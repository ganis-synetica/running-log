/**
 * Exercises the Netlify handlers with the blob store stubbed in memory:
 *   node --experimental-test-module-mocks scripts/test_functions.mjs
 * Covers auth, routing, payload handling and the ingest -> serve round trip.
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

const run = { name: 'Outdoor Run', id: 'NEW-RUN-1', start: '2026-09-03 06:00:00 +0700',
              end: '2026-09-03 06:40:00 +0700', duration: 2400, distance: { qty: 5.5, units: 'km' },
              avgHeartRate: { qty: 141, units: 'bpm' } };

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
const r2 = await (await ingest(post({ data: { workouts: [run] } }, auth))).json();
check('replay adds nothing', r2.added, 0);
check('replay updates nothing', r2.updated, 0);
check('total unchanged', r2.total, before + 1);

const get = (f) => data(new Request(`https://x/api/data/${f}`));
const acts = await (await get('activities')).json();
check('activities served', acts.length, before + 1);
check('newest run is the posted one', acts[acts.length - 1].health_id, 'NEW-RUN-1');
check('distance in metres', acts[acts.length - 1].distance, 5500);
check('heart rate carried', acts[acts.length - 1].average_heartrate, 141);

const stats = await (await get('stats')).json();
check('stats include the new run', stats.lastRun.date, '2026-09-03');
check('stats distance', stats.lastRun.distance, '5.50');
const weekly = await (await get('weekly')).json();
check('weekly still covers all years', weekly.length >= 10, true);
check('unknown file -> 404', (await get('nope')).status, 404);
check('.json suffix tolerated', (await get('stats.json')).status, 200);

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
