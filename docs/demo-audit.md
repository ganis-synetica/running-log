# Demo audit — RUN, GANIS, RUN!

Walkthrough of every screen at desktop (1280 px) and phone (390 px) widths, checking for anything a client would notice: placeholder copy, broken images, console errors, inconsistent spacing or typography, empty states, text overflow, and slow loads.

Screens: **This Week** (`index.html`) · **This Year** (`year.html`) · **All Time** (`alltime.html`).

Method: DOM audit in-browser (overflow, clipped text, broken images, failed fonts, placeholder text, `NaN`/`undefined`/`Infinity`), console capture, `performance.timing` locally and `curl` timing against production, plus full-page Chromium screenshots at both widths. Screenshots live in `docs/audit/`, `before-*` for the state audited and `after-*` for the fixed build.

## Pass 1 — baseline (2026-09-05)

| Screen | Issue | Severity | Screenshot |
|---|---|---|---|
| All Time · phone | Page scrolls horizontally: the 7-column run table (645 px) and the weekly heatmap (547 px) both overflow a 375 px viewport instead of scrolling inside their own containers. Full-page capture is 603 px wide for a 390 px viewport | **blocker** | `docs/audit/before-alltime-mobile.png` |
| All Time | Intro copy hardcodes "808 runs" beside the live stat card reading 990 | quirk | `docs/audit/before-alltime-desktop.png` |
| All Time | Zero-distance runs render pace as `NaN/km` (3 rows in 2017) or `Infinity/km` (1 row in 2026) | quirk | `docs/audit/before-alltime-mobile.png` |
| This Year | Comparison labels hardcode "JAN 2025" / "JAN 2021" — the figures are year-to-date through September, so the label is wrong eight months of the year | quirk | `docs/audit/before-year-desktop.png` |
| This Year | Page title, heading, "Of 2021 Pace" label and the stats keys (`ytd_2026`) are hardcoded — the page would show dashes on 1 Jan 2027 | quirk | `docs/audit/before-year-desktop.png` |
| All screens | "Last synced" renders as `9/5/2026, 9:36:10 AM` (US locale, seconds shown) — inconsistent with the site's typography and ambiguous outside the US | nit | `docs/audit/before-index-desktop.png` |
| This Week · phone | Smallest caption text is 10 px | nit | `docs/audit/before-index-mobile.png` |
| All screens · local dev only | Console shows `404` for `/api/data/*` when served by a plain static server; the page falls back to the committed JSON by design. Not present on production (all `/api` calls return 200) | n/a | — |

Checks that passed on every screen: no placeholder or lorem text, no broken images, no failed web fonts, no clipped text at either width, no horizontal overflow on This Week or This Year, no `undefined` in rendered text, no empty states (every year 2017–2026 has runs).

Load times (production, cold `curl`):

| Resource | Time |
|---|---|
| `index.html` | 0.53 s |
| `year.html` | 0.58 s |
| `alltime.html` | 0.40 s |
| `/api/data/stats` | 0.83 s |
| `/api/data/weekly` | 0.87 s |
| `/api/data/activities` (268 KB) | 1.00 s |

Nothing exceeds 2 s. In-browser `loadEventEnd` was under 100 ms on every screen locally.

## Fixes (commit `b91cd6e`)

| Issue | Fix |
|---|---|
| Phone horizontal scroll | Run table wrapped in an `overflow-x: auto` container; heatmap grid scrolls inside `#heatmap`. The page itself no longer scrolls sideways |
| "808 runs" | Intro count is set from the loaded data |
| `NaN/km` / `Infinity/km` | Pace is only computed when distance > 0; otherwise the cell shows `—` |
| "JAN 2025" labels | Period label is derived from the data's timestamp: "JAN–SEP 2025", collapsing to "JAN" in January |
| Hardcoded year everywhere on This Year | Heading, title, comparison years and the "Of … Pace" label all come from `stats.current_year` and `stats.comparison_years`; the stats keys are looked up dynamically |
| Sync timestamp | One helper on every page renders `5 Sep 2026, 09:36` — day-first, fixed English month names, no seconds |
| Found while fixing: stale helper script | A returning visitor could receive the new HTML with a cached old helper for up to 5 minutes, and on All Time that error fired before the table rendered — leaving it empty. The helper is now cache-busted (`?v=2`) and the table renders before the sync line |

## Pass 2 — after fixes (2026-09-05)

Same walk, same checks, on the fixed build locally and on production after deploy.

| Screen | Result | Screenshot |
|---|---|---|
| This Week · desktop | Clean. Sync reads `5 Sep 2026, 09:36` | `docs/audit/after-index-desktop.png` |
| This Week · phone | Clean. No overflow, no clipping. Capture is 390 px wide | `docs/audit/after-index-mobile.png` |
| This Year · desktop | Labels read "VS LAST YEAR (JAN–SEP 2025)" and "VS BEST YEAR (JAN–SEP 2021)"; "OF 2021 PACE"; no dashes left anywhere | `docs/audit/after-year-desktop.png` |
| This Year · phone | Clean. No overflow, no clipped text | `docs/audit/after-year-mobile.png` |
| All Time · desktop | Intro reads "990 runs"; 74 rows render on first paint; zero-distance rows show `—`; zone bar on every 2026 row; zone-mix strip present; sort toggles ▼/▲ on every column | `docs/audit/after-alltime-desktop.png` |
| All Time · phone | **Page no longer scrolls sideways** — `scrollWidth` 375 = viewport. Table and heatmap scroll inside their own containers. Capture is 390 px wide | `docs/audit/after-alltime-mobile.png` |

Console: no errors on any screen on the fixed build (the only entries are the by-design `404`s from `/api` under a static dev server).

Production, after deploy: new markup live at 09:50; `/api/data/activities` carries zones on 543 of 990 runs (the store merged the committed snapshot on first read — the initial "0" was a CDN response cached 60 s before the deploy); All Time renders from the live source with zone bars and the dynamic intro.

### Accepted, not changed

| Screen | Item | Why |
|---|---|---|
| This Week · phone | 10 px captions under the stats | Deliberate Bauhaus caption style, high-contrast, and the values above them are 32–48 px. Bumping it would change the design rather than fix a defect |

### Verdict

Every blocker and quirk is fixed and verified at both widths, locally and in production. The remaining nit is a design choice. **Stopping here: the UI is at the point where further passes would be redesign, not repair.**
