"""Publish native, global GEFS/IFS ensemble mean and standard-deviation grids.

NOAA: https://www.nco.ncep.noaa.gov/pmb/products/gens/
ECMWF: https://www.ecmwf.int/en/forecasts/datasets/open-data
Only the required GRIB messages are downloaded (validated HTTP byte ranges).
Never substitute deterministic data, another cycle, or a variance for a spread.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import shutil
import threading
import time

import eccodes as ec
import numpy as np
from omfiles import OmFileWriter
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

VERSION = 1
FIELDS = {
    'geopotential_height_500hPa': ('HGT', '500 mb', 'gh', 'pl', '500', 'gpm', 1),
    'temperature_850hPa': ('TMP', '850 mb', 't', 'pl', '850', 'K', 10),
    'pressure_msl': ('PRMSL', 'mean sea level', 'msl', 'sfc', None, 'Pa', 10),
}
VARIABLES = [f'{field}_{stat}' for field in FIELDS for stat in ('mean', 'spread')]
MODELS = {
    'gefs': dict(domain='snowline_gefs_ensemble', step=.5, cycle=6,
                 hours=list(range(0, 241, 3)) + list(range(246, 385, 6))),
    'ecmwf': dict(domain='snowline_ecmwf_ensemble', step=.25, cycle=12,
                  hours=list(range(0, 145, 3)) + list(range(150, 361, 6))),
}
_local = threading.local()
_grib_lock = threading.Lock()


def session():
    if not hasattr(_local, 'session'):
        s = requests.Session()
        s.headers['User-Agent'] = 'Snowline-ensemble-maps/1.0 (github.com/matthewhugo81-arch/snowline)'
        s.mount('https://', HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1,
                status_forcelist=[429, 500, 502, 503, 504])))
        _local.session = s
    return _local.session


def fetch(url, start=None, length=None):
    headers = {} if start is None else {'Range': f'bytes={start}-' + (str(start + length - 1) if length else '')}
    # Reject an ignored Range before reading a multi-GB ECMWF file.
    with session().get(url, headers=headers, timeout=(15, 90), stream=True) as r:
        r.raise_for_status()
        if start is not None:
            if r.status_code != 206 or not r.headers.get('Content-Range', '').startswith(f'bytes {start}-'):
                raise ValueError('Source did not honor the requested byte range')
        content = r.content
        if length is not None and len(content) != length:
            raise ValueError('Incomplete GRIB byte range')
        return content


def gefs_records(text, stat):
    rows = [line.split(':') for line in text.splitlines() if line.strip()]
    result = {}
    for i, row in enumerate(rows):
        for key, (param, level, *_) in FIELDS.items():
            if row[3:5] != [param, level]:
                continue
            expected = 'ens mean' if stat == 'mean' else 'ens std dev'
            if expected not in ':'.join(row[6:]):
                raise ValueError('Incorrect GEFS ensemble statistic')
            start = int(row[1])
            length = int(rows[i + 1][1]) - start if i + 1 < len(rows) else None
            if key in result:
                raise ValueError('Duplicate GEFS field')
            result[key] = (start, length)
    if set(result) != set(FIELDS):
        raise ValueError('Missing GEFS ensemble field')
    return result


def ecmwf_records(records, hour, stat):
    result = {}
    for row in records:
        if row.get('type') != ('em' if stat == 'mean' else 'es') or row.get('step') != str(hour):
            continue
        for key, (_, _, param, levtype, level, *_) in FIELDS.items():
            if row.get('param') == param and row.get('levtype') == levtype and (level is None or row.get('levelist') == level):
                if key in result:
                    raise ValueError('Duplicate ECMWF ensemble field')
                result[key] = (int(row['_offset']), int(row['_length']))
    if set(result) != set(FIELDS):
        raise ValueError(f'Missing ECMWF ensemble fields at +{hour} h')
    return result


class Source:
    def __init__(self, model, run):
        self.model, self.run = model, run
        self.config = MODELS[model]
        self.indexes = {}
        if model == 'ecmwf':
            for block in (240, 360):
                url = self.url(block, 'mean')
                self.indexes[block] = [json.loads(line) for line in fetch(url.replace('.grib2', '.index')).decode().splitlines()]

    def url(self, hour, stat):
        date, cycle = self.run.strftime('%Y%m%d'), self.run.strftime('%H')
        if self.model == 'gefs':
            product = 'geavg' if stat == 'mean' else 'gespr'
            return f'https://noaa-gefs-pds.s3.amazonaws.com/gefs.{date}/{cycle}/atmos/pgrb2ap5/{product}.t{cycle}z.pgrb2a.0p50.f{hour:03d}'
        block = 240 if hour <= 240 else 360
        # ECMWF bundles em/es in the ep files, rather than separate em/es URLs.
        return f'https://data.ecmwf.int/forecasts/{date}/{cycle}z/ifs/0p25/enfo/{date}{cycle}0000-{block}h-enfo-ep.grib2'

    def records(self, hour, stat):
        if self.model == 'gefs':
            return gefs_records(fetch(self.url(hour, stat) + '.idx').decode(), stat)
        return ecmwf_records(self.indexes[240 if hour <= 240 else 360], hour, stat)

    def check_complete(self):
        # Require the full published horizon for both statistics. Every earlier
        # message is also checked as it is decoded before latest.json is updated.
        for stat in ('mean', 'spread'):
            self.records(self.config['hours'][-1], stat)


def normalize_values(values, key, stat, units):
    expected = FIELDS[key][5]
    if units != expected and not (key.startswith('geopotential') and units in ('m', 'gpm')):
        raise ValueError(f'Unexpected units for {key}: {units}')
    values = values.astype(np.float32)
    if key == 'temperature_850hPa' and stat == 'mean':
        values -= 273.15
    if key == 'pressure_msl':
        values /= 100  # Pa -> hPa, for both mean and standard deviation.
    if not np.isfinite(values).all():
        raise ValueError('Missing or invalid ensemble values')
    if stat == 'spread' and np.min(values) < 0:
        raise ValueError('A standard deviation cannot be negative')
    return values


def decode(message, key, stat, source, hour):
    # ecCodes definition initialization is not thread-safe on all platforms.
    # Network transfers remain concurrent; decoding is brief and serialized.
    with _grib_lock:
        return decode_grib(message, key, stat, source, hour)


def decode_grib(message, key, stat, source, hour):
    if not message.startswith(b'GRIB') or not message.endswith(b'7777') or int.from_bytes(message[8:16], 'big') != len(message):
        raise ValueError('Not one complete GRIB2 message')
    g = ec.codes_new_from_message(message)
    try:
        get = lambda k: ec.codes_get(g, k)
        expected_param = FIELDS[key][2]
        if get('shortName') not in (expected_param, 'prmsl' if key == 'pressure_msl' else expected_param):
            raise ValueError('Incorrect GRIB parameter')
        if get('typeOfLevel') != ('meanSea' if key == 'pressure_msl' else 'isobaricInhPa'):
            raise ValueError('Incorrect GRIB level type')
        if key != 'pressure_msl' and get('level') != int(FIELDS[key][4]):
            raise ValueError('Incorrect GRIB pressure level')
        # Both providers encode standard deviation as code 2 in template 4.2.
        if get('productDefinitionTemplateNumber') != 2 or get('derivedForecast') != (0 if stat == 'mean' else 2):
            raise ValueError('GRIB is not the requested ensemble mean/standard deviation')
        if get('numberOfForecastsInEnsemble') < 2:
            raise ValueError('Not an ensemble')
        if get('dataDate') != int(source.run.strftime('%Y%m%d')) or get('dataTime') != int(source.run.strftime('%H')) * 100 or get('endStep') != hour:
            raise ValueError('GRIB cycle or valid time mismatch')
        step = source.config['step']
        nx, ny = int(360 / step), int(180 / step) + 1
        if get('Ni') != nx or get('Nj') != ny or get('jPointsAreConsecutive') or get('alternativeRowScanning'):
            raise ValueError('Unexpected GRIB grid layout')
        if get('iScansNegatively') or get('jScansPositively') or get('latitudeOfFirstGridPointInDegrees') != 90:
            raise ValueError('Unexpected GRIB scanning direction')
        if abs(get('iDirectionIncrementInDegrees') - step) > .0001 or abs(get('jDirectionIncrementInDegrees') - step) > .0001:
            raise ValueError('Unexpected GRIB grid spacing')
        values = normalize_values(ec.codes_get_values(g), key, stat, get('units')).reshape(ny, nx)
        # OM uses south-to-north rows and west-to-east columns from -180°.
        first_lon = get('longitudeOfFirstGridPointInDegrees')
        shift = int(round((first_lon + 180) % 360 / step))
        return np.ascontiguousarray(np.roll(values[::-1], shift, axis=1))
    finally:
        ec.codes_release(g)


def write_frame(source, hour, path):
    values = {}
    for stat in ('mean', 'spread'):
        for key, (start, length) in source.records(hour, stat).items():
            values[f'{key}_{stat}'] = decode(fetch(source.url(hour, stat), start, length), key, stat, source, hour)
    tmp = path.with_suffix('.tmp')
    writer = OmFileWriter(str(tmp))
    children = []
    for key, array in values.items():
        scale = 100 if key == 'temperature_850hPa_spread' else 10 if key.endswith('_spread') else FIELDS[key.removesuffix('_mean')][6]
        children.append(writer.write_array(array, chunks=[10, 180], scale_factor=scale,
                        add_offset=0, compression='pfor_delta_2d', name=key))
    writer.close(writer.write_group(name='root', children=children))
    tmp.replace(path)
    return path.stat().st_size


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:00Z')


def frame_path(root, domain, run, hour):
    return root / domain / run.strftime('%Y/%m/%d/%H00Z') / ((run + timedelta(hours=hour)).strftime('%Y-%m-%dT%H%M') + '.om')


def build_model(model, root, now, workers, hours=None):
    config = MODELS[model]
    latest_path = root / config['domain'] / 'latest.json'
    previous = json.loads(latest_path.read_text()) if latest_path.exists() else None
    run = now.replace(hour=now.hour // config['cycle'] * config['cycle'], minute=0, second=0, microsecond=0)
    source = None
    for offset in range(8):
        candidate = run - timedelta(hours=offset * config['cycle'])
        if (previous and previous.get('format_version') == VERSION and iso(candidate) <= previous['reference_time']
                and previous.get('variables') == VARIABLES and len(previous.get('valid_times', [])) == len(config['hours'])
                and all(frame_path(root, config['domain'], datetime.fromisoformat(previous['reference_time']), h).exists() for h in config['hours'])):
            print(f'{model}: latest complete run already prepared ({previous["reference_time"]})', flush=True)
            return
        try:
            source = Source(model, candidate)
            source.check_complete()
            break
        except (requests.RequestException, ValueError) as error:
            source = None
            print(f'{model}: {iso(candidate)} not ready: {error}', flush=True)
    if source is None:
        raise RuntimeError(f'{model}: no complete run available')
    hours = config['hours'] if hours is None else hours
    paths = [(h, frame_path(root, config['domain'], source.run, h)) for h in hours]
    paths[0][1].parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(write_frame, source, h, path): h for h, path in paths if not path.exists()}
        for i, job in enumerate(as_completed(jobs), 1):
            job.result()
            if i % 10 == 0 or i == len(jobs):
                print(f'{model}: {i}/{len(jobs)} frames prepared in {time.monotonic()-started:.0f}s', flush=True)
    meta = dict(format_version=VERSION, reference_time=iso(source.run), completed=True,
                variables=VARIABLES, valid_times=[iso(source.run + timedelta(hours=h)) for h in hours],
                generated_at=iso(now), source='NOAA GEFS' if model == 'gefs' else 'ECMWF IFS ENS',
                grid_resolution=config['step'], statistic='Ensemble mean and standard deviation',
                source_url='https://www.nco.ncep.noaa.gov/pmb/products/gens/' if model == 'gefs' else 'https://www.ecmwf.int/en/forecasts/datasets/open-data')
    text = json.dumps(meta, indent=2) + '\n'
    (paths[0][1].parent / 'meta.json').write_text(text)
    latest_path.with_suffix('.tmp').write_text(text)
    latest_path.with_suffix('.tmp').replace(latest_path)
    # Retain the preceding prepared cycle so already-open pages can finish a loop.
    keep = {paths[0][1].parent}
    if previous:
        keep.add(root / config['domain'] / datetime.fromisoformat(previous['reference_time']).strftime('%Y/%m/%d/%H00Z'))
    for folder in (root / config['domain']).glob('*/*/*/*Z'):
        if folder not in keep:
            if not folder.resolve().is_relative_to((root / config['domain']).resolve()):
                raise ValueError('Refusing to clean a directory outside generated model data')
            shutil.rmtree(folder)
    total = sum(path.stat().st_size for _, path in paths)
    print(f'{model}: published {len(paths)} native global frames, {total/1024/1024:.1f} MiB, {iso(source.run)}', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('ensemble-data'))
    parser.add_argument('--model', choices=list(MODELS), action='append')
    parser.add_argument('--now', help='UTC time override for reproducible validation')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--hours', help='Validation only: comma-separated hours; use a scratch output directory')
    args = parser.parse_args()
    now = datetime.fromisoformat(args.now).replace(tzinfo=timezone.utc) if args.now else datetime.now(timezone.utc)
    errors = []
    for model in args.model or MODELS:
        try:
            build_model(model, args.output, now, args.workers, [int(h) for h in args.hours.split(',')] if args.hours else None)
        except Exception as error:
            errors.append(f'{model}: {error}')
            print(f'::error::{model}: {error}', flush=True)
    if errors:
        # Fail the build, keeping the previously deployed site untouched.
        raise SystemExit('\n'.join(errors))


if __name__ == '__main__':
    main()
