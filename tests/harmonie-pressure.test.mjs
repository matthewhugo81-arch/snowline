import test from 'node:test';
import assert from 'node:assert/strict';
import {HARMONIE,withHarmoniePressure,verifiedHarmoniePressure} from '../map-harmonie-pressure.js';
import {fieldDataURL,hasFieldTime,loadSpatialModel,loadSpatialRun} from '../map-sources.js';
import {retainRunProgress} from '../map-runs.js';
import {completedModelRun} from '../map-run-selection.js';
const reference_time='2026-10-21T14:00:00Z';
const valid_times=Array.from({length:61},(_,h)=>new Date(Date.parse(reference_time)+h*3600000).toISOString());
const native={domain:HARMONIE,reference_time,completed:true,variables:['wind_gusts_10m','pressure_msl'],valid_times};
const pressure={...native,format_version:1,variables:['pressure_msl'],units:{pressure_msl:'hPa'},grid:{nx:676,ny:564,latMin:-13.6,lonMin:-13.5,dx:.05,dy:.05,southPoleLat:-35,southPoleLon:-8}};
test('refresh retains separate native and pressure sources and does not demote a complete gust run',async()=>{
 const partial=await withHarmoniePressure(native,async()=>({...pressure,completed:false,valid_times:valid_times.slice(0,3)}));
 assert.equal(completedModelRun(HARMONIE,partial),true);
 const full=await withHarmoniePressure(native,async()=>pressure);
 const refreshed=retainRunProgress(partial,full);
 assert.equal(refreshed.sources.length,2);
 assert.equal(refreshed.completed,true);
 assert.match(fieldDataURL(refreshed,'pressure_msl',valid_times[43]),/ensemble-data/);
 assert.match(fieldDataURL(refreshed,'wind_gusts_10m',valid_times[43]),/openmeteo/);
});
test('native pressure replaces the empty spatial field without changing gusts or run completeness',async()=>{
 const meta=await withHarmoniePressure(native,async()=>pressure,'https://example.test/ensemble-data/');
 assert.equal(meta.completed,true);
 assert.match(fieldDataURL(meta,'pressure_msl',valid_times[43]),/^https:\/\/example.test\/ensemble-data\/knmi_harmonie_arome_europe\/2026\/10\/21\/1400Z\/2026-10-23T0900.om$/);
 assert.match(fieldDataURL(meta,'wind_gusts_10m',valid_times[43]),/^https:\/\/openmeteo.s3.amazonaws.com/);
 assert.equal(hasFieldTime(meta,'pressure_msl','2026-10-24T03:00Z'),false);
});
test('missing, mismatched, duplicate or wrong-grid pressure fails closed while gusts remain available',async()=>{
 for(const bad of [null,{...pressure,reference_time:'2026-10-21T13:00Z'},{...pressure,grid:{}},{...pressure,units:{pressure_msl:'Pa'}},{...pressure,valid_times:Array(61).fill(valid_times[0])}]){
  assert.equal(verifiedHarmoniePressure(bad,reference_time),false);
  const meta=await withHarmoniePressure(native,async()=>bad);
  assert.equal(hasFieldTime(meta,'pressure_msl',valid_times[43]),false);
  assert.equal(hasFieldTime(meta,'wind_gusts_10m',valid_times[43]),true);
  assert.equal(meta.completed,true);
 }
});
test('latest and historical selections request only pressure from their exact initialization',async()=>{
 for(const archived of [false,true]){
  const urls=[];const load=async url=>{urls.push(url);return url.includes('ensemble-data')?pressure:native;};
  const meta=archived?await loadSpatialRun(HARMONIE,reference_time,load):await loadSpatialModel(HARMONIE,load);
  assert.equal(hasFieldTime(meta,'pressure_msl',valid_times[43]),true);
  assert.equal(urls.filter(u=>u.includes('ensemble-data')).length,1);
  assert.match(urls.find(u=>u.includes('ensemble-data')),/2026\/10\/21\/1400Z\/meta.json$/);
 }
});
