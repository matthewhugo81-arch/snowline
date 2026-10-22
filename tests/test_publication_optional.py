import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prepare_optional_publication import DOMAINS, prepare


class OptionalPublicationTests(unittest.TestCase):
    def populate(self, root, run='0000Z', published=True, completed=True):
        folder = root / 'ensemble-data' / DOMAINS[1] / '2026/10/22' / run
        folder.mkdir(parents=True, exist_ok=True)
        time = '2026-10-22T' + run[:2] + ':00:00Z'
        name = time[:16].replace(':', '') + '.om.png'
        (folder / name).write_bytes(b'verified frame')
        meta = {'reference_time': time, 'completed': completed, 'valid_times': [time]}
        if published:
            (folder / 'meta.json').write_text(json.dumps(meta))
        return folder, name, meta

    def test_timeout_payload_is_excluded_but_published_runs_and_cache_survive(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache, site = Path(tmp) / 'cache', Path(tmp) / '_site'
            old, name, meta = self.populate(cache)
            (cache / 'ensemble-data' / DOMAINS[1] / 'latest.json').write_text(json.dumps(meta))
            pending, pending_name, _ = self.populate(cache, '1200Z', published=False)
            (pending / 'unfinished.tmp').write_bytes(b'pending')
            shutil.copytree(cache, site)
            count, size = prepare(site)
            self.assertEqual(count, 2)
            self.assertGreater(size, 0)
            self.assertTrue((site / old.relative_to(cache) / name).exists())
            self.assertFalse((site / pending.relative_to(cache) / pending_name).exists())
            self.assertTrue((pending / pending_name).exists())
            self.assertEqual(prepare(site), (0, 0))

    def test_incomplete_advertised_run_and_older_run_are_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.populate(root)
            folder, name, meta = self.populate(root, '1200Z', completed=False)
            (root / 'ensemble-data' / DOMAINS[1] / 'latest.json').write_text(json.dumps(meta))
            (folder / '2026-10-22T1500.om.png').write_bytes(b'not yet advertised')
            self.assertEqual(prepare(root)[0], 1)
            self.assertEqual(len(list(root.rglob('*.om.png'))), 2)
            self.assertTrue((folder / name).exists())

    def test_malformed_or_missing_advertised_metadata_fails_before_deletion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder, name, meta = self.populate(root, published=False)
            (root / 'ensemble-data' / DOMAINS[1] / 'latest.json').write_text(json.dumps(meta))
            with self.assertRaisesRegex(ValueError, 'missing dated metadata'):
                prepare(root)
            self.assertTrue((folder / name).exists())
