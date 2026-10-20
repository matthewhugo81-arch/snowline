import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunCatalogue,completedModelRun,selectedRunKey,sourceModel} from '../map-run-selection.js';
import {fieldDataURL} from '../map-sources.js';
const ref=h=>new Date(Date.UTC(2026,9,20,h)).toISOString();
const run=(h,completed=true,count=55)=>({domain:'ecmwf_ifs',reference_time:ref(h),completed,variables:['temperature_2m','precipitation'],valid_times:Array.from({length:count},(_,i)=>ref(h+i))});
const missing=()=>Object.assign(Error('missing'),{status:404});
function fixture(){
 let latest=run(6,false,4);const data=new Map([[ref(0),run(0)]]);let calls=0;
 const catalogue=createRunCatalogue({loadModel:async()=>{calls++;return latest;},loadRun:async(model,reference)=>{if(reference===latest.reference_time)return latest;if(!data.has(reference))throw missing();return data.get(reference);}});
 return {catalogue,data,setLatest:r=>latest=r,calls:()=>calls};
}
test('every model uses a complete default and a dated incoming choice',async()=>{
 for(const model of ['ecmwf_ifs','icon_global','gem_global','ukmo_uk_deterministic_2km','snowline_gefs_ensemble']){
  const f=fixture();f.setLatest(run(12,false,4));
  const result=await f.catalogue.select(model,async()=>({runs:[]}));
  assert.equal(result.meta.reference_time,ref(0));
  assert.equal(result.latest.reference_time,ref(12));
  assert.equal(result.previous.completed,true);
  assert.equal(sourceModel(result.key),model);
 }
});
test('two panels select the same model independently and share discovery',async()=>{
 const f=fixture(),load=async()=>({});
 const [old,incoming]=await Promise.all([f.catalogue.select('ecmwf_ifs',load),f.catalogue.select(selectedRunKey('ecmwf_ifs',run(6)),load)]);
 assert.equal(f.calls(),1);assert.notEqual(old.key,incoming.key);
 assert.match(fieldDataURL(old.meta,'temperature_2m',ref(7)),/0000Z/);
 assert.match(fieldDataURL(incoming.meta,'temperature_2m',ref(7)),/0600Z/);
 assert.equal(fieldDataURL(incoming.meta,'temperature_2m',ref(20)),null);
});

test('UKV completed-index hints cannot cross main and nowcast run families',async()=>{
 for(const [model,newest,hint,previous] of [['ukmo_uk_deterministic_2km',9,8,6],['ukmo_uk_deterministic_2km_nowcast',10,9,8]]){
  const requested=[];
  const catalogue=createRunCatalogue({
   loadModel:async()=>({...run(newest,false,1),completedReferenceTime:ref(hint)}),
   loadRun:async(id,reference)=>{
    requested.push(reference);
    if(reference===ref(hint))throw Error('Archived UKV run is in a different run family.');
    if(reference!==ref(previous))throw missing();
    return run(previous);
   }
  });
  const selected=await catalogue.select(model,async()=>({}));
  assert.equal(selected.meta.reference_time,ref(previous));
  assert.equal(selected.previous.reference_time,ref(previous));
  assert.equal(selected.warning,null);
  assert.ok(!requested.includes(ref(hint)));
 }
});
test('an open complete or incoming run remains pinned across completion and later cycles',async()=>{
 const f=fixture(),first=await f.catalogue.select('ecmwf_ifs',async()=>({}));
 f.setLatest(run(6));let r=await f.catalogue.select(first.key,async()=>({}));
 assert.equal(r.meta.reference_time,ref(0));
 f.data.set(ref(6),run(6));f.setLatest(run(12,false,3));
 r=await f.catalogue.select(first.key,async()=>({}));assert.equal(r.meta.reference_time,ref(0));assert.equal(r.previous.reference_time,ref(6));
 const incoming=await f.catalogue.select(selectedRunKey('ecmwf_ifs',run(12)),async()=>({}));
 f.setLatest(run(12,false,20));r=await f.catalogue.select(incoming.key,async()=>({}));assert.equal(r.meta.valid_times.length,20);
});
test('failed intermediate cycles and stale responses never displace the last complete run',async()=>{
 const f=fixture();await f.catalogue.select('ecmwf_ifs',async()=>({}));
 f.data.set(ref(6),run(6,false,10));f.setLatest(run(12,false,3));
 let r=await f.catalogue.select('ecmwf_ifs',async()=>({}));assert.equal(r.meta.reference_time,ref(0));
 f.setLatest(run(6,false,1));r=await f.catalogue.select('ecmwf_ifs',async()=>({}));
 assert.equal(r.latest.reference_time,ref(12));assert.equal(r.meta.reference_time,ref(0));
});
test('transient archive errors keep a verified fallback and never qualify unknown completion',async()=>{
 const f=fixture();await f.catalogue.select('ecmwf_ifs',async()=>({}));
 f.setLatest(run(12,false,2));f.data.set(ref(6),{...run(6),completed:undefined});
 const r=await f.catalogue.select('ecmwf_ifs',async()=>({}));assert.equal(r.meta.reference_time,ref(0));
 assert.equal(completedModelRun('gfs_global',run(0)),false);
 assert.equal(completedModelRun('ecmwf_ifs',{...run(0),sources:[run(0),run(6)]}),false);
});
