import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import check_ensemble_freshness as f


class EnsembleRecoveryTests(unittest.TestCase):
    def archive(self, model):
        latest = datetime(2026, 10, 15, tzinfo=timezone.utc)
        references = [latest - timedelta(hours=f.MODELS[model][1] * i) for i in range(3)]
        documents = {'history.json': dict(format_version=1, runs=[f.iso(t) for t in references])}
        for reference in references:
            documents[reference.strftime('%Y/%m/%d/%H00Z/meta.json')] = dict(
                format_version=1, reference_time=f.iso(reference), completed=True,
                variables=sorted(f.VARIABLES), valid_times=[f.iso(reference + timedelta(hours=h)) for h in f.HOURS[model]])
        published = documents[latest.strftime('%Y/%m/%d/%H00Z/meta.json')]
        documents['latest.json'] = published
        return latest, published, documents

    def test_three_exact_runs_pass_for_both_models_including_partial_current(self):
        for model in f.MODELS:
            with self.subTest(model=model):
                _, published, documents = self.archive(model)
                published['completed'] = False
                published['valid_times'] = published['valid_times'][:3]
                result = f.check_archive(model, published, documents.__getitem__)
                self.assertEqual(result['archive_status'], 'current')
                self.assertFalse(result['archive_refresh_needed'])

    def test_missing_duplicate_or_wrong_latest_index_requests_repair(self):
        _, published, original = self.archive('gefs')
        references = original['history.json']['runs']
        for runs in [references[:2], [references[0]] * 3, references[::-1], [references[1]] + references[1:]]:
            with self.subTest(runs=runs):
                documents = copy.deepcopy(original)
                documents['history.json']['runs'] = runs
                self.assertTrue(f.check_archive('gefs', published, documents.__getitem__)['archive_refresh_needed'])

    def test_wrong_cycle_missing_fields_or_partial_predecessor_requests_repair(self):
        _, published, original = self.archive('ecmwf')
        previous = '2026/10/14/1200Z/meta.json'
        for changes in [dict(reference_time=published['reference_time']), dict(variables=[]),
                        dict(completed=False), dict(valid_times=original[previous]['valid_times'][:-1])]:
            with self.subTest(changes=changes):
                documents = copy.deepcopy(original)
                documents[previous].update(changes)
                self.assertTrue(f.check_archive('ecmwf', published, documents.__getitem__)['archive_refresh_needed'])

    def test_archive_404_is_repairable_but_503_is_failed_verification(self):
        _, published, _ = self.archive('gefs')
        for code, status, repair in [(404, 'repair-needed', True), (503, 'check-failed', False)]:
            with self.subTest(code=code):
                with patch.object(f, 'get', side_effect=HTTPError('', code, 'test', {}, None)):
                    result = f.check_archive('gefs', published, lambda path: f.get(path))
                self.assertEqual(result['archive_status'], status)
                self.assertEqual(result['archive_refresh_needed'], repair)

    def test_current_source_still_requests_archive_repair(self):
        run, _, documents = self.archive('gefs')
        documents['history.json']['runs'].pop()
        def get(url):
            relative = url.split('/snowline_gefs_ensemble/', 1)[1]
            return json.dumps(documents[relative]).encode()
        with patch.object(f, 'newest_source', return_value=(run, f.HOURS['gefs'])), patch.object(f, 'get', side_effect=get):
            result = f.check_model('gefs', 'https://example.test', run)
        self.assertEqual(result['status'], 'current')
        self.assertEqual(result['archive_status'], 'repair-needed')
        self.assertTrue(result['refresh_needed'])

    def test_publication_age_triggers_recheck_without_inventing_new_cycle(self):
        now = datetime(2026, 10, 15, 10, tzinfo=timezone.utc)
        for minutes, overdue in [(0, False), (30, False), (31, True), (-10, True)]:
            with self.subTest(minutes=minutes):
                health = json.dumps(dict(checked_at=f.iso(now - timedelta(minutes=minutes)))).encode()
                with patch.object(f, 'get', return_value=health):
                    self.assertEqual(f.publication_check_overdue('https://example.test', now), overdue)
        with patch.object(f, 'get', side_effect=HTTPError('', 404, 'missing health', {}, None)):
            self.assertTrue(f.publication_check_overdue('https://example.test', now))


if __name__ == '__main__':
    unittest.main()
