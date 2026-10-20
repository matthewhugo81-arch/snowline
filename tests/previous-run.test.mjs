import test from 'node:test';
import assert from 'node:assert/strict';
import {runCandidates,discoverPreviousRuns,previousRunTimes,previousRunPresets,previousRunHasChart,previousRunPeriodNote,newerRunAvailable,refreshPinnedRun} from '../map-previous-run-data.js';
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
test('three-run comparison locks valid time and retains each run’s complete intervals',()=>{
 const runs=[meta(-6),meta(-3),meta()],weather=BRIEFING_PRESETS.find(p=>p.id==='weather');
 const times=previousRunTimes(runs,weather,{regional:true});assert.equal(times[0],'2026-10-12T07:00:00.000Z');
 const shared='2026-10-12T13:00:00.000Z';assert.ok(times.includes(shared));
 assert.deepEqual(runs.map(m=>(Date.parse(shared)-Date.parse(m.reference_time))/3600000),[7,4,1]);
 const total=BRIEFING_PRESETS.find(p=>p.id==='precipitation_total_24h');const ending=previousRunTimes(runs,total,{regional:true})[0];
 assert.equal(ending,'2026-10-13T06:00:00.000Z');
 assert.deepEqual(runs.map(m=>previousRunHasChart(m,total,ending)),[true,false,false]);
 assert.deepEqual(previousRunPresets([runs[0],runs[0],runs[2]]),[]);
});

test('UKMO long runs reach T+168 despite an intervening T+60 run and different rain periods',()=>{
 const domain='ukmo_global_deterministic_10km',zero=Date.parse('2026-10-20T00:00Z'),at=h=>new Date(zero+h*3600000).toISOString();
 const make=(init,last)=>({...meta(),domain,reference_time:at(init),valid_times:Array.from({length:last+1},(_,i)=>i).filter(h=>h<=54||h%3===0).map(h=>at(init+h))});
 const runs=[make(-12,168),make(-6,60),make(0,168)],weather=BRIEFING_PRESETS[0],times=previousRunTimes(runs,weather,{});
 assert.equal(times.at(-1),at(168));assert.ok(times.includes(at(48)),'Different 1 h / 3 h rain periods must not hide a valid time');
 assert.match(previousRunPeriodNote(runs,weather,at(48)),/1 h \/ 3 h/);
 assert.deepEqual(runs.map(m=>previousRunHasChart(m,weather,at(72))),[true,false,true]);
 assert.deepEqual(runs.map(m=>previousRunHasChart(m,weather,at(168))),[false,false,true]);
 const total=BRIEFING_PRESETS.find(p=>p.id==='precipitation_total_24h');
 assert.equal(previousRunTimes(runs,total,{}).at(-1),at(168));
 assert.deepEqual(runs.map(m=>previousRunHasChart(m,total,at(72))),[true,false,true]);
 assert.equal(previousRunPeriodNote(runs,total,at(72)),'');
});

test('sparse per-variable publications retain other runs’ times without inventing a chart',()=>{
 const p={id:'height',field:'geopotential_height_500hPa',required:['geopotential_height_500hPa']};
 const runs=[meta(-12),meta(-6),meta()].map(m=>({...m,variables:p.required}));
 const all=previousRunTimes(runs,p,{},'native'),end=all.at(-1);
 runs[2]={...runs[2],variable_valid_times:{geopotential_height_500hPa:[end]}};
 const times=previousRunTimes(runs,p,{},'native');
 assert.ok(times.includes(end));assert.ok(times.includes(runs[0].valid_times[1]));
 assert.equal(previousRunHasChart(runs[2],p,runs[2].valid_times[1]),false);
 assert.equal(previousRunHasChart(runs[2],p,end),true);
});

test('pinned runs gain newly published hours and layers without changing cycles or regressing',()=>{
 const runs=[meta(-12),meta(-6),{...meta(0,8),completed:false}],refs=runs.map(m=>m.reference_time);
 const incoming={...meta(0,24),variables:[...meta().variables,'geopotential_height_500hPa']};
 const grown=refreshPinnedRun(runs,incoming);
 assert.deepEqual(grown.map(m=>m.reference_time),refs);assert.equal(grown[0],runs[0]);assert.equal(grown[1],runs[1]);
 const p={id:'height',field:'geopotential_height_500hPa',required:['geopotential_height_500hPa']};
 assert.equal(previousRunHasChart(grown[2],p,incoming.valid_times.at(-1)),true);
 const retained=refreshPinnedRun(grown,runs[2]);
 assert.equal(previousRunHasChart(retained[2],p,incoming.valid_times.at(-1)),true);
 assert.equal(retained[2].completed,true);
 assert.equal(refreshPinnedRun(grown,meta(6)),grown,'A new initialization only raises a notice; it never replaces pinned runs');
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
   calls.push(url);if(url.includes('_extra_v2/'))throw Object.assign(Error('Not yet prepared'),{status:404});assert.ok(url.includes('/ensemble-data/'+domain+'/'));
   if(url.endsWith('history.json'))return {format_version:1,runs:[...runs.map(m=>m.reference_time),runs[0].reference_time,meta(6).reference_time,meta(-54).reference_time]};
   const found=runs.find(m=>url.includes(new Date(m.reference_time).toISOString().slice(0,10).replaceAll('-','/')+'/'+new Date(m.reference_time).toISOString().slice(11,13)+'00Z/meta.json'));
   assert.ok(found,'Only listed, valid archive cycles are requested');return found;
  };
  const result=await discoverPreviousRuns({model:domain,latest:runs[0],load});
  assert.equal(result.errors.length,0);assert.equal(calls.filter(url=>!url.includes('_extra_v2/')).length,3);
  assert.equal(calls.filter(url=>url.includes('_extra_v2/')).length,2);
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

test('MOGREPS-G discovers retained archive cycles across both publication sites',async()=>{
 const domain='snowline_mogreps_global',runs=[0,-6,-12].map(h=>({...meta(h),domain})),calls=[];
 for(const unavailableSite of [null,'companion','original']){
  const result=await discoverPreviousRuns({model:domain,latest:runs[0],load:async url=>{
   const companion=url.includes('snowline-ensembles');
   if(unavailableSite===(companion?'companion':'original'))throw Object.assign(Error('No index'),{status:404});
   return {format_version:1,runs:companion?[runs[0].reference_time]:runs.map(m=>m.reference_time)};
  },loadRun:async(model,time)=>{calls.push(time);assert.equal(model,domain);const run=runs.find(m=>Date.parse(m.reference_time)===Date.parse(time));assert.ok(run);return run;}});
  assert.equal(result.runs.length,unavailableSite==='original'?1:3);
  assert.equal(result.errors.length,0);
 }
 assert.equal(calls.length,4,'Listed older runs are verified once each; no latest-run substitution');
});
