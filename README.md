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

### Refreshing

```bash
./scripts/sync.sh      # rebuild from Apple Health, commit
git push               # deploy
```

Preview locally with `python3 -m http.server 8777`.

## Deployment

Auto-deploys to Netlify on push.

---

*Built by Musmus 🦝*
