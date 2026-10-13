import sys,json,unittest
from pathlib import Path
from datetime import datetime,timezone,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import check_ensemble_freshness as f
class FreshnessTests(unittest.TestCase):
 def test_all_six_official_fields_required(self):
  rows=[dict(type=s,step='3',param=p,levtype=l,levelist=k) for s in ['em','es'] for p,l,k in f.REQUIRED]
  self.assertEqual(f.ecmwf_hours('\n'.join(map(json.dumps,rows))),[3]);self.assertEqual(f.ecmwf_hours('\n'.join(map(json.dumps,rows[:-1]))),[])
 def test_generation_time_is_not_initialization(self):
  run=datetime(2026,10,13,tzinfo=timezone.utc);meta=dict(reference_time=f.iso(run),valid_times=[f.iso(run+timedelta(hours=3))],completed=True,generated_at=f.iso(run+timedelta(hours=9)))
  r=f.assess('gefs',meta,run,[3],run+timedelta(hours=10));self.assertFalse(r['refresh_needed']);self.assertEqual(r['source_reference'],f.iso(run))
 def test_new_source_and_missing_hours_request_refresh(self):
  run=datetime(2026,10,13,tzinfo=timezone.utc);old=dict(reference_time=f.iso(run-timedelta(hours=12)),valid_times=[],completed=True)
  self.assertTrue(f.assess('ecmwf',old,run,[0,3],run)['refresh_needed']);old.update(reference_time=f.iso(run),valid_times=[f.iso(run)],completed=False);self.assertTrue(f.assess('ecmwf',old,run,[0,3],run)['refresh_needed'])
 def test_partly_issued_gefs_does_not_falsely_require_refresh(self):
  run=datetime(2026,10,13,12,tzinfo=timezone.utc)
  meta=dict(reference_time=f.iso(run),valid_times=[f.iso(run+timedelta(hours=3))],completed=False)
  result=f.assess('gefs',meta,run,[3],run+timedelta(hours=2))
  self.assertEqual(result['status'],'current')
  self.assertFalse(result['refresh_needed'])
  self.assertEqual(result['missing_source_hours'],[])
  self.assertTrue(f.assess('gefs',meta,run,[3,6],run+timedelta(hours=2))['refresh_needed'])
 def test_source_cannot_request_cycle_rollback(self):
  run=datetime(2026,10,13,tzinfo=timezone.utc);meta=dict(reference_time=f.iso(run),valid_times=[f.iso(run)],completed=True)
  self.assertFalse(f.assess('ecmwf',meta,run-timedelta(hours=12),[0,3],run)['refresh_needed'])
if __name__=='__main__':unittest.main()
