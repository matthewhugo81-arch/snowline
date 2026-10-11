import test from 'node:test';
import assert from 'node:assert/strict';
import {combineSources,fieldSource,fieldDataURL,hasFieldTime,loadSpatialModel,SPATIAL_BASE} from '../map-sources.js';
import {sourceVariable,availableFields} from '../map-catalogue.js';

const run='2026-10-09T06:00:00Z',t0='2026-10-09T06:00Z',t1='2026-10-09T07:00Z',t2='2026-10-09T08:00Z';
const surface={domain:'ncep_gfs013',reference_time:run,completed:true,variables:['temperature_2m','precipitation','wind_u_component_10m','wind_v_component_10m'],valid_times:[t0,t1,t2]};
const upper={domain:'ncep_gfs025',reference_time:run,completed:true,variables:['pressure_msl','temperature_850hPa','wind_gusts_10m'],valid_times:[t0,t1]};

test('GFS cloud layers start at the first forecast hour, while other models retain analysis clouds',()=>{
 const variables=['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high'];
 for(const key of variables){
  const meta={...surface,variables};
  assert.equal(hasFieldTime(meta,key,t0),false);
  assert.equal(fieldDataURL(meta,key,run),null);
  assert.equal(hasFieldTime(meta,key,t1),true);
  assert.equal(hasFieldTime({...meta,domain:'ukmo_uk_deterministic_2km'},key,t0),true);
  assert.equal(hasFieldTime({...meta,valid_times:[t1,t2]},key,t1),true);
 }
});

test('interval fields exclude initialization without hiding instantaneous fields or later intervals',()=>{
 const keys=['precipitation','precipitation_probability','rain','showers','snowfall_water_equivalent','shortwave_radiation','direct_radiation','diffuse_radiation'];
 const meta={...surface,variables:[...surface.variables,...keys]};
 for(const key of keys){
  assert.equal(hasFieldTime(meta,key,t0),false,key);
  assert.equal(fieldDataURL(meta,key,run),null,'Equivalent UTC timestamps still identify initialization');
  assert.equal(hasFieldTime(meta,key,t1),true,key);
  assert.equal(fieldSource(meta,key),meta,'Source notes retain the original interval boundaries');
  assert.equal(hasFieldTime({...meta,valid_times:[t1,t2]},key,t1),true,'Do not drop an already-trimmed first interval');
 }
 assert.equal(hasFieldTime(meta,'temperature_2m',t0),true);
 assert.equal(hasFieldTime({...meta,reference_time:undefined},'precipitation',t0),true,'Do not guess initialization when metadata omits it');
 assert.equal(hasFieldTime({...meta,valid_times:[t0,t2]},'precipitation',t1),false,'Do not fill gaps');
});

test('GFS keeps surface fields on the fine grid and routes pressure and upper air to its companion',()=>{
 const meta=combineSources(surface,[upper]);
 assert.equal(sourceVariable(meta,'pressure_msl'),'pressure_msl');
 assert.equal(fieldSource(meta,'temperature_2m',t1).domain,'ncep_gfs013');
 assert.equal(fieldSource(meta,'pressure_msl',t1).domain,'ncep_gfs025');
 assert.equal(fieldDataURL(meta,'pressure_msl',t1),SPATIAL_BASE+'ncep_gfs025/2026/10/09/0600Z/2026-10-09T0700.om');
 assert.equal(fieldDataURL(meta,'temperature_850hPa',t1),SPATIAL_BASE+'ncep_gfs025/2026/10/09/0600Z/2026-10-09T0700.om');
 const fields=['temperature_2m','temperature_850hPa','wind_gusts_10m'].map(key=>({key,name:key}));
 assert.equal(availableFields(fields,[meta]).length,3);
});
test('a companion cannot create pressure at missing hours or combine different forecast cycles',()=>{
 const meta=combineSources(surface,[upper]);
 assert.equal(hasFieldTime(meta,'temperature_2m',t2),true);
 assert.equal(hasFieldTime(meta,'pressure_msl',t2),false);
 assert.equal(fieldDataURL(meta,'pressure_msl',t2),null);
 const mismatched=combineSources(surface,[{...upper,reference_time:'2026-10-09T00:00:00Z'}]);
 assert.equal(sourceVariable(mismatched,'pressure_msl'),null);
});
test('wind vectors cannot borrow missing components from another grid',()=>{
 const meta=combineSources({...surface,variables:['wind_u_component_10m']},[{...upper,variables:['wind_v_component_10m']}]);
 assert.equal(sourceVariable(meta,'wind_speed_10m'),null);
 assert.equal(fieldSource(meta,'wind_speed_10m',t1),null);
});
test('latest GFS fetches companion metadata for the exact selected cycle',async()=>{
 const requested=[];
 const meta=await loadSpatialModel('gfs_global',async url=>{
  requested.push(url);
  if(url===SPATIAL_BASE+'ncep_gfs013/latest.json')return surface;
  if(url.endsWith('/in-progress.json'))throw Object.assign(Error('Not updating'),{status:404});
  if(url===SPATIAL_BASE+'ncep_gfs025/2026/10/09/0600Z/meta.json')return upper;
  throw new Error('Unexpected URL: '+url);
 },'latest');
 assert.equal(requested.length,3);
 assert.equal(meta.sources.length,2);
 assert.deepEqual(meta.sourceWarnings,[]);
});
test('missing or mismatched companion data preserves surface forecasts and reports the partial feed',async()=>{
 for(const companion of [null,{...upper,reference_time:'2026-10-09T00:00:00Z'}]){
  const meta=await loadSpatialModel('gfs_global',async url=>{
   if(url.endsWith('ncep_gfs013/latest.json')||url.endsWith('/in-progress.json'))return surface;
   if(companion)return companion;
   throw new Error('Not yet published');
  },'latest');
  assert.equal(hasFieldTime(meta,'temperature_2m',t1),true);
  assert.equal(sourceVariable(meta,'pressure_msl'),null);
  assert.equal(meta.sourceWarnings.length,1);
 }
});
test('latest mode never substitutes an older longer run',async()=>{
 const requested=[];
 const meta=await loadSpatialModel('gfs_global',async url=>{
  requested.push(url);
  if(url===SPATIAL_BASE+'ncep_gfs013/latest.json')return surface;
  if(url.endsWith('/in-progress.json'))throw Object.assign(Error('Not updating'),{status:404});
  if(url===SPATIAL_BASE+'ncep_gfs025/2026/10/09/0600Z/meta.json')return upper;
  throw new Error('Older run unexpectedly requested');
 });
 assert.equal(meta.reference_time,run);
 assert.equal(requested.length,3);
});
test('UTC timestamp formatting differences identify the same forecast hour',()=>{
 const meta=combineSources(surface,[{...upper,valid_times:['2026-10-09T07:00:00.000Z']}]);
 assert.equal(hasFieldTime(meta,'pressure_msl','2026-10-09T07:00Z'),true);
 assert.equal(fieldDataURL(meta,'pressure_msl','2026-10-09T07:00Z'),SPATIAL_BASE+'ncep_gfs025/2026/10/09/0600Z/2026-10-09T0700.om');
});
test('ordinary models keep their existing feed and do not request GFS data',async()=>{
 const meta=await loadSpatialModel('icon_eu',async url=>{
  assert.ok(['latest.json','in-progress.json'].some(path=>url===SPATIAL_BASE+'dwd_icon_eu/'+path));
  return {...surface,variables:['temperature_2m','pressure_msl']};
 },'latest');
 assert.equal(fieldSource(meta,'pressure_msl',t1).domain,'dwd_icon_eu');
});
