"""Shared parsing helpers for Health Auto Export JSON files."""
import json, glob, os, re
from datetime import datetime

EXPORT_DIR = os.path.expanduser(
    '~/Library/Mobile Documents/iCloud~com~ifunography~HealthExport/Documents/iCloud'
)

RUN_NAMES = {'Outdoor Run', 'Indoor Run', 'Run', 'Running', 'Trail Run'}

# "2026-08-30 17:10:16 +0700"
_TS = re.compile(r'^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})')


def parse_local(ts):
    """Return (date_str, 'YYYY-MM-DDTHH:MM:SS') in the workout's own local time."""
    m = _TS.match(ts.strip())
    if not m:
        return None, None
    return m.group(1), f'{m.group(1)}T{m.group(2)}'


def qty(field, expect_units=None):
    if not isinstance(field, dict):
        return None
    v = field.get('qty')
    if v is None:
        return None
    if expect_units and field.get('units') not in expect_units:
        return ('BAD_UNITS', field.get('units'), v)
    return v


def iter_run_workouts(export_dir=EXPORT_DIR):
    """Yield (filename, workout dict) for every run-type workout in every export file."""
    for path in sorted(glob.glob(os.path.join(export_dir, 'HealthAutoExport-*.json'))):
        try:
            with open(path) as fh:
                doc = json.load(fh)
        except Exception as exc:
            print(f'  ! skip {os.path.basename(path)}: {exc}')
            continue
        for w in doc.get('data', {}).get('workouts', []):
            if w.get('name') in RUN_NAMES:
                yield os.path.basename(path), w


def collect_runs(export_dir=EXPORT_DIR):
    """Dedupe run workouts across daily export files. Returns list sorted by start."""
    runs = {}
    for _, w in iter_run_workouts(export_dir):
        date, start = parse_local(w.get('start', ''))
        if not start:
            continue
        end_date, end = parse_local(w.get('end', ''))
        dist = qty(w.get('distance'))
        if isinstance(dist, tuple):
            dist = None
        dur = w.get('duration')
        key = w.get('id') or f'{start}|{round(dist or 0, 3)}'
        runs[key] = {
            'id': key,
            'date': date,
            'start_local': start,
            'end_local': end,
            'name': w.get('name'),
            'indoor': bool(w.get('isIndoor')),
            'distance_km': round(dist, 4) if dist else 0.0,
            'duration_s': round(dur) if dur else 0,
            'elevation_m': _plain(w.get('elevationUp')),
            'avg_hr': _plain(w.get('avgHeartRate')),
            'max_hr': _plain(w.get('maxHeartRate')),
            'energy_kj': _plain(w.get('activeEnergyBurned')),
            'cadence_spm': _plain(w.get('stepCadence')),
        }
    return sorted(runs.values(), key=lambda r: r['start_local'])


def _plain(field):
    v = qty(field)
    if isinstance(v, tuple) or v is None:
        return None
    return round(v, 2)
