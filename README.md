# Running Log 🏃

Personal running dashboard, built from local Apple Health data.

**Goal:** Run 3x/week in 2026 — Movement as Identity Anchor

## Features

- YTD vs Last Year comparison
- YTD vs Best Year (2021) comparison  
- Weekly performance tracking
- Goal progress visualization
- Bauhaus-inspired design

## Data

The log is built **locally** from the [Health Auto Export](https://www.healthyapps.dev) folder in
iCloud — no API tokens, no rate limits, and it is current the moment a run finishes syncing
to Apple Health.

| Source | Role | Covers | Refresh |
|---|---|---|---|
| Apple Health export (iCloud) | Primary | 2018 → today | Automatic, on device |
| `data/strava-archive.json` | Backfill | 2017, 2022 + gaps in 2018/2021/2023 | Manual workflow |

Neither source is complete on its own — they share only 551 of 986 runs — so
`scripts/build_data.py` matches runs by start time (±30 min) and merges them. On a matched
pair, Apple Health supplies distance and heart rate; Strava supplies moving time (which
excludes pauses) and the run title.

Outputs keep the original Strava-shaped schema, so the dashboards read them unchanged:

- `data/activities.json` — the merged run log
- `data/stats.json` — week, YTD and comparison-year figures
- `data/weekly.json` — per-year, per-ISO-week totals for the heatmap

### How it stays current

The phone is the source of truth. Health Auto Export posts new workouts to
`/api/ingest` on its own cadence; the function folds them into a blob store, and
the dashboards read `/api/data/*` at request time. **No sync step, no commit, no
redeploy** — and none of it depends on the Mac being awake.

```
 Apple Watch ─▶ Apple Health ─▶ Health Auto Export (iPhone)
                                        │  POST every 15 min
                                        ▼
                            /api/ingest ──▶ Netlify Blobs
                                                  │
        index · year · alltime  ◀── /api/data/* ──┘
                    │
                    └─ falls back to data/*.json if the API is unavailable
```

The store is seeded once from the `data/activities.json` committed here — the
988-run merge of Apple Health and the frozen Strava archive. After that the phone
only ever sends deltas, so the 465 MB local export is never reprocessed.

The pages **fall back to the committed `data/*.json`** whenever the API does not
answer, so the dashboard always renders even if the endpoint is misconfigured or
down. That snapshot is refreshed by the local rebuild below.

### Setup (one time)

1. **Set the shared secret** on the Netlify site — Site configuration →
   Environment variables → `HAE_INGEST_TOKEN`. Generate one with:
   ```bash
   openssl rand -hex 32
   ```
2. **Point the phone at it.** In Health Auto Export → Automations, change the
   existing automation's destination from iCloud Drive to **REST API**:
   - URL: `https://<your-site>.netlify.app/api/ingest`
   - Method: POST, Format: JSON
   - Header: `x-api-key` = the token from step 1
   - Turn **off** "Include Routes" — GPS traces are large and unused here.

   Leave the existing iCloud automation in place; the local rebuild depends on it.

### Local rebuild (repair path)

Still the way to rebuild from the full local archive — after a gap in the phone
sync, or to refresh the committed fallback snapshot:

```bash
./scripts/sync.sh      # rebuild from the iCloud export, commit
npm test               # aggregation parity + handler round trip
```

Preview locally with `python3 -m http.server 8777` (the pages fall back to the
committed JSON, since `/api` only exists on Netlify).

## Deployment

Auto-deploys to Netlify on push.

---

*Built by Musmus 🦝*
