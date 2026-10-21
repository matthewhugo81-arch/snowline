"""Member-first, complete-window probability calculations. No browser work.

All amounts are mm water equivalent. Extrema are calculated before the
ensemble statistic. A missing member or interval makes that cell unavailable.
"""
from datetime import timedelta
import numpy as np

THRESHOLDS = {'gust': (50, 60, 70), 'rain': (1, 10, 25, 50),
              'snow': (.1, 1, 5, 10), 'precip': (1, 10, 25, 50)}


def lagged_cycles(reference):
    return [reference - timedelta(hours=i) for i in range(6)]


def complete_window(records, start, end, operation):
    """Records: (start hour, end hour, member grid); exact partition required."""
    records = sorted(records, key=lambda r: r[0])
    cursor, result = start, None
    for lo, hi, values in records:
        if lo != cursor or hi <= lo or hi > end:
            raise ValueError('Missing, overlapping or out-of-window interval')
        a = np.asarray(values, dtype=np.float32)
        if result is None:
            result = a.copy()
        elif result.shape != a.shape:
            raise ValueError('Member grid changed within window')
        elif operation == 'sum':
            result += a
        elif operation == 'max':
            result = np.maximum(result, a)
        elif operation == 'min':
            result = np.minimum(result, a)
        else:
            raise ValueError('Unsupported aggregation')
        cursor = hi
    if cursor != end or result is None:
        raise ValueError('Incomplete forecast window')
    return result


def probability(values, threshold, count, strict=False):
    a = np.asarray(values)
    if a.ndim != 3 or a.shape[0] != count:
        raise ValueError('Incomplete ensemble')
    valid = np.isfinite(a).all(axis=0)
    p = ((a > threshold) if strict else (a >= threshold)).sum(axis=0) * (100.0 / count)
    return np.where(valid, p, np.nan).astype(np.float32)


def threshold_fields(kind, values, hours, count):
    if kind in ('rain_occurrence', 'snow_occurrence'):
        return {f'ens_{kind}_{hours}h': probability(values, 0, count, strict=True)}
    result = {}
    for t in THRESHOLDS[kind]:
        key = f'ens_{kind}_{"gt" if kind == "gust" else "ge"}{str(t).replace(".", "p")}{"kt" if kind == "gust" else "mm"}_{hours}h'
        result[key] = probability(values, t * 1852 / 3600 if kind == 'gust' else t, count, kind == 'gust')
    return result


def nonnegative_difference(end, start, tolerance=.01):
    delta = np.asarray(end) - np.asarray(start)
    if np.any(delta < -tolerance):
        raise ValueError('Accumulation decreased: reset or mismatched interval')
    return np.maximum(delta, 0)


def member_extrema_anomaly(extrema, normal, count=18):
    if extrema.shape[0] != count or extrema.shape[1:] != normal.shape:
        raise ValueError('Incomplete extrema or mismatched climatology grid')
    return np.mean(extrema, axis=0) - normal
