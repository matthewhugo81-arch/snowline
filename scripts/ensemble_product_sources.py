"""Strict native member adapters for optional ensemble products."""
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
import json
import threading
import numpy as np
from netCDF4 import Dataset
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_HTTP = requests.Session()
_HTTP.mount('https://', HTTPAdapter(max_retries=Retry(total=3,backoff_factor=1,status_forcelist=[429,500,502,503,504])))
_HTTP.headers['User-Agent']='Snowline-ensemble-products/1.0'


def fetch(url):
    response=_HTTP.get(url,timeout=90)
    response.raise_for_status()
    return response.content
from ensemble_products import complete_window, nonnegative_difference, lagged_cycles

LOCK = threading.Lock()
# Compact UK and near-Europe cutout; no forecast interpolation.
BOUNDS = (-16, 46, 10, 63)


class GlobalGRIB:
    def __init__(self, model, run, cache):
        # Keep the GRIB libraries out of NetCDF/projection-only model jobs.
        global core, extra
        import build_ensembles as core
        import build_ensemble_extras as extra
        self.model, self.run, self.cache = model, run, Path(cache)
        self.count = 51 if model == 'ecmwf' else 31
        self.source = SimpleNamespace(model=model, run=run, config=core.MODELS[model])
        self.indexes = {}
        self.errors = {}

    def read(self, hour, kind):
        path = self.cache / self.model / self.run.strftime('%Y%m%d%H') / f'{kind}-{hour:03d}.npz'
        if path.exists():
            with np.load(path, allow_pickle=False) as z:
                if 'packing_error' in z.files:
                    self.errors[(hour,kind)]=float(z['packing_error'])
                    return z['values'], (int(z['bounds'][0]),int(z['bounds'][1]),str(z['bounds'][2]))
        # No accumulating field exists at initialization: exact zero is defined.
        if hour == 0 and kind in ('precip', 'snow') and self.model == 'ecmwf':
            self.errors[(hour,kind)]=0
            return np.zeros((self.count, 69, 105), np.float32), (0, 0, 'accum')
        arrays, bounds, packing_error = [], None, 0
        payloads=None
        if self.model=='ecmwf' and kind in ('min','max'):
            rows=[self.record(hour,kind,member) for member in range(self.count)]
            with ThreadPoolExecutor(max_workers=4) as pool:
                payloads=list(pool.map(lambda item:extra.message(*item),rows))
        for member in range(self.count):
            if payloads is None:
                url, row = self.record(hour, kind, member)
                payload = extra.message(url, row)
            else:payload=payloads[member]
            with core._grib_lock:
                g = core.ec.codes_new_from_message(payload)
                try:
                    def get(key):
                        try:return core.ec.codes_get(g,key)
                        except Exception as error:raise ValueError(f'Missing GRIB key {key}: {error}') from error
                    if get('dataDate') != int(self.run.strftime('%Y%m%d')) or get('dataTime') != self.run.hour * 100 or get('endStep') != hour or get('stepUnits') != 1:
                        raise ValueError('Wrong member cycle or valid time')
                    template = get('productDefinitionTemplateNumber')
                    if self.model == 'ecmwf' and member == 0:
                        if template not in (0, 8): raise ValueError('Expected IFS control')
                    elif template not in (1, 11) or get('perturbationNumber') != member:
                        raise ValueError('Wrong ensemble member')
                    identities = {'gust': (('10fg', '10fg3', '10fg6', 'gust'), ('m s**-1',)), 'precip': (('tp',), ('m', 'kg m**-2')), 'snow': (('sf',), ('m of water equivalent',)), 'rain_occurrence': (('crain',), ('(Code table 4.222)', 'Numeric', '(0 - 1)')), 'snow_occurrence': (('csnow',), ('(Code table 4.222)', 'Numeric', '(0 - 1)'))}
                    identities.update({'min':(('mn2t3','mn2t6','mn2t'),('K',)), 'max':(('mx2t3','mx2t6','mx2t'),('K',))})
                    names, units = identities[kind]
                    if get('shortName') not in names or get('units') not in units:
                        raise ValueError(f'Wrong native field/units: {get("shortName")} {get("units")}')
                    if kind in ('min','max') and (get('typeOfLevel')!='heightAboveGround' or get('level')!=2):
                        raise ValueError('Expected 2 metre temperature extrema')
                    period = (int(get('startStep')), hour, get('stepType'))
                    if bounds is not None and bounds != period: raise ValueError('Member periods differ')
                    bounds = period
                    step = self.source.config['step']
                    if get('Ni') != int(360 / step) or get('Nj') != int(180 / step) + 1 or get('latitudeOfFirstGridPointInDegrees') != 90 or get('jScansPositively') or get('iScansNegatively') or get('jPointsAreConsecutive') or get('alternativeRowScanning'):
                        raise ValueError('Unexpected global geometry')
                    a = core.ec.codes_get_values(g)
                    if get('bitmapPresent'): a[a == get('missingValue')] = np.nan
                    # Match the existing verified global crop, then subset.
                    a = extra.crop(a, step, get('longitudeOfFirstGridPointInDegrees'))
                    west, south, _, _ = extra.BOUNDS
                    a = a[int((46-south)/step):int((63-south)/step)+1, int((-16-west)/step):int((10-west)/step)+1]
                    factor=1000 if kind in ('snow','precip') and get('units').startswith('m') else 1
                    a*=factor
                    if kind in ('min','max'):a-=273.15
                    # Only cumulative IFS differences need a packing-error bound.
                    # GEFS complex packing does not expose this optional key.
                    if self.model=='ecmwf' and kind in ('precip','snow'):
                        packing_error=max(packing_error,float(get('packingError'))*factor)
                    arrays.append(a.astype(np.float32))
                finally:
                    core.ec.codes_release(g)
        values = np.stack(arrays)
        self.errors[(hour,kind)]=packing_error
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.tmp.npz'); np.savez_compressed(tmp, values=values, bounds=np.array(bounds, dtype=str),packing_error=packing_error); tmp.replace(path)
        return values, bounds

    def record(self, hour, kind, member):
        if self.model == 'ecmwf':
            url = extra.surface_urls(self.source, hour)[1 if member == 0 else 0][0]
            if url not in self.indexes: self.indexes[url] = extra.indexed(url)
            param = {'gust': ('10fg', '10fg3', '10fg6'), 'precip': ('tp',), 'snow': ('sf',), 'min':('mn2t3',) if hour<=144 else ('mn2t6',), 'max':('mx2t3',) if hour<=144 else ('mx2t6',)}[kind]
            rows = [r for r in self.indexes[url] if r.get('param') in param and r.get('type') == ('fc' if member == 0 else 'pf') and str(r.get('step')) == str(hour) and (member == 0 or str(r.get('number')) == str(member))]
            if len(rows) != 1: raise ValueError('Missing or duplicate ECMWF member field')
            return url, rows[0]
        group = 'b' if kind == 'gust' else 'a'
        member_name = 'gec00' if member == 0 else f'gep{member:02d}'
        date, cycle = self.run.strftime('%Y%m%d'), self.run.strftime('%H')
        url = f'https://noaa-gefs-pds.s3.amazonaws.com/gefs.{date}/{cycle}/atmos/pgrb2{group}p5/{member_name}.t{cycle}z.pgrb2{group}.0p50.f{hour:03d}'
        if url not in self.indexes: self.indexes[url] = [r.split(':') for r in core.fetch(url+'.idx').decode().splitlines()]
        rows = self.indexes[url]; param = {'gust':'GUST', 'precip':'APCP', 'rain_occurrence':'CRAIN', 'snow_occurrence':'CSNOW'}[kind]
        matches = [(i,r) for i,r in enumerate(rows) if r[3:5] == [param,'surface']]
        if len(matches) != 1: raise ValueError('Missing or duplicate GEFS native field')
        i,row = matches[0]; offset=int(row[1])
        length=int(rows[i+1][1])-offset if i+1<len(rows) else None
        if length is None:
            # Read the 16-byte GRIB header to establish its exact length.
            length=int.from_bytes(core.fetch(url,offset,16)[8:16],'big')
        return url, {'_offset':offset,'_length':length}

    def window(self, start, end, kind):
        if kind in ('min','max'):
            limit=360 if self.run.hour in (0,12) else 144
            if (self.model!='ecmwf' or start<0 or end>limit or start>=end or start%3 or end%3
                or (end>144 and (end%6 or (start>144 and start%6)))):
                raise ValueError('Extrema require exact native intervals: three-hourly to T+144, six-hourly thereafter')
            records=[]
            cursor=start
            while cursor<end:
                h=cursor+(3 if cursor<144 else 6)
                a,p=self.read(h,kind)
                if tuple(p)!=(cursor,h,kind):raise ValueError('Incomplete or wrong extrema interval')
                records.append((cursor,h,a));cursor=h
            return complete_window(records,start,end,kind)
        if self.model == 'ecmwf' and kind in ('rain','snow','precip'):
            def amount(k):
                b,pb=self.read(end,k);a,pa=self.read(start,k)
                if tuple(pb)!=(0,end,'accum') or tuple(pa)!=(0,start,'accum'): raise ValueError('Expected cumulative ECMWF amount')
                return nonnegative_difference(b,a,tolerance=self.errors[(end,k)]+self.errors[(start,k)]+1e-5)
            if kind!='rain':return amount(kind)
            rain_total,snow_total=amount('precip'),amount('snow')
            tolerance=sum(self.errors[(h,k)] for h in (start,end) for k in ('precip','snow'))+1e-5
            return nonnegative_difference(rain_total,snow_total,tolerance=tolerance)
        records=[]
        stride=6 if kind.endswith('_occurrence') or (self.model=='gefs' and kind=='precip') else 3
        for h in range(start+stride,end+1,stride):
            a,p=self.read(h,kind);lo,hi,operation=int(p[0]),int(p[1]),p[2]
            if kind=='precip':
                if operation!='accum': raise ValueError('Expected precipitation accumulation')
                # GEFS 3-hour files can contain overlapping 6-hour totals.
                if lo < h-stride:
                    previous,pp=self.read(h-stride,kind)
                    if int(pp[0])!=lo or int(pp[1])!=h-stride: raise ValueError('GEFS accumulation reset mismatch')
                    a=nonnegative_difference(a,previous);lo=h-stride
            elif kind.endswith('_occurrence'):
                if operation!='avg' or lo!=h-6:raise ValueError('Expected complete six-hour category diagnostic')
            elif self.model=='gefs':
                # Explicit sampled gust/category product, never a true interval max.
                if operation!='instant': raise ValueError('Unexpected GEFS sampled field')
                lo=h-3
            elif kind=='gust':
                if operation!='max' or lo<h-3 or lo>=h: raise ValueError('Expected source interval maximum gust')
                # IFS open data includes 1-hour maxima at 3-hour output steps.
                # This is explicitly a sampled-maxima product, not a full-period maximum.
                lo=h-3
            records.append((lo,hi,a))
        return complete_window(records,start,end,'sum' if kind=='precip' else 'max')


