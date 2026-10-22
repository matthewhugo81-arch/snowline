"""Measure the unpacked site and compare content with the last actual deployment.

Changing a check timestamp does not make the forecast new. Quarter-hourly health refreshes
are explicit; model times, field inventories and all binary bytes remain hashed.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def semantic_json(value, ignored=('generated_at',)):
    if isinstance(value, dict):
        return {k: semantic_json(v, ignored) for k, v in value.items() if k not in ignored}
    if isinstance(value, list):
        return [semantic_json(v, ignored) for v in value]
    return value


def inventory(root):
    groups = defaultdict(lambda: {'bytes': 0, 'files': 0})
    digest = hashlib.sha256()
    total = count = 0
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.name == 'publication.json':
            continue
        if path.is_symlink():
            raise ValueError(f'Publication cannot contain symlinks: {path}')
        relative = path.relative_to(root).as_posix()
        size = path.stat().st_size
        total += size
        count += 1
        parts = relative.split('/')
        group = '/'.join(parts[:6]) if parts[0] == 'ensemble-data' and len(parts) > 6 else '/'.join(parts[:2]) if parts[0] == 'ensemble-data' else parts[0]
        groups[group]['bytes'] += size
        groups[group]['files'] += 1
        # Independent health evidence is refreshed every fifteen minutes below.
        if relative == 'ensemble-data/health.json':
            continue
        digest.update(relative.encode() + b'\0')
        if relative.startswith(('ensemble-data/', 'mogreps/')) and path.suffix == '.json':
            ignored = ('generated_at', 'generated') if relative.startswith('mogreps/') else ('generated_at',)
            digest.update(json.dumps(semantic_json(json.loads(path.read_text()), ignored), sort_keys=True, separators=(',', ':')).encode())
        else:
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
        digest.update(b'\0')
    return {'bytes': total, 'files': count, 'contentSha256': digest.hexdigest(), 'groups': dict(sorted(groups.items()))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('--live-url')
    parser.add_argument('--budget', type=int, default=990_000_000)
    parser.add_argument('--report-only', action='store_true')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    report = inventory(args.root)
    report.update(version=1, sourceRevision=os.environ.get('GITHUB_SHA', 'local'),
                  preparedAt=now.isoformat(), healthWindow=int(now.timestamp()) // 900 if (args.root / 'ensemble-data/health.json').is_file() else 0,
                  workflowRun=os.environ.get('GITHUB_RUN_ID'))
    text = json.dumps(report, indent=2) + '\n'
    # Include the manifest itself in the budget.
    size = report['bytes'] + len(text.encode())
    lines = ['## Publication inventory', f'Unpacked site: {size:,} bytes; {report["files"] + 1:,} files; budget: {args.budget:,} bytes.', '', '| Model/run or asset | Bytes | Files |', '|---|---:|---:|']
    lines += [f'| {name} | {data["bytes"]:,} | {data["files"]} |' for name, data in report['groups'].items()]
    print('\n'.join(lines))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write('\n'.join(lines) + '\n')
    if args.report_only:
        return
    if size > args.budget:
        raise SystemExit(f'Publication exceeds {args.budget:,}-byte budget; previous live site is preserved')
    if size >= args.budget * 0.9:
        print(f'::warning::Publication headroom is {args.budget-size:,} bytes ({100*(args.budget-size)/args.budget:.1f}%); review data growth before adding more feeds')
    previous = None
    if args.live_url:
        try:
            request = Request(args.live_url + '?check=' + str(int(now.timestamp())), headers={'Cache-Control': 'no-cache'})
            with urlopen(request, timeout=30) as response:
                previous = json.load(response)
        except HTTPError as error:
            if error.code != 404:
                raise
    changed = not previous or any(previous.get(key) != report[key] for key in ('version', 'sourceRevision', 'contentSha256', 'healthWindow'))
    (args.root / 'publication.json').write_text(text)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write(f'changed={str(changed).lower()}\n')
    print('Publish changed content' if changed else 'No changed forecast/application content; skip artifact and deployment')


if __name__ == '__main__':
    main()
