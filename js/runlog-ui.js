/**
 * Shared UI pieces for the run log: the run table, the week day-strip, the
 * month heatmap and the cumulative year chart. Used by This Week, This Month
 * and All Time so the same run row is not maintained in three places.
 */

window.ZONE_LABELS = ['Z1 <134', 'Z2 134–144', 'Z3 145–155', 'Z4 156–166', 'Z5 167+'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** API record -> the shape every table and list renders from. */
window.mapRun = function mapRun(a) {
  const km = a.distance / 1000;
  const min = a.moving_time / 60;
  const zones = Array.isArray(a.zones) && a.zones.length === 5 ? a.zones : null;
  return {
    date: a.start_date_local.split('T')[0],
    year: a.start_date_local.slice(0, 4),
    name: (a.name || 'Run').split(',')[0].slice(0, 25),
    distance: km.toFixed(2),
    distNum: km,
    time: Math.round(min),
    pace: km ? `${(min / km).toFixed(2)}/km` : '—',
    paceNum: km ? min / km : null,
    zones,
    intensity: zones ? zones.reduce((s, p, i) => s + p * (i + 1), 0) / 100 : null,
  };
};

window.zoneBar = function zoneBar(zones) {
  if (!zones) return '<span class="zone-none">—</span>';
  const title = zones.map((p, i) => `${ZONE_LABELS[i]}: ${p}%`).join('\n');
  const segs = zones.map((p, i) => (p ? `<span class="z${i + 1}" style="width:${p}%"></span>` : '')).join('');
  return `<div class="zone-bar" title="${title}">${segs}</div>`;
};

/** Rows for a short, already-filtered list (This Week / This Month). */
window.renderRunRows = function renderRunRows(tbody, runs, emptyMessage) {
  if (!runs.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="runs-empty">${emptyMessage}</td></tr>`;
    return;
  }
  tbody.innerHTML = runs.map((r, i) => `
    <tr>
      <td>${runs.length - i}</td>
      <td>${r.date}</td>
      <td>${r.name}</td>
      <td class="distance-col">${r.distance} km</td>
      <td>${r.time} min</td>
      <td>${r.pace}</td>
      <td>${zoneBar(r.zones)}</td>
    </tr>`).join('');
};

// ------------------------------------------------------------- week strip

/** Monday of the week containing `d`, as YYYY-MM-DD. */
window.mondayOf = function mondayOf(d) {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
};

/**
 * Seven days, Monday to Sunday, bar height by distance. A gradient across
 * seven cells reads as noise; the shape of the week is what matters.
 */
window.renderDayStrip = function renderDayStrip(el, runs, weekStart) {
  const start = new Date(`${weekStart}T00:00:00`);
  const byDay = new Map();
  runs.forEach((r) => {
    const cur = byDay.get(r.date) || { km: 0, runs: 0 };
    cur.km += r.distNum;
    cur.runs++;
    byDay.set(r.date, cur);
  });
  const max = Math.max(1, ...[...byDay.values()].map((v) => v.km));
  const today = new Date().toISOString().slice(0, 10);

  el.innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const v = byDay.get(key);
    const pct = v ? Math.max(12, (v.km / max) * 100) : 0;
    const cls = ['day-col', v ? 'has-run' : 'rest', key === today ? 'is-today' : '', key > today ? 'future' : ''].join(' ');
    const title = v ? `${key}: ${v.km.toFixed(2)} km` : `${key}: rest`;
    return `<div class="${cls}" title="${title}">
        <div class="day-bar-track"><div class="day-bar" style="height:${pct}%"></div></div>
        <div class="day-km">${v ? v.km.toFixed(1) : '·'}</div>
        <div class="day-label">${label}</div>
      </div>`;
  }).join('');
};

// ---------------------------------------------------------- month heatmap

/**
 * Year rows x 12 fixed month columns. Absolute colour scale on purpose: a
 * per-year scale makes a weak year look as busy as a strong one.
 */
window.renderMonthHeatmap = function renderMonthHeatmap(el, months, onTip) {
  const byYear = new Map();
  months.forEach((m) => {
    const [y, mo] = m.ym.split('-');
    if (!byYear.has(y)) byYear.set(y, new Map());
    byYear.get(y).set(Number(mo), m);
  });
  // Fixed km thresholds, not a fraction of the max: monthly volume is skewed
  // (28 of 95 months are under 20 km) so a linear split made a 1 km month and
  // a 30 km month the same colour.
  const LEVELS = [20, 45, 75, 110];

  const head = `<div class="mh-row mh-head"><div class="mh-year"></div>
    <div class="mh-cells">${MONTH_NAMES.map((n) => `<div class="mh-col-label">${n[0]}</div>`).join('')}</div>
    <div class="mh-total"></div></div>`;

  const rows = [...byYear.keys()].sort().reverse().map((y) => {
    const ms = byYear.get(y);
    let total = 0, runs = 0;
    const cells = [];
    for (let mo = 1; mo <= 12; mo++) {
      const m = ms.get(mo);
      let cls = 'mh-cell';
      if (m && m.km > 0) {
        total += m.km; runs += m.runs;
        cls += ` lvl-${LEVELS.filter((t) => m.km >= t).length + 1}`;
      }
      const info = m && m.km > 0
        ? `${MONTH_NAMES[mo - 1]} ${y}: ${m.km.toFixed(1)} km, ${m.runs} runs`
        : `${MONTH_NAMES[mo - 1]} ${y}: no runs`;
      cells.push(`<div class="${cls}" data-info="${info}"></div>`);
    }
    return `<div class="mh-row"><div class="mh-year">${y}</div>
      <div class="mh-cells">${cells.join('')}</div>
      <div class="mh-total"><strong>${total.toFixed(0)} km</strong> / ${runs}</div></div>`;
  }).join('');

  el.innerHTML = head + rows;
  if (onTip) el.querySelectorAll('.mh-cell').forEach(onTip);
};

// ------------------------------------------------------- cumulative chart

/**
 * Cumulative km by month, one line per year. Cumulative rather than per-month
 * so the gap between two years is readable at any point on the x-axis.
 */
window.renderCumulativeChart = function renderCumulativeChart(el, months, opts) {
  const { current, previous, best } = opts;
  const byYear = new Map();
  months.forEach((m) => {
    const [y, mo] = m.ym.split('-');
    if (!byYear.has(y)) byYear.set(y, new Array(12).fill(0));
    byYear.get(y)[Number(mo) - 1] = m.km;
  });

  const nowMonth = new Date().getMonth() + 1;
  const series = [...byYear.keys()].sort().map((y) => {
    let cum = 0;
    const pts = byYear.get(y).map((km, i) => {
      cum += km;
      return (y === current && i + 1 > nowMonth) ? null : cum;
    });
    return { year: y, pts, total: cum };
  });

  const maxKm = Math.max(100, ...series.map((s) => Math.max(...s.pts.filter((p) => p !== null))));
  const W = 760, H = 380, L = 52, R = 16, T = 16, B = 34;
  const x = (i) => L + (i * (W - L - R)) / 11;
  const y = (v) => T + (H - T - B) * (1 - v / maxKm);

  const role = (yr) => (yr === current ? 'cur' : yr === best ? 'best' : yr === previous ? 'prev' : 'other');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((maxKm * f) / 50) * 50);

  const grid = [...new Set(ticks)].map((v) => `
    <line class="ch-grid" x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}"/>
    <text class="ch-axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');

  const xlabels = MONTH_NAMES.map((n, i) =>
    `<text class="ch-axis" x="${x(i)}" y="${H - B + 20}" text-anchor="middle">${n[0]}</text>`).join('');

  const paths = series.map((s) => {
    const d = s.pts.map((v, i) => (v === null ? null : `${i && s.pts[i - 1] !== null ? 'L' : 'M'}${x(i)},${y(v)}`))
      .filter(Boolean).join(' ');
    const last = s.pts.reduce((acc, v, i) => (v === null ? acc : i), 0);
    const dot = s.pts[last] === null ? '' :
      `<circle class="ch-dot ${role(s.year)}" cx="${x(last)}" cy="${y(s.pts[last])}" r="${role(s.year) === 'cur' ? 5 : 3}"/>`;
    return `<g class="ch-series ${role(s.year)}" data-year="${s.year}">
      <path class="ch-line ${role(s.year)}" d="${d}"/>${dot}</g>`;
  }).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="ch-svg" role="img" aria-label="Cumulative kilometres by month, one line per year">
      ${grid}${xlabels}${paths}
    </svg>
    <div class="ch-legend">
      ${series.slice().reverse().map((s) => `
        <button class="ch-chip ${role(s.year)}" data-year="${s.year}" aria-pressed="true">
          ${s.year} <em>${s.total.toFixed(0)} km</em>
        </button>`).join('')}
    </div>`;

  // Click a year to mute or restore its line.
  el.querySelectorAll('.ch-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const g = el.querySelector(`.ch-series[data-year="${chip.dataset.year}"]`);
      const off = chip.classList.toggle('off');
      chip.setAttribute('aria-pressed', String(!off));
      g.classList.toggle('hidden', off);
    });
  });
};
