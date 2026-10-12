import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {ACCUMULATION_HOURS,ACCUMULATION_KEYS,accumulationKey,accumulationHours,accumulationField,accumulationPlan,accumulationSlots,precipitationStepHours,accumulationPeriod} from '../map-accumulation.js';
import {RollingAccumulations,SharedGridReads,accumulationFiles,installAccumulations} from '../map-accumulation-reader.js';
import {sourceVariable,extendCatalogue,availableFields} from '../map-catalogue.js';
import {fieldSource,fieldDataURL,hasFieldTime} from '../map-sources.js';
const ref='2026-10-12T00:00:00Z',time=h=>new Date(Date.parse(ref)+h*3600000).toISOString();
const meta=(domain='ukmo_uk_deterministic_2km',last=120)=>({domain,reference_time:ref,variables:['precipitation','temperature_2m','pressure_msl'],valid_times:Array.from({length:last+1},(_,i)=>time(i)).filter((t,i)=>i===0||i%precipitationStepHours(domain,i)===0)});
const url=(h,domain='ukmo_uk_deterministic_2km')=>'https://openmeteo.s3.amazonaws.com/data_spatial/'+domain+'/2026/10/12/0000Z/'+time(h).slice(0,16).replace(':','')+'.om';
const hour=url=>Number(url.match(/T(\d{2})00\.om/)?.[1]);