class MetOffice:
    def __init__(self, model, run, cache):
        self.model,self.run,self.cache=model,run,Path(cache)
        self.uk=model=='mogreps_uk';self.count=18
        self.cycles=lagged_cycles(run) if self.uk else [run]
        self.ids={}

    def read(self, cycle, hour, kind):
        specs={'gust':('wind_gust_at_10m_max-PT01H','wind_speed_of_gust','m s-1','maximum'), 'rain':('rainfall_accumulation-PT01H','thickness_of_rainfall_amount','m','sum'), 'snow':('snowfall_accumulation-PT01H','lwe_thickness_of_snowfall_amount','m','sum'), 'min':('temperature_at_screen_level_min-PT01H','air_temperature','K','minimum'), 'max':('temperature_at_screen_level_max-PT01H','air_temperature','K','maximum')}
        specs.update({'rain_conv':('rainfall_accumulation_from_convection-PT01H','thickness_of_convective_rainfall_amount','m','sum'),'snow_conv':('snowfall_accumulation_from_convection-PT01H','lwe_thickness_of_convective_snowfall_amount','m','sum')})
        file,variable,units,method=specs[kind]
        path=self.cache/self.model/cycle.strftime('%Y%m%d%H')/f'{kind}-{hour:03d}.npz'
        if path.exists():
            with np.load(path,allow_pickle=False) as z: return z['values'],z['members'].tolist()
        valid=cycle+timedelta(hours=hour);bucket='uk' if self.uk else 'global'
        url=f'https://met-office-{bucket}-ensemble-model-data.s3.eu-west-2.amazonaws.com/{bucket}-ensemble/'+cycle.strftime('%Y/%m/%d/T%H00Z/')+valid.strftime('%Y%m%dT%H%MZ')+f'-PT{hour:04d}H00M-{file}.nc'
        payload=fetch(url)
        with LOCK,Dataset('memory.nc',memory=payload) as d:
            v=d[variable];members=d['realization'][:].astype(int).tolist()
            if len(members)!=(3 if self.uk else 18) or len(set(members))!=len(members): raise ValueError('Incomplete or duplicate Met Office members')
            if v.units!=units or f'time: {method}' not in v.cell_methods: raise ValueError('Wrong Met Office units or statistic')
            for name,expected in [('forecast_reference_time',cycle),('time',valid)]:
                if d[name].units!='seconds since 1970-01-01 00:00:00' or int(d[name][:])!=int(expected.timestamp()): raise ValueError('Wrong Met Office valid time')
            bounds=np.asarray(d[d['time'].bounds][:]).ravel()
            if not np.array_equal(bounds,[int(valid.timestamp())-3600,int(valid.timestamp())]): raise ValueError('Not a complete one-hour source interval')
            if self.uk:
                if v.dimensions!=('realization','projection_y_coordinate','projection_x_coordinate') or v.shape!=(3,970,1042):raise ValueError('Unexpected UK grid')
                for axis,n,origin in [('projection_x_coordinate',1042,-1158000),('projection_y_coordinate',970,-1036000)]:
                    if not np.allclose(d[axis][:],origin+2000*np.arange(n)):raise ValueError('Unexpected UK coordinates')
                values=np.asarray(np.ma.filled(v[:],np.nan),np.float32)
            else:
                if v.shape!=(18,960,1280): raise ValueError('Unexpected global grid')
                # Native coordinates are centres (-179.859375, -89.90625).
                lat=np.asarray(d['latitude'][:]);lon=np.asarray(d['longitude'][:]);lon=(lon+180)%360-180
                yy=np.where((lat>=45.8)&(lat<=63.1))[0];xx=np.where((lon>=-16.2)&(lon<=10.2))[0]
                values=np.asarray(np.ma.filled(v[:,yy,xx],np.nan),np.float32)
                self.grid=dict(type='regular',nx=len(xx),ny=len(yy),latMin=float(lat[yy[0]]),lonMin=float(lon[xx[0]]),dx=.28125,dy=.1875,zoom=2)
                if np.any(np.diff(lat[yy])<0): raise ValueError('Unexpected global latitude order')
        if kind in ('rain','snow','rain_conv','snow_conv'):values*=1000
        if kind in ('min','max'):values-=273.15
        path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp.npz');np.savez_compressed(tmp,values=values,members=members);tmp.replace(path)
        return values,members

    def window(self,start,end,kind):
        arrays=[];identities=[]
        for cycle in self.cycles:
            lag=int((self.run-cycle).total_seconds()/3600);records=[];ids=None
            # Bounded downloads keep the fuller ensemble affordable. NetCDF
            # decoding remains protected by LOCK; results retain hourly order.
            hours=range(start+1,end+1)
            with ThreadPoolExecutor(max_workers=4) as pool:
                readings=list(pool.map(lambda h:self.read(cycle,h+lag,kind),hours))
            for h,(a,members) in zip(hours,readings):
                if not self.uk and kind in ('rain','snow'):
                    conv,conv_members=self.read(cycle,h+lag,kind+'_conv')
                    if conv_members!=members:raise ValueError('Convective members differ')
                    a=a+conv
                if ids is not None and ids!=members:raise ValueError('Members changed within window')
                ids=members;records.append((h-1,h,a))
            values=complete_window(records,start,end,'sum' if kind in ('rain','snow') else 'min' if kind=='min' else 'max')
            arrays.append(values);identities.extend(ids)
        if len(identities)!=18 or len(set(identities))!=18:raise ValueError('Expected 18 distinct lagged members')
        return np.concatenate(arrays)
