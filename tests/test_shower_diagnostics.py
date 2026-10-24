import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np
from build_shower_diagnostics import global_flags,ukv_flags

class ShowerTests(unittest.TestCase):
 def test_native_rates(self):
  flags=global_flags(np.array([2,2,2,0,np.nan,1]),np.array([1.5,.1,3,0,1,-1]),np.zeros(6))
  np.testing.assert_array_equal(flags,[2,1,1,1,0,0])
 def test_ukv_does_not_turn_uniform_rain_or_dry_cape_into_showers(self):
  ones=np.ones((61,61));zeros=np.zeros_like(ones)
  self.assertFalse((ukv_flags(ones,ones*500,zeros)==2).any())
  self.assertFalse((ukv_flags(zeros,ones*500,zeros)==2).any())
 def test_ukv_cells_need_instability_or_hail(self):
  p=np.zeros((61,61));p[29:32,29:32]=1
  self.assertEqual(ukv_flags(p,p*0,p*0)[30,30],1)
  self.assertEqual(ukv_flags(p,p*50,p*0)[30,30],2)
  self.assertEqual(ukv_flags(p,p*0,p*.1)[30,30],2)
 def test_missing_values_never_become_showers(self):
  p=np.ones((31,31));cape=p*np.nan
  self.assertFalse((ukv_flags(p,cape,p)==2).any())

if __name__=='__main__':unittest.main()
