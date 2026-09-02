/**
 * Verifies the JS aggregation in netlify/functions/lib/runlog.mjs produces the
 * same numbers as scripts/build_data.py. Run after changing either one:
 *   node scripts/test_runlog.mjs
 */
import { readFileSync } from 'node:fs';
import {
  normalizePayload, extractRuns, upsertRuns, buildStats, buildWeekly, isoWeek,
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
const w = { name: 'Outdoor Run', start: '2026-09-02 07:32:29 +0700', end: '2026-09-02 08:12:00 +0700',
            duration: 2371, distance: { qty: 4.23, units: 'km' }, id: 'ABC' };
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
const mixed = [w, { name: 'Table Tennis', start: '2026-09-02 10:00:00 +0700', duration: 600 }];
const ex = extractRuns(mixed);
check('only runs kept', ex.length, 1);
check('distance in metres', ex[0].distance, 4230);
check('local time preserved', ex[0].start_date_local, '2026-09-02T07:32:29');

console.log('\n5. upsert is idempotent and additive');
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

const stravaOnly = [{ type: 'Run', source: 'strava', start_date_local: '2026-09-02T07:30:00',
                      name: 'Sleman', distance: 4200, moving_time: 2300, elapsed_time: 2300,
                      total_elevation_gain: 10, average_heartrate: null, max_heartrate: null }];
const merged = upsertRuns(stravaOnly, newest);
check('matched, not duplicated', merged.runs.length, 1);
check('source upgraded to both', merged.runs[0].source, 'both');
check('strava keeps moving_time', merged.runs[0].moving_time, 2300);
check('strava keeps title', merged.runs[0].name, 'Sleman');
check('health supplies distance', merged.runs[0].distance, 4230);

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
