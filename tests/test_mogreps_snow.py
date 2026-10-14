import importlib.util
from datetime import datetime, timezone, timedelta
from pathlib import Path
import tempfile
import unittest

from netCDF4 import Dataset
import numpy as np

spec = importlib.util.spec_from_file_location('snow', Path(__file__).parents[1] / 'scripts/build_mogreps_snow.py')
snow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snow)


class ProbabilityTests(unittest.TestCase):
    def test_member_fraction_and_inclusive_water_threshold(self):
        values = np.array([[[0, .0001, .0001]], [[0, 0, .0002]], [[0, 0, .0003]]], dtype=np.float32)
        np.testing.assert_allclose(snow.snowfall_probability([(values, [4, 5, 6])], 1), [[0, 100/3, 100]])

    def test_period_scaling_and_no_snow_does_not_mean_missing(self):
        values = np.array([[[.00029, .0003, np.nan]], [[.0001, .0004, 0]], [[0, 0, 0]]], dtype=np.float32)
        result = snow.snowfall_probability([(values, [1, 2, 3])], 3)
        np.testing.assert_allclose(result[:, :2], [[0, 200/3]])
        self.assertTrue(np.isnan(result[0, 2]))

    def test_convective_amounts_are_added_by_member_before_counting(self):
        large = np.array([[[.00006]], [[0]], [[0]]], dtype=np.float32)
        convection = np.array([[[.0001]], [[.00006]], [[0]]], dtype=np.float32)
        # Member 10 crosses the threshold only after adding the two components;
        # member 12 has convection alone. Component probabilities cannot be added.
        result = snow.snowfall_probability([(large, [10, 11, 12]), (convection, [12, 10, 11])], 1)
        np.testing.assert_allclose(result, [[200/3]])
        with self.assertRaises(ValueError):
            snow.snowfall_probability([(large, [10, 11, 12]), (convection, [0, 1, 2])], 1)


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
        result = snow.snowfall_probability([(values, ids)], 1)
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
