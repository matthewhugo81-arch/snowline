"""Assemble runtime files and advertised forecast frames, not conversion caches.

The conversion cache may contain incomplete archive backfills, temporary files
and per-frame calculation records. Only a run's verified metadata can advertise
frames on Pages. Keep every advertised run and its native forecast horizon.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil
import subprocess


REQUIRED_DOMAINS = (
    'snowline_gefs_ensemble', 'snowline_ecmwf_ensemble', 'snowline_mogreps_uk',
    'snowline_gem_700', 'snowline_icon_eu_700',
)
OPTIONAL_DOMAINS = (
    'snowline_gefs_extra_v2', 'snowline_ecmwf_extra_v2', 'snowline_mogreps_global',
)
SOURCE_ONLY = {'.github', 'tests', 'scripts', 'review', 'review-output',
               'scheduler', 'worker', 'node_modules'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def copy_file(source, target):
    if source.is_symlink() or not source.is_file():
        raise ValueError(f'Not a regular publication file: {source}')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def run_path(reference):
    return datetime.fromisoformat(reference.replace('Z', '+00:00')).strftime('%Y/%m/%d/%H%MZ')


def frame_name(valid_time):
    return datetime.fromisoformat(valid_time.replace('Z', '+00:00')).strftime('%Y-%m-%dT%H%M.om')


def copy_domain(source, target):
    latest = read_json(source / 'latest.json')
    latest_run = latest['reference_time']
    references = {latest_run}
    if (source / 'history.json').exists():
        references.update(read_json(source / 'history.json')['runs'])
        copy_file(source / 'history.json', target / 'history.json')
    else:
        # Snowfall and other retained feeds have per-run metadata but no index.
        # Keep these existing run choices; never impose a shorter archive here.
        references.update(read_json(path)['reference_time']
                          for path in source.glob('*/*/*/*Z/meta.json'))
    copy_file(source / 'latest.json', target / 'latest.json')
    for reference in sorted(references):
        relative = Path(run_path(reference))
        metadata = read_json(source / relative / 'meta.json')
        if metadata['reference_time'] != reference or not metadata.get('valid_times'):
            raise ValueError(f'Invalid advertised run metadata: {source / relative}')
        copy_file(source / relative / 'meta.json', target / relative / 'meta.json')
        times = set(metadata['valid_times'])
        if reference == latest_run:
            # Never publish a latest pointer whose frames are missing from its
            # exact-run metadata, even if an interrupted cache write left both.
            if not set(latest['valid_times']) <= times:
                raise ValueError(f'Latest and run metadata disagree: {source}')
        for valid_time in sorted(times):
            name = frame_name(valid_time)
            # OM binary transport needs image/png to avoid Pages' gzip ranges.
            copy_file(source / relative / name, target / relative / (name + '.png'))


def assemble(root, destination):
    root, destination = root.resolve(), destination.resolve()
    if destination == root or not destination.is_relative_to(root):
        raise ValueError('Publication directory must be a child of the checkout')
    if destination.exists():
        raise ValueError('Use a new, empty publication directory')
    destination.mkdir(parents=True)
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    for name in filter(None, tracked):
        path = Path(name)
        if path.parts[0] in SOURCE_ONLY or any(part.startswith('.') for part in path.parts):
            continue
        copy_file(root / path, destination / path)
    point_root = root / 'point-data'
    if not point_root.is_dir():
        raise ValueError('Shared point forecasts were not prepared')
    for path in point_root.glob('*.json'):
        copy_file(path, destination / 'point-data' / path.name)
    for domain in REQUIRED_DOMAINS + OPTIONAL_DOMAINS:
        source = root / 'ensemble-data' / domain
        if domain in REQUIRED_DOMAINS or (source / 'latest.json').exists():
            copy_domain(source, destination / 'ensemble-data' / domain)
    health = root / 'ensemble-data' / 'health.json'
    if health.exists():
        copy_file(health, destination / 'ensemble-data' / 'health.json')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip()
    (destination / 'site-revision.txt').write_text(revision + '\n', encoding='utf-8')
    (destination / '.nojekyll').touch()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--destination', type=Path, default=Path('_site'))
    args = parser.parse_args()
    assemble(args.root, args.destination)
