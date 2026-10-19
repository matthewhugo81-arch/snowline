"""Additional ensemble maps on native cells covering every Snowline map preset.

GEFS: official 30-member statistics. ECMWF: official upper-air statistics and
24-hour probabilities, plus surface means of all 50 perturbed members + CTRL.
Since IFS 50r1 CTRL is oper/fc (ECMWF's documented replacement for enfo/cf).
Never mix cycles, average probabilities, or difference marginal variances.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import shutil
import threading
import numpy as np
from omfiles import OmFileWriter
import build_ensembles as core

VERSION = 2
BOUNDS = (-66, 31, 36, 74)  # All four map presets, with a margin; no regridding.
DOMAINS = {m: f'snowline_{m}_extra_v2' for m in core.MODELS}
THRESHOLDS = (1, 5, 10, 20, 25, 50, 100)
# key: NOAA parameter/level, ECMWF parameter/level, GRIB identities, units
UPPER = {
 'geopotential_height_300hPa': ('HGT', '300 mb', 'gh', '300', ('gh',), ('gpm','m')),
 'geopotential_height_1000hPa': ('HGT', '1000 mb', 'gh', '1000', ('gh',), ('gpm','m')),
 'temperature_500hPa': ('TMP', '500 mb', 't', '500', ('t',), ('K',)),
 'temperature_250hPa': ('TMP', '250 mb', 't', '250', ('t',), ('K',)),
}
GEFS = {
 'temperature_2m_mean': ('TMP','2 m above ground',('2t',),('K',),'heightAboveGround',2),
 'relative_humidity_2m_mean': ('RH','2 m above ground',('2r',),('%',),'heightAboveGround',2),
 'wind_u_10m': ('UGRD','10 m above ground',('10u',),('m s**-1',),'heightAboveGround',10),
 'wind_v_10m': ('VGRD','10 m above ground',('10v',),('m s**-1',),'heightAboveGround',10),
 'snow_depth_mean': ('SNOD','surface',('sde',),('m',),'surface',0),
 'cape_mean': ('CAPE','180-0 mb above ground',('cape',),('J kg**-1',),'pressureFromGroundLayer',18000),
 'cloud_cover_mean': ('TCDC','entire atmosphere',('tcc',),('%',),'atmosphere',0),
 'precipitation_mean': ('APCP','surface',('tp',),('kg m**-2',),'surface',0),
}
EC_SURFACE = {
 'temperature_2m_mean': ('2t',('2t',),('K',),'heightAboveGround',2),
 'dew_point_2m_mean': ('2d',('2d',),('K',),'heightAboveGround',2),
 'wind_u_10m': ('10u',('10u',),('m s**-1',),'heightAboveGround',10),
 'wind_v_10m': ('10v',('10v',),('m s**-1',),'heightAboveGround',10),
 'wind_gusts_10m_mean': ('10fg',('10fg','10fg3','10fg6'),('m s**-1',),'heightAboveGround',10),
 'cloud_cover_mean': ('tcc',('tcc',),('(0 - 1)',),'entireAtmosphere',0),
 'precipitation_mean': ('tp',('tp',),('m',),'surface',0),
 'snowfall_water_equivalent_mean': ('sf',('sf',),('m of water equivalent',),'surface',0),
}
AMOUNTS = ('precipitation_mean', 'snowfall_water_equivalent_mean')
_locks = {}
_locks_guard = threading.Lock()


def atomic_json(path, value):
 path.parent.mkdir(parents=True, exist_ok=True)
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8');tmp.replace(path)


def crop(values, step, first_lon):
 ny,nx=int(180/step)+1,int(360/step)
 grid=np.roll(values.reshape(ny,nx)[::-1],int(round((first_lon+180)%360/step)),axis=1)
 west,south,east,north=BOUNDS
 return np.ascontiguousarray(grid[int((south+90)/step):int((north+90)/step)+1,
                                int((west+180)/step):int((east+180)/step)+1])


def decode(raw, source, hour, names, units, level_type, level, *, stat=None, member=None, probability=None):
 """Validate identity, cycle, statistic, interval and native geometry before use."""
 if not raw.startswith(b'GRIB') or not raw.endswith(b'7777') or int.from_bytes(raw[8:16],'big')!=len(raw):
  raise ValueError('Incomplete GRIB message')
 with core._grib_lock:
  g=core.ec.codes_new_from_message(raw)
  try:
   get=lambda k:core.ec.codes_get(g,k)
   if get('shortName') not in names or get('units') not in units or get('typeOfLevel')!=level_type or get('level')!=level:
    raise ValueError('Unexpected parameter, units or level')
   if get('dataDate')!=int(source.run.strftime('%Y%m%d')) or get('dataTime')!=source.run.hour*100 or get('endStep')!=hour or get('stepUnits')!=1:
    raise ValueError('Wrong initialization, valid time or step units')
   template=get('productDefinitionTemplateNumber')
   if stat and (template not in (2,12) or get('derivedForecast')!=(0 if stat=='mean' else 2) or get('numberOfForecastsInEnsemble')!=(30 if source.model=='gefs' else 51)):
    raise ValueError('Wrong ensemble statistic or member count')
   if member is not None:
    if member==0:
     if source.run<datetime(2026,5,12,tzinfo=timezone.utc) or template not in (0,8):raise ValueError('Invalid IFS CTRL product')
    elif template not in (1,11) or get('perturbationNumber')!=member or get('numberOfForecastsInEnsemble')!=51:
     raise ValueError('Incorrect perturbed member')
   start=int(get('startStep'));end=int(get('endStep'));kind=get('stepType')
   if probability is not None:
    if template!=9 or kind!='accum' or end-start!=24 or get('probabilityType')!=3:
     raise ValueError('Not a 24-hour exceedance probability')
    threshold=get('scaledValueOfLowerLimit')*10.0**-get('scaleFactorOfLowerLimit')
    if abs(threshold-probability)>1e-9:raise ValueError('Wrong probability threshold')
   step=source.config['step']
   if get('Ni')!=int(360/step) or get('Nj')!=int(180/step)+1 or get('jPointsAreConsecutive') or get('alternativeRowScanning') or get('iScansNegatively') or get('jScansPositively') or get('latitudeOfFirstGridPointInDegrees')!=90:
    raise ValueError('Wrong grid or scanning direction')
   if abs(get('iDirectionIncrementInDegrees')-step)>1e-6 or abs(get('jDirectionIncrementInDegrees')-step)>1e-6:raise ValueError('Wrong native grid spacing')
   a=core.ec.codes_get_values(g)
   if get('bitmapPresent'):a[a==get('missingValue')]=np.nan
   a=crop(a,step,get('longitudeOfFirstGridPointInDegrees'))
   if probability is not None and (np.nanmin(a)<0 or np.nanmax(a)>100):raise ValueError('Probability outside 0–100%')
   if stat=='spread' and np.nanmin(a)<0:raise ValueError('Negative standard deviation')
   return a, (start,end,kind)
  finally:core.ec.codes_release(g)


def mean_complete(arrays, count):
 if len(arrays)!=count:raise ValueError('Incomplete member set')
 # NaN propagates: never quietly shrink the ensemble denominator in a cell.
 total=np.zeros_like(arrays[0],dtype=np.float64)
 for a in arrays:total+=a
 return total/count


def cached_crop(array, bounds, step):
 """Reuse already verified member means when narrowing the publication area."""
 west,south,east,north=bounds
 expected=(int(round((north-south)/step))+1,int(round((east-west)/step))+1)
 if array.shape!=expected or west>BOUNDS[0] or south>BOUNDS[1] or east<BOUNDS[2] or north<BOUNDS[3]:
  raise ValueError('Cached member grid does not cover the map presets')
 return np.ascontiguousarray(array[int(round((BOUNDS[1]-south)/step)):int(round((BOUNDS[3]-south)/step))+1,
                                   int(round((BOUNDS[0]-west)/step)):int(round((BOUNDS[2]-west)/step))+1])


def interval_amount(current, previous, start, end, previous_end):
 if not 0<=start<=previous_end<end:raise ValueError('Invalid accumulation bounds')
 if start==previous_end:return np.maximum(current,0)
 if previous is None:raise ValueError('Missing preceding accumulation')
 result=current-previous
 if np.nanmin(result)<-.05:raise ValueError('Accumulation decreased within the same period')
 return np.maximum(result,0)


def indexed(url):
 text=core.fetch(url.replace('.grib2','.index')).decode()
 return [json.loads(line) for line in text.splitlines() if line]


def one(rows, **match):
 found=[r for r in rows if all(str(r.get(k,''))==str(v) for k,v in match.items())]
 if len(found)!=1:raise ValueError(f'Expected one index entry: {match}, got {len(found)}')
 return found[0]


def message(url,row):return core.fetch(url,int(row['_offset']),int(row['_length']))


def gefs_index(source,hour,stat):
 url=source.url(hour,stat)
 rows=[r.split(':') for r in core.fetch(url+'.idx').decode().splitlines()]
 result={}
 for i,r in enumerate(rows):
  if ('ens mean' if stat=='mean' else 'ens std dev') not in ':'.join(r[6:]):raise ValueError('Wrong NOAA statistic')
  key=(r[3],r[4])
  if key in result:raise ValueError('Duplicate NOAA index entry')
  result[key]=(int(r[1]),int(rows[i+1][1])-int(r[1]) if i+1<len(rows) else None)
 return url,result


def official_fields(source,hour):
 values={};periods={}
 if source.model=='gefs':
  for stat in ('mean','spread'):
   url,rows=gefs_index(source,hour,stat)
   for key,(param,level,_,ec_level,names,units) in UPPER.items():
    a,_=decode(core.fetch(url,*rows[param,level]),source,hour,names,units,'isobaricInhPa',int(ec_level),stat=stat)
    values[key+'_'+stat]=a-273.15 if key.startswith('temperature') and stat=='mean' else a
   if stat!='mean':continue
   for key,(param,level,names,units,levtype,lev) in GEFS.items():
    if key in ('precipitation_mean','cloud_cover_mean') and hour==0:continue
    a,bounds=decode(core.fetch(url,*rows[param,level]),source,hour,names,units,levtype,lev,stat='mean')
    if key=='temperature_2m_mean':a-=273.15
    if key=='snow_depth_mean':a*=100  # m -> cm; water-equivalent snow is a different field.
    values[key]=a
    if bounds[0]!=bounds[1]:periods[key]=list(bounds[:2])
   values['wind_vector_10m_mean']=np.hypot(values.pop('wind_u_10m'),values.pop('wind_v_10m'))
  # Keep GEFS's actual 3/6-hour reporting windows, including overlapping ones.
  # No totals are built by adding these overlapping precipitation fields.
  if hour:
   start,end=periods['precipitation_mean']
   if end<=start:raise ValueError('Missing GEFS precipitation period')
   values['precipitation_mean']/=end-start
 else:
  rows=source.indexes[240 if hour<=240 else 360];url=source.url(hour,'mean')
  for stat in ('mean','spread'):
   definitions={**UPPER,**{f'wind_speed_{level}hPa':('','', 'ws',str(level),('ws',),('m s**-1',)) for level in (250,850)}}
   for key,(_,_,param,level,names,units) in definitions.items():
    row=one(rows,type='em' if stat=='mean' else 'es',step=hour,param=param,levtype='pl',levelist=level)
    a,_=decode(message(url,row),source,hour,names,units,'isobaricInhPa',int(level),stat=stat)
    values[key+'_'+stat]=a-273.15 if key.startswith('temperature') and stat=='mean' else a
  if hour>=24 and hour%12==0:
   for threshold in THRESHOLDS:
    row=one(rows,type='ep',step=f'{hour-24}-{hour}',param=f'tpg{threshold}',levtype='sfc')
    a,bounds=decode(message(url,row),source,hour,(f'tpg{threshold}',),('%',),'surface',0,probability=threshold)
    key=f'precipitation_probability_{threshold}mm_24h';values[key]=a;periods[key]=list(bounds[:2])
 return values,periods


def surface_urls(source,hour):
 date=source.run.strftime('%Y%m%d');cycle=source.run.strftime('%H');stamp=date+cycle+'0000'
 # Use the official replica for member traffic; maintain index/binary pairing.
 base='https://storage.googleapis.com/ecmwf-open-data'
 return [(f'{base}/{date}/{cycle}z/ifs/0p25/{stream}/{stamp}-{hour}h-{stream}-{product}.grib2',control)
         for stream,product,control in [('enfo','ef',False),('oper','fc',True)]]


def surface_raw(source,hour,cache,pool):
 path=cache/f'{hour:03d}.npz'
 with _locks_guard:lock=_locks.setdefault(str(path),threading.Lock())
 with lock:
  if path.exists():
   with np.load(path,allow_pickle=False) as saved:
    bounds=saved['_bounds'] if '_bounds' in saved.files else (-80,20,45,80)
    return {k:cached_crop(saved[k],bounds,source.config['step']) for k in saved.files if not k.startswith('_')},json.loads(str(saved['_periods']))
  jobs=[]
  for url,control in surface_urls(source,hour):
   rows=indexed(url)
   for key,(param,names,units,levtype,lev) in EC_SURFACE.items():
    if hour==0 and (key in AMOUNTS or key=='wind_gusts_10m_mean'):continue
    for member in ([0] if control else range(1,51)):
     matches={'type':'fc' if control else 'pf','param':param,'step':str(hour)}
     if not control:matches['number']=str(member)
     # Source switches between 1/3/6-hour maxima; validate and retain its bounds.
     if param=='10fg':
      candidates=[r for r in rows if r.get('param') in names and all(str(r.get(k,''))==str(v) for k,v in matches.items() if k!='param')]
      if len(candidates)!=1:raise ValueError('Missing or duplicate gust member')
      row=candidates[0]
     else:row=one(rows,**matches)
     jobs.append((key,member,url,row,names,units,levtype,lev))
  arrays={};periods={};seen={};uv={};wind_sum=None;wind_seen=set()
  def read(job):
   key,member,url,row,names,units,levtype,lev=job
   return key,member,decode(message(url,row),source,hour,names,units,levtype,lev,member=member)
  pending=[pool.submit(read,job) for job in jobs]
  try:
   for future in as_completed(pending):
    key,member,(a,bounds)=future.result()
    if key in periods and periods[key]!=list(bounds):raise ValueError('Member reporting periods differ')
    periods[key]=list(bounds);seen.setdefault(key,set())
    if member in seen[key]:raise ValueError('Duplicate member')
    seen[key].add(member)
    if key in ('wind_u_10m','wind_v_10m'):
     uv.setdefault(member,{})[key]=a
     if len(uv[member])==2:
      pair=uv.pop(member);speed=np.hypot(pair['wind_u_10m'],pair['wind_v_10m'])
      wind_sum=speed if wind_sum is None else wind_sum+speed;wind_seen.add(member)
    else:arrays[key]=a if key not in arrays else arrays[key]+a
  except Exception:
   for future in pending:future.cancel()
   raise
  if any(members!=set(range(51)) for members in seen.values()) or wind_seen!=set(range(51)):
   raise ValueError('Incomplete 51-member mean')
  arrays={key:a/51 for key,a in arrays.items()};arrays['wind_speed_10m_mean']=wind_sum/51
  periods['wind_speed_10m_mean']=periods.pop('wind_u_10m');periods.pop('wind_v_10m')
  for key in ('temperature_2m_mean','dew_point_2m_mean'):arrays[key]-=273.15
  arrays['cloud_cover_mean']*=100
  for key in AMOUNTS:
   if key in arrays:
    if periods[key]!=[0,hour,'accum']:raise ValueError('Expected ECMWF cumulative precipitation from initialization')
    arrays[key]*=1000
  cache.mkdir(parents=True,exist_ok=True)
  tmp=path.with_suffix('.tmp.npz');np.savez_compressed(tmp,**{k:a.astype(np.float32) for k,a in arrays.items()},_periods=json.dumps(periods),_bounds=BOUNDS);tmp.replace(path)
  return arrays,periods


def surface_fields(source,hour,cache,pool):
 values,periods=surface_raw(source,hour,cache,pool)
 values={k:a.copy() for k,a in values.items()}
 previous_end=hour-(3 if hour<=144 else 6)
 if hour:
  prev,_=surface_raw(source,previous_end,cache,pool) if previous_end else ({}, {})
  for key in AMOUNTS:
   values[key]=interval_amount(values[key],prev.get(key),0,hour,previous_end)/(hour-previous_end)
   periods[key]=[previous_end,hour,'accum']
 return values,{key:bounds[:2] for key,bounds in periods.items() if bounds[0]!=bounds[1]}


def write_frame(path,values):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp')
 writer=OmFileWriter(str(tmp));children=[]
 for key,array in values.items():
  precision=100 if key in AMOUNTS or key.endswith('_spread') else 10
  children.append(writer.write_array(array.astype(np.float32),chunks=[10,120],scale_factor=precision,
                                     add_offset=0,compression='pfor_delta_2d',name=key))
 writer.close(writer.write_group(name='root',children=children));tmp.replace(path)


def build_run(model,root,reference,workers=12,max_surface_frames=128,hours=None):
 run=datetime.fromisoformat(reference);source=core.Source(model,run)
 # Source metadata is the authority for the run and published forecast hours.
 parent=core.frame_path(root,core.MODELS[model]['domain'],run,0).parent
 primary=json.loads((parent/'meta.json').read_text())
 if primary['reference_time']!=reference:raise ValueError('Primary run mismatch')
 available=[int((datetime.fromisoformat(t)-run).total_seconds()/3600) for t in primary['valid_times']]
 if hours is not None:available=[h for h in available if h in hours]
 output=core.frame_path(root,DOMAINS[model],run,0).parent;output.mkdir(parents=True,exist_ok=True)
 cache=root/'_extra_cache'/model/run.strftime('%Y%m%d%H')
 errors=[];surface_done=0
 # Keep each frame resumable. Metadata lists only verified on-disk variables.
 with ThreadPoolExecutor(max_workers=workers) as pool:
  for hour in available:
   path=core.frame_path(root,DOMAINS[model],run,hour);record=path.with_suffix('.json')
   old=json.loads(record.read_text()) if path.exists() and record.exists() else {}
   if old.get('version')==VERSION and (model=='gefs' or old.get('surface_complete')):continue
   try:
    values,periods=official_fields(source,hour)
    complete=model=='gefs'
    if model=='ecmwf' and surface_done<max_surface_frames:
     try:
      surface,intervals=surface_fields(source,hour,cache,pool);values.update(surface);periods.update(intervals);complete=True;surface_done+=1
     except Exception as error:errors.append(f'T+{hour} surface: {error}')
    if old.get('version')==VERSION and old.get('surface_complete') and not complete:continue
    write_frame(path,values)
    atomic_json(record,dict(version=VERSION,variables=list(values),periods=periods,surface_complete=complete))
    if hour%24==0:print(f'{model} extra: T+{hour} verified ({len(values)} fields)',flush=True)
   except Exception as error:errors.append(f'T+{hour}: {error}')
 records=[]
 for hour in available:
  path=core.frame_path(root,DOMAINS[model],run,hour);record=path.with_suffix('.json')
  if path.exists() and record.exists():
   saved=json.loads(record.read_text())
   if saved.get('version')==VERSION:records.append((hour,saved))
 if not records:raise ValueError('No additional ensemble fields verified: '+str(errors[:2]))
 times={};intervals={}
 for hour,record in records:
  time=core.iso(run+timedelta(hours=hour))
  for key in record['variables']:
   times.setdefault(key,[]).append(time)
   if key in record['periods']:
    start,end=record['periods'][key]
    intervals.setdefault(key,{})[time]={'start':core.iso(run+timedelta(hours=start)),'end':time,'hours':end-start}
 meta=dict(format_version=VERSION,domain=DOMAINS[model],reference_time=reference,
           completed=len(records)==len(core.MODELS[model]['hours']) and all(r['surface_complete'] for _,r in records),
           valid_times=[core.iso(run+timedelta(hours=h)) for h,_ in records],variables=sorted(times),
           variable_valid_times=times,variable_intervals=intervals,coverage=list(BOUNDS),grid_resolution=source.config['step'],
           member_count=30 if model=='gefs' else 51,generated_at=core.iso(datetime.now(timezone.utc)),
           source='NOAA GEFS official statistics' if model=='gefs' else 'ECMWF IFS ENS: official statistics/probabilities; surface means of 50 perturbed members plus CTRL')
 atomic_json(output/'meta.json',meta)
 if errors:print(f'::warning::{model} extra: {len(errors)} items await retry; {errors[0]}',flush=True)
 return meta


def main():
 parser=argparse.ArgumentParser();parser.add_argument('--model',choices=list(DOMAINS),required=True)
 parser.add_argument('--output',type=Path,default=Path('ensemble-data'));parser.add_argument('--workers',type=int,default=12)
 parser.add_argument('--max-surface-frames',type=int,default=128);parser.add_argument('--hours',help='Validation only, use scratch output')
 args=parser.parse_args();domain=core.MODELS[args.model]['domain']
 latest=json.loads((args.output/domain/'latest.json').read_text())
 hours=[int(h) for h in args.hours.split(',')] if args.hours else None
 meta=build_run(args.model,args.output,latest['reference_time'],args.workers,args.max_surface_frames,hours)
 atomic_json(args.output/DOMAINS[args.model]/'latest.json',meta)
 if hours is not None:return
 # Additional fields are latest-run only so the full-resolution primary
 # three-run archive continues to fit within the existing hosting allowance.
 keep={datetime.fromisoformat(latest['reference_time']).strftime('%Y%m%d%H')}
 for path in (args.output/'_extra_cache'/args.model).glob('*'):
  if path.is_dir() and path.name not in keep:shutil.rmtree(path)
 for path in (args.output/DOMAINS[args.model]).glob('*/*/*/*Z'):
  if path.is_dir() and ''.join(path.parts[-4:]).replace('00Z','') not in keep:shutil.rmtree(path)
 # The first rollout used wider grids. Never reuse their URLs or retain their
 # generated payload in the publisher cache after the versioned feed succeeds.
 legacy=args.output/f'snowline_{args.model}_extra'
 if legacy.is_dir():
  if not legacy.resolve().is_relative_to(args.output.resolve()):raise ValueError('Refusing cleanup outside generated data')
  shutil.rmtree(legacy)


if __name__=='__main__':main()
