"""Verified same-cycle MOGREPS heights, winds, pressure and daily height anomalies."""
from datetime import datetime, timedelta, timezone
import threading
import fsspec
import h5py
import netCDF4
import numpy as np
import requests
from build_mogreps_global import SOURCE, GRID, CROP, fetch, extract, index_for, statistics
from mogreps_climatology_cache import cached_daily

CLIMATOLOGY = 'https://psl.noaa.gov/thredds/ncss/grid/Datasets/ncep.reanalysis.derived/pressure/hgt.day.ltm.1991-2020.nc'
ANOMALY = 'geopotential_height_500hPa_anomaly_mean'
FIELDS = [f'{base}_{stat}' for base in ['geopotential_height_500hPa', 'wind_speed_300hPa', 'wind_speed_200hPa', 'pressure_msl'] for stat in ['mean', 'spread']] + [ANOMALY]
_climates = {}
_climate_error = None
_lock = threading.Lock()

def text(value):
    return value.decode() if isinstance(value, bytes) else str(value)

def dataset_index(dataset, levels):
    filters = []
    plist = dataset.id.get_create_plist()
    for i in range(plist.get_nfilters()):
        kind, _, params, _ = plist.get_filter(i)
        if kind not in (1, 2):
            raise ValueError('Unsupported HDF5 filter')
        filters.append(dict(id=kind, params=list(params)))
    chunks = {}
    allowed = {level // dataset.chunks[1] for level in levels}
    def record(info):
        coords = [v // c for v, c in zip(info.chunk_offset, dataset.chunks)]
        if coords[1] in allowed:
            chunks[','.join(map(str, coords))] = [info.byte_offset, info.size, info.filter_mask]
    dataset.id.chunk_iter(record)
    return dict(shape=list(dataset.shape), chunkShape=list(dataset.chunks), dtype=dataset.dtype.str,
                fillValue=float(dataset.fillvalue), filters=filters, chunks=chunks)

def pressure_members(manifest, lead, name, unit, levels, workers, crop):
    run = datetime.fromtimestamp(manifest['run'], timezone.utc)
    valid = run + timedelta(hours=lead)
    key = run.strftime('global-ensemble/%Y/%m/%d/T%H00Z/') + valid.strftime('%Y%m%dT%H00Z') + f'-PT{lead:04d}H00M-{name}_on_pressure_levels.nc'
    # Pin both metadata and subsequent parallel ranges to this exact source object.
    response = fetch(SOURCE + key, {'Range': 'bytes=0-7'})
    if response.status_code != 206:
        raise ValueError('Missing source range support')
    etag = response.headers['ETag']
    size = int(response.headers['Content-Range'].split('/')[-1])
    with fsspec.open(SOURCE + key, 'rb', block_size=16384, cache_type='blockcache', headers={'If-Match': etag}) as remote:
        with h5py.File(remote, 'r') as f:
            if int(f['forecast_reference_time'][()]) != manifest['run'] or int(f['time'][()]) != int(valid.timestamp()):
                raise ValueError('Mismatched MOGREPS cycle/time')
            if f['realization'][:].astype(int).tolist() != manifest['members']:
                raise ValueError('Mismatched ensemble members')
            if not np.allclose(f['latitude'][:], -89.90625 + np.arange(960)*.1875) or not np.allclose(f['longitude'][:], -179.859375 + np.arange(1280)*.28125):
                raise ValueError('Mismatched native grid')
            data, flag = f[name], f['flag']
            if text(data.attrs['units']) != unit or text(data.attrs['standard_name']) != name or data.shape != (18, 33, 960, 1280):
                raise ValueError('Unverified parameter/units/dimensions')
            if text(flag.attrs['flag_meanings']) != 'above_surface_pressure below_surface_pressure' or flag.attrs['flag_values'].tolist() != [0, 1]:
                raise ValueError('Unverified pressure mask')
            selected = [int(np.flatnonzero(f['pressure'][:] == p*100)[0]) for p in levels]
            data_index, flag_index = dataset_index(data, selected), dataset_index(flag, selected)
    index = dict(key=key, etag=etag, size=size)
    values = extract(index, data_index, selected, workers, crop)
    flags = extract(index, flag_index, selected, workers, crop)
    return np.where(flags == 0, values, np.nan)

def daily_climatology(valid):
    """NOAA 1991–2020 daily mean; Feb 29 is the mean of Feb 28 and Mar 1."""
    global _climate_error
    if (valid.month, valid.day) == (2, 29):
        return (daily_climatology(valid-timedelta(days=1)) + daily_climatology(valid+timedelta(days=1)))/2
    cached = cached_daily(valid)
    if cached is not None:
        return cached
    key = (valid.month, valid.day)
    with _lock:
        if key not in _climates:
            if _climate_error is not None:
                raise RuntimeError('Climatology unavailable in this worker; retry next publication') from _climate_error
            url = CLIMATOLOGY + f'?var=hgt&vertCoord=500&time=0001-{valid.month:02d}-{valid.day:02d}T00:00:00Z&accept=netcdf3'
            try:
                # This optional baseline must not inherit the native source's
                # four long retries for every forecast hour during an outage.
                response = requests.get(url, timeout=(5, 15))
                response.raise_for_status()
                payload = response.content
            except requests.RequestException as error:
                _climate_error = error
                raise
            with netCDF4.Dataset('climatology', memory=payload) as ds:
                date = netCDF4.num2date(ds['time'][:], ds['time'].units)[0]
                if (date.month, date.day) != key or ds['time'].climo_period != '1991/01/01 - 2020/12/31' or ds['level'][:].tolist() != [500] or ds['hgt'].units != 'm':
                    raise ValueError('Unverified climatological reference')
                if not np.allclose(ds['lat'][:], np.arange(90, -90.1, -2.5)) or not np.allclose(ds['lon'][:], np.arange(0, 360, 2.5)):
                    raise ValueError('Unexpected climatology grid')
                values = np.ma.filled(ds['hgt'][0, 0], np.nan).astype(float)
                if not np.isfinite(values).all():
                    raise ValueError('Incomplete climatology')
                _climates[key] = values
        return _climates[key]

def interpolate_climatology(values, crop=CROP):
    """Bilinear baseline interpolation only; forecast cells remain native."""
    y0, y1, x0, x1 = crop
    lat = -89.90625 + np.arange(y0, y1)*.1875
    lon = (-179.859375 + np.arange(x0, x1)*.28125) % 360
    yy, xx = (90-lat)/2.5, lon/2.5
    y, x = np.floor(yy).astype(int), np.floor(xx).astype(int)
    fy, fx = (yy-y)[:, None], (xx-x)[None, :]
    return ((1-fy)*((1-fx)*values[y[:, None], x]+fx*values[y[:, None], (x+1)%144])
            +fy*((1-fx)*values[(y+1)[:, None], x]+fx*values[(y+1)[:, None], (x+1)%144]))

def comparison_values(manifest, lead, workers=12, crop=CROP, existing=None):
    result = {key: value for key, value in (existing or {}).items() if key in FIELDS}
    if not all(key in result for key in FIELDS[:2]):
        heights = pressure_members(manifest, lead, 'geopotential_height', 'm', [500], workers, crop)[:, 0]
        result['geopotential_height_500hPa_mean'], result['geopotential_height_500hPa_spread'] = statistics(heights)
    valid = datetime.fromtimestamp(manifest['run']+lead*3600, timezone.utc)
    if not all(key in result for key in FIELDS[2:6]):
        wind = pressure_members(manifest, lead, 'wind_speed', 'm s-1', [300, 200], workers, crop)
        for i, level in enumerate([300, 200]):
            result[f'wind_speed_{level}hPa_mean'], result[f'wind_speed_{level}hPa_spread'] = statistics(wind[:, i])
    if not all(key in result for key in FIELDS[6:8]):
        index = index_for(manifest, 'pressure_msl', lead)
        if index.get('units') != 'Pa':
            raise ValueError('Unverified pressure units')
        pressure = extract(index, index['data'], workers=workers, crop=crop)/100
        result['pressure_msl_mean'], result['pressure_msl_spread'] = statistics(pressure)
    try:
        if ANOMALY not in result:
            result[ANOMALY] = result['geopotential_height_500hPa_mean'] - interpolate_climatology(daily_climatology(valid), crop)
    except Exception as error:
        # Publish independently verified native fields; metadata omits only the
        # unavailable anomaly instead of discarding pressure, winds and height.
        print(f'::warning::MOGREPS height anomaly T+{lead} awaits verified climatology: {error}', flush=True)
    return result

