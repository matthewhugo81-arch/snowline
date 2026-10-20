"""Import matching native GEM/ICON-EU omega, height and wind frames.

The browser consumes compact OM subsets at native resolution. Never publish a
frame with mixed grids/cycles, missing fields or guessed units. Each complete
frame and metadata document is replaced atomically; failed hours are retried.
"""
from __future__ import annotations
import argparse
import bz2
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import shutil
import threading

import eccodes as ec
import numpy as np
from omfiles import OmFileWriter
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

VERSION=1
FIELDS=['omega_700hPa','geopotential_height_700hPa','wind_u_component_700hPa','wind_v_component_700hPa']
UNITS=dict(zip(FIELDS,['0.1 Pa/s','m','m/s','m/s']))
SCALES=dict(zip(FIELDS,[10,1,10,10]))
CONFIG={
 'gem':dict(domain='snowline_gem_700',upstream='cmc_gem_gdps_15km',cycle=12,source='ECCC GEM / GDPS',
  variables=['VerticalVelocity','GeopotentialHeight','WindU','WindV'],params=[135,156,131,132],units=['Pa s**-1','gpm','m s**-1','m s**-1'],
  native=(2400,1201,-90,0,.15),crop=(800,1101,760,1434),
  grid=dict(type='regular',nx=674,ny=301,latMin=30,lonMin=-66,dx=.15,dy=.15,zoom=3),
  source_url='https://eccc-msc.github.io/open-data/msc-data/nwp_gdps/readme_gdps-datamart_en/'),
 'icon-eu':dict(domain='snowline_icon_eu_700',upstream='dwd_icon_eu',cycle=3,source='DWD ICON Europe',
  variables=['omega','fi','u','v'],params=[135,129,131,132],units=['Pa s**-1','m**2 s**-2','m s**-1','m s**-1'],
  native=(1377,657,29.5,336.5,.0625),crop=(88,657,0,937),
  grid=dict(type='regular',nx=937,ny=569,latMin=35,lonMin=-23.5,dx=.0625,dy=.0625,zoom=4),
  source_url='https://opendata.dwd.de/weather/nwp/icon-eu/grib/')
}
_local=threading.local()
_grib_lock=threading.Lock()

def iso(t): return t.strftime('%Y-%m-%dT%H:%M:00Z')
def session():
 if not hasattr(_local,'session'):
  s=requests.Session();s.headers['User-Agent']='Snowline-700hPa/1.0 (github.com/matthewhugo81-arch/snowline)'
  s.mount('https://',HTTPAdapter(max_retries=Retry(total=3,backoff_factor=.5,status_forcelist=[429,500,502,503,504])))
  _local.session=s
 return _local.session

def fetch(url):
 with session().get(url,timeout=(15,60)) as response:
  response.raise_for_status()
  if len(response.content)>32*1024*1024: raise ValueError('Unexpectedly large single-field download')
  return response.content

def expected_hours(model,run):
 # GDPS pressure-level omega is three-hourly even while surface files are hourly.
 if model=='gem': return CONFIG[model].get('forecast_hours',list(range(0,241,3)))
 return list(range(79))+list(range(81,121,3)) if run.hour%6==0 else list(range(31))+[36,42,48]

