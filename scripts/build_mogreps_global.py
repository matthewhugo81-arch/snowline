"""Native MOGREPS-G member statistics, cropped without interpolation.

The shared immutable index locates HDF5 chunks in the free Met Office files.
Every range is pinned to its source ETag; pressure flags and missing members
are respected before calculating statistics. No credentials are needed.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
import multiprocessing
from datetime import datetime, timedelta, timezone
import gzip
import itertools
import json
from pathlib import Path
import shutil
import threading
import time
import zlib
from urllib.parse import urlparse
from urllib.request import url2pathname

import numpy as np
from omfiles import OmFileWriter, OmFileReader
import requests

DOMAIN = 'snowline_mogreps_global'
INDEX = 'https://matthewhugo81-arch.github.io/snowline-ensembles/mogreps/'
SOURCE = 'https://met-office-global-ensemble-model-data.s3.eu-west-2.amazonaws.com/'
CROP = (644, 876, 404, 769)
GRID = dict(type='regular', nx=365, ny=232, lonMin=-66.234375, latMin=30.84375, dx=.28125, dy=.1875, zoom=2)
TEMPERATURES = ['temperature_850hPa', 'temperature_500hPa']
INSTANT = [key + suffix for key in TEMPERATURES for suffix in ('_mean', '_spread')]
PERIOD = ['precipitation_mean', 'snowfall_water_equivalent_mean', 'precipitation_probability', 'snowfall_probability']
COMPARISON = [f'{base}_{stat}' for base in ['geopotential_height_500hPa', 'wind_speed_300hPa', 'wind_speed_200hPa', 'pressure_msl'] for stat in ['mean', 'spread']] + ['geopotential_height_500hPa_anomaly_mean']
FIELDS = INSTANT + PERIOD + COMPARISON
_local = threading.local()


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def fetch(url, headers=None):
    if not hasattr(_local, 'session'):
        _local.session = requests.Session()
    for attempt in range(4):
        try:
            response = _local.session.get(url, headers=headers, timeout=(15, 90))
            response.raise_for_status()
            return response
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def read_json(url):
    data = Path(url2pathname(urlparse(url).path)).read_bytes() if url.startswith('file:') else fetch(url).content
    return json.loads(gzip.decompress(data) if url.endswith('.gz') else data)


def validate_manifest(manifest):
    run = datetime.fromtimestamp(manifest['run'], timezone.utc)
    expected = list(range(18)) if run.hour in (0, 12) else [0, *range(18, 35)]
    if (manifest.get('schema') != 1 or manifest.get('intervalHours') != 3 or
            manifest.get('members') != expected or manifest.get('leads') != list(range(0, 247, 3)) or
            manifest.get('grid') != {'latitude': [-89.90625, .1875, 960], 'longitude': [-179.859375, .28125, 1280]} or
            manifest.get('runId') != run.strftime('%Y%m%dT%H00Z')):
        raise ValueError('Unsupported MOGREPS-G manifest')
    return run


def decode_chunk(payload, dataset, mask):
    dtype = np.dtype(dataset['dtype'])
    if dtype.str not in ('<f4', '|i1'):
        raise ValueError('Unsupported source type')
    count = int(np.prod(dataset['chunkShape']))
    for i in reversed(range(len(dataset['filters']))):
        if mask & (1 << i):
            continue
        kind = dataset['filters'][i]['id']
        if kind == 1:
            payload = zlib.decompress(payload)
        elif kind == 2:
            payload = np.frombuffer(payload, dtype=np.uint8).reshape(dtype.itemsize, count).T.copy().tobytes()
        else:
            raise ValueError('Unsupported source compression')
    if len(payload) != count * dtype.itemsize:
        raise ValueError('Truncated decoded chunk')
    return np.frombuffer(payload, dtype=dtype).reshape(dataset['chunkShape'])


def extract(index, dataset, levels=None, workers=12, crop=CROP):
    y0, y1, x0, x1 = crop
    shape, chunk = dataset['shape'], dataset['chunkShape']
    if shape[-2:] != [960, 1280] or shape[0] != 18:
        raise ValueError('Unexpected native grid')
    selections = [list(range(18))] + ([levels] if levels is not None else [])
    prefix = tuple(len(s) for s in selections)
    output = np.full((*prefix, y1-y0, x1-x0), np.nan, dtype=np.float32)
    ranges = [sorted({v//chunk[i] for v in choices}) for i, choices in enumerate(selections)]
    ranges += [range(y0//chunk[-2], (y1-1)//chunk[-2]+1), range(x0//chunk[-1], (x1-1)//chunk[-1]+1)]
    jobs = list(itertools.product(*ranges))

    def load(coords):
        entry = dataset['chunks'].get(','.join(map(str, coords)))
        if not entry:
            raise ValueError('Missing source chunk')
        offset, size, mask = entry
        if offset < 0 or size < 1 or offset + size > index['size']:
            raise ValueError('Invalid source range')
        response = fetch(SOURCE + index['key'], {'Range': f'bytes={offset}-{offset+size-1}', 'If-Match': index['etag']})
        if response.status_code != 206 or len(response.content) != size:
            raise ValueError('Source did not return the exact pinned byte range')
        decoded = decode_chunk(response.content, dataset, mask)
        sy, sx = coords[-2]*chunk[-2], coords[-1]*chunk[-1]
        lo_y, hi_y, lo_x, hi_x = max(y0, sy), min(y1, sy+chunk[-2]), max(x0, sx), min(x1, sx+chunk[-1])
        choices = [[(i, v) for i, v in enumerate(sel) if v//chunk[n] == coords[n]] for n, sel in enumerate(selections)]
        for selected in itertools.product(*choices):
            dest = tuple(i for i, _ in selected)
            source = tuple(v % chunk[n] for n, (_, v) in enumerate(selected))
            values = decoded[source + (slice(lo_y-sy, hi_y-sy), slice(lo_x-sx, hi_x-sx))].astype(np.float32)
            valid = np.isfinite(values) & (np.abs(values) < 1e30) & (values != dataset['fillValue'])
            output[dest + (slice(lo_y-y0, hi_y-y0), slice(lo_x-x0, hi_x-x0))] = np.where(valid, values, np.nan)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        # Consume results so any failed range prevents publication of this frame.
        list(pool.map(load, jobs))
    return output


def index_for(manifest, kind, lead):
    index = read_json(INDEX + manifest['runId'] + f'/{kind}-{lead:03d}.json.gz')
    if (index.get('schema') != 1 or index.get('run') != manifest['run'] or
            index.get('time') != manifest['run'] + lead*3600 or index.get('kind') != kind or
            index.get('members') != manifest['members'] or not index.get('key', '').startswith('global-ensemble/')):
        raise ValueError('Source run/member mismatch')
    return index


def statistics(values):
    # Ordinary mean/std propagate missing members; never silently shrink N.
    return np.mean(values, axis=0), np.std(values, axis=0, ddof=0)


def probability(values, threshold=.1):
    complete = np.isfinite(values).all(axis=0)
    # Tolerate only arithmetic round-off at an exactly equal decimal threshold.
    return np.where(complete, (values >= threshold-1e-10).sum(axis=0)*100/values.shape[0], np.nan).astype(np.float32)


def frame_values(manifest, lead, workers=12, crop=CROP):
    index = index_for(manifest, 'temperature', lead)
    if index.get('levels') != [5, 12]:
        raise ValueError('Wrong pressure levels')
    temp = extract(index, index['data'], index['levels'], workers, crop)
    flags = extract(index, index['flag'], index['levels'], workers, crop)
    temp = np.where(flags == 0, temp.astype(np.float64) - 273.15, np.nan)
    result = {}
    for p, key in enumerate(TEMPERATURES):
        result[key+'_mean'], result[key+'_spread'] = statistics(temp[:, p])
    if not lead:
        return result
    for kind in ('precipitation', 'snowfall'):
        total = np.zeros((18, crop[1]-crop[0], crop[3]-crop[2]), dtype=np.float64)
        for hour in (range(lead-2, lead+1) if lead <= 132 else [lead]):
            idx = index_for(manifest, kind, hour)
            if idx.get('intervalHours') != (1 if hour <= 132 else 3):
                raise ValueError('Incorrect accumulation bounds')
            values = extract(idx, idx['data'], workers=workers, crop=crop)
            total += np.where(values >= 0, values, np.nan)
        rate = total * (1000/3)
        key = 'precipitation' if kind == 'precipitation' else 'snowfall_water_equivalent'
        result[key+'_mean'] = statistics(rate)[0]
        result[kind+'_probability'] = probability(rate)
    return result


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2)+'\n', encoding='utf-8')
    temp.replace(path)


def write_frame(manifest, lead, path, workers, include_comparison=True):
    values = {}
    if path.exists() and path.with_suffix('.json').exists():
        record = json.loads(path.with_suffix('.json').read_text())
        if record.get('version') in (1, 2):
            reader = OmFileReader(str(path))
            try:
                values = {key: np.array(reader.get_child_by_name(key)[:], copy=True) for key in record['variables'] if key in FIELDS}
            finally:
                del reader
            if any(value.shape != (GRID['ny'], GRID['nx']) for value in values.values()):
                raise ValueError('Cached native grid shape mismatch')
    if not all(key in values for key in INSTANT + (PERIOD if lead else [])):
        values.update(frame_values(manifest, lead, workers))
    from mogreps_comparison_fields import comparison_values
    try:
        if include_comparison:
            values.update(comparison_values(manifest, lead, workers, existing=values))
    except Exception as error:
        print(f'::warning::MOGREPS comparison fields T+{lead} await retry: {error}', flush=True)
    if any(not np.isfinite(v).any() for v in values.values()):
        raise ValueError('No complete-member cells')
    temporary = path.with_suffix('.tmp')
    writer = OmFileWriter(str(temporary))
    children = [writer.write_array(np.ascontiguousarray(v, dtype=np.float32), chunks=[10, 100],
                                  scale_factor=100, add_offset=0, compression='pfor_delta_2d', name=k)
                for k, v in values.items()]
    writer.close(writer.write_group(name='root', children=children))
    temporary.replace(path)
    atomic_json(path.with_suffix('.json'), dict(version=2 if all(k in values for k in COMPARISON) else 1, variables=list(values)))
    return list(values)


def metadata(manifest, records):
    run = validate_manifest(manifest)
    times = {h: iso(run+timedelta(hours=h)) for h in sorted(records)}
    variable_times = {key: [times[h] for h in times if key in records[h]] for key in FIELDS}
    periods = {key: {times[h]: dict(start=iso(run+timedelta(hours=h-3)), end=times[h], hours=3)
                    for h in times if key in records[h]} for key in PERIOD}
    return dict(format_version=2, domain=DOMAIN, reference_time=iso(run), completed=sorted(records)==manifest['leads'] and all(all(key in records[h] for key in COMPARISON) for h in records),
                core_completed=sorted(records)==manifest['leads'] and all(all(key in records[h] for key in INSTANT + (PERIOD if h else [])) for h in records),
                variables=[key for key in FIELDS if variable_times[key]], valid_times=list(times.values()),
                variable_valid_times=variable_times, variable_intervals=periods, member_count=18, member_ids=manifest['members'],
                grid=GRID, coverage=[GRID['lonMin'], GRID['latMin'], 36.140625, 74.15625],
                generated_at=iso(datetime.now(timezone.utc)), threshold_mm_per_hour=.1,
                source='Met Office MOGREPS-G native ensemble members', source_url='https://registry.opendata.aws/met-office-global-ensemble/',
                licence='\u00a9 Crown copyright 2026, Met Office; CC BY-SA 4.0',
                method='All 18 same-cycle members; arithmetic mean, population standard deviation (ddof=0), raw member fractions at >=0.1 mm/h over the preceding 3 hours. Missing/below-ground cells stay missing. No time-lagging or smoothing.',
                grid_processing='Native latitude/longitude cells cropped without interpolation; rows 644:876, columns 404:769',
                anomaly_reference=dict(dataset='NOAA NCEP/NCAR Reanalysis 1', period='1991-2020', statistic='daily mean', level_hPa=500, units='m', interpolation='Bilinear climatology to native forecast cells; Feb 29 averages Feb 28 and Mar 1'))


def initialize_frame_worker(index_root):
    global INDEX
    import sys
    INDEX = index_root
    sys.modules['build_mogreps_global'] = sys.modules[__name__]


def native_comparison_ready(record):
    return bool(record and all(key in record.get('variables', []) for key in COMPARISON if key != 'geopotential_height_500hPa_anomaly_mean'))


def core_frame_ready(record, lead):
    return bool(record and record.get('version') in (1, 2) and all(key in record.get('variables', []) for key in INSTANT + (PERIOD if lead else [])))


def build(root, hours=None, workers=3, range_workers=12, run_id=None, comparison_frames=24):
    manifest = read_json(INDEX + (run_id+'/manifest.json' if run_id else 'latest.json'))
    run = validate_manifest(manifest)
    if datetime.now(timezone.utc)-run > timedelta(hours=72):
        raise ValueError('Shared source index is expired')
    domain = root / DOMAIN
    latest = domain / 'latest.json'
    previous = json.loads(latest.read_text()) if latest.exists() else None
    if previous and previous['reference_time'] > iso(run):
        return
    folder = domain / run.strftime('%Y/%m/%d/%H00Z')
    folder.mkdir(parents=True, exist_ok=True)
    requested = manifest['leads'] if hours is None else sorted(set(hours))
    if any(h not in manifest['leads'] for h in requested):
        raise ValueError('Invalid lead')
    records, failures = {}, []
    comparison_budget = comparison_frames if hours is None else len(requested)
    cached = {}
    for h in manifest['leads']:
        path = folder / ((run+timedelta(hours=h)).strftime('%Y-%m-%dT%H%M')+'.om')
        cached[h] = json.loads(path.with_suffix('.json').read_text()) if path.exists() and path.with_suffix('.json').exists() else None
    # New cycles publish their full core horizon first. Enrichment resumes on
    # the next pass instead of delaying all new temperatures/rain/snow behind
    # the first batch of more expensive upper-air source metadata reads.
    core_pending = hours is None and any(not core_frame_ready(cached[h], h) for h in requested)
    # A failed optional anomaly must not repeatedly consume the first 24 slots
    # while later native pressure/wind/height hours remain unpublished.
    ordered = sorted(manifest['leads'], key=lambda h: native_comparison_ready(cached[h]))
    # HDF5 serializes threads globally; independent processes let remote metadata
    # reads overlap without one frame holding up every other forecast hour.
    with ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context('spawn'),
                             initializer=initialize_frame_worker, initargs=(INDEX,)) as pool:
        jobs = {}
        for h in ordered:
            path = folder / ((run+timedelta(hours=h)).strftime('%Y-%m-%dT%H%M')+'.om')
            record = cached[h]
            if record and record.get('version') in (1, 2):
                records[h] = record['variables']
            if h in requested and (not record or record.get('version') != 2):
                include_comparison = comparison_budget > 0 and not core_pending
                if core_frame_ready(record, h) and not include_comparison:
                    continue
                comparison_budget -= int(include_comparison)
                jobs[pool.submit(write_frame, manifest, h, path, range_workers, include_comparison)] = h
        print(f'MOGREPS-G: converting {len(jobs)} frames with {workers} independent workers', flush=True)
        for i, job in enumerate(as_completed(jobs), 1):
            h = jobs[job]
            try:
                records[h] = job.result()
            except Exception as error:
                failures.append(f'T+{h}: {error}')
            print(f'MOGREPS-G: {i}/{len(jobs)} new frames, T+{h}; {len(failures)} failed', flush=True)
    if failures:
        print('::warning::'+failures[0], flush=True)
    if not records:
        raise ValueError('No complete-member frames available')
    meta = metadata(manifest, records)
    atomic_json(folder/'meta.json', meta)
    # Latest may show verified progress; subsequent builds retain every field/time.
    atomic_json(latest, meta)
    folders = sorted(domain.glob('*/*/*/*Z'), reverse=True)
    from run_retention import last_complete_folder
    protected = last_complete_folder(domain, meta['reference_time'])
    keep = set(folders[:3] if not protected or protected in folders[:3] else folders[:2] + [protected])
    for old in folders:
        if old in keep:
            continue
        if not old.resolve().is_relative_to(domain.resolve()):
            raise ValueError('Refusing cleanup outside domain')
        shutil.rmtree(old)
    runs = [json.loads((p/'meta.json').read_text())['reference_time'] for p in sorted(keep,reverse=True) if (p/'meta.json').exists()]
    atomic_json(domain/'history.json', dict(format_version=1, runs=runs))
    print(f'MOGREPS-G: {len(records)}/83 frames published for {iso(run)}', flush=True)


def main():
    global INDEX
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('ensemble-data'))
    parser.add_argument('--hours')
    parser.add_argument('--run')
    parser.add_argument('--index-root',type=Path)
    parser.add_argument('--comparison-frames',type=int,default=24)
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--range-workers', type=int, default=12)
    args = parser.parse_args()
    if args.index_root:
        INDEX = args.index_root.resolve().as_uri()+'/'
    try:
        build(args.output, [int(h) for h in args.hours.split(',')] if args.hours else None, args.workers, args.range_workers, args.run, args.comparison_frames)
    except Exception as error:
        if (args.output/DOMAIN/'latest.json').exists():
            print(f'::warning::MOGREPS-G retaining verified previous run: {error}', flush=True)
        else:
            raise


if __name__ == '__main__':
    import sys
    sys.modules['build_mogreps_global'] = sys.modules[__name__]
    main()
