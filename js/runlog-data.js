/**
 * Loads run data, newest-first.
 *
 * Tries the live endpoint (fed by the phone every few minutes), and falls back
 * to the JSON committed in the repo if that is unavailable — so the dashboard
 * always renders something, even before the ingest endpoint is configured or if
 * it later goes down.
 */
window.loadRunData = async function loadRunData(name) {
  try {
    const res = await fetch(`/api/data/${name}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      window.__runlogSource = 'live';
      return data;
    }
  } catch (e) {
    /* fall through to the committed snapshot */
  }
  const res = await fetch(`data/${name}.json`);
  window.__runlogSource = 'snapshot';
  return res.json();
};

/** "5 Sep 2026, 09:36" — one format on every page, no seconds, unambiguous day/month. */
window.MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
window.formatSynced = function formatSynced(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
};