class Source:
 def __init__(self,model,run):
  self.model,self.run,self.config=model,run,CONFIG[model]
  self.fields=self.config.get('fields',FIELDS)
  if run.minute or run.second or run.hour%self.config['cycle']: raise ValueError('Invalid model cycle')
  self.base=(f'https://dd.weather.gc.ca/{run:%Y%m%d}/WXO-DD/model_gdps/15km/{run:%H}/' if model=='gem'
   else f'https://opendata.dwd.de/weather/nwp/icon-eu/grib/{run:%H}/')

 def url(self,hour,key):
  variable=self.config['variables'][self.fields.index(key)]
  level=int(re.search(r'_(\d+)hPa$',key)[1])
  if self.model=='gem': return self.base+f'{hour:03d}/{self.run:%Y%m%dT%H}Z_MSC_GDPS_{variable}_IsbL-{level:04d}_LatLon0.15_PT{hour:03d}H.grib2'
  return self.base+f'{variable}/icon-eu_europe_regular-lat-lon_pressure-level_{self.run:%Y%m%d%H}_{hour:03d}_{level}_{variable.upper()}.grib2.bz2'

 def available_hours(self):
  expected=set(expected_hours(self.model,self.run))
  if self.model=='gem':
   listing=fetch(self.base).decode()
   return sorted(expected&{int(h) for h in re.findall(r'href="(\d{3})/"',listing)})
  for variable in self.config['variables']:
   listing=fetch(self.base+variable+'/').decode()
   expected&={int(h) for h in re.findall(fr'_{self.run:%Y%m%d%H}_(\d{{3}})_700_{variable.upper()}\.grib2\.bz2',listing)}
  return sorted(expected)

def decode(message,key,source,hour):
 if source.model=='icon-eu': message=bz2.decompress(message)
 if message[:4]!=b'GRIB' or len(message)<20 or int.from_bytes(message[8:16],'big')!=len(message) or message[-4:]!=b'7777':
  raise ValueError('Not one complete GRIB2 message')
 # ecCodes definition initialization is not thread-safe on every platform.
 with _grib_lock:
  g=ec.codes_new_from_message(message)
  try:
   get=lambda k:ec.codes_get(g,k)
   i=source.fields.index(key);cfg=source.config
   level=int(re.search(r'_(\d+)hPa$',key)[1])
   if get('paramId')!=cfg['params'][i] or get('typeOfLevel')!='isobaricInhPa' or get('level')!=level or get('units')!=cfg['units'][i]:
    raise ValueError('Incorrect parameter, pressure level or units')
   valid=source.run+timedelta(hours=hour)
   # DWD analysis steps use minutes (ecCodes returns "0m" for endStep).
   # Absolute valid time handles both minute and hour step encodings.
   if get('stepType')!='instant' or (get('dataDate'),get('dataTime'),get('validityDate'),get('validityTime'))!=(int(source.run.strftime('%Y%m%d')),source.run.hour*100,int(valid.strftime('%Y%m%d')),valid.hour*100):
    raise ValueError('Incorrect initialization or valid time')
   nx,ny,lat,lon,step=cfg['native']
   if get('gridType')!='regular_ll' or get('Ni')!=nx or get('Nj')!=ny or get('iScansNegatively') or not get('jScansPositively') or get('jPointsAreConsecutive') or get('alternativeRowScanning'):
    raise ValueError('Unexpected native grid or scan direction')
   for k,v in {'latitudeOfFirstGridPointInDegrees':lat,'longitudeOfFirstGridPointInDegrees':lon,
    'latitudeOfLastGridPointInDegrees':lat+(ny-1)*step,'longitudeOfLastGridPointInDegrees':(lon+(nx-1)*step)%360,
    'iDirectionIncrementInDegrees':step,'jDirectionIncrementInDegrees':step}.items():
    if abs(get(k)-v)>1e-5: raise ValueError('Unexpected grid coordinates')
   # Geographic lat/lon components must be earth-relative before drawing barbs.
   if key.startswith('wind_') and get('uvRelativeToGrid')!=0: raise ValueError('Grid-relative wind requires rotation')
   values=ec.codes_get_values(g).reshape(ny,nx)
   if get('bitmapPresent'): values[ec.codes_get_array(g,'bitmap').reshape(ny,nx)==0]=np.nan
   values[values==get('missingValue')]=np.nan
   if source.model=='gem': values=np.roll(values,nx//2,axis=1)
   y0,y1,x0,x1=cfg['crop'];values=values[y0:y1,x0:x1]
   if key=='omega_700hPa': values=values*10
   if key.startswith('temperature_'): values=values-273.15
   if key.startswith('geopotential_height_') and source.model=='icon-eu': values=values/9.80665
   if not np.isfinite(values).any(): raise ValueError('No finite values in chart coverage')
   return np.ascontiguousarray(values,dtype=np.float32)
  finally: ec.codes_release(g)

def frame_path(root,domain,run,hour):
 return root/domain/run.strftime('%Y/%m/%d/%H00Z')/((run+timedelta(hours=hour)).strftime('%Y-%m-%dT%H%M')+'.om')

def write_frame(source,hour,path):
 arrays={key:decode(fetch(source.url(hour,key)),key,source,hour) for key in source.fields}
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp')
 writer=OmFileWriter(str(tmp));children=[]
 for key,array in arrays.items():
  children.append(writer.write_array(array,chunks=[10,100],scale_factor=source.config.get('scales',SCALES)[key],add_offset=0,compression='pfor_delta_2d',name=key))
 writer.close(writer.write_group(name='root',children=children));tmp.replace(path)
 return path.stat().st_size

def write_json(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2)+'\n');tmp.replace(path)

