"""Move verified older IFS and GEFS grids out of the Pages bundle, preserving all runs.

Uses the same generated snapshot-branch approach as Stratoscope. Only the
dedicated forecast-archive branch is replaced, with a lease; never source/main.
Pages keeps all metadata and the newest run. Archived file URLs pin a commit.
"""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from urllib.request import Request, urlopen

REPOSITORY = 'matthewhugo81-arch/snowline'
BRANCH = 'forecast-archive'
DOMAIN = 'snowline_ecmwf_ensemble'
RAW = f'https://raw.githubusercontent.com/{REPOSITORY}/'


def domain_archive_plan(site, domain):
    parent = site / 'ensemble-data' / domain
    latest = json.loads((parent / 'latest.json').read_text())
    history = json.loads((parent / 'history.json').read_text())
    references = history['runs']
    if len(references) != 3 or references != sorted(set(references), reverse=True) or references[0] != latest['reference_time']:
        raise ValueError('Archive requires latest plus two verified predecessor runs')
    files, metadata = {}, {}
    for reference in references[1:]:
        folder = parent / datetime.fromisoformat(reference.replace('Z', '+00:00')).strftime('%Y/%m/%d/%H%MZ')
        meta = json.loads((folder / 'meta.json').read_text())
        if meta.get('reference_time') != reference or meta.get('completed') is not True or not meta.get('valid_times'):
            raise ValueError('Refusing to archive an incomplete or mismatched run')
        metadata[folder.relative_to(site).as_posix()] = meta
        for valid in meta['valid_times']:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z', valid):
                raise ValueError('Invalid archived forecast time')
            path = folder / (valid[:16].replace(':', '') + '.om.png')
            if path.is_symlink() or not path.resolve().is_relative_to(site.resolve()):
                raise ValueError('Archive path escapes the staged site')
            size = path.stat().st_size
            if not 32 <= size < 50_000_000:
                raise ValueError('Invalid archived frame size')
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            files[path.relative_to(site).as_posix()] = {'bytes': size, 'sha256': digest}
    return files, metadata


def archive_plan(site):
    files, metadata = domain_archive_plan(site, DOMAIN)
    gefs = 'snowline_gefs_ensemble'
    if (site / 'ensemble-data' / gefs).exists():
        extra_files, extra_metadata = domain_archive_plan(site, gefs)
        files.update(extra_files)
        metadata.update(extra_metadata)
    if sum(item['bytes'] for item in files.values()) > 900_000_000:
        raise ValueError('Generated archive exceeds its own storage budget')
    return files, metadata


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()


def read_json(url):
    with urlopen(Request(url, headers={'Cache-Control': 'no-cache'}), timeout=30) as response:
        return json.load(response)


def verify_transport(commit, files, metadata):
    # Check both ends of each retained run before removing any staged binary.
    for folder in metadata:
        paths = sorted(path for path in files if path.startswith(folder + '/'))
        for path in (paths[0], paths[-1]):
            for attempt in range(4):
                try:
                    with urlopen(Request(RAW + commit + '/' + path, headers={'Range': 'bytes=0-63'}), timeout=30) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes 0-63/{files[path]["bytes"]}' or len(response.read(65)) != 64:
                            raise ValueError('Archive byte-range transport failed')
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(2 ** attempt)


def publish(site):
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise ValueError('Archive publisher is restricted to its public source repository')
    files, metadata = archive_plan(site)
    # Generated/check timestamps do not create a new binary snapshot.
    canonical = {folder: {key: value for key, value in meta.items() if key != 'generated_at'} for folder, meta in metadata.items()}
    fingerprint = hashlib.sha256(json.dumps({'files': files, 'metadata': canonical}, sort_keys=True).encode()).hexdigest()
    remote = git(site, 'ls-remote', 'https://github.com/' + REPOSITORY + '.git', 'refs/heads/' + BRANCH)
    previous = remote.split()[0] if remote else ''
    commit = None
    if previous:
        old = read_json(RAW + previous + '/archive.json')
        if old.get('publisher') != 'snowline-map-archive-v1':
            raise ValueError('Refusing to replace a branch not owned by this archive publisher')
        if old.get('contentSha256') == fingerprint:
            commit = previous
    if not commit:
        with tempfile.TemporaryDirectory(prefix='snowline-archive-') as temporary:
            root = Path(temporary)
            for relative in files:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(site / relative, target)
            for folder, meta in canonical.items():
                (root / folder / 'meta.json').write_text(json.dumps(meta, sort_keys=True) + '\n')
            (root / 'archive.json').write_text(json.dumps({'publisher': 'snowline-map-archive-v1', 'contentSha256': fingerprint, 'files': files}, sort_keys=True) + '\n')
            (root / 'README.md').write_text('Generated Snowline IFS and GEFS archive. Replaced automatically with two retained predecessor runs. Source code is on main. Pages metadata pins immutable commit URLs.\n')
            git(root, 'init', '-b', BRANCH)
            git(root, 'config', 'user.name', 'github-actions[bot]')
            git(root, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
            git(root, 'remote', 'add', 'origin', 'https://github.com/' + REPOSITORY + '.git')
            git(root, 'add', '.')
            git(root, 'commit', '-m', 'Publish verified IFS and GEFS predecessor grids')
            git(root, 'push', f'--force-with-lease=refs/heads/{BRANCH}:{previous}', 'origin', f'HEAD:refs/heads/{BRANCH}')
            commit = git(root, 'rev-parse', 'HEAD')
    verify_transport(commit, files, metadata)
    for folder, meta in metadata.items():
        meta['archive_base'] = RAW + commit + '/ensemble-data/'
        (site / folder / 'meta.json').write_text(json.dumps(meta, indent=2) + '\n')
    # Delete only verified duplicates from the disposable Pages staging tree.
    # The conversion cache retains every original frame and can recreate it.
    for relative in files:
        (site / relative).unlink()
    print(f'Archive verified at {commit}: {len(files)} frames; {sum(item["bytes"] for item in files.values()):,} bytes removed from Pages staging')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('site', type=Path)
    parser.add_argument('--plan-only', action='store_true')
    args = parser.parse_args()
    if args.plan_only:
        files, metadata = archive_plan(args.site.resolve())
        total = sum(p.stat().st_size for p in args.site.rglob('*') if p.is_file())
        remaining = total - sum(item['bytes'] for item in files.values())
        print(f'Archive plan: {len(files)} frames; projected Pages data: {remaining:,} bytes')
        if remaining > 980_000_000:
            raise SystemExit('Archive plan leaves insufficient Pages headroom')
    else:
        publish(args.site.resolve())
