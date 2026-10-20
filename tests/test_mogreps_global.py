import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib
import numpy as np
from omfiles import OmFileReader
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import build_mogreps_global as b


class GlobalMogrepsTests(unittest.TestCase):
    def manifest(self):
        return dict(schema=1, run=1792389600, runId='20261019T0600Z', members=[0,*range(18,35)],
                    intervalHours=3, leads=list(range(0,247,3)),grid={'latitude':[-89.90625,.1875,960],'longitude':[-179.859375,.28125,1280]})

    def test_deflate_shuffle_and_filter_masks(self):
        values=np.array([1.25,-4.5,0,273.15],dtype='<f4')
        dataset=dict(dtype='<f4',chunkShape=[2,2],filters=[dict(id=2),dict(id=1)])
        shuffled=values.view(np.uint8).reshape(-1,4).T.copy().tobytes()
        np.testing.assert_array_equal(b.decode_chunk(zlib.compress(shuffled),dataset,0).ravel(),values)
        np.testing.assert_array_equal(b.decode_chunk(values.tobytes(),dataset,3).ravel(),values)
        with self.assertRaises(ValueError): b.decode_chunk(b'short',dataset,3)

    def test_statistics_use_complete_members_population_sd_and_raw_exceedances(self):
        values=np.arange(18,dtype=float).reshape(18,1,1)
        mean,sd=b.statistics(values)
        self.assertEqual(float(mean[0,0]),8.5)
        self.assertAlmostEqual(float(sd[0,0]),np.sqrt((18**2-1)/12))
        self.assertAlmostEqual(float(b.probability(values,9)[0,0]),50)
        values[0,0,0]=np.nan
        self.assertTrue(np.isnan(b.statistics(values)[0][0,0]))
        self.assertTrue(np.isnan(b.probability(values)[0,0]))

    def test_three_hour_accumulations_precede_probabilities_and_mask_below_ground(self):
        manifest=self.manifest()
        def index(manifest,kind,h): return dict(kind=kind,hour=h,levels=[5,12],data='values',flag='flags',intervalHours=1 if h<=132 else 3)
        def extract(idx,dataset,*args,**kwargs):
            if idx['kind']=='temperature':
                values=np.zeros((18,2,1,1)) if dataset=='flags' else np.full((18,2,1,1),273.15)
                if dataset=='flags': values[0,0]=1
                return values
            values=np.zeros((18,1,1))
            # Only one hour has 0.3 mm: exactly reaches 0.1 mm/h over 3 h.
            if idx['hour'] in (3,135): values[:9]=.0003
            return values
        with patch.object(b,'index_for',side_effect=index),patch.object(b,'extract',side_effect=extract):
            data=b.frame_values(manifest,3,crop=(0,1,0,1))
            self.assertTrue(np.isnan(data['temperature_850hPa_mean'][0,0]))
            self.assertEqual(data['temperature_500hPa_mean'][0,0],0)
            self.assertAlmostEqual(data['precipitation_mean'][0,0],.05)
            self.assertEqual(data['precipitation_probability'][0,0],50)
            later=b.frame_values(manifest,135,crop=(0,1,0,1))
            self.assertEqual(later['snowfall_probability'][0,0],50)
            self.assertEqual(set(b.frame_values(manifest,0,crop=(0,1,0,1))),set(b.INSTANT))

    def test_metadata_keeps_field_times_and_actual_periods(self):
        manifest=self.manifest();meta=b.metadata(manifest,{0:b.INSTANT,3:b.FIELDS,9:b.FIELDS})
        self.assertFalse(meta['completed']);self.assertEqual(meta['member_ids'],[0,*range(18,35)])
        valid='2026-10-19T15:00:00Z'
        self.assertEqual(meta['variable_intervals']['precipitation_mean'][valid]['start'],'2026-10-19T12:00:00Z')
        self.assertNotIn(meta['reference_time'],meta['variable_valid_times']['precipitation_mean'])
        manifest['members']=list(range(18))
        with self.assertRaises(ValueError): b.validate_manifest(manifest)

    def test_om_keeps_missing_temperature_and_probability_precision(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'frame.om'
            values={key:np.full((232,365),-20.123 if key in b.INSTANT else 100/18) for key in b.FIELDS}
            values['temperature_850hPa_mean'][0,0]=np.nan
            with patch.object(b,'frame_values',return_value=values), patch('mogreps_comparison_fields.comparison_values',return_value={}): b.write_frame(self.manifest(),24,path,1)
            reader=OmFileReader(str(path))
            self.assertTrue(np.isnan(reader.get_child_by_name('temperature_850hPa_mean')[0,0]))
            self.assertAlmostEqual(float(reader.get_child_by_name('temperature_500hPa_mean')[0,0]),-20.123,delta=.011)
            self.assertAlmostEqual(float(reader.get_child_by_name('precipitation_probability')[0,0]),100/18,delta=.011)
            del reader


if __name__=='__main__': unittest.main()
