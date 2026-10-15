"""Compare deployed native statistical grids against official GEFS/IFS indexes.
Metadata only. No inferred initialization or deterministic substitution.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
import json,os
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request,urlopen
from urllib.parse import urlencode
SITE='https://matthewhugo81-arch.github.io/snowline/'
MODELS={'gefs':('snowline_gefs_ensemble',6),'ecmwf':('snowline_ecmwf_ensemble',12)}
REQUIRED={('gh','pl','500'),('t','pl','850'),('msl','sfc',None)}
ECMWF_BASES=('https://data.ecmwf.int/forecasts','https://storage.googleapis.com/ecmwf-open-data')
VARIABLES={f'{field}_{stat}' for field in ('geopotential_height_500hPa','temperature_850hPa','pressure_msl') for stat in ('mean','spread')}
HOURS={'gefs':list(range(0,241,3))+list(range(246,385,6)), 'ecmwf':list(range(0,145,3))+list(range(150,361,6))}
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
  return gefs_hours(date,cycle)
 hours=[]
 for block in (240,360):
  for i,base in enumerate(ECMWF_BASES):
   url=f'{base}/{date}/{cycle}z/ifs/0p25/enfo/{date}{cycle}0000-{block}h-enfo-ep.index'
   try:
    hours.extend(ecmwf_hours(get(url).decode()));break
   except (URLError,TimeoutError) as e:
    code=getattr(e,'code',None)
    if code==404:break
    if i==len(ECMWF_BASES)-1 or code is not None and code not in (429,500,502,503,504):raise
 return sorted(set(hours))

def gefs_hours(date,cycle):
 # Checking f003 alone misses newly issued later hours of the same cycle.
 # Use complete binary/index pairs, then verify all six statistical fields.
 base='https://noaa-gefs-pds.s3.amazonaws.com/'
 products=[('geavg','ens mean'),('gespr','ens std dev')]
 prefixes={product:f'gefs.{date}/{cycle}/atmos/pgrb2ap5/{product}.t{cycle}z.pgrb2a.0p50.f' for product,_ in products}
 available=[]
 for product,_ in products:
  prefix=prefixes[product]
  listing=ET.fromstring(get(base+'?'+urlencode({'list-type':'2','prefix':prefix})))
  if listing.findtext('{*}IsTruncated')=='true':raise ValueError('GEFS availability listing was truncated')
  keys={node.text for node in listing.findall('{*}Contents/{*}Key')}
  available.append({int(key[len(prefix):]) for key in keys if key.startswith(prefix) and re.fullmatch(r'\d{3}',key[len(prefix):]) and key+'.idx' in keys})
 expected=set(range(0,241,3))|set(range(246,385,6))
 candidates=sorted(expected.intersection(*available))
 def verify(hour):
  for product,marker in products:
   try:rows=[row.split(':') for row in get(base+prefixes[product]+f'{hour:03d}.idx').decode().splitlines()]
   except HTTPError as e:
    if e.code==404:return None
    raise
   if not all(any(r[3:5]==list(pair) and marker in ':'.join(r[6:]) for r in rows) for pair in [('HGT','500 mb'),('TMP','850 mb'),('PRMSL','mean sea level')]):return None
  return hour
 with ThreadPoolExecutor(max_workers=8) as pool:return [hour for hour in pool.map(verify,candidates) if hour is not None]
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
 # A source may publish only a subset of its eventual forecast horizon.
 # Do not treat a correctly initialized, partially issued GEFS cycle as stale
 # when every hour verified in the official index is already on the site.
 update=newer or (reference==source_run and bool(missing))
 return dict(model=MODELS[model][0],published_reference=published.get('reference_time') if published else None,source_reference=iso(source_run),source_hours=source_hours,published_frames=len(available),completed=published.get('completed') if published else None,status='newer-source-run' if newer else 'hours-pending' if update else 'current',refresh_needed=update,missing_source_hours=missing,checked_at=iso(now))
def check_archive(model,published,read_json):
 # Retention is checked independently of whether the live cycle is current.
 # Only a definite missing/invalid archive requests repair; transport errors
 # remain visible instead of being mistaken for absent historical forecasts.
 references=[]
 try:
  if not published:raise ValueError('No current ensemble is published')
  archive=read_json('history.json')
  if archive.get('format_version')!=1 or not isinstance(archive.get('runs'),list):raise ValueError('Invalid archive index')
  references=[datetime.fromisoformat(t.replace('Z','+00:00')) for t in archive['runs']]
  latest=datetime.fromisoformat(published['reference_time'].replace('Z','+00:00'))
  if len(references)!=3 or references!=sorted(set(references),reverse=True) or references[0]!=latest:
   raise ValueError('Archive must retain the latest run and two distinct predecessors')
  for i,reference in enumerate(references):
   if reference.timestamp()%(MODELS[model][1]*3600) or not timedelta(0)<=latest-reference<=timedelta(hours=48):
    raise ValueError('Archive cycle is outside its native cadence or 48-hour window')
   meta=read_json(reference.strftime('%Y/%m/%d/%H00Z/meta.json'))
   if meta.get('format_version')!=1 or datetime.fromisoformat(meta['reference_time'].replace('Z','+00:00'))!=reference:
    raise ValueError('Archived metadata does not match its exact cycle')
   if not VARIABLES<=set(meta.get('variables',[])) or not meta.get('valid_times'):
    raise ValueError('Archived ensemble fields or forecast times are missing')
   if i and (meta.get('completed') is not True or meta['valid_times']!=[iso(reference+timedelta(hours=h)) for h in HOURS[model]]):
    raise ValueError('A previous ensemble run is incomplete')
  return dict(archive_status='current',archive_runs=[iso(t) for t in references],archive_refresh_needed=False)
 except (HTTPError,URLError,TimeoutError,FileNotFoundError,ValueError,KeyError,TypeError,AttributeError) as error:
  transport=isinstance(error,(URLError,TimeoutError)) and getattr(error,'code',None)!=404
  return dict(archive_status='check-failed' if transport else 'repair-needed',archive_runs=[iso(t) for t in references],archive_refresh_needed=not transport,archive_error=str(error))

def publication_check_overdue(site,now):
 try:
  health=json.loads(get(site.rstrip('/')+'/ensemble-data/health.json'))
  checked=datetime.fromisoformat(health['checked_at'].replace('Z','+00:00'))
  return now-checked>timedelta(minutes=30) or checked-now>timedelta(minutes=5)
 except (URLError,TimeoutError,ValueError,KeyError,TypeError):return True

def check_model(model,site,now,local_root=None):
 def read_json(relative):
  if local_root:return json.loads((local_root/MODELS[model][0]/relative).read_text())
  return json.loads(get(site.rstrip('/')+'/ensemble-data/'+MODELS[model][0]+'/'+relative))
 run,hours=newest_source(model,now)
 try:published=read_json('latest.json')
 except (HTTPError,FileNotFoundError) as e:
  if isinstance(e,HTTPError) and e.code!=404:raise
  published=None
 result=assess(model,published,run,hours,now)
 result.update(check_archive(model,published,read_json))
 result['refresh_needed']|=result['archive_refresh_needed']
 return result
def main():
 p=argparse.ArgumentParser();p.add_argument('--site',default=SITE);p.add_argument('--output',type=Path,default=Path('health-output/ensembles.json'));p.add_argument('--local-root',type=Path);args=p.parse_args();now=datetime.now(timezone.utc)
 def check(model):
  try:
   return check_model(model,args.site,now,args.local_root)
  except Exception as e:return dict(model=MODELS[model][0],status='check-failed',error=str(e),refresh_needed=False,checked_at=iso(now))
 with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(check,MODELS))
 overdue=False if args.local_root else publication_check_overdue(args.site,now)
 refresh=overdue or any(r['refresh_needed'] for r in results)
 report=dict(checked_at=iso(now),scope='Official statistical indexes and three-run archives versus published native grids; not image latency.',publication_check_overdue=overdue,refresh_needed=refresh,models=results)
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n')
 if os.environ.get('GITHUB_OUTPUT'):
  with open(os.environ['GITHUB_OUTPUT'],'a') as stream:stream.write('refresh_needed='+str(refresh).lower()+'\n')
 for r in results:print(r['model']+': '+r['status']+' | site '+str(r.get('published_reference'))+' | official '+str(r.get('source_reference'))+' | archive '+r.get('archive_status','unchecked')+(' | '+r['error'] if 'error' in r else ''))
 if refresh or any(r['status']=='check-failed' or r.get('archive_status')=='check-failed' for r in results):raise SystemExit(1)
if __name__=='__main__':main()
