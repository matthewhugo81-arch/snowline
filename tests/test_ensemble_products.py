import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import unittest
from datetime import datetime,timezone
import numpy as np
from ensemble_products import complete_window,probability,threshold_fields,lagged_cycles,member_extrema_anomaly,nonnegative_difference
from ensemble_product_sources import MetOffice,GlobalGRIB


class Products(unittest.TestCase):
    def test_member_extrema_precede_probability(self):
        a=np.array([[[60]],[[0]]],dtype=float);b=np.array([[[0]],[[60]]],dtype=float)
        peak=complete_window([(0,6,a),(6,12,b)],0,12,'max')
        self.assertEqual(probability(peak,50,2)[0,0],100)
        self.assertEqual((probability(a,50,2)+probability(b,50,2))[0,0]/2,50)

    def test_complete_members_and_missing_cells(self):
        a=np.zeros((18,1,2));a[0,0,0]=np.nan
        p=probability(a,1,18);self.assertTrue(np.isnan(p[0,0]));self.assertEqual(p[0,1],0)
        with self.assertRaises(ValueError):probability(a[:3],1,18)

    def test_gaps_overlaps_and_partial_windows_are_rejected(self):
        a=np.ones((2,1,1))
        for records in [[(0,5,a),(6,12,a)],[(0,7,a),(6,12,a)],[(0,6,a)],[(0,13,a)]]:
            with self.assertRaises(ValueError):complete_window(records,0,12,'sum')

    def test_accumulation_is_member_first(self):
        a=np.array([[[4]],[[7]]]);total=complete_window([(0,6,a),(6,12,a)],0,12,'sum')
        self.assertEqual(threshold_fields('rain',total,12,2)['ens_rain_ge10mm_12h'][0,0],50)

    def test_knots_and_strict_exceedance(self):
        a=np.array([[[50*1852/3600]],[[51*1852/3600]]])
        self.assertEqual(threshold_fields('gust',a,12,2)['ens_gust_gt50kt_12h'][0,0],50)

    def test_six_lagged_cycles_share_valid_window(self):
        reference=datetime(2026,10,21,12,tzinfo=timezone.utc)
        source=MetOffice('mogreps_uk',reference,Path('unused'));calls=[]
        def read(cycle,h,kind):
            lag=int((reference-cycle).total_seconds()/3600);calls.append((lag,h))
            return np.full((3,1,1),1.),list(range(3*lag,3*lag+3))
        source.read=read
        values=source.window(0,12,'rain');self.assertEqual(values.shape,(18,1,1));np.testing.assert_equal(values,12)
        self.assertIn((5,6),calls);self.assertIn((5,17),calls)
        self.assertEqual(len(lagged_cycles(reference)),6)

    def test_duplicate_lagged_members_rejected(self):
        source=MetOffice('mogreps_uk',datetime(2026,10,21,tzinfo=timezone.utc),Path('unused'))
        source.read=lambda *args:(np.ones((3,1,1)),[0,1,2])
        with self.assertRaises(ValueError):source.window(0,12,'rain')

    def test_gefs_uses_nonoverlapping_native_six_hour_totals(self):
        source=GlobalGRIB('gefs',datetime(2026,10,21,tzinfo=timezone.utc),Path('unused'));calls=[]
        def read(h,kind):calls.append(h);return np.full((31,1,1),6.),(h-6,h,'accum')
        source.read=read;np.testing.assert_equal(source.window(0,24,'precip'),24);self.assertEqual(calls,[6,12,18,24])

    def test_category_fraction_means_occurrence(self):
        a=np.array([[[.25]],[[0]]]);self.assertEqual(threshold_fields('snow_occurrence',a,12,2)['ens_snow_occurrence_12h'][0,0],50)

    def test_extrema_mean_not_extreme_of_mean(self):
        a=np.array([[[10]],[[20]]]);np.testing.assert_equal(member_extrema_anomaly(a,np.array([[12]]),2),3)
        with self.assertRaises(ValueError):member_extrema_anomaly(a,np.array([[12]]),18)

    def test_reset_is_not_silently_clipped(self):
        with self.assertRaises(ValueError):nonnegative_difference(np.array([1]),np.array([5]))


if __name__=='__main__':unittest.main()
