import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
import json
from datetime import datetime,timezone
import numpy as np
from ensemble_products import complete_window,probability,threshold_fields,lagged_cycles,member_extrema_anomaly,nonnegative_difference
from ensemble_product_sources import MetOffice,GlobalGRIB
from ensemble_products import cold_probability_fields,COLD_THRESHOLDS
from build_ensemble_products import build,publish


class Products(unittest.TestCase):
    def test_cold_thresholds_include_equality_and_are_monotonic(self):
        a=np.array([[[0]], [[-2]], [[-5]], [[-10]], [[1]], [[-11]]],dtype=float)
        fields=cold_probability_fields(a,6)
        for key,expected in zip(COLD_THRESHOLDS,[500/6,400/6,50,200/6]):
            self.assertAlmostEqual(float(fields[key][0,0]),expected,places=4)
        a[0,0,0]=np.nan
        self.assertTrue(all(np.isnan(v[0,0]) for v in cold_probability_fields(a,6).values()))
        with self.assertRaises(ValueError):cold_probability_fields(a,18)

    def test_cold_probability_uses_member_minimum_not_mean_or_time_average(self):
        a=np.array([[[-2]],[[4]]]);b=np.array([[[4]],[[-2]]])
        minima=complete_window([(0,12,a),(12,24,b)],0,24,'min')
        self.assertEqual(cold_probability_fields(minima,2)['ens_temperature_lem2c_24h'][0,0],100)
        self.assertEqual(cold_probability_fields((a+b)/2,2)['ens_temperature_lem2c_24h'][0,0],0)

    def test_cold_build_without_climatology_and_retained_task_upgrade(self):
        run=datetime(2026,10,21,9,tzinfo=timezone.utc)
        for has_normal in (False,True):
            with self.subTest(has_normal=has_normal),TemporaryDirectory() as directory:
                root=Path(directory);normal=root/'normal.npz'
                if has_normal:normal.touch()
                calls=[]
                source=MetOffice('mogreps_uk',run,root/'cache')
                def window(start,end,kind):
                    calls.append((start,end,kind));return np.zeros((18,1,1),dtype=np.float32)
                source.window=window
                def frame(path,values):path.write_bytes(b'fixture')
                with patch('build_ensemble_products.MetOffice',return_value=source),patch('build_ensemble_products.uk_nearest_indices',return_value=(np.array([[0]]),np.array([[0]]),np.array([[True]]))),patch('build_ensemble_products.write_frame',side_effect=frame),patch('temperature_climatology.read_normals',return_value={k:np.zeros((12,1,1)) for k in ('min','max')}):
                    build('mogreps_uk',root,root/'cache',run,max_hour=24,climatology=normal)
                    folder=root/'snowline_mogreps_uk_products/2026/10/21/0900Z'
                    record_path=folder/'2026-10-22T0900.om.json'
                    record=json.loads(record_path.read_text())
                    self.assertTrue(set(COLD_THRESHOLDS).issubset(record['variables']))
                    self.assertEqual(calls.count((0,24,'min')),1,'Minima shared by anomalies and probabilities')
                    self.assertEqual('ens_temperature_min_anomaly' in record['variables'],has_normal)
                    if has_normal:
                        # Simulate the previous release's completed anomaly-only minimum task.
                        record['variables']=[k for k in record['variables'] if k not in COLD_THRESHOLDS]
                        record['intervals']={k:v for k,v in record['intervals'].items() if k not in COLD_THRESHOLDS}
                        record_path.write_text(json.dumps(record))
                        np.savez_compressed(folder/'024-min-24.npz',ens_temperature_min_anomaly=np.zeros((1,1)))
                        publish(root,folder,source,'mogreps_uk',run,[(24,'min',24)],True)
                        self.assertFalse(json.loads((folder/'meta.json').read_text())['completed'])
                        calls.clear()
                        build('mogreps_uk',root,root/'cache',run,max_hour=24,climatology=normal)
                        self.assertEqual(calls,[(0,24,'min')])
                        updated=json.loads(record_path.read_text())
                        self.assertTrue(set(COLD_THRESHOLDS).issubset(updated['variables']))
                        self.assertEqual(updated['tasks'].count('min-24'),1)
                    calls.clear()
                    build('mogreps_uk',root,root/'cache',run,max_hour=24,climatology=normal)
                    self.assertEqual(calls,[],'Complete retained tasks require no source download')
                    self.assertTrue(json.loads((folder/'meta.json').read_text())['completed'])

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

    def test_ecmwf_complete_extrema_and_medium_range_boundary(self):
        source=GlobalGRIB('ecmwf',datetime(2026,10,21,12,tzinfo=timezone.utc),Path('unused'))
        source.read=lambda h,k:(np.full((51,1,1),h),(h-3,h,k))
        np.testing.assert_equal(source.window(117,141,'min'),120)
        np.testing.assert_equal(source.window(117,141,'max'),141)
        with self.assertRaises(ValueError):source.window(141,165,'max')
        source.read=lambda h,k:(np.ones((51,1,1)),(h-1,h,k))
        with self.assertRaises(ValueError):source.window(21,45,'min')

    def test_ecmwf_anomaly_requires_all_51_members(self):
        a=np.full((51,1,2),10.);a[50,0,1]=np.nan
        anomaly=member_extrema_anomaly(a,np.full((1,2),12.),51)
        self.assertEqual(anomaly[0,0],-2)
        self.assertTrue(np.isnan(anomaly[0,1]))
        with self.assertRaises(ValueError):member_extrema_anomaly(a[:50],np.full((1,2),12.),51)


if __name__=='__main__':unittest.main()
