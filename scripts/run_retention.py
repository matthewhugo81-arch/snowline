"""Protect the newest verified complete generation during interrupted updates."""
import json
from datetime import datetime


def last_complete_folder(domain_root, before=None):
    candidates = []
    for folder in domain_root.glob('*/*/*/*Z'):
        try:
            meta = json.loads((folder / 'meta.json').read_text())
            reference = datetime.fromisoformat(meta['reference_time'].replace('Z', '+00:00'))
            if before and reference >= datetime.fromisoformat(before.replace('Z', '+00:00')):
                continue
            if folder != domain_root / reference.strftime('%Y/%m/%d/%H%MZ'):
                continue
            times = meta.get('valid_times', [])
            if meta.get('completed') is not True or not times or not meta.get('variables'):
                continue
            if not all((folder / (time[:16].replace(':', '') + '.om')).is_file() for time in times):
                continue
            candidates.append((reference, folder))
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return max(candidates)[1] if candidates else None
