"""Prepare a verified HadUK-Grid 1991–2020 monthly extrema baseline.

Input files require the user's CEDA access. Never substitute mean temperature,
a single station, a different baseline or synthetic values when absent.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np


def prepare(folder,output):
    from netCDF4 import Dataset
    from pyproj import Transformer
    result={};provenance={}
    x,y=np.meshgrid(-1158000+2000*np.arange(1042),-1036000+2000*np.arange(970))
    projection='+proj=laea +lat_0=54.9 +lon_0=-2.5 +a=6378137 +b=6356752.314140356 +units=m'
    east,north=Transformer.from_crs(projection,'EPSG:27700',always_xy=True).transform(x,y)
    for kind in ('min','max'):
        name='tas'+kind;files=list(Path(folder).rglob(f'{name}_hadukgrid_uk_1km_mon-30y_199101-202012.nc'))
        if len(files)!=1:raise ValueError(f'Exactly one 1 km 1991–2020 {name} file is required')
        file=files[0]
        with Dataset(file) as d:
            v=d[name]
            if v.shape[0]!=12 or v.units not in ('degC','degree_Celsius','degrees_Celsius','degrees C','Celsius') or str(getattr(d,'lta_period','')) not in ('1991-2020','1991 to 2020'):
                raise ValueError('Unverified climatology period, units or month count')
            if v.dimensions[-2:]!=('projection_y_coordinate','projection_x_coordinate'):raise ValueError('Unexpected HadUK grid')
            if not np.array_equal(d['month_number'][:],np.arange(1,13)):raise ValueError('Expected January through December normals')
            expected=f'time: {"minimum" if kind=="min" else "maximum"} within days time: mean over days time: mean over years'
            if v.cell_methods!=expected:raise ValueError('Expected monthly normals of daily extrema')
            xs=np.asarray(d['projection_x_coordinate'][:]);ys=np.asarray(d['projection_y_coordinate'][:])
            if not np.allclose(np.diff(xs),1000) or not np.allclose(np.diff(ys),1000):raise ValueError('Expected 1 km HadUK cells')
            ix=np.rint((east-xs[0])/1000).astype(int);iy=np.rint((north-ys[0])/1000).astype(int)
            inside=(ix>=0)&(ix<len(xs))&(iy>=0)&(iy<len(ys))
            values=np.asarray(np.ma.filled(v[:],np.nan),np.float32)
            mapped=values[:,np.clip(iy,0,len(ys)-1),np.clip(ix,0,len(xs)-1)]
            result[kind]=np.where(inside,mapped,np.nan)
            if not np.isfinite(result[kind]).any():raise ValueError('Empty UK climatology')
        provenance[kind]=dict(file=file.name,sha256=hashlib.sha256(file.read_bytes()).hexdigest())
    # Independently interpolated source extrema can cross at isolated cells.
    # Exclude inconsistent/missing pairs instead of inventing corrected normals.
    valid=np.isfinite(result['min'])&np.isfinite(result['max'])&(result['min']<=result['max'])
    for kind in result:result[kind]=np.where(valid,result[kind],np.nan)
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(output,**result,period='1991-2020',statistic='monthly extrema normals',provenance=json.dumps(provenance))


def prepare_ecmwf(folder,output):
    """Area-average original 1 km UK land cells into the published 0.25° cells.

    Projection libraries are needed only for preparation, never in GRIB jobs.
    Equal-area HadUK cells have equal weights; no sea or foreign-land normals
    are invented. This is spatial matching, not model bias correction.
    """
    from netCDF4 import Dataset
    from pyproj import Transformer
    result={};provenance={}
    for kind in ('min','max'):
        name='tas'+kind;file=Path(folder)/f'{name}_hadukgrid_uk_1km_mon-30y_199101-202012.nc'
        with Dataset(file) as d:
            v=d[name]
            if str(d.lta_period)!='1991-2020' or v.units!='degC' or not np.array_equal(d['month_number'][:],np.arange(1,13)):
                raise ValueError('Unverified HadUK period, units or months')
            expected=f'time: {"minimum" if kind=="min" else "maximum"} within days time: mean over days time: mean over years'
            if v.cell_methods!=expected:raise ValueError('Wrong extrema statistic')
            xs=np.asarray(d['projection_x_coordinate'][:]);ys=np.asarray(d['projection_y_coordinate'][:])
            if not np.allclose(np.diff(xs),1000) or not np.allclose(np.diff(ys),1000):raise ValueError('Expected 1 km cells')
            x,y=np.meshgrid(xs,ys)
            lon,lat=Transformer.from_crs('EPSG:27700','EPSG:4326',always_xy=True).transform(x,y)
            ix=np.floor((lon+16+.125)/.25).astype(int);iy=np.floor((lat-46+.125)/.25).astype(int)
            inside=(ix>=0)&(ix<105)&(iy>=0)&(iy<69)
            ids=(iy*105+ix)[inside];values=np.asarray(np.ma.filled(v[:],np.nan),np.float32)[:,inside]
            result[kind]=values
        provenance[kind]=dict(file=file.name,sha256=hashlib.sha256(file.read_bytes()).hexdigest())
    valid=np.isfinite(result['min'])&np.isfinite(result['max'])&(result['min']<=result['max'])
    counts=[];normals={k:[] for k in result}
    for month in range(12):
        use=valid[month];count=np.bincount(ids[use],minlength=69*105)
        counts.append(count.reshape(69,105))
        for kind in result:
            total=np.bincount(ids[use],weights=result[kind][month,use],minlength=69*105)
            mean=np.divide(total,count,out=np.full(total.shape,np.nan),where=count>0)
            normals[kind].append(mean.reshape(69,105).astype(np.float32))
    np.savez_compressed(output,**{k:np.stack(v) for k,v in normals.items()},land_cell_count=np.stack(counts),
                        period='1991-2020',statistic='monthly extrema normals',provenance=json.dumps(provenance),
                        grid='0.25 degree centres: lon -16 to 10, lat 46 to 63; mean of valid 1 km UK land cells')


def ireland_path(path,model):
    suffix='-ecmwf' if model=='ecmwf' else ''
    return Path(path).with_name(f'met-eireann-extrema-1991-2020{suffix}.npz')


def anomaly_reference(path,model):
    """Fingerprint all baseline inputs so retained tasks cannot hide upgrades."""
    files=[Path(path)];supplement=ireland_path(path,model)
    if supplement.exists():files.append(supplement)
    hashes=[hashlib.sha256(f.read_bytes()).hexdigest() for f in files]
    return dict(dataset='HadUK-Grid + Met Eireann' if len(files)>1 else 'HadUK-Grid',
                period='1991-2020',statistic='monthly normal of daily minimum/maximum',
                forecast_window='24 hours ending 09 UTC',
                coverage='UK and Republic of Ireland' if len(files)>1 else 'UK',
                revision=hashlib.sha256(':'.join(hashes).encode()).hexdigest(),
                inputs=[dict(file=f.name,sha256=h) for f,h in zip(files,hashes)])


def read_normals(path,model='mogreps_uk',include_ireland=True):
    with np.load(path,allow_pickle=False) as z:
        if str(z['period'])!='1991-2020' or str(z['statistic'])!='monthly extrema normals':raise ValueError('Wrong temperature baseline')
        result={kind:z[kind].copy() for kind in ('min','max')}
        shape=(12,69,105) if model=='ecmwf' else (12,970,1042)
        if any(a.shape!=shape for a in result.values()):raise ValueError('Wrong normal grid')
        if np.any(result['min']>result['max']):raise ValueError('Minimum normal exceeds maximum')
        provenance=json.loads(str(z['provenance']))
        if any(len(provenance[k]['sha256'])!=64 for k in result):raise ValueError('Missing baseline provenance')
    supplement=ireland_path(path,model)
    if include_ireland and supplement.exists():
        manifest=json.loads(supplement.with_name('ireland-manifest.json').read_text(encoding='utf8'))
        if hashlib.sha256(supplement.read_bytes()).hexdigest()!=manifest['artifacts'][model]['sha256']:
            raise ValueError('Irish baseline checksum mismatch')
        with np.load(supplement,allow_pickle=False) as z:
            if (str(z['period'])!='1991-2020' or str(z['statistic'])!='monthly extrema normals'
                or str(z['units'])!='degC' or str(z['model'])!=model
                or json.loads(str(z['provenance']))!=manifest['sources']):
                raise ValueError('Unverified Irish temperature baseline')
            extra={k:z[k].copy() for k in result}
            if any(v.shape!=shape for v in extra.values()) or np.any(extra['min']>extra['max']):
                raise ValueError('Invalid Irish extrema grid')
            use=(~np.isfinite(result['min']) & ~np.isfinite(result['max'])
                 & np.isfinite(extra['min']) & np.isfinite(extra['max']))
            for kind in result:result[kind]=np.where(use,extra[kind],result[kind])
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('folder');p.add_argument('--model',choices=['mogreps_uk','ecmwf'],default='mogreps_uk');p.add_argument('--output');a=p.parse_args()
    output=a.output or ('climatology/haduk-extrema-1991-2020-ecmwf.npz' if a.model=='ecmwf' else 'climatology/haduk-extrema-1991-2020.npz')
    (prepare_ecmwf if a.model=='ecmwf' else prepare)(a.folder,output)
