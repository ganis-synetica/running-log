/**
 * Blob-backed storage for the run log.
 *
 * The store is seeded once from the data/activities.json committed in the repo —
 * the 988-run merge of Apple Health and the frozen Strava archive. After that the
 * phone only ever posts deltas, so the 465 MB local export is never reprocessed.
 */
import { getStore } from '@netlify/blobs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const STORE = 'runlog';
const KEY = 'runs';

export const SOURCES = {
  primary: 'Apple Health via Health Auto Export (POST /api/ingest)',
  backfill: 'data/strava-archive.json (frozen)',
};

const here = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  resolve(process.cwd(), 'data/activities.json'),
  resolve(here, '../../../data/activities.json'),
];

/** The committed merge, used to seed an empty store. */
function bootstrap() {
  for (const p of CANDIDATES) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch { /* try next */ }
  }
  console.warn('bootstrap data/activities.json not found; starting empty');
  return [];
}

export async function loadRuns() {
  const store = getStore(STORE);
  const stored = await store.get(KEY, { type: 'json' });
  if (Array.isArray(stored) && stored.length) return stored;

  const seed = bootstrap();
  if (seed.length) await store.setJSON(KEY, seed);
  return seed;
}

export async function saveRuns(runs) {
  await getStore(STORE).setJSON(KEY, runs);
}
