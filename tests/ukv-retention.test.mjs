import test from 'node:test';
import assert from 'node:assert/strict';
import {UKV,UKV_NOWCAST} from '../ukv-run-selection.js';
import {MAP_MODELS,MAP_RUN_CHOICES} from '../map-models.js';
import {UKV_PREVIOUS,previousCompletedUKV,createMapRunLoader,completedUKV} from '../map-ukv-runs.js';
import {fieldDataURL,loadSpatialRun} from '../map-sources.js';
import {discoverPreviousRuns,previousRunPresets,previousRunTimes} from '../map-previous-run-data.js';
import {modelOptionLabel} from '../map-model-run-menu.js';
import {BRIEFING_PRESETS} from '../map-briefing-data.js';
const hour=3600000,origin=Date.parse('2026-10-13T00:00Z');
const run=(offset,completed=true,horizon=54)=>({domain:UKV,reference_time:new Date(origin+offset*hour).toISOString(),completed,
 variables:['temperature_2m','precipitation','cloud_cover','pressure_msl'],valid_times:Array.from({length:horizon+1},(_,i)=>new Date(origin+(offset+i)*hour).toISOString())});
const missing=()=>Object.assign(Error('Absent'),{status:404});
function archive(records){const calls=[];return {calls,loadRun:async(model,ref)=>{calls.push(ref);assert.equal(model,UKV);const record=records.get(Date.parse(ref));if(record instanceof Error)throw record;if(!record)throw missing();return record;}};}
const records=(...runs)=>new Map(runs.map(m=>[Date.parse(m.reference_time),m]));

