"""Measure Pages payloads, avoid identical uploads, and reuse passed browser gates."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.request import Request, urlopen


SITE = 'https://matthewhugo81-arch.github.io/snowline/'
MANIFEST = 'site-publication.json'
SCHEMA = 1
VALIDATION_VERSION = 1
MAX_BYTES = 1_000_000_000
HEARTBEAT_MINUTES = 20


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def strip_check_times(value):
    if isinstance(value, dict):
        return {key: strip_check_times(item) for key, item in value.items()
                if key not in ('generated_at', 'checked_at')}
    if isinstance(value, list):
        return [strip_check_times(item) for item in value]
    return value


def content_digest(path, relative):
    # Check timestamps change on every poll. Forecast content/status changes
    # still publish immediately; a 20-minute heartbeat renews source checks.
    if relative.parts[0] == 'ensemble-data' and path.suffix == '.json':
        return hashlib.sha256(canonical(strip_check_times(json.loads(path.read_text())))).hexdigest()
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_site(directory):
    digest = hashlib.sha256()
    total = count = 0
    groups, runs = {}, {}
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError(f'Symlink is not a Pages publication input: {path}')
        if not path.is_file() or path == directory / MANIFEST:
            continue
        relative = path.relative_to(directory)
        size = path.stat().st_size
        total += size
        count += 1
        group = '/'.join(relative.parts[:2]) if relative.parts[0] == 'ensemble-data' else relative.parts[0] if len(relative.parts) > 1 else 'application'
        groups[group] = groups.get(group, 0) + size
        if relative.parts[0] == 'ensemble-data' and len(relative.parts) >= 7:
            run = '/'.join(relative.parts[:6])
            runs[run] = runs.get(run, 0) + size
        digest.update(relative.as_posix().encode() + b'\0' + content_digest(path, relative).encode() + b'\n')
    return dict(content_sha256=digest.hexdigest(), payload_bytes=total,
                payload_files=count, groups=groups, runs=runs)


def read_published(site, now):
    url = site.rstrip('/') + '/' + MANIFEST + '?check=' + str(int(now.timestamp()))
    try:
        with urlopen(Request(url, headers={'Cache-Control': 'no-cache',
                                          'User-Agent': 'Snowline-Pages-release/1.0'}), timeout=20) as response:
            raw = response.read(128 * 1024 + 1)
        if len(raw) > 128 * 1024:
            raise ValueError('Publication record is too large')
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get('schema') != SCHEMA:
            raise ValueError('Unrecognised publication record')
        return result
    except Exception as error:
        # Missing/failed verification never authorizes bypassing the browser
        # gates or skipping a new publication.
        print(f'Published release record unavailable; verify this revision: {error}')
        return None


def browser_validated(published, revision):
    return bool(published and published.get('schema') == SCHEMA
                and published.get('source_revision') == revision
                and published.get('browser_validation') == {
                    'version': VALIDATION_VERSION, 'revision': revision,
                    'checks': ['map-browser', 'location-browser'],
                })


def publication_needed(current, published, now, heartbeat_minutes=HEARTBEAT_MINUTES):
    if not published or current['content_sha256'] != published.get('content_sha256'):
        return True
    if not isinstance(published.get('built_at'), str):
        return True
    try:
        previous = datetime.fromisoformat(published['built_at'].replace('Z', '+00:00'))
        age = now - previous
    except (KeyError, TypeError, ValueError):
        return True
    return not timedelta(0) <= age < timedelta(minutes=heartbeat_minutes)


def output(name, value):
    text = str(value).lower() if isinstance(value, bool) else str(value)
    print(f'{name}={text}')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
            stream.write(f'{name}={text}\n')


def write_summary(current, changed, maximum):
    lines = ['## Pages publication', '',
             f"Unpacked site: **{current['total_bytes']:,} bytes** in {current['file_count']:,} files; limit {maximum:,} bytes.",
             '', 'Publication required: **' + ('yes' if changed else 'no; forecast content unchanged and source-check heartbeat still current') + '**.',
             '', 'Compressed artifact size is not used as the site-size measurement.', '',
             '| Payload | Unpacked bytes |', '| --- | ---: |']
    lines.extend(f'| {group} | {size:,} |' for group, size in sorted(current['groups'].items(), key=lambda item: -item[1]))
    if current['runs']:
        lines += ['', '| Retained forecast run | Unpacked bytes |', '| --- | ---: |']
        lines.extend(f'| {run} | {size:,} |' for run, size in sorted(current['runs'].items()))
    text = '\n'.join(lines) + '\n'
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as stream:
            stream.write(text)


def prepare(directory, revision, published, now, maximum=MAX_BYTES):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Expected a full source commit SHA')
    measured = inspect_site(directory)
    current = dict(schema=SCHEMA, source_revision=revision,
                   built_at=now.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
                   browser_validation={'version': VALIDATION_VERSION, 'revision': revision,
                                       'checks': ['map-browser', 'location-browser']},
                   **measured, total_bytes=0, file_count=measured['payload_files'] + 1)
    # The record is uploaded only by a deploy job whose exact-revision browser
    # checks have passed (or whose matching published validation is verified).
    # Include this record's own bytes in the strict unpacked site measurement.
    while True:
        raw = canonical(current) + b'\n'
        size = measured['payload_bytes'] + len(raw)
        if current['total_bytes'] == size:
            break
        current['total_bytes'] = size
    (directory / MANIFEST).write_bytes(raw)
    changed = publication_needed(current, published, now) or not browser_validated(published, revision)
    write_summary(current, changed, maximum)
    if size > maximum:
        raise ValueError(f'Unpacked site is {size:,} bytes, above the {maximum:,}-byte Pages budget. '
                         'The previous deployment is retained; do not shorten advertised forecast runs to bypass this check.')
    if size >= maximum * 0.9:
        print('::warning::Pages site uses at least 90% of the unpacked size budget; inspect the per-run breakdown.')
    return current, changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validation', 'prepare'])
    parser.add_argument('--revision', required=True)
    parser.add_argument('--site', default=SITE)
    parser.add_argument('--directory', type=Path, default=Path('_site'))
    parser.add_argument('--max-bytes', type=int, default=MAX_BYTES)
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    published = read_published(args.site, now)
    if args.action == 'validation':
        output('browser_validated', browser_validated(published, args.revision))
    else:
        _, changed = prepare(args.directory, args.revision, published, now, args.max_bytes)
        output('changed', changed)


if __name__ == '__main__':
    main()
