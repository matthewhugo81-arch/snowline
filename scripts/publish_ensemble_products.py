"""Publish only the generated-data branch, with bounded history.

Every snapshot contains the retained two runs. Browser URLs pin the data commit,
so rebuilding a frame can never mix a cached directory with new data chunks.
The force-with-lease applies only to this disposable generated-data branch.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def git(*args,cwd=None):
    return subprocess.check_output(['git',*args],cwd=cwd,text=True).strip()


def publish(artifacts):
    remote=git('remote','get-url','origin')
    old=git('ls-remote','origin','refs/heads/ensemble-products').split()
    expected=old[0] if old else ''
    with tempfile.TemporaryDirectory(prefix='ensemble-products-') as directory:
        folder=Path(directory);git('init',cwd=folder);git('remote','add','origin',remote,cwd=folder)
        git('config','user.name','github-actions[bot]',cwd=folder);git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com',cwd=folder)
        data=folder/'ensemble-data';data.mkdir()
        # Preserve a previous model when its independent job failed.
        if expected:
            git('fetch','--depth=1','origin',expected,cwd=folder)
            git('checkout','FETCH_HEAD','--','ensemble-data',cwd=folder)
        copied=0
        for source in Path(artifacts).glob('products-*'):
            model=source.name.removeprefix('products-')
            if model not in ('ecmwf','gefs','mogreps_uk','mogreps_g') or not (source/'latest.json').exists():continue
            target=data/f'snowline_{model}_products'
            if target.exists():shutil.rmtree(target)
            shutil.copytree(source,target);copied+=1
        if not copied:raise RuntimeError('No verified model artifacts to publish')
        # source work files and task arrays are small and retained for resuming;
        # no native member downloads or credentials ever enter this directory.
        pointer=data/'publication.json';pointer.unlink(missing_ok=True)
        git('add','--all','ensemble-data',cwd=folder)
        tree=git('write-tree',cwd=folder)
        snapshot=git('commit-tree',tree,'-m','Verified ensemble probability snapshot',cwd=folder)
        pointer.write_text(json.dumps({'format_version':1,'revision':snapshot})+'\n')
        git('add','ensemble-data/publication.json',cwd=folder)
        tree=git('write-tree',cwd=folder)
        revision=git('commit-tree',tree,'-p',snapshot,'-m','Pin optional ensemble publication',cwd=folder)
        git('push',f'--force-with-lease=refs/heads/ensemble-products:{expected}','origin',revision+':refs/heads/ensemble-products',cwd=folder)


if __name__=='__main__':publish(sys.argv[1])
