/**
 * POST target for the Health Auto Export "REST API" automation.
 *
 * The phone posts recent workouts on its own cadence; this folds them into the
 * stored run log. All the logic lives in lib/runlog.mjs — this handler only does
 * auth, blob I/O and HTTP.
 */
import { getStore } from '@netlify/blobs';
import { normalizePayload, extractRuns, upsertRuns } from './lib/runlog.mjs';
import { loadRuns, saveRuns, STORE } from './lib/store.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = process.env.HAE_INGEST_TOKEN;
  if (!expected) return json({ error: 'HAE_INGEST_TOKEN is not set on the site' }, 500);
  const supplied = req.headers.get('x-api-key') || bearer(req.headers.get('authorization'));
  if (!safeEqual(supplied, expected)) return json({ error: 'unauthorized' }, 401);

  let body;
  const raw = await req.text();
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'body is not JSON' }, 400);
  }

  const workouts = normalizePayload(body);
  const incoming = extractRuns(workouts);

  // Keep the most recent payload whenever nothing usable came out of it, so an
  // unexpected export shape can be inspected instead of guessed at.
  if (!workouts.length) {
    await getStore(STORE).set('last-unparsed-payload', raw.slice(0, 512 * 1024));
    return json({ ok: true, workouts: 0, runs: 0, note: 'no workouts found; raw payload stored for inspection' });
  }

  const existing = await loadRuns();
  const { runs, counts } = upsertRuns(existing, incoming);
  if (counts.added || counts.updated) await saveRuns(runs);

  return json({ ok: true, workouts: workouts.length, runs: incoming.length, ...counts, total: runs.length });
};

const bearer = (h) => (h && /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '') : null);

function safeEqual(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export const config = { path: '/api/ingest' };
