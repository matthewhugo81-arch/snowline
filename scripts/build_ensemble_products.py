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
from ensemble_product_sources import GlobalGRIB, MetOffice, fetch
from ensemble_products import threshold_fields, member_extrema_anomaly, cold_probability_fields, COLD_THRESHOLDS

UTC=timezone.utc
def iso(t):return t.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00','Z')


def atomic_json(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data)+'\n',encoding='utf8')
    temporary.replace(path)


def uk_nearest_indices():
    # Do not load PROJ alongside GRIB libraries in the global model jobs.
    from build_mogreps_snow import uk_nearest_indices as native_indices
    return native_indices()


def runtime_check(model):
    if model in ('ecmwf','gefs'):
        GlobalGRIB(model,datetime.now(UTC),Path('unused-runtime-check'))
    elif model=='mogreps_uk':
        uk_nearest_indices()


def latest_run(model):
    domains={'gefs':'snowline_gefs_ensemble','ecmwf':'snowline_ecmwf_ensemble','mogreps_g':'snowline_mogreps_global','mogreps_uk':'ukmo_uk_ensemble_2km'}
    base='https://openmeteo.s3.amazonaws.com/data_spatial/' if model=='mogreps_uk' else 'https://matthewhugo81-arch.github.io/'+('snowline-ensembles' if model=='mogreps_g' else 'snowline')+'/ensemble-data/'
    data=json.loads(fetch(base+domains[model]+'/latest.json'))
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


def task_complete(record,task,model,kind,has_climatology,revision=None):
    if task not in record.get('tasks',[]):return False
    required=set(COLD_THRESHOLDS) if model=='mogreps_uk' and kind=='min' else set()
    if kind in ('min','max') and has_climatology:
        key=f'ens_temperature_{kind}_anomaly';required.add(key)
        if revision and record.get('anomaly_revisions',{}).get(key)!=revision:return False
    return required.issubset(record.get('variables',[]))


def probability_targets(model,end_limit,kinds):
    # Add six-hour windows without doubling the existing 12/24-hour schedule.
    periods=(12,24) if model=='gefs' else (6,12,24)
    return [(h,kind,period) for period in periods
            for h in range(6 if period==6 else 12,end_limit+1,6 if period==6 else 12)
            if h>=period for kind in kinds]


def build(model,root,cache,run=None,max_hour=144,budget=1500,climatology=None):
    run=run or latest_run(model);domain=f'snowline_{model}_products'
    folder=root/domain/run.strftime('%Y/%m/%d/%H00Z');folder.mkdir(parents=True,exist_ok=True)
    source=(GlobalGRIB if model in ('gefs','ecmwf') else MetOffice)(model,run,cache)
    kinds=['gust','precip','rain_occurrence','snow_occurrence'] if model=='gefs' else ['gust','rain','snow']
    end_limit=min(max_hour,114 if model=='mogreps_uk' else 120)
    targets=probability_targets(model,end_limit,kinds)
    normal=None;reference=None
    if model=='ecmwf':climatology=Path(climatology).with_name('haduk-extrema-1991-2020-ecmwf.npz') if climatology else None
    if model in ('mogreps_uk','ecmwf') and climatology and Path(climatology).exists():
        from temperature_climatology import read_normals,anomaly_reference
        normal=read_normals(climatology,model)
        reference=anomaly_reference(climatology,model)
    if model=='mogreps_uk' or normal is not None:
        anomaly_limit=min(max_hour,144) if model=='ecmwf' else end_limit
        extrema_kinds=('min','max') if normal is not None else ('min',)
        targets += [(h,kind,24) for h in range(24,anomaly_limit+1) if (run+timedelta(hours=h)).hour==9 for kind in extrema_kinds]
    # Publish near-term extrema alongside probabilities, not after the entire
    # probability horizon. Completed tasks are reused on the next build.
    targets.sort(key=lambda task:task[0])
    started=time.monotonic();failures=[]
    for h,kind,period in targets:
        if time.monotonic()-started>budget:break
        valid=run+timedelta(hours=h);path=folder/(valid.strftime('%Y-%m-%dT%H%M')+'.om.png')
        record_path=path.with_suffix('.json')
        record=json.loads(record_path.read_text()) if record_path.exists() and path.exists() else {}
        task=f'{kind}-{period}'
        if task_complete(record,task,model,kind,normal is not None,reference and reference['revision']):continue
        try:
            a=source.window(h-period,h,kind)
            if kind in ('min','max'):
                values=cold_probability_fields(a,source.count) if model=='mogreps_uk' and kind=='min' else {}
                if normal is not None:
                    date=valid if kind=='min' else valid-timedelta(hours=24)
                    values[f'ens_temperature_{kind}_anomaly']=member_extrema_anomaly(a,normal[kind][date.month-1],source.count)
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
            revisions=record.get('anomaly_revisions',{})
            for key in values:
                if key.endswith('_anomaly'):revisions[key]=reference['revision']
            atomic_json(record_path,dict(tasks=sorted(set(record.get('tasks',[])+[task])),variables=sorted(merged),intervals=intervals,anomaly_revisions=revisions))
            publish(root,folder,source,model,run,targets,normal is not None,reference)
            print(f'{model} T+{h} {task}: published {len(values)} grids',flush=True)
        except Exception as error:
            failures.append(f'T+{h} {task}: {error}');print(f'::warning::{model} {failures[-1]}',flush=True)
    # Refresh even when all tasks were reused or rebuilding hit its budget.
    # Old-baseline anomalies must never be advertised as the new reference.
    publish(root,folder,source,model,run,targets,normal is not None,reference)
    if not (folder/'meta.json').exists() or not json.loads((folder/'meta.json').read_text()).get('variables'):raise RuntimeError('No verified products: '+('; '.join(failures[:2])))
    # Retain two product runs independently of the ordinary map archive.
    folders=sorted((root/domain).glob('*/*/*/*Z'),reverse=True)
    for old in folders[2:]:
        if not old.resolve().is_relative_to((root/domain).resolve()):raise ValueError('Unsafe retention path')
        shutil.rmtree(old)


