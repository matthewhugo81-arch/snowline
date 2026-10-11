import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSpatialModel,SPATIAL_BASE,hasFieldTime,fieldDataURL} from '../map-sources.js';
import {UKV,UKV_NOWCAST} from '../ukv-run-selection.js';
import {MAP_MODELS} from '../map-models.js';

const time=h=>new Date(Date.UTC(2026,9,11,h)).toISOString();
const run=(cycle,hours,completed=false)=>({reference_time:time(cycle),completed,variables:['temperature_2m','precipitation','cloud_cover','pressure_msl'],valid_times:hours.map(h=>time(cycle+h))});
const missing=()=>Object.assign(Error('Not available'),{status:404});
test('every remote model uses the arriving feed and keeps only published hours',async()=>{
 for(const model of MAP_MODELS.filter(model=>!model.id.startsWith('snowline_'))){
  const meta=await loadSpatialModel(model.id,async url=>{
   if(url.endsWith('in-progress.json'))return run(model.id===UKV_NOWCAST?13:12,[0,1,2]);
   if(url.endsWith('latest.json'))return run(6,[0,1,2,3,4,5,6],true);
   if(url.includes('/1200Z/meta.json'))return run(12,[0,1]);
   throw missing();
  });
  assert.equal(meta.reference_time,time(model.id===UKV_NOWCAST?13:12),model.id);
  assert.equal(meta.completed,false,model.id);
  assert.equal(hasFieldTime(meta,'temperature_2m',time(model.id===UKV_NOWCAST?16:15)),false);
 }
});
test('GFS surface and pressure advance independently within the same new cycle',async()=>{
 const meta=await loadSpatialModel('gfs_global',async url=>{
  if(url===SPATIAL_BASE+'ncep_gfs013/latest.json')return run(6,[0,1,2],true);
  if(url===SPATIAL_BASE+'ncep_gfs013/in-progress.json')return {...run(12,[0,1,2,3]),variables:['temperature_2m','cloud_cover']};
  if(url===SPATIAL_BASE+'ncep_gfs025/2026/10/11/1200Z/meta.json')return {...run(12,[0,1]),variables:['pressure_msl']};
  throw missing();
 });
 assert.equal(hasFieldTime(meta,'cloud_cover',time(15)),true);
 assert.equal(hasFieldTime(meta,'pressure_msl',time(15)),false);
 assert.match(fieldDataURL(meta,'pressure_msl',time(13)),/1200Z/);
});
test('UKV family discovery starts at the live frontier, beyond latest completed initialization',async()=>{
 const main=await loadSpatialModel(UKV,async url=>{
  if(url.endsWith('latest.json'))return run(9,[0,1,2],true);
  if(url.endsWith('in-progress.json'))return run(13,[0,1]);
  if(url.includes('/1200Z/meta.json'))return run(12,[0,1,2]);
  throw missing();
 });
 assert.equal(main.reference_time,time(12));assert.equal(main.completed,false);
});
test('temporary live endpoint failure is disclosed, with completed data still usable',async()=>{
 const meta=await loadSpatialModel('icon_global',async url=>{
  if(url.endsWith('latest.json'))return run(6,[0,1,2],true);
  throw Object.assign(Error('Service unavailable'),{status:503});
 });
 assert.equal(meta.reference_time,time(6));assert.match(meta.sourceWarnings.join(' '),/live run check failed/);
});
test('live data works when the completed pointer is unavailable',async()=>{
 const meta=await loadSpatialModel('icon_global',async url=>{
  if(url.endsWith('in-progress.json'))return run(12,[0,1]);
  throw missing();
 });
 assert.equal(meta.reference_time,time(12));
});
