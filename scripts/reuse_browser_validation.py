"""Reuse a main-branch browser run only for identical runtime and test inputs."""
import json
import os
import subprocess
import time
from urllib.request import Request, urlopen

REPOSITORY = 'matthewhugo81-arch/snowline'


def same_inputs(candidate, revision):
    subprocess.run(['git', 'fetch', '--quiet', '--depth=1', 'origin', candidate], check=True)
    # Python converter/helper tests are independent of the browser suite.
    # Keep every browser fixture, JS test and shipped asset in this comparison.
    paths = ['.', ':(exclude).github/**', ':(exclude)scripts/**',
             ':(exclude)review/**', ':(exclude)tests/*.py']
    for selection in (paths, ['.github/workflows/map-browser-tests.yml']):
        result = subprocess.run(['git', 'diff', '--quiet', candidate, revision, '--', *selection])
        if result.returncode != 0:
            return False
    return True


def get_json(path):
    request = Request('https://api.github.com/repos/' + REPOSITORY + '/' + path,
                      headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                               'Accept': 'application/vnd.github+json',
                               'X-GitHub-Api-Version': '2022-11-28'})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def reuse(revision, fetch=get_json, compare=same_inputs, sleep=time.sleep, clock=time.monotonic, wait=1200):
    runs = fetch('actions/workflows/map-browser-tests.yml/runs?branch=main&event=push&per_page=10')['workflow_runs']
    for run in runs:
        if run.get('head_branch') != 'main' or run.get('event') != 'push':
            continue
        if not compare(run['head_sha'], revision):
            continue
        candidate, run_id = run['head_sha'], run['id']
        deadline = clock() + wait
        while run['status'] != 'completed':
            if clock() >= deadline:
                return False
            print('Waiting for existing identical browser validation: ' + run['html_url'], flush=True)
            sleep(20)
            run = fetch('actions/runs/' + str(run['id']))
            # A run response must retain its checked commit identity.
            if run['head_sha'] != candidate or run['id'] != run_id:
                return False
        if run.get('conclusion') == 'success':
            print('Reusing successful identical browser validation: ' + run['html_url'], flush=True)
            return True
        return False
    return False


if __name__ == '__main__':
    try:
        if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
            raise ValueError('Unexpected repository')
        proven = reuse(os.environ['SOURCE_REVISION'])
    except Exception as error:
        print('Existing browser proof unavailable; run the normal browser gate: ' + str(error), flush=True)
        proven = False
    raise SystemExit(0 if proven else 1)
