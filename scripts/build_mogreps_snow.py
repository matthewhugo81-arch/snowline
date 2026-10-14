"""Member snowfall exceedance grids from the Met Office's public NetCDF files.

No temperature proxy, neighbourhood smoothing or time-lagged members. Global
large-scale and convective snowfall are added member by member before counting.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import json
from pathlib import Path
import shutil
import threading

from netCDF4 import Dataset, num2date
import numpy as np
from omfiles import OmFileWriter
from pyproj import Transformer
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

VERSION = 1
FIELD = 'snowfall_probability'
THRESHOLD = 0.1  # mm liquid-water equivalent per hour, averaged over CF bounds
CONFIG = {
    'uk': dict(native='ukmo_uk_ensemble_2km', domain='snowline_mogreps_uk', members=3,
               bucket='uk', prefix='uk-ensemble', shape=(970, 1042)),
    'global': dict(native='ukmo_global_ensemble_20km', domain='snowline_mogreps_global', members=18,
                   bucket='global', prefix='global-ensemble', shape=(960, 1280)),
}
NC_LOCK = threading.Lock()  # netCDF/HDF5 is not thread safe, even across files.
LOCAL = threading.local()


def fetch(url):
    if not hasattr(LOCAL, 'session'):
        LOCAL.session = requests.Session()
        LOCAL.session.mount('https://', HTTPAdapter(max_retries=Retry(
            total=2, backoff_factor=.5, status_forcelist=[429, 500, 502, 503, 504])))
    response = LOCAL.session.get(url, timeout=(15, 90))
    response.raise_for_status()
    return response


def iso(value):
    return value.strftime('%Y-%m-%dT%H:%M:00Z')


def nc_time(variable):
    value = num2date(variable[:], variable.units, only_use_cftime_datetimes=False)
    return value.replace(tzinfo=timezone.utc)


def decode(payload, config, run, valid, interval, convective=False):
    name = 'lwe_thickness_of_' + ('convective_' if convective else '') + 'snowfall_amount'
    with NC_LOCK, Dataset('memory.nc', memory=payload) as data:
        variable = data[name]
        expected_dims = ('realization', 'projection_y_coordinate', 'projection_x_coordinate') if config['bucket'] == 'uk' else ('realization', 'latitude', 'longitude')
        if variable.dimensions != expected_dims or variable.shape != (config['members'], *config['shape']):
            raise ValueError('Unexpected snowfall dimensions or member count')
        if variable.units != 'm' or 'time: sum' not in variable.cell_methods:
            raise ValueError('Snowfall must be accumulated metres of water equivalent')
        if nc_time(data['forecast_reference_time']) != run or nc_time(data['time']) != valid:
            raise ValueError('Snowfall belongs to a different run or valid time')
        bounds = np.asarray(data[data['time'].bounds][:], dtype=np.int64)
        endpoint = int(data['time'][:])
        if data['time'].units != 'seconds since 1970-01-01 00:00:00' or not np.array_equal(bounds, [endpoint - interval * 3600, endpoint]):
            raise ValueError('Unexpected snowfall accumulation bounds')
        members = np.asarray(data['realization'][:], dtype=int)
        if len(np.unique(members)) != config['members']:
            raise ValueError('Duplicate ensemble member IDs')
        if config['bucket'] == 'uk':
            for axis, size, start in [('projection_x_coordinate', 1042, -1158000), ('projection_y_coordinate', 970, -1036000)]:
                if not np.allclose(data[axis][:], start + np.arange(size) * 2000, atol=.01, rtol=0):
                    raise ValueError('Unexpected UK grid coordinates')
            projection = data[variable.grid_mapping]
            for key, value in dict(semi_major_axis=6378137, semi_minor_axis=6356752.314140356,
                                   longitude_of_projection_origin=-2.5, latitude_of_projection_origin=54.9).items():
                if not np.isclose(projection.getncattr(key), value, atol=.001, rtol=0):
                    raise ValueError('Unexpected UK projection')
        else:
            for axis, size, start, step in [('latitude', 960, -89.90625, .1875), ('longitude', 1280, -179.859375, .28125)]:
                if not np.allclose(data[axis][:], start + np.arange(size) * step, atol=.00002, rtol=0):
                    raise ValueError('Unexpected global grid coordinates')
        values = np.asarray(np.ma.filled(variable[:], np.nan), dtype=np.float32)
    values[values < 0] = np.nan
    return values, members


def snowfall_probability(components, interval):
    """Use the full member denominator; incomplete cells are unavailable, not dry."""
    if interval <= 0 or not components:
        raise ValueError('A positive accumulation interval and members are required')
    total, members = components[0]
    total = total.copy()
    for values, ids in components[1:]:
        if set(ids) != set(members) or values.shape != total.shape:
            raise ValueError('Snowfall components have different members or grids')
        total += values[[list(ids).index(member) for member in members]]
    complete = np.isfinite(total).all(axis=0)
    # Compare in native metres to avoid rounding a 3-hour threshold differently.
    result = (total >= np.float32(THRESHOLD * interval / 1000)).sum(axis=0).astype(np.float32) * (100 / len(members))
    result[~complete] = np.nan
    return result


@lru_cache(maxsize=1)
def uk_nearest_indices():
    # The renderer supports spherical LAEA. Preserve member fractions with a
    # nearest-cell reprojection from the provider's ellipsoidal 2 km grid.
    common = '+proj=laea +lat_0=54.9 +lon_0=-2.5 +units=m '
    transform = Transformer.from_crs(common + '+R=6371229', common + '+a=6378137 +b=6356752.314140356', always_xy=True)
    x, y = np.meshgrid(-1158000 + np.arange(1042) * 2000, -1036000 + np.arange(970) * 2000)
    sx, sy = transform.transform(x, y)
    ix, iy = np.rint((sx + 1158000) / 2000).astype(int), np.rint((sy + 1036000) / 2000).astype(int)
    inside = (ix >= 0) & (ix < 1042) & (iy >= 0) & (iy < 970)
    return np.clip(iy, 0, 969), np.clip(ix, 0, 1041), inside


def write_frame(config, run, hour, path):
    valid = run + timedelta(hours=hour)
    interval = 3 if config['bucket'] == 'global' and hour > 132 else 1
    base = f'https://met-office-{config["bucket"]}-ensemble-model-data.s3.eu-west-2.amazonaws.com/'
    prefix = config['prefix'] + run.strftime('/%Y/%m/%d/T%H00Z/') + valid.strftime('%Y%m%dT%H%MZ') + f'-PT{hour:04d}H00M-'
    components = []
    for convective in ([False, True] if config['bucket'] == 'global' else [False]):
        parameter = 'snowfall_accumulation' + ('_from_convection' if convective else '')
        payload = fetch(base + prefix + parameter + f'-PT{interval:02d}H.nc').content
        components.append(decode(payload, config, run, valid, interval, convective))
    probability = snowfall_probability(components, interval)
    if config['bucket'] == 'uk':
        iy, ix, inside = uk_nearest_indices()
        probability = probability[iy, ix]
        probability[~inside] = np.nan
    if not np.isfinite(probability).any():
        raise ValueError('No complete-member snowfall cells')
    temporary = path.with_suffix('.tmp')
    writer = OmFileWriter(str(temporary))
    child = writer.write_array(np.ascontiguousarray(probability), chunks=[10, 100],
                               scale_factor=100, add_offset=0, compression='pfor_delta_2d', name=FIELD)
    writer.close(writer.write_group(name='root', children=[child]))
    temporary.replace(path)
    record = dict(interval_hours=interval, members=components[0][1].tolist())
    path.with_suffix('.json').write_text(json.dumps(record))
    return record


def build(model, root, hours=None, workers=2):
    config = CONFIG[model]
    candidates = []
    for filename in ('latest.json', 'in-progress.json'):
        try:
            meta = fetch('https://openmeteo.s3.amazonaws.com/data_spatial/' + config['native'] + '/' + filename).json()
            if meta.get('valid_times'):
                candidates.append(meta)
        except requests.RequestException:
            pass
    if not candidates:
        raise ValueError('No verified MOGREPS run available')
    upstream = max(candidates, key=lambda m: (m['reference_time'], len(m['valid_times'])))
    run = datetime.fromisoformat(upstream['reference_time'])
    domain_root = root / config['domain']
    latest = domain_root / 'latest.json'
    previous = json.loads(latest.read_text()) if latest.exists() else None
    if previous and previous['reference_time'] > iso(run):
        return  # Never roll an already published run backwards.
    folder = domain_root / run.strftime('%Y/%m/%d/%H00Z')
    folder.mkdir(parents=True, exist_ok=True)
    expected = sorted({int((datetime.fromisoformat(t) - run).total_seconds() / 3600) for t in upstream['valid_times'] if datetime.fromisoformat(t) > run})
    requested = [h for h in expected if hours is None or h in hours]
    paths = {h: folder / ((run + timedelta(hours=h)).strftime('%Y-%m-%dT%H%M') + '.om') for h in requested}
    records, failures = {}, []
    existing = json.loads((folder / 'meta.json').read_text()) if (folder / 'meta.json').exists() else {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {}
        for hour, path in paths.items():
            if existing.get('format_version') == VERSION and path.exists() and path.with_suffix('.json').exists():
                records[hour] = json.loads(path.with_suffix('.json').read_text())
            else:
                jobs[pool.submit(write_frame, config, run, hour, path)] = hour
        for i, job in enumerate(as_completed(jobs), 1):
            try:
                records[jobs[job]] = job.result()
            except Exception as error:
                failures.append(f'T+{jobs[job]}: {error}')
            if i % 20 == 0 or i == len(jobs):
                print(f'MOGREPS-{model}: checked {i}/{len(jobs)} new snowfall frames', flush=True)
    if failures:
        print(f'::warning::MOGREPS-{model}: {len(failures)} unavailable frames; {failures[0]}', flush=True)
    if not records:
        raise ValueError('No complete-member snowfall frames available')
    ordered = sorted(records)
    metadata = dict(format_version=VERSION, reference_time=iso(run),
                    completed=upstream.get('completed') is True and ordered == expected,
                    variables=[FIELD], valid_times=[iso(run + timedelta(hours=h)) for h in ordered],
                    intervals={iso(run + timedelta(hours=h)): records[h]['interval_hours'] for h in ordered},
                    member_count=config['members'], threshold_mm_per_hour=THRESHOLD,
                    generated_at=iso(datetime.now(timezone.utc)),
                    source='Met Office MOGREPS native member snowfall',
                    source_url=f'https://registry.opendata.aws/met-office-{config["bucket"]}-ensemble/',
                    licence='© Crown copyright 2026, Met Office; CC BY-SA 4.0',
                    method='Fraction of all members with snowfall water equivalent >= 0.1 mm/hour over the stated interval; global large-scale + convective snowfall; no lagging or neighbourhood processing.',
                    grid_processing='Nearest-cell reprojection to spherical LAEA 2 km' if model == 'uk' else 'Native global cell centres')
    for target in (folder / 'meta.json', latest):
        target.with_suffix('.tmp').write_text(json.dumps(metadata, indent=2) + '\n')
        target.with_suffix('.tmp').replace(target)
    # Three cycles support comparison and allow already-open pages to finish.
    folders = sorted(domain_root.glob('*/*/*/*Z'), reverse=True)
    for old in folders[3:]:
        if not old.resolve().is_relative_to(domain_root.resolve()):
            raise ValueError('Refusing to clean outside generated snow data')
        shutil.rmtree(old)
    print(f'MOGREPS-{model}: {len(records)} verified snowfall probability frames, {iso(run)}', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=CONFIG, required=True)
    parser.add_argument('--output', type=Path, default=Path('ensemble-data'))
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--hours', help='Validation only: comma-separated hours in a scratch output directory')
    args = parser.parse_args()
    try:
        build(args.model, args.output, [int(h) for h in args.hours.split(',')] if args.hours else None, args.workers)
    except Exception as error:
        if (args.output / CONFIG[args.model]['domain'] / 'latest.json').exists():
            print(f'::warning::MOGREPS-{args.model}: retaining previous snowfall run: {error}', flush=True)
        else:
            raise


if __name__ == '__main__':
    main()
