/**
 * Serves the run log to the dashboards at request time, so new runs appear
 * without a rebuild. Falls back to the committed data/*.json in the browser
 * (see js/runlog-data.js) if this is ever unavailable.
 */
import { buildStats, buildWeekly, buildSummary } from './lib/runlog.mjs';
import { loadRuns, SOURCES } from './lib/store.mjs';

const FILES = new Set(['stats', 'weekly', 'activities', 'summary']);

export default async (req) => {
  const file = new URL(req.url).pathname.split('/').pop().replace(/\.json$/, '');
  if (!FILES.has(file)) return json({ error: `unknown file '${file}'` }, 404);

  const runs = await loadRuns();
  const body = file === 'stats' ? buildStats(runs, new Date(), SOURCES)
    : file === 'weekly' ? buildWeekly(runs)
    : file === 'summary' ? buildSummary(runs)
    : runs;

  return json(body, 200, { 'cache-control': 'public, max-age=60' });
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });

export const config = { path: '/api/data/:file' };
