/**
 * Pure run-log logic — no dependencies, no I/O.
 *
 * Mirrors scripts/build_data.py so the served numbers match a local rebuild.
 * The Netlify handlers wrap this with blob storage and HTTP; everything that
 * can actually be wrong lives here, where it can be tested directly.
 */

export const RUN_NAMES = new Set([
  'Outdoor Run', 'Indoor Run', 'Run', 'Running', 'Trail Run',
]);

// Heart-rate zone boundaries as configured on Ganis' Apple Watch (bpm):
//   Z1 <134 | Z2 134-144 | Z3 145-155 | Z4 156-166 | Z5 167+
// Must match ZONE_EDGES in scripts/health_common.py.
export const ZONE_EDGES = [134, 145, 156, 167];

const MATCH_WINDOW_MS = 30 * 60 * 1000;
export const WEEKLY_GOAL = 3;

// ------------------------------------------------------------------ payload

/**
 * Health Auto Export's REST payload shape is not documented against a live
 * sample here, so accept every plausible envelope and dig out the workouts.
 * Anything unrecognised returns [] and the caller keeps the raw body for
 * inspection rather than throwing.
 */
export function normalizePayload(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body.filter(isWorkoutish);
  if (Array.isArray(body?.data?.workouts)) return body.data.workouts;
  if (Array.isArray(body?.workouts)) return body.workouts;
  if (Array.isArray(body?.data)) return body.data.filter(isWorkoutish);
  // { data: { workouts: {...single} } } and other stragglers
  if (isWorkoutish(body?.data?.workouts)) return [body.data.workouts];
  if (isWorkoutish(body)) return [body];
  return [];
}

function isWorkoutish(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o) && 'start' in o && 'name' in o;
}

const TS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;

/** Keep the workout's own local wall-clock time; never shift to UTC. */
export function parseLocal(ts) {
  const m = TS.exec(String(ts || '').trim());
  return m ? `${m[1]}T${m[2]}` : null;
}

function qty(field) {
  const v = field?.qty;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Percent of per-minute HR samples in each zone, [Z1..Z5], summing to 100. */
export function zonesFrom(series) {
  const hr = (series || [])
    .map((x) => x?.Avg)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!hr.length) return null;
  const counts = [0, 0, 0, 0, 0];
  for (const h of hr) counts[ZONE_EDGES.filter((e) => h >= e).length]++;
  return percent(counts, hr.length);
}

/** Largest-remainder rounding so the five percentages always sum to 100. */
function percent(counts, n) {
  const raw = counts.map((c) => (c * 100) / n);
  const base = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - base[i], i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const left = 100 - base.reduce((s, v) => s + v, 0);
  for (const [, i] of order.slice(0, left)) base[i]++;
  return base;
}

/** Convert raw Health workouts into the Strava-shaped records the pages read. */
export function extractRuns(workouts) {
  const out = [];
  for (const w of workouts || []) {
    if (!RUN_NAMES.has(w?.name)) continue;
    const start = parseLocal(w.start);
    if (!start) continue;
    const km = qty(w.distance) ?? 0;
    const secs = Math.round(Number(w.duration) || 0);
    out.push({
      type: 'Run',
      source: 'health',
      health_id: w.id || `${start}|${km.toFixed(3)}`,
      start_date_local: start,
      name: w.name || 'Run',
      distance: Math.round(km * 1000 * 10) / 10,
      moving_time: secs,
      elapsed_time: secs,
      total_elevation_gain: qty(w.elevationUp) ?? 0,
      average_heartrate: qty(w.avgHeartRate),
      max_heartrate: qty(w.maxHeartRate),
      zones: zonesFrom(w.heartRateData),
    });
  }
  return out;
}

// ------------------------------------------------------------------- upsert

const ms = (s) => new Date(`${s}Z`).getTime();

