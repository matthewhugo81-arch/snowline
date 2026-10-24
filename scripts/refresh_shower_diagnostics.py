"""Resume optional shower products on every normal site publication.

Discover exact published provider times; never guess a missing forecast hour.
Keep four recent cycles per model, and discard raw inputs after each frame.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import time
from urllib.request import urlopen
from build_shower_diagnostics import DOMAINS, build, iso

BASE='https://openmeteo.s3.amazonaws.com/data_spatial/'
def get(url):
 with urlopen(url,timeout=20) as r:return json.load(r)
def parse(s):return datetime.fromisoformat(s.replace('Z','+00:00'))
def frame_path(root,model,run,valid):return Path(root)/DOMAINS[model]/run.strftime('%Y/%m/%d/%H%MZ')/(valid.strftime('%Y-%m-%dT%H%M')+'.json')
def forecast_hours(meta,run):
 if meta.get('reference_time') is None or parse(meta['reference_time'])!=run:raise ValueError('Metadata cycle mismatch')
 result=[]
 for value in meta.get('valid_times',[]):
  hours=(parse(value)-run).total_seconds()/3600
  if hours>0 and hours.is_integer() and hours<=240:result.append(int(hours))
 return sorted(set(result))
def discover(model):
 base=BASE+DOMAINS[model]+'/'
 runs={}
 for name in ('latest.json','in-progress.json'):
  try:
   meta=get(base+name);run=parse(meta['reference_time']);forecast_hours(meta,run);runs[run]=meta
  except Exception as error:print('Metadata unavailable',model,name,str(error),flush=True)
 if not runs:return {}
 newest=max(runs);cycle=3 if model=='ukv' else 6
 main=newest.replace(hour=newest.hour//cycle*cycle,minute=0,second=0,microsecond=0)
 for run in (main,main-timedelta(hours=cycle),main-timedelta(hours=2*cycle)):
  if run in runs:continue
  try:
   meta=get(base+run.strftime('%Y/%m/%d/%H%MZ/meta.json'));forecast_hours(meta,run);runs[run]=meta
  except Exception as error:print('Prior cycle unavailable',iso(run),str(error),flush=True)
 return dict(sorted(runs.items(),reverse=True)[:4])
def refresh(model,output,budget,now=None):
 start=time.monotonic();now=now or datetime.now(timezone.utc);runs=discover(model)
 if not runs:raise RuntimeError('No published '+model+' cycles available')
 tasks=[]
 for run,meta in runs.items():
  for hour in forecast_hours(meta,run):
   valid=run+timedelta(hours=hour);path=frame_path(output,model,run,valid)
   if path.exists():
    try:
     old=json.loads(path.read_text())
     if old.get('version')==1 and old.get('reference_time')==iso(run) and old.get('valid_time')==iso(valid) and 'flags_rle' in old:continue
    except (ValueError,OSError):pass
   tasks.append((run,hour,valid))
 # Next 48 h first, with newest runs first at the same valid time.
 tasks.sort(key=lambda x:(x[2]<now-timedelta(hours=2),abs((x[2]-now).total_seconds()),-x[0].timestamp()))
 made=0;failed=[]
 for run,hour,valid in tasks:
  if time.monotonic()-start>=budget:break
  try:
   with tempfile.TemporaryDirectory(prefix='snowline-showers-') as cache:build(model,run,hour,cache,output)
   made+=1
  except Exception as error:
   failed.append({'run':iso(run),'hour':hour,'error':str(error)[:300]});print('Deferred',model,iso(run),hour,str(error),flush=True)
 root=Path(output).resolve()/DOMAINS[model]
 # Delete only generated frame files in this model's output tree, after discovery.
 keep={r.strftime('%Y/%m/%d/%H%MZ') for r in runs}
 if root.exists():
  for path in root.glob('*/*/*/*Z/*.json'):
   if path.parent.relative_to(root).as_posix() not in keep:path.unlink()
 root.mkdir(parents=True,exist_ok=True)
 report={'version':1,'checked_at':iso(now),'created':made,'pending':len(tasks)-made,'failures':failed,'runs':[iso(r) for r in runs]}
 (root/'health.json').write_text(json.dumps(report))
 print(json.dumps(report),flush=True)
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--model',choices=DOMAINS,required=True);p.add_argument('--output',default='shower-data');p.add_argument('--budget',type=int,default=180);a=p.parse_args();refresh(a.model,a.output,a.budget)
