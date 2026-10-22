"""Recover native KNMI PMSL missing from the Open-Meteo spatial export.

Read only tar headers and the first (PMSL) GRIB of each hourly member using
validated HTTP ranges. Never download the multi-GB archive or substitute runs.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import shutil
import tarfile

import eccodes as ec
import numpy as np
from omfiles import OmFileWriter
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from knmi_cooldown import KNMIRateLimited, request_download_url

DOMAIN = 'knmi_harmonie_arome_europe'
API = 'https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p3/versions/1.0/files'
SOURCE = 'https://dataplatform.knmi.nl/dataset/harmonie-arome-cy43-p3-1-0'
GRID = dict(nx=676, ny=564, latMin=-13.6, lonMin=-13.5, dx=.05, dy=.05, southPoleLat=-35, southPoleLon=-8)

class KNMIRetry(Retry):
    RETRY_AFTER_STATUS_CODES = Retry.RETRY_AFTER_STATUS_CODES - {429}

def session():
    s = requests.Session()
    # Handle 429 once at the API boundary and persist its cooldown across jobs.
    s.mount('https://', HTTPAdapter(max_retries=KNMIRetry(total=3, backoff_factor=2, status_forcelist=[500,502,503,504])))
    return s

def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:00Z')

def decode(data, run):
    if data[:4] != b'GRIB' or data[7] != 1 or data[-4:] != b'7777':
        raise ValueError('Incomplete GRIB1 pressure message')
    g = ec.codes_new_from_message(data)
    try:
        expected = dict(indicatorOfParameter=1, level=0, dataDate=int(run.strftime('%Y%m%d')), dataTime=run.hour*100,
                        Ni=676, Nj=564, iScansNegatively=0, jScansPositively=1, jPointsAreConsecutive=0, alternativeRowScanning=0)
        if any(ec.codes_get(g,k) != v for k,v in expected.items()) or str(ec.codes_get(g,'indicatorOfTypeOfLevel')) != '103':
            raise ValueError('Wrong pressure parameter, initialization or grid')
        coordinates = dict(latitudeOfFirstGridPointInDegrees=-13.6, longitudeOfFirstGridPointInDegrees=-13.5,
                           latitudeOfLastGridPointInDegrees=14.55, longitudeOfLastGridPointInDegrees=20.25,
                           latitudeOfSouthernPoleInDegrees=-35, longitudeOfSouthernPoleInDegrees=-8,
                           iDirectionIncrementInDegrees=.05, jDirectionIncrementInDegrees=.05)
        if ec.codes_get(g,'gridType') != 'rotated_ll' or any(abs(ec.codes_get(g,k)-v)>1e-5 for k,v in coordinates.items()):
            raise ValueError('Unexpected native pressure coordinates')
        hour = int(ec.codes_get(g,'endStep'))
        if not 0 <= hour <= 60 or ec.codes_get(g,'timeRangeIndicator') != 0:
            raise ValueError('Unexpected forecast lead or non-instantaneous pressure')
        a = ec.codes_get_values(g).reshape(564,676)/100
        if not np.isfinite(a).all() or a.min()<800 or a.max()>1100:
            raise ValueError('Missing or invalid sea-level pressure')
        return hour, np.ascontiguousarray(a, dtype=np.float32)
    finally:
        ec.codes_release(g)

def read_range(s, url, offset, length):
    with s.get(url, headers={'Range':f'bytes={offset}-{offset+length-1}'}, timeout=(15,60), stream=True) as r:
        # Refuse a server ignoring Range before consuming a multi-GB response.
        if r.status_code != 206 or not r.headers.get('Content-Range','').startswith(f'bytes {offset}-'):
            raise ValueError(f'KNMI range request failed ({r.status_code})')
        data = r.content
        if len(data)>length or len(data)<512:
            raise ValueError('Invalid range response length')
        return data

def write_json(path, data):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2)+'\n');tmp.replace(path)

def metadata(run,hours):
    return dict(format_version=1,domain=DOMAIN,reference_time=iso(run),completed=hours==set(range(61)),variables=['pressure_msl'],units={'pressure_msl':'hPa'},
                grid=GRID,valid_times=[iso(run+timedelta(hours=h)) for h in sorted(hours)],source='KNMI HARMONIE Cy43 P3',source_url=SOURCE)

def build(root, run):
    folder=root/DOMAIN/run.strftime('%Y/%m/%d/%H00Z');folder.mkdir(parents=True,exist_ok=True)
    meta_path=folder/'meta.json'
    if meta_path.exists():
        old=json.loads(meta_path.read_text())
        if old.get('format_version')==1 and old.get('completed') and all((folder/(t[:16].replace(':','')+'.om')).exists() for t in old['valid_times']):
            return old
    s=session()
    key=os.environ.get('KNMI_API_KEY')
    if not key:
        r=s.get('https://developer.dataplatform.knmi.nl/open-data-api',timeout=30);r.raise_for_status()
        key=re.search(r'eyJvcmci[A-Za-z0-9]+',r.text)[0]
    filename=f'HARM43_V1_P3_{run:%Y%m%d%H}.tar'
    url=request_download_url(s, API+'/'+filename+'/url', key, root/DOMAIN/'request-cooldown.json', registered=bool(os.environ.get('KNMI_API_KEY')))
    offset=0;hours=set()
    for _ in range(250):
        block=read_range(s,url,offset,1024*1024)
        if not any(block[:512]): break
        member=tarfile.TarInfo.frombuf(block[:512],encoding='utf8',errors='strict')
        payload=offset+512
        if member.isfile():
            data=block[512:];size=int.from_bytes(data[4:7],'big')
            if data[:4]!=b'GRIB' or not 100<size<1024*1024:
                raise ValueError('Expected PMSL first in KNMI hourly member')
            if len(data)<size: data=read_range(s,url,payload,size)
            hour,array=decode(data[:size],run)
            if hour in hours: raise ValueError('Duplicate forecast hour')
            hours.add(hour)
            path=folder/((run+timedelta(hours=hour)).strftime('%Y-%m-%dT%H%M')+'.om')
            tmp=path.with_suffix('.tmp');writer=OmFileWriter(str(tmp))
            child=writer.write_array(array,chunks=[10,100],scale_factor=10,add_offset=0,compression='pfor_delta_2d',name='pressure_msl')
            writer.close(writer.write_group(name='root',children=[child]));tmp.replace(path)
            write_json(meta_path,metadata(run,hours))
            write_json(root/DOMAIN/'latest.json',metadata(run,hours))
        offset=payload+((member.size+511)//512)*512
        if hours==set(range(61)): break
    if hours!=set(range(61)): raise ValueError(f'Incomplete pressure run: {len(hours)}/61 hours')
    meta=metadata(run,hours)
    write_json(meta_path,meta);write_json(root/DOMAIN/'latest.json',meta)
    print(f'HARMONIE {iso(run)}: verified 61 native pressure frames',flush=True)
    return meta

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path('ensemble-data'));parser.add_argument('--run')
    args=parser.parse_args()
    if args.run: run=datetime.fromisoformat(args.run.replace('Z','+00:00'))
    else:
        r=session().get(f'https://openmeteo.s3.amazonaws.com/data_spatial/{DOMAIN}/latest.json',timeout=30);r.raise_for_status()
        run=datetime.fromisoformat(r.json()['reference_time'].replace('Z','+00:00'))
    build(args.root,run)
    # Retain recent exact cycles for Run selection while bounding Pages storage.
    for p in (args.root/DOMAIN).glob('*/*/*/*/meta.json'):
        if datetime.fromisoformat(json.loads(p.read_text())['reference_time'].replace('Z','+00:00')) < run-timedelta(hours=3):
            shutil.rmtree(p.parent)

if __name__=='__main__':
    try:
        main()
    except KNMIRateLimited as error:
        print(f'::warning::{error}', flush=True)
        raise SystemExit(75)
