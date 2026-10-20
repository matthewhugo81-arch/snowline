"""Dependency-free source checks for all five Snowline-generated map feeds.

Native IFS and other Open-Meteo grids are consumed directly by the browser.
These checks cover only data requiring Snowline conversion/publication.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import argparse
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import urlencode
import xml.etree.ElementTree as ET

import check_ensemble_freshness as ensemble
from mogreps_source import newest_complete_after

DIRECT = {
    'mogreps': ('snowline_mogreps_uk', 'ukmo_uk_ensemble_2km'),
    'gem': ('snowline_gem_700', 'cmc_gem_gdps_15km'),
    'gem-upper': ('snowline_gem_upper', 'cmc_gem_gdps_15km'),
    'icon-eu': ('snowline_icon_eu_700', 'dwd_icon_eu'),
}


def native_meta(domain):
    candidates = []
    for filename in ('latest.json', 'in-progress.json'):
        try:
            data = json.loads(ensemble.get('https://openmeteo.s3.amazonaws.com/data_spatial/' + domain + '/' + filename))
            if data.get('valid_times'):
                candidates.append(data)
        except HTTPError as error:
            if error.code != 404:
                raise
    if not candidates:
        raise ValueError('No verified native run')
    return max(candidates, key=lambda m: (m['reference_time'], len(m['valid_times'])))


def expected_hours(model, run, native):
    if model == 'mogreps':
        return sorted({int((datetime.fromisoformat(t.replace('Z', '+00:00')) - run).total_seconds() / 3600)
                       for t in native['valid_times'] if datetime.fromisoformat(t.replace('Z', '+00:00')) > run})
    if model == 'gem-upper':
        return list(range(0, 169, 3)) + list(range(174, 241, 6))
    if model == 'gem':
        return list(range(0, 241, 3))
    return list(range(79)) + list(range(81, 121, 3)) if run.hour % 6 == 0 else list(range(31)) + [36, 42, 48]


def mogreps_hours(run):
    """Paginate the real snowfall object listing; do not infer snow from rain."""
    base = 'https://met-office-uk-ensemble-model-data.s3.eu-west-2.amazonaws.com/'
    prefix = run.strftime('uk-ensemble/%Y/%m/%d/T%H00Z/')
    params = {'list-type': '2', 'prefix': prefix}
    hours = set()
    for _ in range(40):
        listing = ET.fromstring(ensemble.get(base + '?' + urlencode(params)))
        for node in listing.findall('{*}Contents/{*}Key'):
            match = re.fullmatch(re.escape(prefix) + r'(\d{8}T\d{4}Z)-PT(\d{4})H00M-snowfall_accumulation-PT01H.nc', node.text or '')
            if match:
                hour = int(match[2])
                if match[1] == (run + timedelta(hours=hour)).strftime('%Y%m%dT%H%MZ'):
                    hours.add(hour)
        if listing.findtext('{*}IsTruncated') != 'true':
            return hours
        token = listing.findtext('{*}NextContinuationToken')
        if not token or token == params.get('continuation-token'):
            raise ValueError('Missing or repeated snowfall listing continuation')
        params['continuation-token'] = token
    raise ValueError('Snowfall listing exceeds bounded pagination')


def direct_hours(model, run, candidates):
    if not candidates:
        return []
    if model == 'mogreps':
        return sorted(set(candidates) & mogreps_hours(run))
    if model == 'icon-eu':
        hours = set(candidates)
        for variable in ('omega', 'fi', 'u', 'v'):
            text = ensemble.get(f'https://opendata.dwd.de/weather/nwp/icon-eu/grib/{run:%H}/{variable}/').decode()
            hours &= {int(h) for h in re.findall(fr'_{run:%Y%m%d%H}_(\d{{3}})_700_{variable.upper()}\.grib2\.bz2', text)}
        return sorted(hours)
    base = f'https://dd.weather.gc.ca/{run:%Y%m%d}/WXO-DD/model_gdps/15km/{run:%H}/'
    listing = ensemble.get(base).decode()
    available = set(candidates) & {int(h) for h in re.findall(r'href="(\d{3})/"', listing)}
    upper = {'AirTemp':[1000,850,500,250],'GeopotentialHeight':[500,300,200],'RelativeHumidity':[1000,700,300],'WindU':[1000,500,300,200],'WindV':[1000,500,300,200]}
    pairs = [(field, level) for field, levels in upper.items() for level in levels] if model == 'gem-upper' else [(field,700) for field in ('VerticalVelocity','GeopotentialHeight','WindU','WindV')]
    def complete(hour):
        text = ensemble.get(base + f'{hour:03d}/').decode()
        return hour if all(f'{run:%Y%m%dT%H}Z_MSC_GDPS_{field}_IsbL-{level:04d}_LatLon0.15_PT{hour:03d}H.grib2' in text
                           for field, level in pairs) else None
    with ThreadPoolExecutor(max_workers=6) as pool:
        return sorted(h for h in pool.map(complete, sorted(available)) if h is not None)


def check_direct(model, site, now, local_root=None):
    domain, native_domain = DIRECT[model]
    if model == 'gem-upper':
        site = 'https://matthewhugo81-arch.github.io/snowline-ensembles'
        local_root = None
    native = native_meta(native_domain)
    run = datetime.fromisoformat(native['reference_time'].replace('Z', '+00:00'))
    try:
        published = json.loads((local_root / domain / 'latest.json').read_text() if local_root else
                               ensemble.get(site.rstrip('/') + '/ensemble-data/' + domain + '/latest.json'))
    except (FileNotFoundError, HTTPError) as error:
        if isinstance(error, HTTPError) and error.code != 404:
            raise
        published = None
    reference = datetime.fromisoformat(published['reference_time'].replace('Z', '+00:00')) if published else None
    # A temporarily regressed upstream pointer must never roll the site back.
    if reference and reference > run:
        return dict(model=domain, status='upstream-behind', refresh_needed=False,
                    source_reference=ensemble.iso(run), published_reference=ensemble.iso(reference), checked_at=ensemble.iso(now))
    expected = expected_hours(model, run, native)
    fields = {'snowfall_probability'} if model == 'mogreps' else {'omega_700hPa', 'geopotential_height_700hPa', 'wind_u_component_700hPa', 'wind_v_component_700hPa'}
    if model == 'gem-upper':
        fields = {f'{kind}_{level}hPa' for kind, levels in {'temperature':[1000,850,500,250],'geopotential_height':[500,300,200],'relative_humidity':[1000,700,300],'wind_u_component':[1000,500,300,200],'wind_v_component':[1000,500,300,200]}.items() for level in levels}
    valid = published and published.get('format_version') == 1 and fields <= set(published.get('variables', []))
    prepared = {int((datetime.fromisoformat(t.replace('Z', '+00:00')) - run).total_seconds() / 3600)
                for t in published.get('valid_times', [])} if reference == run and valid else set()
    missing = direct_hours(model, run, sorted(set(expected) - prepared))
    newer = reference is None or reference < run
    # A native precipitation cycle alone is not proof of available snowfall.
    status = ('newer-source-run' if newer else 'hours-pending') if missing else ('awaiting-source' if newer else 'current')
    return dict(model=domain, status=status, refresh_needed=bool(missing),
                source_reference=ensemble.iso(run), published_reference=ensemble.iso(reference) if reference else None,
                source_hours=sorted((prepared & set(expected)) | set(missing)), missing_source_hours=missing,
                published_frames=len(published.get('valid_times', [])) if published else 0, checked_at=ensemble.iso(now))


def check_global(site, now, local_root=None):
    domain = 'snowline_mogreps_global'
    site = 'https://matthewhugo81-arch.github.io/snowline-ensembles'
    local_root = None
    manifest = json.loads(ensemble.get('https://matthewhugo81-arch.github.io/snowline-ensembles/mogreps/latest.json'))
    reference = ensemble.iso(datetime.fromtimestamp(manifest['run'], timezone.utc))
    if manifest.get('schema') != 1 or manifest.get('intervalHours') != 3 or len(manifest.get('members', [])) != 18:
        raise ValueError('Invalid global ensemble index')
    if (now-datetime.fromtimestamp(manifest['run'], timezone.utc)).total_seconds() > 72*3600:
        raise ValueError('Global source index expired')
    indexed = datetime.fromtimestamp(manifest['run'], timezone.utc)
    official = newest_complete_after(indexed, now, ensemble.get)
    index_pending = official > indexed
    path = local_root/domain/'latest.json' if local_root else None
    try:
        published = json.loads(path.read_text()) if path else json.loads(ensemble.get(site+'/ensemble-data/'+domain+'/latest.json'))
    except (FileNotFoundError, HTTPError):
        published = {}
    same = published.get('reference_time') == reference and published.get('format_version') == 2
    fields = ['temperature_850hPa_mean','temperature_850hPa_spread','temperature_500hPa_mean','temperature_500hPa_spread',
              'precipitation_mean','snowfall_water_equivalent_mean','precipitation_probability','snowfall_probability']
    comparison = [f'{base}_{stat}' for base in ['geopotential_height_500hPa','wind_speed_300hPa','wind_speed_200hPa','pressure_msl'] for stat in ['mean','spread']] + ['geopotential_height_500hPa_anomaly_mean']
    missing = [h for h in manifest['leads'] if not same or any(
        ensemble.iso(datetime.fromtimestamp(manifest['run']+h*3600, timezone.utc)) not in published.get('variable_valid_times', {}).get(key, [])
        for key in ((fields if h else fields[:4]) + comparison))]
    behind = published.get('reference_time', '') > reference
    return dict(model=domain, status='index-pending' if index_pending else 'upstream-behind' if behind else 'current' if not missing else 'hours-pending' if same else 'newer-source-run',
                refresh_needed=bool(missing) and not behind, source_reference=reference, source_hours=manifest['leads'],
                official_source_reference=ensemble.iso(official), index_refresh_needed=index_pending,
                published_reference=published.get('reference_time'), missing_source_hours=[] if behind else missing, checked_at=ensemble.iso(now))


def report(site, now, local_root=None):
    models = list(ensemble.MODELS) + list(DIRECT) + ['mogreps-global']
    def check(model):
        try:
            if model == 'mogreps-global':
                return check_global(site, now, local_root)
            return (ensemble.check_model if model in ensemble.MODELS else check_direct)(model, site, now, local_root)
        except Exception as error:
            domain = 'snowline_mogreps_global' if model == 'mogreps-global' else ensemble.MODELS[model][0] if model in ensemble.MODELS else DIRECT[model][0]
            return dict(model=domain, status='check-failed', error=str(error), refresh_needed=False, checked_at=ensemble.iso(now))
    with ThreadPoolExecutor(max_workers=5) as pool:
        rows = list(pool.map(check, models))
    overdue = False if local_root else ensemble.publication_check_overdue(site, now)
    return dict(checked_at=ensemble.iso(now), scope='Generated map feeds: source availability, same-run hours and archives; MOGREPS-G index independently checked against the official inventory.',
                publication_check_overdue=overdue, refresh_needed=overdue or any(row['refresh_needed'] for row in rows), models=rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--site', default=ensemble.SITE)
    parser.add_argument('--output', type=Path, default=Path('health-output/ensembles.json'))
    parser.add_argument('--local-root', type=Path)
    args = parser.parse_args()
    result = report(args.site, datetime.now(timezone.utc), args.local_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('refresh_needed=' + str(result['refresh_needed']).lower() + '\n')
    for row in result['models']:
        print(row['model'] + ': ' + row['status'] + ' | published ' + str(row.get('published_reference')) +
              ' | source ' + str(row.get('source_reference')) + ' | missing ' + str(len(row.get('missing_source_hours', []))) +
              (' | ' + row['error'] if row.get('error') else ''))
    if result['refresh_needed'] or any(row['status'] in ('check-failed', 'index-pending') or row.get('archive_status') == 'check-failed' for row in result['models']):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
