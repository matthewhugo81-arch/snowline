import sys
from pathlib import Path
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import mogreps_comparison_fields as c

class ComparisonTests(unittest.TestCase):
    def test_baseline_bilinear_coordinates_and_greenwich_wrap(self):
        # A latitude-only plane is interpolated exactly, including both sides of Greenwich.
        grid=np.broadcast_to(np.arange(90,-90.1,-2.5)[:,None],(73,144))
        crop=(700,702,638,642)
        expected=np.broadcast_to((-89.90625+np.arange(700,702)*.1875)[:,None],(2,4))
        np.testing.assert_allclose(c.interpolate_climatology(grid,crop),expected)

    def test_anomaly_subtracts_daily_climatology_and_missing_member_stays_missing(self):
        heights=np.full((18,1,2,2),5600.);heights[0,0,0,0]=np.nan
        wind=np.full((18,2,2,2),30.)
        with patch.object(c,'pressure_members',side_effect=[heights,wind]), \
             patch.object(c,'daily_climatology',return_value=np.full((73,144),5500.)), \
             patch.object(c,'index_for',return_value={'units':'Pa','data':{}}), \
             patch.object(c,'extract',return_value=np.full((18,2,2),101300.)):
            result=c.comparison_values({'run':1792454400},0,crop=(700,702,600,602))
        self.assertTrue(np.isnan(result[c.ANOMALY][0,0]))
        self.assertAlmostEqual(result[c.ANOMALY][1,1],100)
        self.assertAlmostEqual(result['pressure_msl_mean'][1,1],1013)
        self.assertAlmostEqual(result['wind_speed_300hPa_mean'][1,1],30)

    def test_leap_day_averages_adjacent_daily_climates(self):
        with patch.dict(c._climates,{(2,28):np.array([10.]),(3,1):np.array([20.])}):
            np.testing.assert_array_equal(c.daily_climatology(datetime(2028,2,29,tzinfo=timezone.utc)),[15.])

    def test_climatology_outage_keeps_verified_native_fields(self):
        with patch.object(c,'pressure_members',side_effect=[np.full((18,1,2,2),5600.),np.full((18,2,2,2),30.)]), \
             patch.object(c,'daily_climatology',side_effect=RuntimeError('NOAA unavailable')), \
             patch.object(c,'index_for',return_value={'units':'Pa','data':{}}), \
             patch.object(c,'extract',return_value=np.full((18,2,2),101300.)):
            result=c.comparison_values({'run':1792454400},0,crop=(700,702,600,602))
        self.assertEqual(set(result),set(c.FIELDS)-{c.ANOMALY})
        self.assertEqual(result['geopotential_height_500hPa_mean'][0,0],5600)
        self.assertEqual(result['pressure_msl_mean'][0,0],1013)
        self.assertEqual(result['wind_speed_200hPa_mean'][0,0],30)

    def test_noaa_outage_is_attempted_once_per_worker_not_per_hour(self):
        with patch.dict(c._climates,{},clear=True), patch.object(c,'_climate_error',None), \
             patch.object(c.requests,'get',side_effect=c.requests.HTTPError('503')) as request:
            with self.assertRaises(c.requests.HTTPError):
                c.daily_climatology(datetime(2026,10,21,tzinfo=timezone.utc))
            with self.assertRaisesRegex(RuntimeError,'retry next publication'):
                c.daily_climatology(datetime(2026,10,22,tzinfo=timezone.utc))
            self.assertEqual(request.call_count,1)
            self.assertEqual(request.call_args.kwargs['timeout'],(5,15))

    def test_anomaly_retry_reuses_prepared_native_arrays(self):
        existing={key:np.full((2,2),5600.) for key in c.FIELDS if key!=c.ANOMALY}
        with patch.object(c,'pressure_members',side_effect=AssertionError('native data requested again')), \
             patch.object(c,'index_for',side_effect=AssertionError('pressure index requested again')), \
             patch.object(c,'daily_climatology',return_value=np.full((73,144),5500.)):
            result=c.comparison_values({'run':1792454400},0,crop=(700,702,600,602),existing=existing)
        self.assertEqual(result[c.ANOMALY][0,0],100)
        self.assertIs(result['pressure_msl_mean'],existing['pressure_msl_mean'])

if __name__=='__main__':
    unittest.main()
