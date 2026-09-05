/**
 * Verifies the JS logic in netlify/functions/lib/runlog.mjs, including that
 * its aggregation produces the same numbers as scripts/build_data.py.
 *   node scripts/test_runlog.mjs
 */
import { readFileSync } from 'node:fs';
import {
  normalizePayload, extractRuns, upsertRuns, mergeBootstrap,
  buildStats, buildWeekly, isoWeek, zonesFrom,
} from '../netlify/functions/lib/runlog.mjs';

let failures = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`);
};

const runs = JSON.parse(readFileSync('data/activities.json', 'utf8'));
const pyStats = JSON.parse(readFileSync('data/stats.json', 'utf8'));
const pyWeekly = JSON.parse(readFileSync('data/weekly.json', 'utf8'));

console.log('\n1. aggregation matches build_data.py');
const jsStats = buildStats(runs, new Date(), pyStats.sources);
for (const k of Object.keys(pyStats)) {
  if (k === 'updated_at') continue;
  check(`stats.${k}`, jsStats[k], pyStats[k]);
}
check('weekly (all years)', buildWeekly(runs), pyWeekly);

console.log('\n2. isoWeek matches Python isocalendar');
check('2026-01-01', isoWeek('2026-01-01'), [2026, 1]);
check('2025-12-29', isoWeek('2025-12-29'), [2026, 1]);
check('2017-01-01', isoWeek('2017-01-01'), [2016, 52]);
check('2026-09-02', isoWeek('2026-09-02'), [2026, 36]);

console.log('\n3. payload envelopes all yield the same workout');
const hrSeries = [120, 138, 140, 150, 158, 170].map((Avg) => ({ Avg }));
const w = { name: 'Outdoor Run', start: '2026-12-31 07:32:29 +0700', end: '2026-12-31 08:12:00 +0700',
            duration: 2371, distance: { qty: 4.23, units: 'km' }, id: 'ABC', heartRateData: hrSeries };
for (const [label, body] of [
  ['{data:{workouts}}', { data: { workouts: [w] } }],
  ['{workouts}', { workouts: [w] }],
  ['bare array', [w]],
  ['{data:[...]}', { data: [w] } ],
  ['single object', w],
]) check(label, normalizePayload(body).length, 1);
check('unknown shape', normalizePayload({ foo: 1 }).length, 0);
check('null body', normalizePayload(null).length, 0);

console.log('\n4. extractRuns filters and converts');
const mixed = [w, { name: 'Table Tennis', start: '2026-12-31 10:00:00 +0700', duration: 600 }];
const ex = extractRuns(mixed);
check('only runs kept', ex.length, 1);
check('distance in metres', ex[0].distance, 4230);
check('local time preserved', ex[0].start_date_local, '2026-12-31T07:32:29');
check('zones derived from HR series', ex[0].zones, [17, 33, 17, 17, 16]);

console.log('\n5. HR zones');
check('one sample per zone', zonesFrom([100, 134, 145, 156, 167].map((Avg) => ({ Avg }))), [20, 20, 20, 20, 20]);
check('boundaries are inclusive at the bottom', zonesFrom([133, 134].map((Avg) => ({ Avg }))), [50, 50, 0, 0, 0]);
check('always sums to 100', zonesFrom([1, 2, 3].map((Avg) => ({ Avg }))).reduce((s, v) => s + v, 0), 100);
check('no series -> null', zonesFrom(undefined), null);
check('empty series -> null', zonesFrom([]), null);
check('ignores malformed samples', zonesFrom([{ Avg: 'x' }, { Min: 1 }, { Avg: 140 }]), [0, 100, 0, 0, 0]);
const py = runs.filter((r) => r.source !== 'strava' && r.zones);
check('python snapshot carries zones for watch runs', py.length > 500, true);
check('python zones sum to 100', py.every((r) => r.zones.reduce((s, v) => s + v, 0) === 100), true);
check('strava-only runs have no zones', runs.filter((r) => r.source === 'strava').every((r) => r.zones == null), true);

console.log('\n6. upsert is idempotent and additive');
const base = runs.slice(0, -1);
const newest = extractRuns([w]);
const once = upsertRuns(base, newest);
check('new run added', once.counts.added, 1);
check('length grew by 1', once.runs.length, base.length + 1);
const twice = upsertRuns(once.runs, newest);
check('re-post adds nothing', twice.counts.added, 0);
check('re-post changes nothing', twice.counts.updated, 0);
check('length stable', twice.runs.length, once.runs.length);
check('still sorted', twice.runs.every((r, i, a) => !i || a[i-1].start_date_local <= r.start_date_local), true);

const stravaOnly = [{ type: 'Run', source: 'strava', start_date_local: '2026-12-31T07:30:00',
                      name: 'Sleman', distance: 4200, moving_time: 2300, elapsed_time: 2300,
                      total_elevation_gain: 10, average_heartrate: null, max_heartrate: null, zones: null }];
const merged = upsertRuns(stravaOnly, newest);
check('matched, not duplicated', merged.runs.length, 1);
check('source upgraded to both', merged.runs[0].source, 'both');
check('strava keeps moving_time', merged.runs[0].moving_time, 2300);
check('strava keeps title', merged.runs[0].name, 'Sleman');
check('health supplies distance', merged.runs[0].distance, 4230);
check('health supplies zones', merged.runs[0].zones, [17, 33, 17, 17, 16]);

console.log('\n7. bootstrap merge fills gaps without overwriting');
const stored = runs.slice(0, -2).map((r) => ({ ...r, zones: undefined }));   // store predates zones, lacks 2 runs
stored[10].distance = 1234;                                                    // a phone-supplied value
const mb = mergeBootstrap(stored, runs);
check('missing runs added', mb.counts.added, 2);
check('length now matches seed', mb.runs.length, runs.length);
check('zones filled where seed has them', mb.runs.filter((r) => r.zones).length, runs.filter((r) => r.zones).length);
check('existing value not overwritten', mb.runs.find((r) => r.start_date_local === stored[10].start_date_local).distance, 1234);
check('sorted after adds', mb.runs.every((r, i, a) => !i || a[i-1].start_date_local <= r.start_date_local), true);
const again = mergeBootstrap(mb.runs, runs);
check('second merge is a no-op', again.counts, { added: 0, filled: 0 });

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
