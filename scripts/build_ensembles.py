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
import xml.etree.ElementTree as ET

import eccodes as ec
import numpy as np
from omfiles import OmFileWriter
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from ensemble_height_anomaly import ANOMALY, REFERENCE, add_anomalies

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
ECMWF_BASES = ('https://data.ecmwf.int/forecasts', 'https://storage.googleapis.com/ecmwf-open-data')
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
        self.ecmwf_bases = {}
        if model == 'ecmwf':
            for block in (240, 360):
                for i, base in enumerate(ECMWF_BASES):
                    # Keep each binary on the same mirror as its byte-offset index.
                    self.ecmwf_bases[block] = base
                    url = self.url(block, 'mean')
                    try:
                        self.indexes[block] = [json.loads(line) for line in fetch(url.replace('.grib2', '.index')).decode().splitlines()]
                        break
                    except requests.RequestException as error:
                        status = getattr(error.response, 'status_code', None)
                        if status == 404 and i == len(ECMWF_BASES) - 1:
                            self.indexes[block] = []
                            break
                        if i == len(ECMWF_BASES) - 1 or status is not None and status not in (404, 429, 500, 502, 503, 504):
                            raise
                        print(f'ecmwf: source unavailable for {self.run.isoformat()} block {block}; trying official mirror')

    def url(self, hour, stat):
        date, cycle = self.run.strftime('%Y%m%d'), self.run.strftime('%H')
        if self.model == 'gefs':
            product = 'geavg' if stat == 'mean' else 'gespr'
            return f'https://noaa-gefs-pds.s3.amazonaws.com/gefs.{date}/{cycle}/atmos/pgrb2ap5/{product}.t{cycle}z.pgrb2a.0p50.f{hour:03d}'
        block = 240 if hour <= 240 else 360
        # ECMWF bundles em/es in the ep files, rather than separate em/es URLs.
        base = self.ecmwf_bases.get(block, ECMWF_BASES[0])
        return f'{base}/{date}/{cycle}z/ifs/0p25/enfo/{date}{cycle}0000-{block}h-enfo-ep.grib2'

    def records(self, hour, stat):
        if self.model == 'gefs':
            return gefs_records(fetch(self.url(hour, stat) + '.idx').decode(), stat)
        return ecmwf_records(self.indexes[240 if hour <= 240 else 360], hour, stat)

    def available_hours(self):
        if self.model == 'gefs':
            available = []
            for stat in ('mean', 'spread'):
                prefix = self.url(0, stat).split('.com/', 1)[1][:-3]
                url = 'https://noaa-gefs-pds.s3.amazonaws.com/?' + requests.compat.urlencode(
                    {'list-type': '2', 'prefix': prefix})
                listing = ET.fromstring(fetch(url))
                if listing.findtext('{*}IsTruncated') == 'true':
                    raise ValueError('GEFS availability listing was truncated')
                keys = [node.text for node in listing.findall('{*}Contents/{*}Key')]
                available.append({int(key[-3:]) for key in keys if key.startswith(prefix) and key[-3:].isdigit()})
            return [hour for hour in self.config['hours'] if all(hour in hours for hours in available)]
        available = []
        for hour in self.config['hours']:
            try:
                for stat in ('mean', 'spread'):
                    self.records(hour, stat)
                available.append(hour)
            except ValueError:
                continue
        return available


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


