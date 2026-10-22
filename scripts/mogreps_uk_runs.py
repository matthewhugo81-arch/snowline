"""Dependency-free UTC cycle policy shared by publication and freshness checks."""
from datetime import datetime, timedelta, timezone


def three_hour_cycle(reference):
    return datetime.fromisoformat(reference).timestamp() % (3 * 3600) == 0


def select_three_hour_run(candidates, load):
    if not candidates:
        raise ValueError("No verified MOGREPS run available")
    candidates = list(candidates)
    candidates.sort(key=lambda m: (datetime.fromisoformat(m['reference_time']), len(m['valid_times'])), reverse=True)
    newest = datetime.fromisoformat(candidates[0]['reference_time']).astimezone(timezone.utc)
    if newest.minute or newest.second or newest.microsecond:
        raise ValueError('Invalid MOGREPS initialization')
    run = newest.replace(hour=newest.hour // 3 * 3)
    while run >= newest - timedelta(hours=24):
        meta = next((m for m in candidates if datetime.fromisoformat(m['reference_time']) == run), None)
        if meta is None:
            try:
                meta = load(run.strftime('%Y/%m/%d/%H00Z/meta.json'))
            except Exception as error:
                status = getattr(error, 'code', None) or getattr(getattr(error, 'response', None), 'status_code', None)
                if status != 404:
                    raise
                run -= timedelta(hours=3)
                continue
        if datetime.fromisoformat(meta['reference_time']) != run:
            raise ValueError('MOGREPS metadata does not match requested initialization')
        times = meta.get('valid_times')
        if times == []:
            run -= timedelta(hours=3)
            continue
        if not isinstance(times, list) or not times or not meta.get('variables') or any(datetime.fromisoformat(t) < run for t in times):
            raise ValueError('Invalid MOGREPS metadata')
        return meta
    raise ValueError('No three-hourly MOGREPS run published within 24 hours')