test('one operational UKV has precisely latest/previous map choices, no nowcast or unrelated duplicates',()=>{
 assert.equal(MAP_MODELS.filter(m=>m.id.startsWith(UKV)).length,1);
 assert.deepEqual(MAP_RUN_CHOICES.filter(m=>m.sourceModel===UKV).map(m=>m.id),[UKV,UKV_PREVIOUS]);
 assert.ok(!MAP_RUN_CHOICES.some(m=>m.id===UKV_NOWCAST));
 assert.deepEqual(MAP_RUN_CHOICES.filter(m=>m.sourceModel!==UKV),MAP_MODELS.filter(m=>m.id!==UKV));
});
test('partial latest retains one explicitly completed main run and all its hourly steps',async()=>{
 const latest=run(3,false,7),previous=run(0),a=archive(records(previous,run(-3)));
 const result=await previousCompletedUKV(latest,null,a.loadRun);
 assert.equal(result.previous,previous);assert.equal(a.calls.length,1);assert.equal(previous.valid_times.length,55);
 assert.equal(latest.valid_times.length,8);assert.equal(latest.completed,false);
});
test('incomplete, missing and unknown completion cycles are skipped, including across midnight',async()=>{
 const unknown=run(-6);delete unknown.completed;
 const a=archive(records(run(-3,false),unknown,run(-12)));
 const result=await previousCompletedUKV(run(0,false,2),null,a.loadRun);
 assert.equal(result.previous.reference_time,run(-12).reference_time);
 assert.deepEqual(a.calls.map(t=>new Date(t).getUTCHours()),[21,18,15,12]);
 assert.equal(completedUKV(run(-1)),false);
});
test('incorrect archive identity and transient errors keep only an already verified fallback',async()=>{
 for(const failure of [Error('Timeout'),Object.assign(Error('server'),{status:503}),run(-3)]){
  const a=archive(new Map([[origin,failure]]));
  const result=await previousCompletedUKV(run(3,false),null,a.loadRun,run(-6));
  assert.equal(result.previous.reference_time,run(-6).reference_time);assert.equal(result.warnings.length,1);assert.equal(a.calls.length,1);
  assert.equal((await previousCompletedUKV(run(3,false),null,a.loadRun)).previous,null);
 }
});
test('empty history is explicit and bounded; a partial run is never promoted',async()=>{
 const a=archive(records(run(0,false)));
 assert.equal((await previousCompletedUKV(run(3,false),null,a.loadRun)).previous,null);
 assert.equal(a.calls.length,16);
 await assert.rejects(previousCompletedUKV(run(3),null,a.loadRun,null,{lookbackHours:100}),/48/);
});
test('an empty incomplete archive is skipped without hiding a completed older fallback',async()=>{
 const empty={...run(0,false),valid_times:[]},prior=run(-3);
 const load=async url=>url.includes('/0000Z/')?empty:prior;
 await assert.rejects(loadSpatialRun(UKV,empty.reference_time,load),error=>error.code==='NO_PUBLISHED_HOURS');
 assert.equal((await previousCompletedUKV(run(3,false),load)).previous.reference_time,prior.reference_time);
});
test('latest completion keeps the prior run; the next cycle rolls the pair, skipping failed intermediate runs',async()=>{
 let latest=run(3,false,8);const data=records(run(0)),a=archive(data),loader=createMapRunLoader({loadModel:async()=>latest,loadRun:a.loadRun});
 const get=()=>loader(UKV,async()=>{});
 assert.equal((await get()).previousCompletedRun.reference_time,run(0).reference_time);
 latest=run(3,true);assert.equal((await get()).previousCompletedRun.reference_time,run(0).reference_time);
 latest=run(6,false,2);data.set(origin+3*hour,run(3,true));
 let result=await get();assert.equal(result.previousCompletedRun.reference_time,run(3).reference_time);
 assert.equal(result.previousCompletedRun.previousCompletedRun,undefined);
 latest=run(9,false,2);data.set(origin+6*hour,run(6,false,9));
 result=await get();assert.equal(result.previousCompletedRun.reference_time,run(3).reference_time);
 assert.deepEqual(result.valid_times,latest.valid_times);
});
test('stale metadata cannot regress the latest cycle, previous cycle or completion',async()=>{
 let latest=run(3),data=records(run(0)),a=archive(data),loader=createMapRunLoader({loadModel:async()=>latest,loadRun:a.loadRun});
 await loader(UKV,async()=>{});latest=run(6,false,3);data.set(origin+3*hour,run(3));await loader(UKV,async()=>{});
 latest=run(3,false,1);const current=await loader(UKV,async()=>{});
 assert.equal(current.reference_time,run(6).reference_time);assert.equal(current.previousCompletedRun.reference_time,run(3).reference_time);
 assert.match(current.sourceWarnings.join(' '),/older initialization/);
});
test('concurrent checks resolving out of order cannot restore a retired pair',async()=>{
 let release;const older=new Promise(r=>release=r);let calls=0;
 const a=archive(records(run(0),run(3))),loader=createMapRunLoader({loadModel:()=>++calls===1?older:Promise.resolve(run(6,false,2)),loadRun:a.loadRun});
 const pending=loader(UKV,async()=>{});await loader(UKV,async()=>{});release(run(3,false,4));
 const result=await pending;assert.equal(result.reference_time,run(6).reference_time);assert.equal(result.previousCompletedRun.reference_time,run(3).reference_time);
});
test('both choices coalesce a check and use exact-cycle URLs, with no cross-cycle fallback or accumulation stitching',async()=>{
 let calls=0;const a=archive(records(run(0))),loader=createMapRunLoader({loadModel:async()=>{calls++;return run(3,false,2);},loadRun:a.loadRun}),load=async()=>{};
 const [latest,previous]=await Promise.all([loader(UKV,load),loader(UKV_PREVIOUS,load)]);
 assert.equal(calls,1);assert.equal(a.calls.length,1);
 const time=run(3).valid_times[1];assert.match(fieldDataURL(latest,'temperature_2m',time),/0300Z/);assert.match(fieldDataURL(previous,'temperature_2m',time),/0000Z/);
 assert.equal(fieldDataURL(latest,'temperature_2m',run(3).valid_times[10]),null);
 assert.equal(fieldDataURL(latest,'precipitation_total_6h',run(3).valid_times[6]),null);
 assert.match(fieldDataURL(previous,'precipitation_total_6h',run(0).valid_times[6]),/0000Z/);
 assert.match(modelOptionLabel(MAP_RUN_CHOICES.find(m=>m.id===UKV),{meta:latest}),/03Z · updating/);
 assert.match(modelOptionLabel(MAP_RUN_CHOICES.find(m=>m.id===UKV_PREVIOUS),{meta:previous}),/previous completed.*00Z/);
});
test('history exposes exactly the same UKV pair and compares only overlapping valid times',async()=>{
 const latest={...run(3,false,8),previousCompletedRun:run(0)},a=archive(records(run(0),run(-3))),result=await discoverPreviousRuns({model:UKV,latest,loadRun:a.loadRun});
 assert.deepEqual(result.runs.map(m=>m.reference_time),[run(3).reference_time,run(0).reference_time]);assert.equal(a.calls.length,0);
 const weather=BRIEFING_PRESETS.find(p=>p.id==='weather');
 assert.ok(previousRunPresets(result.runs,2).some(p=>p.id==='weather'));
 const times=previousRunTimes(result.runs,weather,{id:UKV,regional:true});
 assert.equal(times.length,8);assert.equal(times[1],run(3).valid_times[2]);
 assert.deepEqual(previousRunTimes([latest,latest],weather,{id:UKV}),[]);
});
test('a fresh page rediscovers its completed fallback from the provider archive',async()=>{
 const latest=run(3,false,8),prior=run(0),calls=[];
 const load=async url=>{calls.push(url);if(url.endsWith('/latest.json'))return prior;if(url.endsWith('/in-progress.json'))return latest;if(url.includes('/0000Z/meta.json'))return prior;throw missing();};
 const loader=createMapRunLoader(),m=await loader(UKV_PREVIOUS,load);
 assert.equal(m.reference_time,prior.reference_time);assert.ok(calls.some(u=>u.includes('/0000Z/meta.json')));
});