def read_meta(path,model,run=None):
 try: data=json.loads(path.read_text())
 except (OSError,ValueError): return None
 cfg=CONFIG[model]
 if data.get('format_version')!=VERSION or data.get('variables')!=cfg.get('fields',FIELDS) or data.get('units')!=cfg.get('output_units',UNITS) or data.get('grid')!=cfg['grid'] or data.get('domain')!=cfg['domain']: return None
 if run is not None and data.get('reference_time')!=iso(run): return None
 return data

def build_run(model,root,run,workers=4,hours=None):
 cfg=CONFIG[model];source=Source(model,run);expected=expected_hours(model,run)
 requested=expected if hours is None else hours
 if not set(requested)<=set(expected): raise ValueError('Invalid forecast lead time')
 folder=frame_path(root,cfg['domain'],run,0).parent;meta_path=folder/'meta.json'
 old=read_meta(meta_path,model,run)
 prepared={int((datetime.fromisoformat(t)-run).total_seconds()/3600) for t in old['valid_times']} if old else set()
 prepared={h for h in prepared if h in expected and frame_path(root,cfg['domain'],run,h).is_file()}
 if set(requested)<=prepared and old.get('completed')==(prepared==set(expected)): return old
 try: available=source.available_hours()
 except (requests.RequestException,ValueError) as error:
  if not prepared: raise
  print(f'::warning::{model}: source check failed; retaining verified frames for {iso(run)}: {error}',flush=True)
  available=[]
 pending=[h for h in requested if h in available and h not in prepared]
 failures=[]
 with ThreadPoolExecutor(max_workers=workers) as pool:
  jobs={pool.submit(write_frame,source,h,frame_path(root,cfg['domain'],run,h)):h for h in pending}
  for index,job in enumerate(as_completed(jobs),1):
   h=jobs[job]
   try: job.result();prepared.add(h)
   except Exception as error: failures.append(f'T+{h}: {error}')
   if index%20==0 or index==len(jobs): print(f'{model} {iso(run)}: {index}/{len(jobs)} new frames processed',flush=True)
 if failures: print(f'::warning::{model}: {len(failures)} incomplete frames will be retried: {failures[0]}',flush=True)
 if not prepared: raise ValueError('No complete verified 700 hPa frames')
 meta=dict(format_version=VERSION,domain=cfg['domain'],reference_time=iso(run),completed=prepared==set(expected),
  variables=cfg.get('fields',FIELDS),units=cfg.get('output_units',UNITS),grid=cfg['grid'],valid_times=[iso(run+timedelta(hours=h)) for h in sorted(prepared)],
  expected_forecast_hours=expected[-1],generated_at=iso(datetime.now(timezone.utc)),source=cfg['source'],source_url=cfg['source_url'],
  method=cfg.get('method','Native-resolution regional subset; omega in 0.1 Pa/s, geopotential height in metres, earth-relative wind components in m/s.'),
  precision={'omega_Pa_s':.01,'height_m':1,'wind_m_s':.1})
 write_json(meta_path,meta)
 print(f'{model} {iso(run)}: {len(prepared)}/{len(expected)} complete frames published',flush=True)
 return meta

