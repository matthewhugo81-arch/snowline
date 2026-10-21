"""Independent optional publication: complete probability/anomaly frames only.

This script is deliberately absent from the core chart publication workflow.
Its failures and compute cost cannot delay ordinary forecast charts.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import shutil
import time
import numpy as np
from omfiles import OmFileWriter
import build_ensembles as core
from build_ensemble_extras import atomic_json
from build_mogreps_snow import uk_nearest_indices
from ensemble_product_sources import GlobalGRIB, MetOffice
from ensemble_products import threshold_fields, member_extrema_anomaly

UTC=timezone.utc
def iso(t):return t.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00','Z')


def latest_run(model):
    domains={'gefs':'snowline_gefs_ensemble','ecmwf':'snowline_ecmwf_ensemble','mogreps_g':'snowline_mogreps_global','mogreps_uk':'ukmo_uk_ensemble_2km'}
    base='https://openmeteo.s3.amazonaws.com/data_spatial/' if model=='mogreps_uk' else 'https://matthewhugo81-arch.github.io/'+('snowline-ensembles' if model=='mogreps_g' else 'snowline')+'/ensemble-data/'
    data=json.loads(core.fetch(base+domains[model]+'/latest.json'))
    run=datetime.fromisoformat(data['reference_time'].replace('Z','+00:00'))
    # A six-hour anchor keeps one full lagged set stable while it is built.
    if model=='mogreps_uk':run=run.replace(hour=run.hour//6*6)
    return run


def write_frame(path,values):
    path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp')
    writer=OmFileWriter(str(tmp));children=[]
    for key,a in sorted(values.items()):
        if not np.isfinite(a).any():raise ValueError('No complete-member cells')
        children.append(writer.write_array(np.ascontiguousarray(a,dtype=np.float32),chunks=[10,min(100,a.shape[1])],scale_factor=100,add_offset=0,compression='pfor_delta_2d',name=key))
    writer.close(writer.write_group(name='root',children=children));tmp.replace(path)


def build(model,root,cache,run=None,max_hour=120,budget=1500,climatology=None):
    run=run or latest_run(model);domain=f'snowline_{model}_products'
    folder=root/domain/run.strftime('%Y/%m/%d/%H00Z');folder.mkdir(parents=True,exist_ok=True)
    source=(GlobalGRIB if model in ('gefs','ecmwf') else MetOffice)(model,run,cache)
    kinds=['gust','precip','rain_occurrence','snow_occurrence'] if model=='gefs' else ['gust','rain','snow']
    end_limit=min(max_hour,114 if model=='mogreps_uk' else 120)
    targets=[(h,kind,period) for h in range(12,end_limit+1,12) for period in (12,24) if h>=period for kind in kinds]
    normal=None
    if model=='mogreps_uk' and climatology and Path(climatology).exists():
        from temperature_climatology import read_normals
        normal=read_normals(climatology)
        targets += [(h,kind,24) for h in range(24,end_limit+1) if (run+timedelta(hours=h)).hour==9 for kind in ('min','max')]
    started=time.monotonic();failures=[]
    for h,kind,period in targets:
        if time.monotonic()-started>budget:break
        valid=run+timedelta(hours=h);path=folder/(valid.strftime('%Y-%m-%dT%H%M')+'.om.png')
        record_path=path.with_suffix('.json')
        record=json.loads(record_path.read_text()) if record_path.exists() and path.exists() else {}
        task=f'{kind}-{period}'
        if task in record.get('tasks',[]):continue
        try:
            a=source.window(h-period,h,kind)
            if kind in ('min','max'):
                date=valid if kind=='min' else valid-timedelta(hours=24)
                values={f'ens_temperature_{kind}_anomaly':member_extrema_anomaly(a,normal[kind][date.month-1])}
            else:values=threshold_fields(kind,a,period,source.count)
            if model=='mogreps_uk':
                iy,ix,inside=uk_nearest_indices()
                values={k:np.where(inside,v[iy,ix],np.nan) for k,v in values.items()}
            # Store a compact completed task for resumable builds; no raw members
            # enter the public branch. The OM frame is rewritten atomically.
            task_path=folder/f'{h:03d}-{task}.npz'
            np.savez_compressed(task_path,**values)
            merged={}
            for f in folder.glob(f'{h:03d}-*.npz'):
                with np.load(f,allow_pickle=False) as z:merged.update({k:z[k] for k in z.files})
            write_frame(path,merged)
            intervals=record.get('intervals',{})
            for key in values:intervals[key]=dict(start=iso(valid-timedelta(hours=period)),end=iso(valid),hours=period)
            atomic_json(record_path,dict(tasks=record.get('tasks',[])+[task],variables=sorted(merged),intervals=intervals))
            publish(root,folder,source,model,run,targets,normal is not None)
            print(f'{model} T+{h} {task}: published {len(values)} grids',flush=True)
        except Exception as error:
            failures.append(f'T+{h} {task}: {error}');print(f'::warning::{model} {failures[-1]}',flush=True)
    if not (folder/'meta.json').exists():raise RuntimeError('No verified products: '+('; '.join(failures[:2])))
    # Retain two product runs independently of the ordinary map archive.
    folders=sorted((root/domain).glob('*/*/*/*Z'),reverse=True)
    for old in folders[2:]:
        if not old.resolve().is_relative_to((root/domain).resolve()):raise ValueError('Unsafe retention path')
        shutil.rmtree(old)


def publish(root,folder,source,model,run,targets,has_climatology):
    records={}
    for f in folder.glob('*.om.json'):
        valid=f.name.split('.om')[0];valid=datetime.strptime(valid,'%Y-%m-%dT%H%M').replace(tzinfo=UTC)
        if not f.with_suffix('.png').exists():continue
        records[iso(valid)]=json.loads(f.read_text())
    variables=sorted({k for r in records.values() for k in r['variables']})
    times=sorted(records)
    completed=sum(len(r['tasks']) for r in records.values())==len(targets)
    meta=dict(format_version=1,domain=f'snowline_{model}_products',reference_time=iso(run),completed=completed,variables=variables,valid_times=times,
              variable_valid_times={k:[t for t in times if k in records[t]['variables']] for k in variables},
              variable_intervals={k:{t:records[t]['intervals'][k] for t in times if k in records[t]['variables']} for k in variables},
              member_count=source.count,source_cycles=[iso(c) for c in getattr(source,'cycles',[run])],generated_at=iso(datetime.now(UTC)),
              method='Member-first complete windows; all members required at each cell; no probability averaging, neighbourhood smoothing or missing-as-zero.',
              anomaly_reference={'dataset':'HadUK-Grid','period':'1991-2020','statistic':'monthly normal of daily minimum/maximum','forecast_window':'24 hours ending 09 UTC'} if has_climatology else None)
    atomic_json(folder/'meta.json',meta)
    latest=root/meta['domain']/'latest.json'
    if not latest.exists() or json.loads(latest.read_text())['reference_time']<=meta['reference_time']:atomic_json(latest,meta)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model',required=True,choices=['gefs','ecmwf','mogreps_uk','mogreps_g']);p.add_argument('--output',type=Path,default=Path('ensemble-data'));p.add_argument('--cache',type=Path,default=Path('product-cache'));p.add_argument('--run');p.add_argument('--max-hour',type=int,default=120);p.add_argument('--budget',type=int,default=1500);p.add_argument('--climatology',default='climatology/haduk-extrema-1991-2020.npz');a=p.parse_args()
    build(a.model,a.output,a.cache,datetime.fromisoformat(a.run.replace('Z','+00:00')) if a.run else None,a.max_hour,a.budget,a.climatology)
