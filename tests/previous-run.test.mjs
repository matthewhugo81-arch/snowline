import test from 'node:test';
import assert from 'node:assert/strict';
import {runCandidates,discoverPreviousRuns,previousRunTimes,previousRunPresets,newerRunAvailable} from '../map-previous-run-data.js';
import {loadSpatialRun} from '../map-sources.js';
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
 const latest=meta(),result=await discoverPreviousRuns({model:main,latest,lookbackHours:12,loadRun:async(model,time)=>{
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