function findMatch(runs, byHealthId, rec) {
  if (rec.health_id && byHealthId.has(rec.health_id)) return byHealthId.get(rec.health_id);
  const t = ms(rec.start_date_local);
  let idx = -1, best = Infinity;
  runs.forEach((r, i) => {
    const gap = Math.abs(ms(r.start_date_local) - t);
    if (gap <= MATCH_WINDOW_MS && gap < best) { best = gap; idx = i; }
  });
  return idx;
}

const bySort = (a, b) => a.start_date_local.localeCompare(b.start_date_local);

/**
 * Fold incoming Health runs into the stored log.
 *
 * Matches an existing record by health_id, else by start time within 30 min —
 * the same rule scripts/build_data.py uses. On a match with a Strava record,
 * Health supplies distance and heart rate while Strava keeps moving_time
 * (which excludes pauses) and the run title.
 */
export function upsertRuns(existing, incoming) {
  const runs = existing.map((r) => ({ ...r }));
  const byHealthId = new Map();
  runs.forEach((r, i) => r.health_id && byHealthId.set(r.health_id, i));

  const counts = { added: 0, updated: 0, unchanged: 0 };

  for (const inc of incoming) {
    const idx = findMatch(runs, byHealthId, inc);

    if (idx < 0) {
      runs.push(inc);
      byHealthId.set(inc.health_id, runs.length - 1);
      counts.added++;
      continue;
    }

    const cur = runs[idx];
    const merged = { ...cur };
    merged.health_id = inc.health_id;
    merged.distance = inc.distance || cur.distance;
    merged.average_heartrate = inc.average_heartrate ?? cur.average_heartrate;
    merged.max_heartrate = inc.max_heartrate ?? cur.max_heartrate;
    merged.total_elevation_gain = inc.total_elevation_gain || cur.total_elevation_gain;
    merged.elapsed_time = inc.elapsed_time || cur.elapsed_time;
    merged.zones = inc.zones ?? cur.zones ?? null;
    if (cur.source === 'health') {
      merged.moving_time = inc.moving_time || cur.moving_time;
      merged.start_date_local = inc.start_date_local;
    }
    merged.source = cur.source === 'health' ? 'health' : 'both';

    if (JSON.stringify(merged) === JSON.stringify(cur)) counts.unchanged++;
    else { runs[idx] = merged; counts.updated++; }
    byHealthId.set(inc.health_id, idx);
  }

  runs.sort(bySort);
  return { runs, counts };
}

/**
 * Bring the stored log up to date with the merge committed in the repo.
 *
 * The repo snapshot is rebuilt from the full local archive, so it can carry
 * runs and fields (like zones) the phone never sent. This only ever FILLS
 * gaps — a value the phone supplied is never overwritten — and adds runs the
 * store has not seen.
 */
export function mergeBootstrap(stored, seed) {
  const runs = stored.map((r) => ({ ...r }));
  const byHealthId = new Map();
  runs.forEach((r, i) => r.health_id && byHealthId.set(r.health_id, i));

  const counts = { added: 0, filled: 0 };

  for (const s of seed) {
    const idx = findMatch(runs, byHealthId, s);
    if (idx < 0) {
      runs.push({ ...s });
      if (s.health_id) byHealthId.set(s.health_id, runs.length - 1);
      counts.added++;
      continue;
    }
    const cur = runs[idx];
    let touched = false;
    for (const k of Object.keys(s)) {
      if ((cur[k] === undefined || cur[k] === null) && s[k] !== undefined && s[k] !== null) {
        cur[k] = s[k];
        touched = true;
      }
    }
    if (touched) counts.filled++;
    if (cur.health_id) byHealthId.set(cur.health_id, idx);
  }

  if (counts.added) runs.sort(bySort);
  return { runs, counts };
}

// -------------------------------------------------------------- aggregation

