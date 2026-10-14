import sys,json,unittest
from pathlib import Path
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
from urllib.parse import parse_qs,urlparse
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import check_ensemble_freshness as f
class FreshnessTests(unittest.TestCase):
 def test_gefs_checks_later_hours_and_all_six_fields(self):
  def fake_get(url):
   if '?' in url:
    prefix=parse_qs(urlparse(url).query)['prefix'][0]
    # f012 lacks its binary; f015 is absent from spread. Neither is ready.
    hours=[0,3,6,9,15] if 'geavg' in prefix else [0,3,6,9]
    keys=[prefix+f'{h:03d}'+suffix for h in hours for suffix in ['', '.idx']]+[prefix+'012.idx']
    return ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>'+''.join('<Contents><Key>'+key+'</Key></Contents>' for key in keys)+'</ListBucketResult>').encode()
   marker='ens mean' if 'geavg' in url else 'ens std dev'
   fields=[('HGT','500 mb'),('TMP','850 mb'),('PRMSL','mean sea level')]
   if 'f009.idx' in url and 'gespr' in url:fields=fields[:-1]
   return '\n'.join(f'{i}:0:d=2026101406:{key}:{level}:3 hour fcst:{marker}' for i,(key,level) in enumerate(fields)).encode()
  with patch.object(f,'get',side_effect=fake_get):
   self.assertEqual(f.probe('gefs',datetime(2026,10,14,6,tzinfo=timezone.utc)),[0,3,6])
 def test_truncated_gefs_listing_fails_closed(self):
  with patch.object(f,'get',return_value=b'<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>'):
   with self.assertRaisesRegex(ValueError,'truncated'):f.gefs_hours('20261014','06')
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
