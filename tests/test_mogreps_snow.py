import importlib.util
from datetime import datetime, timezone, timedelta
from pathlib import Path
import tempfile
import unittest
import json
import sys
from unittest.mock import patch, Mock
import requests

from netCDF4 import Dataset
import numpy as np

spec = importlib.util.spec_from_file_location('snow', Path(__file__).parents[1] / 'scripts/build_mogreps_snow.py')
snow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snow)
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))


class RunSelectionTests(unittest.TestCase):
    @staticmethod
    def metadata(hour, **changes):
        reference = datetime(2026, 10, 22, tzinfo=timezone.utc) + timedelta(hours=hour)
        return dict(reference_time=snow.iso(reference), completed=True,
                    variables=['precipitation_probability'],
                    valid_times=[snow.iso(reference + timedelta(hours=h)) for h in (1, 2, 3, 6)], **changes)

    @staticmethod
    def loader(records, calls):
        def fetch(url):
            calls.append(url)
            for suffix, meta in records.items():
                if url.endswith(suffix):
                    if isinstance(meta, Exception):
                        raise meta
                    return Mock(json=lambda: meta)
            raise requests.HTTPError(response=Mock(status_code=404))
        return fetch

    def test_completed_index_avoids_extra_lookup_and_keeps_forecast_steps(self):
        calls = []
        records = {'latest.json': self.metadata(0), 'in-progress.json': self.metadata(2)}
        with patch.object(snow, 'fetch', self.loader(records, calls)):
            self.assertEqual(snow.select_upstream(snow.CONFIG['uk']), self.metadata(0))
        self.assertEqual(len(calls), 2)

    def test_only_aligned_cycles_are_looked_up_across_midnight(self):
        calls = []
        records = {'latest.json': self.metadata(1), 'in-progress.json': self.metadata(2),
                   '2026/10/21/2100Z/meta.json': self.metadata(-3)}
        with patch.object(snow, 'fetch', self.loader(records, calls)):
            self.assertEqual(snow.select_upstream(snow.CONFIG['uk']), self.metadata(-3))
        self.assertTrue(calls[-2].endswith('2026/10/22/0000Z/meta.json'))
        self.assertTrue(calls[-1].endswith('2026/10/21/2100Z/meta.json'))
        self.assertEqual(len(calls), 4)

    def test_wrong_identity_and_network_failure_do_not_use_older_cycles(self):
        for value in (self.metadata(-3), requests.HTTPError(response=Mock(status_code=503)), requests.Timeout()):
            calls = []
            records = {'latest.json': self.metadata(2), 'in-progress.json': self.metadata(2),
                       '2026/10/22/0000Z/meta.json': value}
            with patch.object(snow, 'fetch', self.loader(records, calls)):
                with self.assertRaises((ValueError, requests.RequestException)):
                    snow.select_upstream(snow.CONFIG['uk'])
            self.assertEqual(len(calls), 3)

    def test_all_cycles_and_utc_offsets(self):
        for hour in range(24):
            self.assertEqual(snow.three_hour_cycle(self.metadata(hour)['reference_time']), hour % 3 == 0)
        self.assertTrue(snow.three_hour_cycle('2026-10-22T04:00:00+01:00'))
        self.assertFalse(snow.three_hour_cycle('2026-10-22T03:30:00Z'))

    def test_publisher_migrates_hourly_index_and_reuses_existing_aligned_frames(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            domain = root / snow.CONFIG['uk']['domain']
            domain.mkdir()
            latest = domain / 'latest.json'
            latest.write_text(json.dumps(self.metadata(2)))
            # Existing hourly folders must not crowd out the new 00Z generation
            # or its complete 21Z predecessor during migration.
            for hour in (-3, 1, 2):
                meta = self.metadata(hour)
                folder = domain / datetime.fromisoformat(meta['reference_time']).strftime('%Y/%m/%d/%H00Z')
                folder.mkdir(parents=True)
                (folder / 'meta.json').write_text(json.dumps(meta))
                for time in meta['valid_times']:
                    (folder / (time[:16].replace(':', '') + '.om')).write_bytes(b'fixture')

            def write(config, run, hour, path):
                record = dict(interval_hours=1, members=[1, 2, 3])
                path.write_bytes(b'fixture')
                path.with_suffix('.json').write_text(json.dumps(record))
                return record

            with patch.object(snow, 'select_upstream', return_value=self.metadata(0)), patch.object(snow, 'write_frame', side_effect=write) as writer:
                snow.build('uk', root)
                published = json.loads(latest.read_text())
                self.assertEqual(published['reference_time'], self.metadata(0)['reference_time'])
                self.assertEqual(published['valid_times'], self.metadata(0)['valid_times'])
                self.assertTrue(published['completed'])
                self.assertEqual(sorted(p.name for p in domain.glob('*/*/*/*Z')), ['0000Z', '2100Z'])
                self.assertEqual(writer.call_count, 4)
                snow.build('uk', root)
                self.assertEqual(writer.call_count, 4, 'Repeated builds must reuse all prepared frames')
            # A previously published eligible cycle is never rewound.
            for hour in (3, 5):
                latest.write_text(json.dumps(self.metadata(hour)))
                with patch.object(snow, 'select_upstream', return_value=self.metadata(0)), patch.object(snow, 'write_frame') as writer:
                    snow.build('uk', root)
                    writer.assert_not_called()
                    self.assertEqual(json.loads(latest.read_text())['reference_time'], self.metadata(hour)['reference_time'])


class ProbabilityTests(unittest.TestCase):
    def test_member_fraction_and_inclusive_water_threshold(self):
        values = np.array([[[0, .0001, .0001]], [[0, 0, .0002]], [[0, 0, .0003]]], dtype=np.float32)
        np.testing.assert_allclose(snow.snowfall_probability(values, [4, 5, 6], 1), [[0, 100/3, 100]])

    def test_period_scaling_and_no_snow_does_not_mean_missing(self):
        values = np.array([[[.00029, .0003, np.nan]], [[.0001, .0004, 0]], [[0, 0, 0]]], dtype=np.float32)
        result = snow.snowfall_probability(values, [1, 2, 3], 3)
        np.testing.assert_allclose(result[:, :2], [[0, 200/3]])
        self.assertTrue(np.isnan(result[0, 2]))



class NetCDFTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'snow.nc'
        self.run = datetime(2026, 10, 14, 2, tzinfo=timezone.utc)
        self.valid = self.run + timedelta(hours=63)
        with Dataset(self.path, 'w') as d:
            for name, size in [('realization', 3), ('projection_y_coordinate', 970), ('projection_x_coordinate', 1042), ('bnds', 2)]:
                d.createDimension(name, size)
            v = d.createVariable('lwe_thickness_of_snowfall_amount', 'f4', ('realization', 'projection_y_coordinate', 'projection_x_coordinate'), zlib=True)
            v.units = 'm'; v.cell_methods = 'time: sum'; v.grid_mapping = 'laea'; v[:] = 0
            d.createVariable('realization', 'i4', ('realization',))[:] = [23, 24, 25]
            for axis, n, start in [('projection_x_coordinate', 1042, -1158000), ('projection_y_coordinate', 970, -1036000)]:
                d.createVariable(axis, 'f4', (axis,))[:] = start + np.arange(n) * 2000
            projection = d.createVariable('laea', 'i4')
            projection.setncatts(dict(semi_major_axis=6378137, semi_minor_axis=6356752.314140356,
                                     longitude_of_projection_origin=-2.5, latitude_of_projection_origin=54.9))
            for name, value in [('forecast_reference_time', self.run), ('time', self.valid)]:
                t = d.createVariable(name, 'i8'); t.units = 'seconds since 1970-01-01 00:00:00'; t[:] = int(value.timestamp())
            d['time'].bounds = 'time_bnds'
            d.createVariable('time_bnds', 'i8', ('bnds',))[:] = [int(self.valid.timestamp()) - 3600, int(self.valid.timestamp())]

    def tearDown(self):
        self.temp.cleanup()

    def decode(self, **kwargs):
        return snow.decode(self.path.read_bytes(), snow.CONFIG['uk'], kwargs.get('run', self.run), self.valid, kwargs.get('interval', 1))

    def test_verified_times_units_grid_members(self):
        values, ids = self.decode()
        self.assertEqual(values.shape, (3, 970, 1042))
        np.testing.assert_equal(ids, [23, 24, 25])
        with self.assertRaisesRegex(ValueError, 'bounds'):
            self.decode(interval=3)
        with self.assertRaisesRegex(ValueError, 'different run'):
            self.decode(run=self.run - timedelta(hours=1))
        with Dataset(self.path, 'a') as d:
            d['lwe_thickness_of_snowfall_amount'].units = 'mm'
        with self.assertRaisesRegex(ValueError, 'metres'):
            self.decode()

    def test_missing_and_negative_snow_are_not_dry(self):
        with Dataset(self.path, 'a') as d:
            d['lwe_thickness_of_snowfall_amount'][0, 0, 0] = -1
            d['lwe_thickness_of_snowfall_amount'][1, 0, 1] = np.ma.masked
        values, ids = self.decode()
        result = snow.snowfall_probability(values, ids, 1)
        self.assertTrue(np.isnan(result[0, :2]).all())
        self.assertEqual(result[0, 2], 0)

    def test_duplicate_members_and_shifted_grid_are_rejected(self):
        with Dataset(self.path, 'a') as d:
            d['realization'][:] = [1, 1, 2]
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.decode()
        with Dataset(self.path, 'a') as d:
            d['realization'][:] = [1, 2, 3]
            d['projection_x_coordinate'][0] += 1000
        with self.assertRaisesRegex(ValueError, 'coordinates'):
            self.decode()


if __name__ == '__main__':
    unittest.main()
