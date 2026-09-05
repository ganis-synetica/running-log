/**
 * Blob-backed storage for the run log.
 *
 * The store is seeded from the data/activities.json committed in the repo —
 * the merge of Apple Health and the frozen Strava archive, rebuilt locally
 * from the full 465 MB export. The phone then keeps it current with deltas.
 *
 * Whenever a new snapshot is committed (its fingerprint changes), the store is
 * brought up to date with it: runs the phone never sent are added and missing
 * fields are filled, without ever overwriting what the phone supplied. That
 * makes `scripts/sync.sh` + push a real repair path.
 */
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mergeBootstrap } from './runlog.mjs';

export const STORE = 'runlog';
const KEY = 'runs';
const FP_KEY = 'seed-fingerprint';

export const SOURCES = {
  primary: 'Apple Health via Health Auto Export (POST /api/ingest)',
  backfill: 'data/strava-archive.json (frozen)',
};

const here = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  resolve(process.cwd(), 'data/activities.json'),
  resolve(here, '../../../data/activities.json'),
];

let seedCache = null;

/** The committed merge and a fingerprint of it, read once per warm function. */
function bootstrap() {
  if (seedCache) return seedCache;
  for (const p of CANDIDATES) {
    try {
      const text = readFileSync(p, 'utf8');
      seedCache = { runs: JSON.parse(text), fp: createHash('sha1').update(text).digest('hex') };
      return seedCache;
    } catch { /* try next */ }
  }
  console.warn('bootstrap data/activities.json not found; starting empty');
  seedCache = { runs: [], fp: 'none' };
  return seedCache;
}

export async function loadRuns() {
  const store = getStore(STORE);
  const seed = bootstrap();
  const stored = await store.get(KEY, { type: 'json' });

  if (!Array.isArray(stored) || !stored.length) {
    if (seed.runs.length) {
      await store.setJSON(KEY, seed.runs);
      await store.set(FP_KEY, seed.fp);
    }
    return seed.runs;
  }

  if ((await store.get(FP_KEY)) === seed.fp) return stored;

  const { runs, counts } = mergeBootstrap(stored, seed.runs);
  if (counts.added || counts.filled) {
    await store.setJSON(KEY, runs);
    console.log(`bootstrap merge: +${counts.added} runs, ${counts.filled} filled`);
  }
  await store.set(FP_KEY, seed.fp);
  return runs;
}

export async function saveRuns(runs) {
  await getStore(STORE).setJSON(KEY, runs);
}
