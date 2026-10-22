"""Persist KNMI's backoff across publisher runs without storing credentials."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import time


class KNMIRateLimited(RuntimeError):
    pass


def retry_time(header, now):
    try:
        return now + max(60, int(header))
    except (TypeError, ValueError):
        try:
            return max(now + 60, parsedate_to_datetime(header).timestamp())
        except (TypeError, ValueError, AttributeError):
            # The anonymous key's hourly quota is shared with other users.
            return now + 3600


def request_download_url(session, endpoint, key, cooldown_path, *, registered=False, now=None):
    now = time.time() if now is None else now
    try:
        saved = json.loads(cooldown_path.read_text())
    except (FileNotFoundError, ValueError):
        saved = {}
    if saved.get('registered') == registered and saved.get('retry_at', 0) > now:
        until = datetime.fromtimestamp(saved['retry_at'], timezone.utc).isoformat()
        raise KNMIRateLimited(f'KNMI pressure deferred until {until}; preserving verified exact-run data')
    response = session.get(endpoint, headers={'Authorization': key}, timeout=30)
    if response.status_code == 429:
        until = retry_time(response.headers.get('Retry-After'), now)
        cooldown_path.parent.mkdir(parents=True, exist_ok=True)
        temp = cooldown_path.with_suffix('.tmp')
        temp.write_text(json.dumps({'retry_at': until, 'registered': registered}) + '\n')
        temp.replace(cooldown_path)
        raise KNMIRateLimited('KNMI returned HTTP 429; cooldown saved for later publisher runs')
    response.raise_for_status()
    url = response.json()['temporaryDownloadUrl']
    cooldown_path.unlink(missing_ok=True)
    return url