const round = (n, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

function totals(runs) {
  return {
    runs: runs.length,
    distance_km: round(runs.reduce((s, r) => s + r.distance, 0) / 1000),
    time_hrs: round(runs.reduce((s, r) => s + r.moving_time, 0) / 3600),
  };
}

const inRange = (runs, lo, hi) =>
  runs.filter((r) => r.start_date_local.slice(0, 10) >= lo && r.start_date_local.slice(0, 10) < hi);

const iso = (d) => d.toISOString().slice(0, 10);

/** ISO-8601 week, matching Python's date.isocalendar(). */
export function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;          // Mon = 0
  d.setUTCDate(d.getUTCDate() - day + 3);        // nearest Thursday
  const year = d.getUTCFullYear();
  const firstThu = new Date(Date.UTC(year, 0, 4));
  const fDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fDay + 3);
  return [year, 1 + Math.round((d - firstThu) / (7 * 86400000))];
}

export function buildStats(runs, now = new Date(), sources = {}) {
  const y = now.getFullYear();
  const prev = y - 1;
  const md = `-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const ws = iso(new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate())));
  const lastMon = new Date(monday);
  lastMon.setDate(lastMon.getDate() - 7);
  const ls = iso(new Date(Date.UTC(lastMon.getFullYear(), lastMon.getMonth(), lastMon.getDate())));

  const byYear = new Map();
  for (const r of runs) {
    const k = Number(r.start_date_local.slice(0, 4));
    if (!byYear.has(k)) byYear.set(k, []);
    byYear.get(k).push(r);
  }
  let best = prev, bestKm = -1;
  for (const [yr, rs] of byYear) {
    if (yr >= y) continue;
    const km = rs.reduce((s, r) => s + r.distance, 0);
    if (km > bestKm) { bestKm = km; best = yr; }
  }

  const week = (lo, hi) => {
    const sel = inRange(runs, lo, hi);
    const t = totals(sel);
    return {
      runs: t.runs,
      distance_km: t.distance_km,
      time_min: Math.round(sel.reduce((s, r) => s + r.moving_time, 0) / 60),
    };
  };

  const last = runs[runs.length - 1] || null;
  const km = last ? last.distance / 1000 : 0;

  return {
    current_year: String(y),
    [`ytd_${y}`]: totals(inRange(runs, `${y}-01-01`, `${y + 1}-01-01`)),
    [`ytd_${prev}_same_period`]: totals(inRange(runs, `${prev}-01-01`, `${prev}${md}`)),
    [`ytd_${best}_same_period`]: totals(inRange(runs, `${best}-01-01`, `${best}${md}`)),
    [`full_year_${prev}`]: totals(byYear.get(prev) || []),
    [`full_year_${best}`]: totals(byYear.get(best) || []),
    comparison_years: { previous: String(prev), best: String(best) },
    weekly_goal: WEEKLY_GOAL,
    this_week: week(ws, '9999'),
    last_week: week(ls, ws),
    lastRun: last && {
      date: last.start_date_local.slice(0, 10),
      distance: km.toFixed(2),
      pace: km ? ((last.moving_time / 60) / km).toFixed(2) : '0.00',
    },
    sources,
    updated_at: new Date().toISOString(),
  };
}

export function buildWeekly(runs) {
  const years = new Map();
  for (const r of runs) {
    const [yr, wk] = isoWeek(r.start_date_local.slice(0, 10));
    if (!years.has(yr)) years.set(yr, new Map());
    const weeks = years.get(yr);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk).push(r);
  }
  return [...years.keys()].sort().map((yr) => {
    const weeks = years.get(yr);
    const flat = [...weeks.values()].flat();
    return {
      year: String(yr),
      total_runs: flat.length,
      total_distance: round(flat.reduce((s, r) => s + r.distance, 0) / 1000),
      weeks: [...weeks.keys()].sort((a, b) => a - b).map((n) => ({
        week_num: n,
        runs: weeks.get(n).length,
        distance_km: round(weeks.get(n).reduce((s, r) => s + r.distance, 0) / 1000),
      })),
    };
  });
}
