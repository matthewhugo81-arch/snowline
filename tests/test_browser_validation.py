import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from reuse_browser_validation import reuse, same_inputs


def run(status='completed', conclusion='success', sha='abc'):
    return dict(id=10, head_sha=sha, head_branch='main', event='push',
                status=status, conclusion=conclusion, html_url='https://github.com/example/run/10')


class BrowserProofTests(unittest.TestCase):
    def test_success_requires_matching_runtime_and_validation_inputs(self):
        fetch = lambda path: {'workflow_runs': [run()]}
        self.assertTrue(reuse('revision', fetch=fetch, compare=lambda a,b: True))
        self.assertFalse(reuse('revision', fetch=fetch, compare=lambda a,b: False))
        self.assertFalse(reuse('revision', fetch=lambda _: {'workflow_runs': [run(conclusion='failure')]}, compare=lambda a,b: True))

    def test_running_identical_suite_is_joined_and_identity_changes_are_rejected(self):
        fetch = lambda path: {'workflow_runs': [run('in_progress', None)]} if 'workflow' in path else run()
        self.assertTrue(reuse('revision', fetch=fetch, compare=lambda a,b: True, sleep=lambda _: None))
        fetch = lambda path: {'workflow_runs': [run('in_progress', None)]} if 'workflow' in path else run(sha='changed')
        self.assertFalse(reuse('revision', fetch=fetch, compare=lambda a,b: True, sleep=lambda _: None))

    def test_wait_is_bounded_and_non_main_runs_are_rejected(self):
        ticks=iter([0,2])
        self.assertFalse(reuse('revision', fetch=lambda _: {'workflow_runs': [run('in_progress', None)]}, compare=lambda a,b: True, clock=lambda: next(ticks), wait=1))
        other=run();other['head_branch']='feature'
        self.assertFalse(reuse('revision', fetch=lambda _: {'workflow_runs': [other]}, compare=lambda a,b: True))

    def test_git_comparison_reuses_pipeline_changes_but_rejects_runtime_and_browser_test_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            previous=os.getcwd();os.chdir(temporary)
            try:
                def git(*args):
                    return subprocess.check_output(['git',*args], stderr=subprocess.DEVNULL, text=True).strip()
                git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('remote','add','origin','.')
                def commit(path,content):
                    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content)
                    git('add','.');git('commit','-m','Fixture');return git('rev-parse','HEAD')
                commit('maps.js','original');commit('tests/browser.mjs','original')
                base=commit('.github/workflows/map-browser-tests.yml','original')
                pipeline=commit('.github/workflows/publish-maps.yml','new pipeline')
                self.assertTrue(same_inputs(base,pipeline))
                tests=commit('tests/browser.mjs','changed test')
                self.assertFalse(same_inputs(base,tests))
                runtime=commit('maps.js','changed runtime')
                self.assertFalse(same_inputs(tests,runtime))
                workflow=commit('.github/workflows/map-browser-tests.yml','changed workflow')
                self.assertFalse(same_inputs(runtime,workflow))
            finally:
                os.chdir(previous)
