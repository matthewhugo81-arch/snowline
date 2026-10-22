"""Exclude unadvertised extra-field frames from a disposable site staging tree.

The two-minute converter may stop before writing metadata. Its resumable cache
must survive, but those unfinished files cannot yet serve any chart. Retain
every frame advertised by dated metadata or latest.json, including incomplete
published runs and older runs; never change forecast metadata or the cache.
"""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re

DOMAINS = ('snowline_gefs_extra_v2', 'snowline_ecmwf_extra_v2')


def staged_path(path, site):
    if path.is_symlink() or not path.resolve().is_relative_to(site):
        raise ValueError('Optional publication path escapes the staging tree')
    return path


def advertised(meta, folder):
    reference = datetime.fromisoformat(meta['reference_time'].replace('Z', '+00:00'))
    if '/'.join(folder.parts[-4:]) != reference.strftime('%Y/%m/%d/%H%MZ'):
        raise ValueError('Optional publication metadata has a mismatched run')
    times = meta.get('valid_times')
    if not isinstance(times, list) or not times:
        raise ValueError('Optional publication metadata has no verified times')
    names = set()
    for valid in times:
        if not isinstance(valid, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z', valid):
            raise ValueError('Invalid optional publication forecast time')
        names.add(valid[:16].replace(':', '') + '.om.png')
    return names


def unpublished_files(site):
    site = site.resolve()
    removed = []
    for domain in DOMAINS:
        parent = staged_path(site / 'ensemble-data' / domain, site)
        if not parent.exists():
            continue
        latest_path = staged_path(parent / 'latest.json', site)
        latest = json.loads(latest_path.read_text()) if latest_path.exists() else None
        latest_folder = None
        if latest:
            reference = datetime.fromisoformat(latest['reference_time'].replace('Z', '+00:00'))
            latest_folder = staged_path(parent / reference.strftime('%Y/%m/%d/%H%MZ'), site)
            if not staged_path(latest_folder / 'meta.json', site).is_file():
                raise ValueError('Advertised optional run is missing dated metadata')
        for folder in parent.glob('*/*/*/*Z'):
            staged_path(folder, site)
            metadata = staged_path(folder / 'meta.json', site)
            keep = advertised(json.loads(metadata.read_text()), folder) if metadata.exists() else set()
            if folder == latest_folder:
                keep |= advertised(latest, folder)
            # Fail before deletion if an advertised chart is already missing.
            for filename in keep:
                if not staged_path(folder / filename, site).is_file():
                    raise ValueError('Advertised optional frame is missing')
            for path in folder.iterdir():
                staged_path(path, site)
                if path.name.endswith('.om.png') and path.name not in keep or path.suffix == '.tmp':
                    removed.append(path)
    return removed


def prepare(site):
    paths = unpublished_files(site)
    size = sum(path.stat().st_size for path in paths)
    for path in paths:
        path.unlink()
    return len(paths), size


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('site', type=Path)
    args = parser.parse_args()
    count, size = prepare(args.site)
    print(f'Excluded {count} unadvertised optional files ({size:,} bytes) from site staging; conversion cache unchanged')
