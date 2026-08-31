#!/usr/bin/env python3
"""Rebuild the running log from local Apple Health data.

Primary source : Health Auto Export JSON in iCloud (fresh, updates daily, no API).
Backfill source: data/strava-archive.json — a frozen snapshot of the Strava history
                 covering periods the Health export never captured (2017, 2022, and
                 patches of 2018/2021/2023 when the export app was not running).

Neither source is complete on its own, so runs are matched by start time and merged.
Outputs keep the original Strava-shaped schema so the dashboards need no changes.
"""
import json, os, sys, collections
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from health_common import collect_runs, EXPORT_DIR

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ARCHIVE = os.path.join(DATA, 'strava-archive.json')

MATCH_WINDOW_S = 1800   # runs starting within 30 min of each other are the same run
WEEKLY_GOAL = 3


def dt(s):
    return datetime.fromisoformat(s[:19])


def load_health():
    if not os.path.isdir(EXPORT_DIR):
        sys.exit(f'Health export folder not found:\n  {EXPORT_DIR}')
    runs = collect_runs()
    if not runs:
        sys.exit('Health export folder contained no run workouts.')
    return runs


def load_archive():
    if not os.path.exists(ARCHIVE):
        print('  ! no strava-archive.json — building from Health export only')
        return []
    with open(ARCHIVE) as fh:
        return [a for a in json.load(fh) if a.get('type') == 'Run']


def merge(health, strava):
    """Match by start-time proximity. Health wins on distance, Strava on moving time/name."""
    pool = [[dt(r['start_local']), r, False] for r in health]
    merged, stats = [], collections.Counter()

    for a in strava:
        st = dt(a['start_date_local'])
        hit = None
        for row in pool:
            if row[2]:
                continue
            gap = abs((row[0] - st).total_seconds())
            if gap <= MATCH_WINDOW_S and (hit is None or gap < hit[0]):
                hit = (gap, row)
        if hit:
            hit[1][2] = True
            merged.append(record(hit[1][1], a))
            stats['matched'] += 1
        else:
            merged.append(record(None, a))
            stats['strava_only'] += 1

    for row in pool:
        if not row[2]:
            merged.append(record(row[1], None))
            stats['health_only'] += 1

    merged.sort(key=lambda r: r['start_date_local'])
    return merged, stats


def record(h, s):
    """Emit one run in the Strava-shaped schema the dashboards already read."""
    if h and s:
        km = h['distance_km'] or s['distance'] / 1000
        secs = s.get('moving_time') or h['duration_s']
        name, src = s.get('name') or h['name'], 'both'
    elif h:
        km, secs, name, src = h['distance_km'], h['duration_s'], h['name'], 'health'
    else:
        km, secs, name, src = s['distance'] / 1000, s.get('moving_time', 0), s.get('name'), 'strava'

    start = h['start_local'] if h else s['start_date_local'][:19]
    return {
        'type': 'Run',
        'source': src,
        'start_date_local': start,
        'name': name or 'Run',
        'distance': round(km * 1000, 1),
        'moving_time': int(secs or 0),
        'elapsed_time': int((h['duration_s'] if h else s.get('elapsed_time')) or secs or 0),
        'total_elevation_gain': (h.get('elevation_m') if h else s.get('total_elevation_gain')) or 0,
        'average_heartrate': (h.get('avg_hr') if h else s.get('average_heartrate')),
        'max_heartrate': (h.get('max_hr') if h else s.get('max_heartrate')),
    }


# ---------------------------------------------------------------- aggregation

def totals(runs):
    km = sum(r['distance'] for r in runs) / 1000
    return {'runs': len(runs), 'distance_km': round(km, 1),
            'time_hrs': round(sum(r['moving_time'] for r in runs) / 3600, 1)}


def in_range(runs, lo, hi):
    return [r for r in runs if lo <= r['start_date_local'][:10] < hi]


def build_stats(runs, today):
    y = today.year
    md = today.strftime('-%m-%d')
    week_start = today - timedelta(days=today.weekday())
    ws, ls = week_start.strftime('%Y-%m-%d'), (week_start - timedelta(days=7)).strftime('%Y-%m-%d')

    by_year = collections.defaultdict(list)
    for r in runs:
        by_year[int(r['start_date_local'][:4])].append(r)
    prev = y - 1
    best = max((yr for yr in by_year if yr < y),
               key=lambda k: sum(r['distance'] for r in by_year[k]), default=prev)

    def week(lo, hi):
        sel = in_range(runs, lo, hi)
        t = totals(sel)
        return {'runs': t['runs'], 'distance_km': t['distance_km'],
                'time_min': round(sum(r['moving_time'] for r in sel) / 60)}

    last = runs[-1] if runs else None
    km = last['distance'] / 1000 if last else 0

    stats = {
        'current_year': str(y),
        f'ytd_{y}': totals(in_range(runs, f'{y}-01-01', f'{y+1}-01-01')),
        f'ytd_{prev}_same_period': totals(in_range(runs, f'{prev}-01-01', f'{prev}{md}')),
        f'ytd_{best}_same_period': totals(in_range(runs, f'{best}-01-01', f'{best}{md}')),
        f'full_year_{prev}': totals(by_year.get(prev, [])),
        f'full_year_{best}': totals(by_year.get(best, [])),
        'comparison_years': {'previous': str(prev), 'best': str(best)},
        'weekly_goal': WEEKLY_GOAL,
        'this_week': week(ws, '9999'),
        'last_week': week(ls, ws),
        'lastRun': last and {
            'date': last['start_date_local'][:10],
            'distance': f'{km:.2f}',
            'pace': f'{(last["moving_time"]/60)/km:.2f}' if km else '0.00',
        },
        'sources': {'health_export': EXPORT_DIR, 'strava_archive': 'data/strava-archive.json'},
        'updated_at': datetime.now().astimezone().replace(microsecond=0).isoformat(),
    }
    return stats


def build_weekly(runs):
    years = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in runs:
        d = datetime.fromisoformat(r['start_date_local'][:10])
        iso = d.isocalendar()
        years[str(iso[0])][iso[1]].append(r)
    out = []
    for yr in sorted(years):
        weeks = years[yr]
        flat = [r for w in weeks.values() for r in w]
        out.append({
            'year': yr,
            'total_runs': len(flat),
            'total_distance': round(sum(r['distance'] for r in flat) / 1000, 1),
            'weeks': [{'week_num': n, 'runs': len(weeks[n]),
                       'distance_km': round(sum(r['distance'] for r in weeks[n]) / 1000, 1)}
                      for n in sorted(weeks)],
        })
    return out


def main():
    print(f'Reading Health export: {EXPORT_DIR}')
    health = load_health()
    strava = load_archive()
    print(f'  health runs {len(health)}   strava archive runs {len(strava)}')

    runs, counts = merge(health, strava)
    print(f'  merged {len(runs)} runs  '
          f'(both {counts["matched"]}, health-only {counts["health_only"]}, '
          f'strava-only {counts["strava_only"]})')

    today = datetime.now()
    write('activities.json', runs)
    write('stats.json', build_stats(runs, today))
    write('weekly.json', build_weekly(runs))
    print(f'  latest run: {runs[-1]["start_date_local"][:10]}' if runs else '')


def write(name, obj):
    path = os.path.join(DATA, name)
    with open(path, 'w') as fh:
        json.dump(obj, fh, indent=2)
    print(f'  wrote data/{name}')


if __name__ == '__main__':
    main()
