import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import assemble_pages as assembly
import pages_release as release


NOW = datetime(2026, 10, 20, 19, 0, tzinfo=timezone.utc)
REVISION = 'a' * 40


class PagesReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.site = Path(self.temporary.name)
        (self.site / 'index.html').write_text('<!doctype html><title>Snowline</title>')
        self.domain = self.site / 'ensemble-data' / 'example'
        self.domain.mkdir(parents=True)
        self.metadata = self.domain / 'latest.json'
        self.metadata.write_text(json.dumps({'reference_time': '2026-10-20T12:00:00Z',
                                             'valid_times': ['2026-10-20T15:00:00Z'],
                                             'generated_at': NOW.isoformat()}))
        self.frame = self.domain / '2026' / '10' / '20' / '1200Z' / '2026-10-20T1500.om.png'
        self.frame.parent.mkdir(parents=True)
        self.frame.write_bytes(b'first verified forecast')

    def prepare(self, published=None, now=NOW, revision=REVISION, maximum=release.MAX_BYTES):
        with contextlib.redirect_stdout(io.StringIO()):
            return release.prepare(self.site, revision, published, now, maximum)

    def test_counts_every_unpacked_byte_including_publication_record(self):
        current, changed = self.prepare()
        files = [path for path in self.site.rglob('*') if path.is_file()]
        self.assertTrue(changed)
        self.assertEqual(current['total_bytes'], sum(path.stat().st_size for path in files))
        self.assertEqual(current['file_count'], len(files))
        self.assertEqual(current, json.loads((self.site / release.MANIFEST).read_text()))
        self.assertEqual(current['runs']['ensemble-data/example/2026/10/20/1200Z'], len(self.frame.read_bytes()))

    def test_identical_forecast_skips_until_source_check_heartbeat(self):
        published, _ = self.prepare()
        value = json.loads(self.metadata.read_text())
        value['generated_at'] = (NOW + timedelta(minutes=5)).isoformat()
        self.metadata.write_text(json.dumps(value, indent=2))
        current, changed = self.prepare(published, NOW + timedelta(minutes=5))
        self.assertEqual(current['content_sha256'], published['content_sha256'])
        self.assertFalse(changed)
        _, heartbeat = self.prepare(published, NOW + timedelta(minutes=20))
        self.assertTrue(heartbeat)

    def test_corrected_same_cycle_binary_publishes_immediately(self):
        published, _ = self.prepare()
        self.frame.write_bytes(b'corrected verified data')
        _, changed = self.prepare(published, NOW + timedelta(minutes=1))
        self.assertTrue(changed)

    def test_appended_forecast_hour_and_source_status_are_not_ignored(self):
        health = self.site / 'ensemble-data' / 'health.json'
        health.write_text(json.dumps({'checked_at': NOW.isoformat(), 'models': [{'status': 'current'}]}))
        published, _ = self.prepare()
        health.write_text(json.dumps({'checked_at': (NOW + timedelta(minutes=1)).isoformat(),
                                     'models': [{'status': 'hours-pending'}]}))
        _, changed = self.prepare(published, NOW + timedelta(minutes=1))
        self.assertTrue(changed)
        value = json.loads(self.metadata.read_text())
        value['valid_times'].append('2026-10-20T18:00:00Z')
        self.metadata.write_text(json.dumps(value))
        _, changed = self.prepare(published, NOW + timedelta(minutes=1))
        self.assertTrue(changed)

    def test_new_code_requires_both_browser_gates_on_the_same_revision(self):
        published, _ = self.prepare()
        self.assertTrue(release.browser_validated(published, REVISION))
        self.assertFalse(release.browser_validated(published, 'b' * 40))
        self.assertFalse(release.browser_validated(None, REVISION))
        for bad in ({**published, 'schema': 0},
                    {**published, 'browser_validation': {'version': 1, 'revision': REVISION, 'checks': ['map-browser']}},
                    {**published, 'browser_validation': {**published['browser_validation'], 'revision': 'b' * 40}}):
            self.assertFalse(release.browser_validated(bad, REVISION))
            _, changed = self.prepare(bad, NOW + timedelta(minutes=1))
            self.assertTrue(changed)

    def test_missing_invalid_and_future_publication_time_do_not_skip(self):
        published, _ = self.prepare()
        for stamp in (None, 'invalid', '2027-01-01T00:00:00Z', '2026-10-20T19:00:00'):
            self.assertTrue(release.publication_needed(published, {**published, 'built_at': stamp}, NOW))

    def test_size_budget_rejects_full_uncompressed_payload(self):
        current, _ = self.prepare()
        with self.assertRaisesRegex(ValueError, 'previous deployment is retained'):
            self.prepare(maximum=current['total_bytes'] - 1)
        self.assertEqual(self.frame.read_bytes(), b'first verified forecast')

    def test_symlinks_cannot_smuggle_unmeasured_payloads(self):
        (self.site / 'alias').symlink_to(self.frame)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.prepare()


class AdvertisedRunAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'cache'
        self.target = self.root / 'site'
        self.source.mkdir()

    def run_fixture(self, cycle, completed=True):
        reference = f'2026-10-20T{cycle:02d}:00:00Z'
        metadata = {'reference_time': reference, 'valid_times': [reference], 'completed': completed}
        folder = self.source / assembly.run_path(reference)
        folder.mkdir(parents=True)
        (folder / 'meta.json').write_text(json.dumps(metadata))
        (folder / assembly.frame_name(reference)).write_bytes(b'verified native grid')
        # Conversion-only records must stay in the cache, even for kept runs.
        (folder / 'work.tmp').write_bytes(b'partial data')
        (folder / '2026-10-20T0000.json').write_text('{"interval_hours":3}')
        return metadata

    def test_keeps_all_indexed_runs_and_om_bytes_but_not_unadvertised_backfill(self):
        runs = [self.run_fixture(hour) for hour in (0, 6, 12)]
        pending = self.run_fixture(18, completed=False)
        (self.source / 'latest.json').write_text(json.dumps(runs[-1]))
        (self.source / 'history.json').write_text(json.dumps({'runs': [run['reference_time'] for run in reversed(runs)]}))
        assembly.copy_domain(self.source, self.target)
        published = list(self.target.rglob('*.om.png'))
        self.assertEqual(len(published), 3)
        self.assertTrue(all(path.read_bytes() == b'verified native grid' for path in published))
        self.assertFalse((self.target / assembly.run_path(pending['reference_time'])).exists())
        self.assertFalse(list(self.target.rglob('*.tmp')))
        self.assertEqual(len(list(self.target.rglob('*.json'))), 5)
        # The unpublished partial backfill is still available for later builds.
        self.assertTrue((self.source / assembly.run_path(pending['reference_time']) / 'meta.json').exists())

    def test_feed_without_history_keeps_previous_complete_run_and_incoming_run(self):
        old = self.run_fixture(6)
        incoming = self.run_fixture(12, completed=False)
        (self.source / 'latest.json').write_text(json.dumps(incoming))
        assembly.copy_domain(self.source, self.target)
        for run in (old, incoming):
            self.assertTrue((self.target / assembly.run_path(run['reference_time']) / 'meta.json').is_file())

    def test_missing_advertised_frame_blocks_publication(self):
        latest = self.run_fixture(12)
        (self.source / 'latest.json').write_text(json.dumps(latest))
        (self.source / assembly.run_path(latest['reference_time']) / assembly.frame_name(latest['reference_time'])).unlink()
        with self.assertRaisesRegex(ValueError, 'Not a regular publication file'):
            assembly.copy_domain(self.source, self.target)

    def test_newer_latest_pointer_cannot_advertise_unverified_hours(self):
        latest = self.run_fixture(12)
        latest['valid_times'].append('2026-10-20T15:00:00Z')
        (self.source / 'latest.json').write_text(json.dumps(latest))
        with self.assertRaisesRegex(ValueError, 'Latest and run metadata disagree'):
            assembly.copy_domain(self.source, self.target)


if __name__ == '__main__':
    unittest.main()
