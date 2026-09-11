# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A personal running dashboard: four static pages backed by Apple Health data. No build step, no framework.

## Commands

```bash
npm test                       # both suites; run before every commit
node scripts/test_runlog.mjs   # pure logic + Python/JS aggregation parity
node --experimental-test-module-mocks scripts/test_functions.mjs   # Netlify handlers, blob store stubbed

python3 scripts/build_data.py  # rebuild data/*.json from the iCloud Health export
./scripts/sync.sh              # build_data.py + commit (--no-commit to skip)

python3 -m http.server 8777    # preview; .claude/launch.json defines the same for preview_start
```

There is no linter and no build. Deploys are a static file copy on push to `main`.

## Architecture

### Three planes of the same data

| Plane | Lives in | Role |
|---|---|---|
| Source | `~/Library/Mobile Documents/iCloud~com~ifunography~HealthExport/` | ~465 MB of daily Health Auto Export JSON. Mac-only |
| Snapshot | `data/*.json` (committed) | Browser fallback **and** the seed for the live store |
| Live | Netlify Blobs, store `runlog` | What the deployed site actually serves |

The phone POSTs workouts to `/api/ingest` on its own cadence; the function folds them into the blob store; pages read `/api/data/*` at request time. Nothing depends on the Mac being awake.

`scripts/sync.sh` is the repair path: it rebuilds the snapshot from the full local archive. Because the store re-merges whenever the snapshot's fingerprint changes (below), committing a rebuilt snapshot also repairs the live store.

### Two implementations that must agree

`scripts/build_data.py` (local rebuild) and `netlify/functions/lib/runlog.mjs` (live) compute the same aggregates in different languages. **`test_runlog.mjs` asserts the JS output is byte-identical to the committed Python output across every run and year.** Change one, change the other, or the test fails — that is the point of it.

Same rule for `ZONE_EDGES`: heart-rate zone boundaries are duplicated in `scripts/health_common.py` and `runlog.mjs` and must match.

### Merge rules

Neither source is complete, so runs are matched **by start time within 30 minutes**:

- **Apple Health + Strava matched** → Health supplies distance, heart rate and zones; Strava supplies `moving_time` (excludes pauses) and the run title.
- **`mergeBootstrap`** (store vs. committed snapshot) only ever *fills* gaps. A value the phone supplied is never overwritten. Keyed on a sha1 fingerprint of `data/activities.json`, so a new commit triggers exactly one merge.
- `data/strava-archive.json` is frozen history. The GitHub workflow refreshes it manually and never runs on a schedule — a cron here would clobber the merge.

### Front end

Four pages, one signature visual each, so nothing is duplicated across them:

| Page | Visual | Data |
|---|---|---|
| `index.html` — This Week | day strip + week heatmap | `summary`, `weekly` |
| `month.html` — This Month | year rows × 12 months | `summary` |
| `year.html` — This Year | cumulative km, one line per year | `summary` |
| `alltime.html` — All Time | full sortable run log | `activities` |

- `js/runlog-data.js` — `loadRunData(name)` tries `/api/data/<name>`, falls back to `data/<name>.json`, and records which in `window.__runlogSource`.
- `js/runlog-ui.js` — every shared widget: run rows, zone bars, day strip, both heatmaps, the cumulative chart.
- `data/summary.json` is the slim payload (per-month totals + last 62 days of runs, ~24 KB). Only All Time loads the full `activities.json` (~380 KB). Keep it that way.

Pure functions in `runlog.mjs` and `runlog-ui.js` hold the logic; the Netlify handlers only do auth, blob I/O and HTTP.

## Gotchas that have caused real bugs

- **Cache-bust shared assets.** `netlify.toml` sets `max-age=300` on everything. Editing `js/*.js` or `css/shared.css` without bumping the `?v=N` query in **all four** HTML files ships new markup against a stale script or stylesheet. This has broken the site twice — once blanking the run log, once rendering the chart with no line colours.
- **`/api` does not exist locally.** Pages fall back to committed JSON; the 404s in the console are by design. Check `window.__runlogSource` to tell `live` from `snapshot`.
- **`/api/data/*` is CDN-cached for 60s.** Verifying immediately after a deploy can return the old body. Append `?nocache=$(date +%s)`.
- **Netlify env var changes need a redeploy** to take effect.
- **Grid and flex children default to `min-width: auto`,** so a wide table opens its track and scrolls the whole page sideways on mobile. Pin `min-width: 0` and let `.table-scroll` handle it.
- **Test fixtures are dated `2026-12-31`** so they cannot collide with a real run as the data grows.
- **Absolute colour scales in the month heatmap are deliberate.** Normalising per year makes a weak year look as busy as a strong one.

## Verifying UI changes

The in-app browser pane intermittently returns blank or misaligned screenshots. Prefer DOM assertions via `javascript_tool`; when a real screenshot is needed, Playwright's bundled Chromium in the scratchpad is reliable and system headless Chrome hangs on this machine. Past audits and before/after captures live in `docs/demo-audit.md` and `docs/audit/`.
