import test from 'node:test';
import assert from 'node:assert/strict';
import {runCandidates,discoverPreviousRuns,previousRunTimes,previousRunPresets,newerRunAvailable} from '../map-previous-run-data.js';
import {loadSpatialRun,fieldDataURL} from '../map-sources.js';
import {BRIEFING_PRESETS} from '../map-briefing-data.js';
const main='ukmo_uk_deterministic_2km',nowcast=main+'_nowcast',ref='2026-10-12T12:00:00Z';
const meta=(hours=0,last=54)=>({domain:main,reference_time:new Date(Date.parse(ref)+hours*3600000).toISOString(),completed:true,variables:['temperature_2m','relative_humidity_2m','cloud_cover','precipitation','pressure_msl'],valid_times:Array.from({length:last+1},(_,i)=>new Date(Date.parse(ref)+(hours+i)*3600000).toISOString())});

test('history candidates preserve UKV main/nowcast separation and UTC midnight',()=>{
 assert.equal(runCandidates(main,ref).length,16);assert.equal(runCandidates(main,ref)[0],'2026-10-12T09:00:00.000Z');
 assert.equal(runCandidates(main,ref)[4],'2026-10-11T21:00:00.000Z');
 assert.ok(runCandidates(nowcast,'2026-10-12T13:00:00Z').every(t=>new Date(t).getUTCHours()%3!==0));
 assert.throws(()=>runCandidates(main,ref,100),/48/);
});
test('archived loading requests the exact cycle and never falls back to latest',async()=>{
 const calls=[],m=meta(-3);const data=await loadSpatialRun(main,m.reference_time,async url=>{calls.push(url);return m;});
 assert.equal(data.reference_time,m.reference_time);assert.equal(calls.length,1);assert.match(calls[0],/0900Z\/meta.json$/);
 await assert.rejects(loadSpatialRun(main,m.reference_time,async()=>meta(0)),/does not match/);
 await assert.rejects(loadSpatialRun(nowcast,m.reference_time,async()=>m),/family/);
});
test('failed metadata checks are distinguished from expired or unpublished cycles',async()=>{
 const latest=meta(),result=await discoverPreviousRuns({model:'icon_eu',latest,lookbackHours:12,loadRun:async(model,time)=>{
  const hour=new Date(time).getUTCHours();if(hour===6)throw Object.assign(Error('Gone'),{status:404});if(hour===3)throw Error('Timeout');return meta((Date.parse(time)-Date.parse(ref))/3600000);
 }});
 assert.deepEqual(result.runs.map(m=>new Date(m.reference_time).getUTCHours()),[12,9,0]);assert.equal(result.unavailable.length,1);assert.equal(result.errors.length,1);
});
test('three-run comparison locks valid time, not lead time, and uses only common complete intervals',()=>{
 const runs=[meta(-6),meta(-3),meta()],weather=BRIEFING_PRESETS.find(p=>p.id==='weather');
 const times=previousRunTimes(runs,weather,{regional:true});assert.equal(times[0],'2026-10-12T13:00:00.000Z');
 assert.deepEqual(runs.map(m=>(Date.parse(times[0])-Date.parse(m.reference_time))/3600000),[7,4,1]);
 const total=BRIEFING_PRESETS.find(p=>p.id==='precipitation_total_24h');const ending=previousRunTimes(runs,total,{regional:true})[0];
 assert.equal(ending,'2026-10-13T12:00:00.000Z');
 assert.deepEqual(previousRunPresets([runs[0],runs[0],runs[2]]),[]);
});
test('history omits unsupported fields and never changes pinned runs when a new cycle arrives',()=>{
 const runs=[meta(-6),meta(-3),meta()],refs=runs.map(m=>m.reference_time);assert.ok(previousRunPresets(runs).some(p=>p.id==='dew-point'));
 assert.ok(!previousRunPresets(runs).some(p=>p.id==='temperature-max'));
 assert.equal(newerRunAvailable(runs,meta(3)),true);assert.equal(newerRunAvailable(runs,meta()),false);assert.deepEqual(runs.map(m=>m.reference_time),refs);
});

test('ensemble history loads three distinct exact cycles from the publication index',async()=>{
 for(const [domain,cadence] of [['snowline_gefs_ensemble',6],['snowline_ecmwf_ensemble',12]]){
  const runs=[0,-cadence,-2*cadence].map(h=>({...meta(h),domain,variables:['temperature_850hPa_mean','temperature_850hPa_spread','pressure_msl_mean']}));
  const calls=[];
  const load=async url=>{
   calls.push(url);if(url.includes('_extra/'))throw Object.assign(Error('Not yet prepared'),{status:404});assert.ok(url.includes('/ensemble-data/'+domain+'/'));
   if(url.endsWith('history.json'))return {format_version:1,runs:[...runs.map(m=>m.reference_time),runs[0].reference_time,meta(6).reference_time,meta(-54).reference_time]};
   const found=runs.find(m=>url.includes(new Date(m.reference_time).toISOString().slice(0,10).replaceAll('-','/')+'/'+new Date(m.reference_time).toISOString().slice(11,13)+'00Z/meta.json'));
   assert.ok(found,'Only listed, valid archive cycles are requested');return found;
  };
  const result=await discoverPreviousRuns({model:domain,latest:runs[0],load});
  assert.equal(result.errors.length,0);assert.equal(calls.filter(url=>!url.includes('_extra/')).length,3);
  assert.equal(calls.filter(url=>url.includes('_extra/')).length,2);
  assert.deepEqual(result.runs.map(m=>m.reference_time),runs.map(m=>m.reference_time));
  for(const archived of result.runs.slice(1))assert.match(fieldDataURL(archived,'temperature_850hPa_spread',archived.valid_times[1]),new RegExp('/ensemble-data/'+domain+'/'));
  const time=previousRunTimes(result.runs,{id:'temperature_850hPa_spread',field:'temperature_850hPa_spread',required:['temperature_850hPa_spread']},{regional:false})[0];
  assert.ok(time);assert.equal(new Set(result.runs.map(m=>(Date.parse(time)-Date.parse(m.reference_time))/3600000)).size,3);
  await assert.rejects(loadSpatialRun(domain,runs[1].reference_time,async()=>runs[0]),/does not match/);
 }
});

test('an unavailable ensemble archive never falls back to latest or another model',async()=>{
 const latest={...meta(),domain:'snowline_gefs_ensemble'};let calls=0;
 const result=await discoverPreviousRuns({model:latest.domain,latest,load:async()=>{throw Error('network unavailable');},loadRun:async()=>{calls++;return latest;}});
 assert.deepEqual(result.runs,[latest]);assert.equal(calls,0);assert.equal(result.errors.length,1);assert.match(result.notice,/could not be checked/);
});
