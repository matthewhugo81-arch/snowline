"""Prepare a verified HadUK-Grid 1991–2020 monthly extrema baseline.

Input files require the user's CEDA access. Never substitute mean temperature,
a single station, a different baseline or synthetic values when absent.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from netCDF4 import Dataset
from pyproj import Transformer


def prepare(folder,output):
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


def read_normals(path):
    with np.load(path,allow_pickle=False) as z:
        if str(z['period'])!='1991-2020' or str(z['statistic'])!='monthly extrema normals':raise ValueError('Wrong temperature baseline')
        result={kind:z[kind].copy() for kind in ('min','max')}
        if any(a.shape!=(12,970,1042) for a in result.values()):raise ValueError('Wrong normal grid')
        if np.any(result['min']>result['max']):raise ValueError('Minimum normal exceeds maximum')
        provenance=json.loads(str(z['provenance']))
        if any(len(provenance[k]['sha256'])!=64 for k in result):raise ValueError('Missing baseline provenance')
        return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('folder');p.add_argument('--output',default='climatology/haduk-extrema-1991-2020.npz');a=p.parse_args();prepare(a.folder,a.output)
