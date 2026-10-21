"""Add daily height anomalies to verified native ensemble frames, atomically."""
from datetime import timedelta
import numpy as np
from omfiles import OmFileReader, OmFileWriter
from mogreps_climatology_cache import cached_daily

ANOMALY = 'geopotential_height_500hPa_anomaly_mean'
REFERENCE = dict(dataset='NOAA NCEP/NCAR Reanalysis 1', period='1991-2020',
                 statistic='daily mean', level_hPa=500, units='m',
                 interpolation='Bilinear climatology to native forecast cells; Feb 29 averages Feb 28 and Mar 1')


def baseline(valid, step):
    # Use the same verified annual cache and leap-day convention as MOGREPS.
    if (valid.month, valid.day) == (2, 29):
        values = [cached_daily(valid + timedelta(days=d)) for d in (-1, 1)]
        if any(v is None for v in values):
            raise ValueError('Verified 1991–2020 climatology cache unavailable')
        climate = (values[0] + values[1]) / 2
    else:
        climate = cached_daily(valid)
    if climate is None:
        raise ValueError('Verified 1991–2020 climatology cache unavailable')
    lat = -90 + np.arange(round(180 / step) + 1) * step
    lon = (-180 + np.arange(round(360 / step)) * step) % 360
    yy, xx = (90 - lat) / 2.5, lon / 2.5
    y, x = np.floor(yy).astype(int), np.floor(xx).astype(int)
    fy, fx = (yy - y)[:, None], (xx - x)[None, :]
    # Clamp the polar neighbour and wrap longitude at Greenwich.
    return ((1-fy)*((1-fx)*climate[y[:, None], x] + fx*climate[y[:, None], (x+1)%144])
            + fy*((1-fx)*climate[np.minimum(y+1, 72)[:, None], x]
                  + fx*climate[np.minimum(y+1, 72)[:, None], (x+1)%144]))


def add_anomalies(paths, run, step, fields):
    """Reuse cached forecasts; an unavailable baseline never removes core maps."""
    published, climates = [], {}
    failures = []
    for hour, path in paths:
        try:
            reader = OmFileReader(str(path))
            try:
                try:
                    existing = reader.get_child_by_name(ANOMALY)
                except ValueError as error:
                    if str(error) != f"Child with name '{ANOMALY}' does not exist":
                        raise
                    existing = None
                if existing is not None:
                    published.append(hour)
                    continue
                values = {key: np.array(reader.get_child_by_name(key)[:], copy=True)
                          for key in fields}
            finally:
                del reader
            valid = run + timedelta(hours=hour)
            day = valid.strftime('%m-%d')
            if day not in climates:
                climates[day] = baseline(valid, step)
            mean = values['geopotential_height_500hPa_mean']
            if mean.shape != climates[day].shape:
                raise ValueError('Unexpected native ensemble grid')
            values[ANOMALY] = mean - climates[day]
            if not np.isfinite(values[ANOMALY]).all():
                raise ValueError('Incomplete height anomaly')
            temporary = path.with_suffix('.anomaly.tmp')
            writer = OmFileWriter(str(temporary))
            children = []
            for key, array in values.items():
                # Preserve native fields at their original publication precision.
                scale = (100 if key == 'temperature_850hPa_spread' else
                         1 if key == 'geopotential_height_500hPa_mean' else 10)
                children.append(writer.write_array(np.ascontiguousarray(array, dtype=np.float32),
                    chunks=[10, 180], scale_factor=scale, add_offset=0,
                    compression='pfor_delta_2d', name=key))
            writer.close(writer.write_group(name='root', children=children))
            temporary.replace(path)
            published.append(hour)
        except Exception as error:
            failures.append(f'T+{hour}: {error}')
    if failures:
        print(f'::warning::Height anomalies pending for {len(failures)} frames: {failures[0]}', flush=True)
    return published
