import sys, unittest, tempfile, json
from pathlib import Path
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import refresh_shower_diagnostics as r

class RefreshTests(unittest.TestCase):
 def test_exact_cycle_and_native_hours(self):
  run=datetime(2026,10,24,6,tzinfo=timezone.utc)
  meta={'reference_time':r.iso(run),'valid_times':[r.iso(run+timedelta(hours=h)) for h in (0,1,3,6)]}
  self.assertEqual(r.forecast_hours(meta,run),[1,3,6])
  with self.assertRaises(ValueError):r.forecast_hours(meta,run+timedelta(hours=6))
 def test_resumes_failed_frames_and_preserves_completed(self):
  run=datetime(2026,10,24,6,tzinfo=timezone.utc)
  meta={'reference_time':r.iso(run),'valid_times':[r.iso(run+timedelta(hours=h)) for h in (1,2)]}
  with tempfile.TemporaryDirectory() as out:
   first=r.frame_path(out,'global',run,run+timedelta(hours=1));first.parent.mkdir(parents=True)
   first.write_text(json.dumps({'version':1,'reference_time':r.iso(run),'valid_time':r.iso(run+timedelta(hours=1)),'flags_rle':[[1,4]]}))
   original=first.read_bytes()
   with patch.object(r,'discover',return_value={run:meta}),patch.object(r,'build',side_effect=RuntimeError('not yet available')) as build:
    report=r.refresh('global',out,60,run);self.assertEqual(build.call_count,1);self.assertEqual(report['pending'],1);self.assertEqual(first.read_bytes(),original)
   with patch.object(r,'discover',return_value={run:meta}),patch.object(r,'build') as build:
    report=r.refresh('global',out,60,run);self.assertEqual(build.call_count,1);self.assertEqual(report['created'],1)
 def test_discovery_failure_does_not_remove_old_products(self):
  with tempfile.TemporaryDirectory() as out:
   keep=Path(out)/'keep.json';keep.write_text('preserve')
   with patch.object(r,'discover',return_value={}):
    with self.assertRaises(RuntimeError):r.refresh('global',out,60)
   self.assertEqual(keep.read_text(),'preserve')

if __name__=='__main__':unittest.main()
