import sys
from pathlib import Path
from datetime import datetime, timezone
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import ensemble_height_anomaly as a
import build_ensembles as b
from omfiles import OmFileReader, OmFileWriter


class HeightAnomalyTests(unittest.TestCase):
    def test_native_grids_poles_and_periodic_longitudes(self):
        climate = np.broadcast_to(np.arange(90, -90.1, -2.5)[:, None], (73, 144))
        for step in (.5, .25):
            with patch.object(a, 'cached_daily', return_value=climate):
                result = a.baseline(datetime(2026, 12, 31), step)
            expected = -90 + np.arange(round(180 / step) + 1) * step
            np.testing.assert_allclose(result, np.broadcast_to(expected[:, None], result.shape))
        # Interpolate across the last climatology column and Greenwich.
        climate = np.zeros((73, 144)); climate[:, -1] = 100
        with patch.object(a, 'cached_daily', return_value=climate):
            result = a.baseline(datetime(2026, 1, 1), .5)
        np.testing.assert_allclose(result[180, 359:362], [20, 0, 0])

    def test_leap_day_and_missing_baseline(self):
        dates = []
        def daily(valid):
            dates.append((valid.month, valid.day))
            return np.full((73, 144), 5400 if valid.month == 2 else 5600)
        with patch.object(a, 'cached_daily', side_effect=daily):
            np.testing.assert_allclose(a.baseline(datetime(2028, 2, 29), .5), 5500)
        self.assertEqual(dates, [(2, 28), (3, 1)])
        with patch.object(a, 'cached_daily', return_value=None):
            with self.assertRaises(ValueError): a.baseline(datetime(2026, 1, 1), .5)

    def test_backfill_preserves_native_fields_and_retries_after_outage(self):
        run = datetime(2026, 10, 21, 18, tzinfo=timezone.utc)
        for model, config in b.MODELS.items():
            with self.subTest(model=model), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'frame.om'
                shape = (round(180/config['step'])+1, round(360/config['step']))
                writer = OmFileWriter(str(path))
                values = {k: np.full(shape, 5600 if k.endswith('_mean') else .23, dtype=np.float32) for k in b.VARIABLES}
                children = [writer.write_array(v, chunks=[10,180], scale_factor=100, add_offset=0,
                            compression='pfor_delta_2d', name=k) for k,v in values.items()]
                writer.close(writer.write_group(name='root', children=children))
                original = path.read_bytes()
                with patch.object(a, 'baseline', side_effect=ValueError('outage')):
                    self.assertEqual(a.add_anomalies([(6,path)], run, config['step'], b.VARIABLES), [])
                self.assertEqual(path.read_bytes(), original)
                with patch.object(a, 'baseline', return_value=np.full(shape, 5500)) as baseline:
                    self.assertEqual(a.add_anomalies([(6,path)], run, config['step'], b.VARIABLES), [6])
                    self.assertEqual(baseline.call_args.args[0].day, 22)
                reader = OmFileReader(str(path))
                np.testing.assert_allclose(reader.get_child_by_name(a.ANOMALY)[:], 100)
                np.testing.assert_allclose(reader.get_child_by_name('temperature_850hPa_spread')[:], .23)
                del reader
                with patch.object(a, 'baseline', side_effect=AssertionError('must reuse')):
                    self.assertEqual(a.add_anomalies([(6,path)], run, config['step'], b.VARIABLES), [6])

    def test_metadata_advertises_only_successful_anomaly_hours(self):
        from types import SimpleNamespace
        run = datetime(2026, 10, 21, tzinfo=timezone.utc)
        for model in b.MODELS:
            with self.subTest(model=model), tempfile.TemporaryDirectory() as directory:
                source = SimpleNamespace(run=run, available_hours=lambda: [0,3])
                def write(source, hour, path): path.write_bytes(b'fixture')
                with patch.object(b, 'Source', return_value=source), patch.object(b, 'write_frame', side_effect=write), \
                     patch.object(b, 'add_anomalies', return_value=[3]):
                    meta = b.build_model(model, Path(directory), run, 1, hours=[0,3])
                self.assertEqual(meta['anomaly_reference'], a.REFERENCE)
                self.assertEqual(meta['variable_valid_times'][a.ANOMALY], [b.iso(run+b.timedelta(hours=3))])
                self.assertEqual(meta['variable_valid_times'][b.VARIABLES[0]], meta['valid_times'])


if __name__ == '__main__': unittest.main()
