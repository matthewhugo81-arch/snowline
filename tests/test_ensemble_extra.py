import sys
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import build_ensemble_extras as e
from omfiles import OmFileReader

class EnsembleExtraTests(unittest.TestCase):
 def test_complete_member_mean_keeps_missing_cells_missing(self):
  a=e.np.array([1.,e.np.nan]);b=e.np.array([3.,4.])
  mean=e.mean_complete([a,b],2)
  self.assertEqual(mean[0],2);self.assertTrue(e.np.isnan(mean[1]))
  with self.assertRaises(ValueError):e.mean_complete([a],2)

 def test_accumulations_need_matching_period_and_previous_value(self):
  a=e.np.array([4.,2.]);b=e.np.array([1.,2.])
  e.np.testing.assert_array_equal(e.interval_amount(a,b,0,6,3),[3,0])
  e.np.testing.assert_array_equal(e.interval_amount(a,None,6,9,6),a)
  with self.assertRaises(ValueError):e.interval_amount(a,None,0,6,3)
  with self.assertRaises(ValueError):e.interval_amount(a,b,4,6,3)
  with self.assertRaises(ValueError):e.interval_amount(b,a,0,6,3)

 def test_crop_retains_cell_orientation_and_native_spacing(self):
  step=.5;a=e.np.arange(361*720,dtype=float).reshape(361,720)
  cropped=e.crop(a.ravel(),step,0)
  self.assertEqual(cropped.shape,(87,205))
  self.assertEqual(cropped[0,0],a[118,588])
  self.assertEqual(cropped[-1,-1],a[32,72])

 def test_cached_wider_member_means_keep_the_same_native_cells(self):
  source=e.np.arange(721*1440,dtype=float).reshape(721,1440)
  previous=source[440:681,400:901]
  narrowed=e.cached_crop(previous,(-80,20,45,80),.25)
  e.np.testing.assert_array_equal(narrowed,source[484:657,456:865])
  e.np.testing.assert_array_equal(e.cached_crop(narrowed,e.BOUNDS,.25),narrowed)
  with self.assertRaises(ValueError):e.cached_crop(previous,(-80,20,40,80),.25)

 def test_probability_threshold_interval_and_grid_are_checked(self):
  ec=e.core.ec;g=ec.codes_grib_new_from_samples('regular_ll_sfc_grib2')
  try:
   params=dict(Ni=1440,Nj=721,latitudeOfFirstGridPointInDegrees=90,latitudeOfLastGridPointInDegrees=-90,
    longitudeOfFirstGridPointInDegrees=0,longitudeOfLastGridPointInDegrees=359.75,
    iDirectionIncrementInDegrees=.25,jDirectionIncrementInDegrees=.25,
    productDefinitionTemplateNumber=9,probabilityType=3,scaleFactorOfLowerLimit=2,scaledValueOfLowerLimit=1,
    dataDate=20261019,dataTime=0,startStep=0,endStep=24,paramId=131062)
   for key,value in params.items():ec.codes_set(g,key,value)
   ec.codes_set_values(g,e.np.full(1440*721,50.))
   source=SimpleNamespace(model='ecmwf',run=e.datetime(2026,10,19,tzinfo=e.timezone.utc),config=e.core.MODELS['ecmwf'])
   raw=ec.codes_get_message(g)
   values,bounds=e.decode(raw,source,24,('tpg10',),('%',),'surface',0,probability=10)
   self.assertEqual(bounds,(0,24,'accum'));self.assertEqual(values[0,0],50)
   with self.assertRaises(ValueError):e.decode(raw,source,24,('tpg10',),('%',),'surface',0,probability=5)
   with self.assertRaises(ValueError):e.decode(raw,source,36,('tpg10',),('%',),'surface',0,probability=10)
  finally:ec.codes_release(g)

 def test_om_preserves_small_rates_zero_and_missing_cells(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'test.om';a=e.np.full((87,205),.03);a[0,0]=0;a[0,1]=e.np.nan
   e.write_frame(path,{'precipitation_mean':a})
   reader=OmFileReader(str(path));values=reader.get_child_by_name('precipitation_mean')[:,:]
   self.assertEqual(values[0,0],0);self.assertTrue(e.np.isnan(values[0,1]));self.assertAlmostEqual(values[1,1],.03,places=2)
   del reader

if __name__=='__main__':unittest.main()
