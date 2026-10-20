import bz2
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import build_vertical_motion as b
from omfiles import OmFileReader

RUN=datetime(2026,10,15,12,tzinfo=timezone.utc)

def grib(model,key,value=1,hour=9,changes=None):
 s=b.Source(model,RUN);cfg=s.config;nx,ny,lat,lon,step=cfg['native']
 g=b.ec.codes_grib_new_from_samples('regular_ll_pl_grib2')
 try:
  settings=dict(Ni=nx,Nj=ny,jScansPositively=1,latitudeOfFirstGridPointInDegrees=lat,
   longitudeOfFirstGridPointInDegrees=lon,latitudeOfLastGridPointInDegrees=lat+(ny-1)*step,
   longitudeOfLastGridPointInDegrees=(lon+(nx-1)*step)%360,iDirectionIncrementInDegrees=step,
   jDirectionIncrementInDegrees=step,level=700,paramId=cfg['params'][b.FIELDS.index(key)],
   dataDate=20261015,dataTime=1200,forecastTime=hour,uvRelativeToGrid=0)
  settings.update(changes or {})
  for k,v in settings.items(): b.ec.codes_set(g,k,v)
  values=b.np.full((ny,nx),value,dtype=float)
  # A unique corner of the crop checks longitude roll, row order and subset.
  y0,_,x0,_=cfg['crop'];native_x=(x0+nx//2)%nx if model=='gem' else x0
  values[y0,native_x]=value*2
  b.ec.codes_set_values(g,values.ravel());message=b.ec.codes_get_message(g)
  return bz2.compress(message) if model=='icon-eu' else message
 finally: b.ec.codes_release(g)

class VerticalMotionTests(unittest.TestCase):
 def test_native_units_orientation_and_no_resampling(self):
  for model in b.CONFIG:
   source=b.Source(model,RUN)
   for key,value,expected in [('omega_700hPa',-.7,-7),('geopotential_height_700hPa',3000,3000),('wind_u_component_700hPa',12.5,12.5),('wind_v_component_700hPa',-8,-8)]:
    raw=value*9.80665 if model=='icon-eu' and key=='geopotential_height_700hPa' else value
    result=b.decode(grib(model,key,raw),key,source,9)
    self.assertEqual(result.shape,(source.config['grid']['ny'],source.config['grid']['nx']))
    self.assertAlmostEqual(float(result[0,0]),expected*2,places=2)
    self.assertAlmostEqual(float(result[-1,-1]),expected,places=2)

 def test_reject_wrong_parameter_level_run_time_grid_and_incomplete_message(self):
  source=b.Source('gem',RUN);key='omega_700hPa'
  for changes in [dict(level=500),dict(dataDate=20261014),dict(forecastTime=12),dict(paramId=131),dict(jScansPositively=0),dict(longitudeOfFirstGridPointInDegrees=1)]:
   with self.assertRaises(ValueError): b.decode(grib('gem',key,changes=changes),key,source,9)
  message=grib('gem',key)
  with self.assertRaises(ValueError): b.decode(message[:-1],key,source,9)

 def test_minute_encoded_icon_analysis_is_valid(self):
  key='omega_700hPa';source=b.Source('icon-eu',RUN)
  message=grib('icon-eu',key,hour=0,changes={'indicatorOfUnitOfTimeRange':0})
  self.assertEqual(float(b.decode(message,key,source,0)[-1,-1]),10)
  with self.assertRaises(ValueError): b.decode(message,key,source,1)

 def test_om_precision_missing_values_and_signed_omega(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'frame.om';source=b.Source('gem',RUN)
   def array(message,key,source,hour):
    a=b.np.full((10,100),-7.23,dtype=b.np.float32);a[0,0]=b.np.nan;a[0,1]=0;a[0,2]=7.23;return a
   with patch.object(b,'fetch',return_value=b'GRIB'),patch.object(b,'decode',side_effect=array): b.write_frame(source,9,path)
   reader=OmFileReader(str(path));a=reader.get_child_by_name('omega_700hPa')[:,:]
   self.assertTrue(b.np.isnan(a[0,0]));self.assertEqual(a[0,1],0)
   self.assertAlmostEqual(float(a[0,2]),7.2,places=1);self.assertAlmostEqual(float(a[-1,-1]),-7.2,places=1)
   del reader

 def test_missing_companion_never_writes_a_frame(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'frame.om'
   def decode(message,key,source,hour):
    if key=='wind_v_component_700hPa': raise ValueError('Missing V')
    return b.np.ones((10,100),dtype=b.np.float32)
   with patch.object(b,'fetch',return_value=b'GRIB'),patch.object(b,'decode',side_effect=decode):
    with self.assertRaises(ValueError): b.write_frame(b.Source('gem',RUN),9,path)
   self.assertFalse(path.exists())

 def test_partial_publication_retries_missing_hours_without_reloading_good_frames(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);calls=[]
   def write(source,hour,path):
    calls.append(hour)
    if hour==3 and calls.count(3)==1: raise ValueError('Field still arriving')
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'valid');return 5
   with patch.object(b.Source,'available_hours',return_value=[0,3,6]),patch.object(b,'write_frame',side_effect=write):
    first=b.build_run('gem',root,RUN,1,[0,3,6]);second=b.build_run('gem',root,RUN,1,[0,3,6])
   self.assertEqual(first['valid_times'],[b.iso(RUN),b.iso(RUN+timedelta(hours=6))])
   self.assertEqual(len(second['valid_times']),3);self.assertFalse(second['completed']);self.assertEqual(calls.count(0),1);self.assertEqual(calls.count(3),2)

 def test_native_forecast_cadences(self):
  self.assertEqual(len(b.expected_hours('gem',RUN)),81)
  self.assertEqual(b.expected_hours('gem',RUN)[-1],240)
  self.assertEqual(len(b.expected_hours('icon-eu',RUN)),93)
  self.assertEqual(b.expected_hours('icon-eu',RUN+timedelta(hours=3))[-4:],[30,36,42,48])

 def test_upper_gem_cadence_matches_available_high_level_files(self):
  import build_gem_upper as upper
  with patch.dict(b.CONFIG, {'gem': dict(b.CONFIG['gem'])}):
   upper.configure()
   hours=b.expected_hours('gem',RUN)
   self.assertEqual(len(hours),69)
   self.assertEqual(hours[-13:],[168,174,180,186,192,198,204,210,216,222,228,234,240])

 def test_partial_archive_survives_a_later_source_outage(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   def write(source,hour,path):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'verified');return 8
   with patch.object(b.Source,'available_hours',return_value=[0]),patch.object(b,'write_frame',side_effect=write):
    original=b.build_run('gem',root,RUN,1)
   with patch.object(b.Source,'available_hours',side_effect=ValueError('offline')):
    retained=b.build_run('gem',root,RUN,1)
   self.assertEqual(retained['valid_times'],original['valid_times']);self.assertFalse(retained['completed'])

 def test_dwd_listing_intersection_matches_exact_cycle_and_all_fields(self):
  source=b.Source('icon-eu',RUN)
  def listing(url):
   variable=url.rstrip('/').rsplit('/',1)[1].upper()
   hours=[0,1] if variable=='V' else [0,1,2]
   return '\n'.join([f'icon-eu_europe_regular-lat-lon_pressure-level_2026101512_{h:03d}_700_{variable}.grib2.bz2' for h in hours]+[f'icon-eu_europe_regular-lat-lon_pressure-level_2026101506_003_700_{variable}.grib2.bz2']).encode()
  with patch.object(b,'fetch',side_effect=listing): self.assertEqual(source.available_hours(),[0,1])

 def test_source_outage_retains_previous_verified_run(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);cfg=b.CONFIG['gem'];previous=dict(format_version=b.VERSION,domain=cfg['domain'],variables=b.FIELDS,units=b.UNITS,grid=cfg['grid'],reference_time=b.iso(RUN),valid_times=[b.iso(RUN)])
   b.write_json(root/cfg['domain']/'latest.json',previous)
   with patch.object(b,'primary_run',side_effect=ValueError('offline')): self.assertEqual(b.build_model('gem',root),previous)

 def test_cleanup_keeps_three_runs_without_deleting_other_feeds(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);cfg=b.CONFIG['gem'];other=root/'another-model/sentinel';other.parent.mkdir();other.write_text('keep')
   old=b.frame_path(root,cfg['domain'],RUN-timedelta(hours=36),0);old.parent.mkdir(parents=True);old.write_text('old')
   def build(model,root,run,workers,hours):
    path=b.frame_path(root,cfg['domain'],run,0);path.parent.mkdir(parents=True,exist_ok=True);path.write_text('valid')
    return dict(reference_time=b.iso(run),valid_times=[b.iso(run)],completed=True)
   with patch.object(b,'build_run',side_effect=build): b.build_model('gem',root,run=RUN)
   self.assertFalse(old.exists());self.assertEqual(other.read_text(),'keep')
   self.assertEqual(len(list((root/cfg['domain']).glob('*/*/*/*Z'))),3)

if __name__=='__main__': unittest.main()