test('exactly the requested periods, one fixed mm scale and complete run-bounded windows',()=>{
 assert.deepEqual(ACCUMULATION_HOURS,[6,12,18,24,36,48,72,120]);
 for(const hours of ACCUMULATION_HOURS){const plan=accumulationPlan(meta(),accumulationKey(hours),time(hours));assert.equal(plan.times.length,hours);assert.equal(Date.parse(plan.start),Date.parse(ref));assert.equal(plan.hours,hours);assert.equal(accumulationPlan(meta(),accumulationKey(hours),time(hours-1)),null);assert.deepEqual(accumulationField(accumulationKey(hours)).stops,accumulationField(ACCUMULATION_KEYS[0]).stops);}
 assert.equal(accumulationHours('precipitation_probability'),null);assert.equal(accumulationHours('precipitation_total_7h'),null);
});
test('native step transitions correctly join hourly, three-hourly and six-hourly amounts',()=>{
 const m=meta('ecmwf_ifs',168),plan=accumulationPlan(m,accumulationKey(120),time(168));assert.ok(plan);assert.equal(plan.times.length,42+18+4);
 assert.equal(accumulationPlan(m,accumulationKey(6),time(150)).times.length,1);
 assert.equal(accumulationPlan(meta('ncep_gfs013',150),accumulationKey(24),time(132)).times.length,12+4);
 assert.equal(accumulationSlots('ecmwf_aifs025_single',ref,time(12),6).length,1);
 assert.equal(accumulationSlots('ecmwf_aifs025_single',ref,time(13),6),null);
});
test('missing published steps do not become zero or a longer time interval',()=>{
 const m=meta();m.valid_times=m.valid_times.filter(t=>Date.parse(t)!==Date.parse(time(4)));
 assert.equal(accumulationPlan(m,accumulationKey(6),time(6)),null);assert.ok(accumulationPlan(m,accumulationKey(6),time(12)));
 const coarse=meta('ecmwf_ifs',168);coarse.valid_times=coarse.valid_times.filter(t=>Date.parse(t)!==Date.parse(time(147))&&Date.parse(t)!==Date.parse(time(138)));
 assert.equal(accumulationPlan(coarse,accumulationKey(24),time(144)),null);
 assert.ok(accumulationPlan(coarse,accumulationKey(6),time(150)));
});
test('54-hour runs and 12-hour nowcasts cannot manufacture longer totals or change cycles',()=>{
 for(const h of [72,120])assert.equal(sourceVariable(meta(undefined,54),accumulationKey(h)),null);
 assert.ok(sourceVariable(meta(undefined,54),accumulationKey(48)));
 assert.equal(sourceVariable(meta(undefined,12),accumulationKey(18)),null);
 const newer=meta(undefined,4),older={...meta(),reference_time:time(-6)};
 assert.equal(accumulationPlan({...newer,sources:[newer,older]},accumulationKey(6),time(4)),null);
});
test('only actual total precipitation with verified cadence is exposed; probability/rain are not substituted',()=>{
 for(const m of [{...meta(),variables:['rain']},{...meta(),variables:['precipitation_probability']},{...meta(),domain:'unknown_feed'}])assert.equal(sourceVariable(m,accumulationKey(6)),null);
 const fields=[],settings={colorScales:{}};extendCatalogue(fields,[meta(undefined,24)],OM,settings);
 assert.deepEqual(availableFields(fields,[meta(undefined,24)]).filter(f=>accumulationHours(f.key)).map(f=>accumulationHours(f.key)),[6,12,18,24]);
 assert.equal(settings.colorScales.precipitation_total_24h.unit,'mm water');
});
test('URLs, point readouts and legends retain the exact single run and period across midnight',()=>{
 const m=meta();assert.equal(fieldSource(m,accumulationKey(24),time(30)),m);assert.ok(hasFieldTime(m,accumulationKey(24),time(30)));
 const u=fieldDataURL(m,accumulationKey(24),time(30)),files=accumulationFiles(u,accumulationKey(24));
 assert.equal(files.urls.length,24);assert.equal(files.urls[0],url(7));assert.equal(files.urls.at(-1),url(30));
 assert.match(accumulationPeriod(accumulationKey(24),time(30)),/12 Oct.*06:00.*13 Oct.*06:00 UTC/);
});
test('numerical sums preserve zero, fractional amounts, missing and negative source cells',async()=>{
 const totals=new RollingAccumulations(async u=>Float32Array.from([0,.25,hour(u)===2?NaN:1,hour(u)===2?-1:1,2]));
 const data=await totals.read(url(6),accumulationKey(6),null);
 assert.deepEqual([...data.values].map(v=>Number.isNaN(v)?null:v),[0,1.5,null,null,12]);assert.equal(data.scaleFactor,100);
 assert.equal(totals.inputs.stats.reads,6);totals.clear();
});
test('rolling one hour ahead downloads only entering/leaving intervals and repairs missing-cell masks',async()=>{
 const totals=new RollingAccumulations(async u=>Float32Array.from([hour(u),hour(u)===1?NaN:1]));
 await totals.read(url(6),accumulationKey(6),null);const data=await totals.read(url(7),accumulationKey(6),null);
 assert.deepEqual([...data.values],[27,6]);assert.equal(totals.stats.rolling,1);assert.equal(totals.inputs.stats.reads,7);
 const first=await totals.read(url(6),accumulationKey(6),null);assert.equal(first.values[0],21);assert.ok(Number.isNaN(first.values[1]));totals.clear();
});
test('window, area, model and run changes cannot reuse incompatible rolling grids',async()=>{
 const totals=new RollingAccumulations(async()=>Float32Array.of(1));
 await totals.read(url(6),accumulationKey(6),[{start:0,end:1}]);
 assert.equal((await totals.read(url(12),accumulationKey(12),[{start:0,end:1}])).values[0],12);
 await totals.read(url(7),accumulationKey(6),[{start:1,end:2}]);
 assert.equal(totals.stats.full,3);assert.equal(totals.stats.rolling,0);totals.clear();
});
test('input failures are not cached as dry weather and a retry can succeed',async()=>{
 let broken=true;const totals=new RollingAccumulations(async u=>{if(hour(u)===3&&broken)throw Error('HTTP 404');return Float32Array.of(1);});
 await assert.rejects(totals.read(url(6),accumulationKey(6),null),/404/);assert.equal(totals.snapshots.size,0);
 broken=false;assert.equal((await totals.read(url(6),accumulationKey(6),null)).values[0],6);totals.clear();
});
test('parallel panels share input requests, respect concurrency, and cancel independently',async()=>{
 let calls=0;const reads=new SharedGridReads(async(u,r,s)=>{calls++;await new Promise(r=>setTimeout(r,5));s.throwIfAborted();return Float32Array.of(1);},{concurrency:2});
 const c=new AbortController(),a=reads.get('same',null,c.signal),b=reads.get('same',null);c.abort();await assert.rejects(a);assert.equal((await b)[0],1);assert.equal(calls,1);
 await Promise.all(Array.from({length:10},(_,i)=>reads.get(String(i),null)));assert.ok(reads.stats.peak<=2);reads.clear();
});
test('memory retention stays bounded and transferred output cannot corrupt a rolling snapshot',async()=>{
 const totals=new RollingAccumulations(async()=>new Float32Array(10).fill(1),{maxBytes:160,maxSnapshotBytes:100});
 const first=await totals.read(url(6),accumulationKey(6),null);structuredClone(first.values,{transfer:[first.values.buffer]});
 const next=await totals.read(url(7),accumulationKey(6),null);assert.equal(next.values[0],6);assert.ok(totals.inputs.bytes<=160);assert.ok(totals.snapshotBytes<=100);totals.clear();
});
test('install is idempotent and leaves ordinary reader requests untouched',async()=>{
 const calls=[],reader={config:{useSAB:false},readVariable:async(u,k)=>{calls.push(k);return {values:Float32Array.of(1)};},prefetchVariable:async()=>{}};
 const fake={getProtocolInstance:()=>({omFileReader:reader})},settings={};
 assert.equal(installAccumulations(fake,settings),installAccumulations(fake,settings));
 await reader.readVariable(url(6),'temperature_2m');assert.deepEqual(calls,['temperature_2m']);
 assert.equal((await reader.readVariable(url(6),accumulationKey(6))).values[0],6);
});