def build_model(model, root, now, workers, hours=None, max_new_frames=128, *, archive=False):
    config = MODELS[model]
    run = now.replace(hour=now.hour // config['cycle'] * config['cycle'], minute=0, second=0, microsecond=0)
    latest_path = (frame_path(root, config['domain'], run, 0).parent / 'meta.json'
                   if archive else root / config['domain'] / 'latest.json')
    previous = json.loads(latest_path.read_text()) if latest_path.exists() else None
    source = None
    for offset in range(1 if archive else 8):
        candidate = run - timedelta(hours=offset * config['cycle'])
        if (previous and previous.get('format_version') == VERSION and iso(candidate) == previous['reference_time']
                and set(VARIABLES).issubset(previous.get('variables', []))
                and previous.get('anomaly_reference') == REFERENCE
                and previous.get('variable_valid_times', {}).get(ANOMALY) == previous.get('valid_times')
                and len(previous.get('valid_times', [])) == len(config['hours'])
                and all(frame_path(root, config['domain'], datetime.fromisoformat(previous['reference_time']), h).exists() for h in config['hours'])):
            print(f'{model}: latest run already prepared ({previous["reference_time"]})', flush=True)
            return previous
        if previous and iso(candidate) < previous['reference_time']:
            break  # Never roll a published feed back to an older initialization.
        try:
            source = Source(model, candidate)
            available = source.available_hours()
            if not available:
                raise ValueError('No complete forecast frames published yet')
            break
        except (requests.RequestException, ValueError) as error:
            source = None
            print(f'{model}: {iso(candidate)} not ready: {error}', flush=True)
    if source is None:
        if previous:
            print(f'::warning::{model}: live source unavailable; retaining {previous["reference_time"]}', flush=True)
            return previous
        raise RuntimeError(f'{model}: no published forecast hours available')
    requested = config['hours'] if hours is None else hours
    paths = [(h, frame_path(root, config['domain'], source.run, h)) for h in requested if h in available]
    if not paths:
        raise ValueError('Requested forecast hours are not published yet')
    paths[0][1].parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    # Process the currently published batch without waiting for future hours.
    # The default covers either model's full native horizon, avoiding an
    # artificial backlog when many source hours are already available.
    # An individual frame still requires all six verified fields.
    pending = [(h, path) for h, path in paths if not path.exists()][:max_new_frames]
    failures = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(write_frame, source, h, path): h for h, path in pending}
        for i, job in enumerate(as_completed(jobs), 1):
            try:
                job.result()
            except Exception as error:
                failures.append(f'T+{jobs[job]}: {error}')
            if i % 10 == 0 or i == len(jobs):
                print(f'{model}: {i}/{len(jobs)} frames prepared in {time.monotonic()-started:.0f}s', flush=True)
    paths = [(h, frame_path(root, config['domain'], source.run, h)) for h in requested
             if frame_path(root, config['domain'], source.run, h).exists()]
    if failures:
        print(f'::warning::{model}: {len(failures)} frames will be retried: {failures[0]}', flush=True)
    if not paths:
        if previous:
            print(f'::warning::{model}: keeping previous published run until a new frame is verified', flush=True)
            return previous
        raise ValueError('No verified ensemble frames could be prepared')
    prepared = [h for h, _ in paths]
    anomaly_hours = add_anomalies(paths, source.run, config['step'], VARIABLES)
    preceding = (previous['reference_time'] if previous['reference_time'] != iso(source.run)
                 else previous.get('previous_reference_time')) if previous else None
    meta = dict(format_version=VERSION, reference_time=iso(source.run), completed=prepared == config['hours'],
                variables=VARIABLES, valid_times=[iso(source.run + timedelta(hours=h)) for h in prepared],
                expected_forecast_hours=config['hours'][-1],
                generated_at=iso(datetime.now(timezone.utc) if archive else now), source='NOAA GEFS' if model == 'gefs' else 'ECMWF IFS ENS',
                grid_resolution=config['step'], statistic='Ensemble mean and standard deviation',
                source_url='https://www.nco.ncep.noaa.gov/pmb/products/gens/' if model == 'gefs' else 'https://www.ecmwf.int/en/forecasts/datasets/open-data')
    if anomaly_hours:
        meta['variables'] = VARIABLES + [ANOMALY]
        meta['anomaly_reference'] = REFERENCE
        meta['variable_valid_times'] = {key: meta['valid_times'] for key in VARIABLES}
        meta['variable_valid_times'][ANOMALY] = [iso(source.run + timedelta(hours=h)) for h in anomaly_hours]
    if preceding:
        meta['previous_reference_time'] = preceding
    text = json.dumps(meta, indent=2) + '\n'
    run_meta = paths[0][1].parent / 'meta.json'
    run_meta.with_suffix('.tmp').write_text(text)
    run_meta.with_suffix('.tmp').replace(run_meta)
    latest_path.with_suffix('.tmp').write_text(text)
    latest_path.with_suffix('.tmp').replace(latest_path)
    total = sum(path.stat().st_size for _, path in paths)
    print(f'{model}: published {len(paths)} native global frames, {total/1024/1024:.1f} MiB, {iso(source.run)}', flush=True)
    return meta


