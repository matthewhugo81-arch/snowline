"""Compare deployed native statistical grids against official GEFS/IFS indexes.
Metadata only. No inferred initialization or deterministic substitution.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
import json,os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request,urlopen
SITE='https://matthewhugo81-arch.github.io/snowline/'
MODELS={'gefs':('snowline_gefs_ensemble',6),'ecmwf':('snowline_ecmwf_ensemble',12)}
REQUIRED={('gh','pl','500'),('t','pl','850'),('msl','sfc',None)}
def iso(t):return t.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
def get(url):
 with urlopen(Request(url,headers={'User-Agent':'Snowline-ensemble-health/1.0','Cache-Control':'no-cache'}),timeout=20) as r:return r.read()
def ecmwf_hours(text):
 groups={}
 for line in text.splitlines():
  row=json.loads(line)
  if row.get('type') not in ('em','es'):continue
  key=(row.get('param'),row.get('levtype'),row.get('levelist') if row.get('levtype')=='pl' else None)
  groups.setdefault((int(row['step']),row['type']),set()).add(key)
 return sorted(h for h,stat in groups if stat=='em' and REQUIRED<=groups[(h,'em')] and REQUIRED<=groups.get((h,'es'),set()))
def probe(model,run):
 date,cycle=run.strftime('%Y%m%d'),run.strftime('%H')
 if model=='gefs':
  for product,marker in [('geavg','ens mean'),('gespr','ens std dev')]:
   url=f'https://noaa-gefs-pds.s3.amazonaws.com/gefs.{date}/{cycle}/atmos/pgrb2ap5/{product}.t{cycle}z.pgrb2a.0p50.f003.idx'
   rows=[row.split(':') for row in get(url).decode().splitlines()]
   if not all(any(r[3:5]==list(pair) and marker in ':'.join(r[6:]) for r in rows) for pair in [('HGT','500 mb'),('TMP','850 mb'),('PRMSL','mean sea level')]):raise ValueError('GEFS index lacks required mean/spread fields')
  return [3]
 hours=[]
 for block in (240,360):
  url=f'https://data.ecmwf.int/forecasts/{date}/{cycle}z/ifs/0p25/enfo/{date}{cycle}0000-{block}h-enfo-ep.index'
  try:hours.extend(ecmwf_hours(get(url).decode()))
  except HTTPError as e:
   if e.code!=404:raise
 return sorted(set(hours))
def newest_source(model,now):
 cycle=MODELS[model][1];top=now.replace(hour=now.hour//cycle*cycle,minute=0,second=0,microsecond=0)
 for back in range(4):
  run=top-timedelta(hours=back*cycle)
  try:hours=probe(model,run)
  except HTTPError as e:
   if e.code==404:continue
   raise
  if hours:return run,hours
 raise ValueError('No verified official statistical product in bounded lookback')
def assess(model,published,source_run,source_hours,now):
 reference=datetime.fromisoformat(published['reference_time'].replace('Z','+00:00')) if published else None
 available=set(published.get('valid_times',[])) if published else set()
 available_ms={datetime.fromisoformat(t.replace('Z','+00:00')).timestamp() for t in available}
 missing=[h for h in source_hours if (source_run+timedelta(hours=h)).timestamp() not in available_ms]
 newer=reference is None or source_run>reference
 incomplete_gefs=model=='gefs' and reference==source_run and published.get('completed') is False
 update=newer or (reference==source_run and (bool(missing) or incomplete_gefs))
 return dict(model=MODELS[model][0],published_reference=published.get('reference_time') if published else None,source_reference=iso(source_run),source_hours=source_hours,published_frames=len(available),completed=published.get('completed') if published else None,status='newer-source-run' if newer else 'hours-pending' if update else 'current',refresh_needed=update,missing_source_hours=missing,checked_at=iso(now))
def check_model(model,site,now):
 run,hours=newest_source(model,now)
 try:published=json.loads(get(site.rstrip('/')+'/ensemble-data/'+MODELS[model][0]+'/latest.json'))
 except HTTPError as e:
  if e.code!=404:raise
  published=None
 return assess(model,published,run,hours,now)
def main():
 p=argparse.ArgumentParser();p.add_argument('--site',default=SITE);p.add_argument('--output',type=Path,default=Path('health-output/ensembles.json'));p.add_argument('--local-root',type=Path);args=p.parse_args();now=datetime.now(timezone.utc)
 def check(model):
  try:
   if args.local_root:
    run,hours=newest_source(model,now);path=args.local_root/MODELS[model][0]/'latest.json';published=json.loads(path.read_text()) if path.exists() else None
    return assess(model,published,run,hours,now)
   return check_model(model,args.site,now)
  except Exception as e:return dict(model=MODELS[model][0],status='check-failed',error=str(e),refresh_needed=False,checked_at=iso(now))
 with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(check,MODELS))
 report=dict(checked_at=iso(now),scope='Official statistical indexes versus published native grids; not image latency.',models=results)
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n')
 if os.environ.get('GITHUB_OUTPUT'):
  with open(os.environ['GITHUB_OUTPUT'],'a') as stream:stream.write('refresh_needed='+str(any(r['refresh_needed'] for r in results)).lower()+'\n')
 for r in results:print(r['model']+': '+r['status']+' | site '+str(r.get('published_reference'))+' | official '+str(r.get('source_reference'))+(' | '+r['error'] if 'error' in r else ''))
 if any(r['status']=='check-failed' or r['refresh_needed'] for r in results):raise SystemExit(1)
if __name__=='__main__':main()
