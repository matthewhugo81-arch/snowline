"""Exact-run shower guidance; UKV texture estimate is experimental, not native weather type.

No rainfall amounts are partitioned using instantaneous diagnostics. Symbols retain
the original interval total and phase. Flags: 0 missing, 1 unseparated, 2 shower.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import urllib.request
from itertools import groupby
import numpy as np
from netCDF4 import Dataset
from pyproj import CRS, Transformer
from scipy.ndimage import uniform_filter

BASE='https://met-office-atmospheric-model-data.s3-eu-west-2.amazonaws.com/'
DOMAINS={'global':'ukmo_global_deterministic_10km','ukv':'ukmo_uk_deterministic_2km'}
MODELS={'global':'global-deterministic-10km','ukv':'uk-deterministic-2km'}
GRID=dict(lonMin=-25,latMin=44,dx=.05,dy=.05,nx=901,ny=541)

def iso(t):return t.strftime('%Y-%m-%dT%H:%M:00Z')

def read(model,run,hour,name,cache):
 valid=run+timedelta(hours=hour)
 key=f'{MODELS[model]}/{run:%Y%m%dT%H%MZ}/{valid:%Y%m%dT%H%MZ}-PT{hour:04d}H00M-{name}.nc'
 path=Path(cache)/key
 if not path.exists():
  path.parent.mkdir(parents=True,exist_ok=True)
  with urllib.request.urlopen(BASE+key,timeout=90) as r:payload=r.read()
  tmp=path.with_suffix('.tmp');tmp.write_bytes(payload);tmp.replace(path)
 with Dataset(path) as ds:
  if float(ds['forecast_reference_time'][...])!=run.timestamp() or float(ds['time'][...])!=valid.timestamp():raise ValueError('Source time mismatch')
  candidates=[v for v in ds.variables.values() if getattr(v,'grid_mapping',None)]
  if len(candidates)!=1:raise ValueError('Ambiguous source field')
  v=candidates[0];a=np.asarray(np.ma.filled(v[:],np.nan),dtype=np.float32)
  if name.endswith('PT01H'):
   bounds=np.asarray(ds['time_bnds'][:]);
   if bounds[-1]-bounds[0]!=3600:raise ValueError('Expected hourly amount')
  if v.units=='m s-1':a*=3600000
  elif v.units=='m':a*=1000
  elif v.units not in ('J kg-1','K','Pa'):raise ValueError('Unsupported source units: '+v.units)
  mapping=ds[v.grid_mapping].__dict__
  if model=='global':x=np.asarray(ds['longitude'][:]);y=np.asarray(ds['latitude'][:])
  else:x=np.asarray(ds['projection_x_coordinate'][:]);y=np.asarray(ds['projection_y_coordinate'][:])
  levels=None
  if a.ndim==3:
   level_var=ds[v.dimensions[0]];levels=np.asarray(level_var[:])/(100 if level_var.units=='Pa' else 1);a=a[np.argmin(abs(levels-850))]
   if min(abs(levels-850))>1:raise ValueError('850 hPa unavailable')
  return dict(values=a,x=x,y=y,mapping=mapping,units=v.units)

def same(*fields):
 first=fields[0]
 if any(not np.array_equal(first[k],f[k]) for f in fields[1:] for k in ('x','y')):raise ValueError('Input grids differ')

def global_flags(total,rain,snow):
 valid=np.isfinite(total)&np.isfinite(rain)&np.isfinite(snow)&(total>=0)&(rain>=0)&(snow>=0)
 conv=rain+snow
 # Dominant convective rate at valid time. It is not an interval fraction.
 shower=valid&(total>=.1)&(conv>=.1)&(conv>=.5*total)&(conv<=total+np.maximum(.05,total*.05))
 return np.where(valid,np.where(shower,2,1),0).astype('u1')

def ukv_flags(precip,cape,hail):
 valid=np.isfinite(precip)&np.isfinite(cape)&np.isfinite(hail)&(precip>=0)&(cape>=0)&(hail>=0)
 # 30-km neighbourhood on 2-km grid: require both instability and broken/
 # cellular rain structure. Thresholds are provisional, not Met Office rules.
 p=np.where(valid,precip,0)
 coverage=uniform_filter((p>=.1).astype(float),size=15,mode='constant')
 mean=uniform_filter(p,size=15,mode='constant')
 variance=np.maximum(0,uniform_filter(p*p,size=15,mode='constant')-mean*mean)
 cv=np.sqrt(variance)/np.maximum(mean,.05)
 complete=uniform_filter(valid.astype(float),size=15,mode='constant')>.999
 shower=valid&(p>=.1)&((hail>=.01)|(complete&(cape>=30)&(coverage<.8)&(cv>=.5)))
 return np.where(valid,np.where(shower,2,1),0).astype('u1')

def sample(field,values=None):
 g=GRID;lon,lat=np.meshgrid(g['lonMin']+np.arange(g['nx'])*g['dx'],g['latMin']+np.arange(g['ny'])*g['dy'])
 if field['mapping']['grid_mapping_name']=='latitude_longitude':
  xx=lon%360 if field['x'].min()>=0 else lon;yy=lat
 else:
  xx,yy=Transformer.from_crs('EPSG:4326',CRS.from_cf(field['mapping']),always_xy=True).transform(lon,lat)
 x,y=field['x'],field['y'];ix=np.rint((xx-x[0])/(x[1]-x[0])).astype(int);iy=np.rint((yy-y[0])/(y[1]-y[0])).astype(int)
 inside=(ix>=0)&(ix<len(x))&(iy>=0)&(iy<len(y))
 a=field['values'] if values is None else values
 result=np.full(ix.shape,np.nan);result[inside]=a[iy[inside],ix[inside]]
 return result

def build(model,run,hour,cache,output):
 if hour<1:raise ValueError('No preceding forecast interval at initialization')
 if model=='global':
  fields=[read(model,run,hour,k,cache) for k in ('precipitation_rate','rainfall_rate_from_convection','snowfall_rate_from_convection')]
  same(*fields);flag=global_flags(*(f['values'] for f in fields));method='native-rate'
 else:
  fields=[read(model,run,hour,k,cache) for k in ('precipitation_accumulation-PT01H','CAPE_surface','hail_fall_accumulation-PT01H')]
  same(*fields);flag=ukv_flags(*(f['values'] for f in fields));method='estimated-texture'
 flags=np.nan_to_num(sample(fields[0],flag)).astype('u1')
 valid=run+timedelta(hours=hour)
 doc=dict(version=1,domain=DOMAINS[model],reference_time=iso(run),valid_time=iso(valid),method=method,grid=GRID,
  flags_rle=[[int(value),sum(1 for _ in items)] for value,items in groupby(flags.ravel())],source=BASE+MODELS[model],attribution='British Crown copyright, Met Office, CC BY-SA 4.0')
 path=Path(output)/DOMAINS[model]/run.strftime('%Y/%m/%d/%H%MZ')/(valid.strftime('%Y-%m-%dT%H%M')+'.json')
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(doc,separators=(',',':')));tmp.replace(path)
 print(model,iso(run),iso(valid),'shower cells',int((flags==2).sum()))
 return doc

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--model',choices=DOMAINS,required=True);p.add_argument('--run',required=True);p.add_argument('--hours',required=True);p.add_argument('--cache',default='work/shower-cache');p.add_argument('--output',default='shower-data');a=p.parse_args()
 run=datetime.fromisoformat(a.run.replace('Z','+00:00'))
 if run.tzinfo is None or run.minute or run.second:raise ValueError('Explicit UTC whole-hour run required')
 for hour in map(int,a.hours.split(',')):build(a.model,run,hour,a.cache,a.output)