def prepare_history(model, root, now, workers, max_new_frames=128):
    """Retain latest plus two complete, exact-cycle forecasts within 48 hours.

    Backfill from official GRIB products on the first publication after upgrade.
    Archive writes never update latest.json or substitute another cycle. A failed
    backfill leaves the verified live forecast usable and is retried next time.
    """
    config = MODELS[model]
    domain_root = root / config['domain']
    latest = json.loads((domain_root / 'latest.json').read_text())
    reference = datetime.fromisoformat(latest['reference_time'])
    retained = [latest]
    pending = []
    for offset in range(config['cycle'], 49, config['cycle']):
        candidate = reference - timedelta(hours=offset)
        try:
            meta = build_model(model, root, candidate, workers,
                               max_new_frames=max_new_frames, archive=True)
            if meta and meta.get('completed') is True and meta['reference_time'] == iso(candidate):
                retained.append(meta)
            elif meta and meta['reference_time'] == iso(candidate):
                pending.append(meta)
        except (requests.RequestException, ValueError, RuntimeError) as error:
            print(f'::warning::{model}: archive {iso(candidate)} unavailable: {error}', flush=True)
        if len(retained) == 3:
            break
    index = dict(format_version=VERSION, generated_at=iso(now),
                 runs=[meta['reference_time'] for meta in retained])
    path = domain_root / 'history.json'
    path.with_suffix('.tmp').write_text(json.dumps(index, indent=2) + '\n')
    path.with_suffix('.tmp').replace(path)
    # Clean only after all retained runs and their index have been verified.
    keep = {frame_path(root, config['domain'], datetime.fromisoformat(meta['reference_time']), 0).parent
            for meta in retained + pending[:1]}
    from run_retention import last_complete_folder
    protected = last_complete_folder(domain_root, latest['reference_time'])
    if protected:
        keep.add(protected)
        protected_meta = json.loads((protected / 'meta.json').read_text())
        if protected_meta['reference_time'] not in index['runs']:
            index['runs'].append(protected_meta['reference_time'])
            path.with_suffix('.tmp').write_text(json.dumps(index, indent=2) + '\n')
            path.with_suffix('.tmp').replace(path)
    for folder in domain_root.glob('*/*/*/*Z'):
        if folder not in keep:
            if not folder.resolve().is_relative_to(domain_root.resolve()):
                raise ValueError('Refusing to clean a directory outside generated model data')
            shutil.rmtree(folder)
    if len(retained) < 3:
        print(f'::warning::{model}: only {len(retained)} verified runs available for comparison', flush=True)
    print(f'{model}: retained {len(retained)} exact-cycle forecasts for comparison', flush=True)
    return index


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('ensemble-data'))
    parser.add_argument('--model', choices=list(MODELS), action='append')
    parser.add_argument('--now', help='UTC time override for reproducible validation')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--max-new-frames', type=int, default=128, help='Maximum new frames per model per pass')
    parser.add_argument('--hours', help='Validation only: comma-separated hours; use a scratch output directory')
    args = parser.parse_args()
    now = datetime.fromisoformat(args.now).replace(tzinfo=timezone.utc) if args.now else datetime.now(timezone.utc)
    errors = []
    for model in args.model or MODELS:
        try:
            build_model(model, args.output, now, args.workers, [int(h) for h in args.hours.split(',')] if args.hours else None, args.max_new_frames)
            if args.hours is None:
                prepare_history(model, args.output, now, args.workers, args.max_new_frames)
        except Exception as error:
            errors.append(f'{model}: {error}')
            print(f'::error::{model}: {error}', flush=True)
    if errors:
        # Fail the build, keeping the previously deployed site untouched.
        raise SystemExit('\n'.join(errors))


if __name__ == '__main__':
    main()
