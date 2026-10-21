from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from publish_map_archive import archive_plan, DOMAIN


class ArchiveTests(unittest.TestCase):
    def test_only_two_exact_complete_predecessors_leave_pages_and_originals_survive_planning(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            parent = site / 'ensemble-data' / DOMAIN
            parent.mkdir(parents=True)
            latest = datetime(2026, 10, 21, tzinfo=timezone.utc)
            refs = [(latest - timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M:%SZ') for h in (0, 12, 24)]
            (parent / 'latest.json').write_text(json.dumps({'reference_time': refs[0]}))
            (parent / 'history.json').write_text(json.dumps({'runs': refs}))
            for reference in refs:
                folder = parent / datetime.fromisoformat(reference).strftime('%Y/%m/%d/%H%MZ')
                folder.mkdir(parents=True)
                (folder / 'meta.json').write_text(json.dumps({'reference_time': reference, 'completed': True, 'valid_times': [reference]}))
                (folder / (reference[:16].replace(':', '') + '.om.png')).write_bytes(b'x' * 64)
            files, metadata = archive_plan(site)
            self.assertEqual(len(files), 2)
            self.assertEqual(len(metadata), 2)
            self.assertEqual(len(list(site.rglob('*.om.png'))), 3)
            for value in files.values():
                self.assertEqual(value['bytes'], 64)
                self.assertEqual(len(value['sha256']), 64)
            path = parent / datetime.fromisoformat(refs[1]).strftime('%Y/%m/%d/%H%MZ') / 'meta.json'
            meta = json.loads(path.read_text())
            meta['completed'] = False
            path.write_text(json.dumps(meta))
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                archive_plan(site)
