import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from run_retention import last_complete_folder


class RetentionTests(unittest.TestCase):
    def test_protects_complete_run_through_multiple_incomplete_cycles(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for hour in (0, 3, 6, 9, 12):
                folder = root / f'2026/10/20/{hour:02}00Z'
                folder.mkdir(parents=True)
                time = f'2026-10-20T{hour:02}:00:00Z'
                (folder / 'meta.json').write_text(json.dumps(dict(reference_time=time, completed=hour == 0, variables=['t'], valid_times=[time])))
                (folder / (time[:16].replace(':', '') + '.om')).write_bytes(b'fixture')
            self.assertEqual(last_complete_folder(root, '2026-10-20T12:00:00Z'), root / '2026/10/20/0000Z')
            (root / '2026/10/20/0000Z/2026-10-20T0000.om').unlink()
            self.assertIsNone(last_complete_folder(root))
