"""Verified 500 hPa daily climatology from NOAA's independent bulk archive."""
import argparse
from datetime import datetime, timedelta
import hashlib
import os
from pathlib import Path
import tempfile
import netCDF4
import numpy as np
import requests

SOURCE = 'https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/pressure/hgt.day.ltm.1991-2020.nc'
PERIOD = '1991/01/01 - 2020/12/31'
CACHE = Path(os.environ.get('MOGREPS_CLIMATOLOGY_CACHE', 'climatology-cache/500hpa-daily-1991-2020.npz'))
DATES = [(datetime(2001, 1, 1) + timedelta(days=i)).strftime('%m-%d') for i in range(365)]
_annual = None


def verified_values(dataset):
    dates = [f'{d.month:02d}-{d.day:02d}' for d in netCDF4.num2date(dataset['time'][:], dataset['time'].units)]
    levels = dataset['level'][:].tolist()
    if dataset['time'].climo_period != PERIOD or dataset['hgt'].units != 'm' or dates != DATES or levels.count(500) != 1:
        raise ValueError('Unverified NOAA climatology period, units, dates or level')
    if dataset['hgt'].dimensions != ('time', 'level', 'lat', 'lon'):
        raise ValueError('Unverified NOAA climatology dimensions')
    if not np.allclose(dataset['lat'][:], np.arange(90, -90.1, -2.5)) or not np.allclose(dataset['lon'][:], np.arange(0, 360, 2.5)):
        raise ValueError('Unverified NOAA climatology grid')
    values = np.ma.filled(dataset['hgt'][:, levels.index(500)], np.nan).astype(np.float32)
    if values.shape != (365, 73, 144) or not np.isfinite(values).all():
        raise ValueError('Incomplete NOAA climatology')
    return values


def read_cache(path=CACHE):
    with np.load(path, allow_pickle=False) as data:
        values = data['values']
        if str(data['source']) != SOURCE or str(data['period']) != PERIOD or data['dates'].tolist() != DATES:
            raise ValueError('Unverified cached climatology provenance')
        if values.shape != (365, 73, 144) or not np.isfinite(values).all():
            raise ValueError('Incomplete cached climatology')
        digest = hashlib.sha256(values.tobytes()).hexdigest()
        if str(data['values_sha256']) != digest:
            raise ValueError('Cached climatology checksum mismatch')
        return values


def cached_daily(valid):
    global _annual
    if _annual is None:
        if not CACHE.is_file():
            return None
        _annual = read_cache()
    return _annual[DATES.index(valid.strftime('%m-%d'))]


def prepare(path=CACHE, source=None):
    if path.is_file():
        read_cache(path)
        print(f'Verified climatology cache: {path.stat().st_size:,} bytes')
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='noaa-climatology-') as temporary:
        raw = Path(source) if source else Path(temporary) / 'daily.nc'
        if not source:
            with requests.get(SOURCE, stream=True, timeout=(5, 30)) as response:
                response.raise_for_status()
                total = 0
                with raw.open('wb') as stream:
                    for block in response.iter_content(1024 * 1024):
                        total += len(block)
                        if total > 300_000_000:
                            raise ValueError('Unexpected NOAA bulk file size')
                        stream.write(block)
        with netCDF4.Dataset(raw) as dataset:
            values = verified_values(dataset)
        with raw.open('rb') as stream:
            source_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
        temporary_cache = path.with_suffix('.tmp')
        with temporary_cache.open('wb') as stream:
            np.savez_compressed(stream, values=values, dates=DATES, source=SOURCE, period=PERIOD,
                                source_sha256=source_hash, values_sha256=hashlib.sha256(values.tobytes()).hexdigest())
        read_cache(temporary_cache)
        temporary_cache.replace(path)
    print(f'Prepared verified 500 hPa climatology: {path.stat().st_size:,} bytes; source SHA256 {source_hash}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path, default=CACHE)
    args = parser.parse_args()
    prepare(args.output, args.source)
