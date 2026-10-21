import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from publication_manifest import inventory


class PublicationTests(unittest.TestCase):
    def test_timestamps_do_not_republish_but_binary_corrections_and_hours_do(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / 'ensemble-data' / 'model'
            data.mkdir(parents=True)
            meta = data / 'latest.json'
            meta.write_text('{"generated_at":"old","valid_times":[1]}')
            frame = data / 'frame.om.png'
            frame.write_bytes(b'first')
            first = inventory(root)
            self.assertEqual(first['bytes'], sum(p.stat().st_size for p in data.iterdir()))
            meta.write_text('{"generated_at":"new","valid_times":[1]}')
            self.assertEqual(first['contentSha256'], inventory(root)['contentSha256'])
            frame.write_bytes(b'other')
            self.assertNotEqual(first['contentSha256'], inventory(root)['contentSha256'])
            frame.write_bytes(b'first')
            meta.write_text('{"generated_at":"new","valid_times":[1,2]}')
            self.assertNotEqual(first['contentSha256'], inventory(root)['contentSha256'])