def primary_run(model):
 metas=[]
 for filename in ('latest.json','in-progress.json'):
  try:
   meta=json.loads(fetch('https://openmeteo.s3.amazonaws.com/data_spatial/'+CONFIG[model]['upstream']+'/'+filename))
   if meta.get('valid_times'): metas.append(datetime.fromisoformat(meta['reference_time']))
  except (requests.RequestException,ValueError,KeyError): pass
 if not metas: raise ValueError('Cannot verify the model run used by the map')
 return max(metas)

def build_model(model,root,workers=4,run=None,hours=None):
 cfg=CONFIG[model];domain_root=root/cfg['domain'];latest_path=domain_root/'latest.json'
 previous=read_meta(latest_path,model)
 try: reference=run or primary_run(model)
 except Exception:
  if previous:
   print(f'::warning::{model}: model source unavailable; retaining {previous["reference_time"]}',flush=True);return previous
  raise
 retained=[]
 for offset in range(1 if hours is not None else 3):
  target=reference-timedelta(hours=offset*cfg['cycle'])
  try: retained.append(build_run(model,root,target,workers,hours))
  except Exception as error: print(f'::warning::{model} {iso(target)} unavailable: {error}',flush=True)
 if previous and all(meta['reference_time']!=previous['reference_time'] for meta in retained) and (len(retained)<3 or previous['reference_time']>max(m['reference_time'] for m in retained)):
  retained.append(previous)
 if not retained: raise ValueError(f'{model}: no verified direct data available')
 retained.sort(key=lambda m:m['reference_time'],reverse=True);latest=retained[0]
 write_json(latest_path,latest)
 write_json(domain_root/'history.json',dict(format_version=VERSION,runs=[m['reference_time'] for m in retained]))
 # Preserve all attempted runs plus a previous fallback when the new run failed.
 keep={frame_path(root,cfg['domain'],datetime.fromisoformat(m['reference_time']),0).parent for m in retained}
 from run_retention import last_complete_folder
 protected=last_complete_folder(domain_root,latest['reference_time'])
 if protected:
  if protected not in keep:
   keep={frame_path(root,cfg['domain'],datetime.fromisoformat(meta['reference_time']),0).parent for meta in retained[:2]}|{protected}
   retained=[meta for meta in retained if frame_path(root,cfg['domain'],datetime.fromisoformat(meta['reference_time']),0).parent in keep]
  if all(meta['reference_time']!=json.loads((protected/'meta.json').read_text())['reference_time'] for meta in retained):
   retained.append(json.loads((protected/'meta.json').read_text()))
   write_json(domain_root/'history.json',dict(format_version=VERSION,runs=[m['reference_time'] for m in retained]))
 for folder in domain_root.glob('*/*/*/*Z'):
  if folder not in keep:
   if not folder.resolve().is_relative_to(domain_root.resolve()): raise ValueError('Refusing cleanup outside generated data')
   shutil.rmtree(folder)
 return latest

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--model',choices=CONFIG,required=True)
 parser.add_argument('--output',type=Path,default=Path('ensemble-data'));parser.add_argument('--workers',type=int,default=4)
 parser.add_argument('--run',help='Exact UTC initialization, for reproducible validation');parser.add_argument('--hours',help='Validation only: comma-separated hours in a scratch directory')
 args=parser.parse_args()
 if not 1<=args.workers<=8: parser.error('workers must be between 1 and 8')
 run=datetime.fromisoformat(args.run).astimezone(timezone.utc) if args.run else None
 build_model(args.model,args.output,args.workers,run,[int(h) for h in args.hours.split(',')] if args.hours else None)

if __name__=='__main__': main()