def publish(root,folder,source,model,run,targets,has_climatology,reference=None):
    records={}
    for f in folder.glob('*.om.json'):
        valid=f.name.split('.om')[0];valid=datetime.strptime(valid,'%Y-%m-%dT%H%M').replace(tzinfo=UTC)
        if not f.with_suffix('.png').exists():continue
        record=json.loads(f.read_text())
        if reference:
            record['variables']=[k for k in record['variables'] if not k.endswith('_anomaly')
                                 or record.get('anomaly_revisions',{}).get(k)==reference['revision']]
        if record['variables']:records[iso(valid)]=record
    # Do not replace a usable older publication when a new run produced no
    # data. An existing obsolete snapshot must still be invalidated below.
    if not records and not (folder/'meta.json').exists():return
    variables=sorted({k for r in records.values() for k in r['variables']})
    times=sorted(records)
    completed=all(task_complete(records.get(iso(run+timedelta(hours=h)),{}),f'{kind}-{period}',model,kind,has_climatology,reference and reference['revision']) for h,kind,period in targets)
    meta=dict(format_version=1,domain=f'snowline_{model}_products',reference_time=iso(run),completed=completed,variables=variables,valid_times=times,
              variable_valid_times={k:[t for t in times if k in records[t]['variables']] for k in variables},
              variable_intervals={k:{t:records[t]['intervals'][k] for t in times if k in records[t]['variables']} for k in variables},
              member_count=source.count,source_cycles=[iso(c) for c in getattr(source,'cycles',[run])],generated_at=iso(datetime.now(UTC)),
              method='Member-first complete windows; all members required at each cell; no probability averaging, neighbourhood smoothing or missing-as-zero.',
              anomaly_reference=(reference or {'dataset':'HadUK-Grid','period':'1991-2020','statistic':'monthly normal of daily minimum/maximum','forecast_window':'24 hours ending 09 UTC'}) if has_climatology else None)
    atomic_json(folder/'meta.json',meta)
    latest=root/meta['domain']/'latest.json'
    if not latest.exists() or json.loads(latest.read_text())['reference_time']<=meta['reference_time']:atomic_json(latest,meta)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model',required=True,choices=['gefs','ecmwf','mogreps_uk','mogreps_g']);p.add_argument('--output',type=Path,default=Path('ensemble-data'));p.add_argument('--cache',type=Path,default=Path('product-cache'));p.add_argument('--run');p.add_argument('--check-runtime',action='store_true');p.add_argument('--max-hour',type=int,default=144);p.add_argument('--budget',type=int,default=1500);p.add_argument('--climatology',default='climatology/haduk-extrema-1991-2020.npz');a=p.parse_args()
    if a.check_runtime:runtime_check(a.model)
    else:build(a.model,a.output,a.cache,datetime.fromisoformat(a.run.replace('Z','+00:00')) if a.run else None,a.max_hour,a.budget,a.climatology)
