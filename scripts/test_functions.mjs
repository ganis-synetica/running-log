/**
 * Exercises the Netlify handlers with the blob store stubbed in memory:
 *   node --experimental-test-module-mocks scripts/test_functions.mjs
 * Covers auth, routing, payload handling, the ingest -> serve round trip and
 * the bootstrap merge that runs when a new snapshot is committed.
 */
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';

const blobs = new Map();
const fakeStore = {
  get: async (k, o) => (blobs.has(k) ? (o?.type === 'json' ? JSON.parse(blobs.get(k)) : blobs.get(k)) : null),
  set: async (k, v) => void blobs.set(k, v),
  setJSON: async (k, v) => void blobs.set(k, JSON.stringify(v)),
};
mock.module('@netlify/blobs', { namedExports: { getStore: () => fakeStore } });

const { default: ingest } = await import('../netlify/functions/ingest.mjs');
const { default: data } = await import('../netlify/functions/data.mjs');

let failures = 0;
const check = (name, got, want) => {
  const [g, w] = [JSON.stringify(got), JSON.stringify(want)];
  if (g === w) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`);
};

const TOKEN = 'test-token-1234567890';
const post = (body, headers = {}) => new Request('https://x/api/ingest', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const auth = { 'x-api-key': TOKEN };
const get = (f) => data(new Request(`https://x/api/data/${f}`));

const run = { name: 'Outdoor Run', id: 'NEW-RUN-1', start: '2026-12-31 06:00:00 +0700',
              end: '2026-12-31 06:40:00 +0700', duration: 2400, distance: { qty: 5.5, units: 'km' },
              avgHeartRate: { qty: 141, units: 'bpm' },
              heartRateData: [130, 140, 140, 150, 160].map((Avg) => ({ Avg })) };

console.log('\n1. auth and method guards (no blob access)');
delete process.env.HAE_INGEST_TOKEN;
check('no token configured -> 500', (await ingest(post({}, auth))).status, 500);
process.env.HAE_INGEST_TOKEN = TOKEN;
check('GET -> 405', (await ingest(new Request('https://x/api/ingest'))).status, 405);
check('no key -> 401', (await ingest(post({}))).status, 401);
check('wrong key -> 401', (await ingest(post({}, { 'x-api-key': 'nope' }))).status, 401);
check('wrong length key -> 401', (await ingest(post({}, { 'x-api-key': 'short' }))).status, 401);
check('bearer accepted', (await ingest(post({ data: { workouts: [] } }, { authorization: `Bearer ${TOKEN}` }))).status, 200);
check('bad JSON -> 400', (await ingest(post('not json', auth))).status, 400);

console.log('\n2. unrecognised payload is stored, not dropped');
blobs.clear();
const odd = await (await ingest(post({ mystery: true }, auth))).json();
check('reports zero workouts', odd.workouts, 0);
check('raw payload kept', blobs.has('last-unparsed-payload'), true);

console.log('\n3. ingest -> serve round trip');
blobs.clear();
const seed = JSON.parse(readFileSync('data/activities.json', 'utf8'));
const before = seed.length;
const r1 = await (await ingest(post({ data: { workouts: [run] } }, auth))).json();
check('seeded from committed data + 1', r1.total, before + 1);
check('added exactly one', r1.added, 1);
check('fingerprint recorded on seed', blobs.has('seed-fingerprint'), true);
const r2 = await (await ingest(post({ data: { workouts: [run] } }, auth))).json();
check('replay adds nothing', r2.added, 0);
check('replay updates nothing', r2.updated, 0);
check('total unchanged', r2.total, before + 1);

const acts = await (await get('activities')).json();
check('activities served', acts.length, before + 1);
const posted = acts.find((r) => r.health_id === 'NEW-RUN-1');
check('posted run present', !!posted, true);
check('distance in metres', posted.distance, 5500);
check('heart rate carried', posted.average_heartrate, 141);
check('zones computed on ingest', posted.zones, [20, 40, 20, 20, 0]);

const stats = await (await get('stats')).json();
check('stats include the new run', stats.lastRun.date, '2026-12-31');
check('stats distance', stats.lastRun.distance, '5.50');
const weekly = await (await get('weekly')).json();
check('weekly still covers all years', weekly.length >= 10, true);
check('unknown file -> 404', (await get('nope')).status, 404);
check('.json suffix tolerated', (await get('stats.json')).status, 200);

console.log('\n4. a new committed snapshot is merged into an existing store');
blobs.clear();
// A store from before zones existed, missing the two newest runs, with one
// phone-supplied value that must survive.
const old = seed.slice(0, -2).map((r) => ({ ...r, zones: undefined }));
old[5].distance = 4321;
blobs.set('runs', JSON.stringify(old));
blobs.set('seed-fingerprint', 'stale');
const merged = await (await get('activities')).json();
check('missing runs added', merged.length, seed.length);
check('zones filled from snapshot', merged.filter((r) => r.zones).length, seed.filter((r) => r.zones).length);
check('phone value kept', merged.find((r) => r.start_date_local === old[5].start_date_local).distance, 4321);
check('fingerprint updated', blobs.get('seed-fingerprint') !== 'stale', true);
const writes = blobs.get('runs');
await get('activities');
check('same snapshot -> no rewrite', blobs.get('runs') === writes, true);

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
