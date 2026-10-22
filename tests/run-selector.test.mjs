import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunCatalogue,completedModelRun,selectedRunKey,sourceModel,renderRunSelector} from '../map-run-selection.js';
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
test('automatic selection advances only after completion and catches completed intervening cycles',async()=>{
 const f=fixture(),select=()=>f.catalogue.select('ecmwf_ifs',async()=>({}));
 let r=await select();assert.equal(r.meta.reference_time,ref(0));
 f.setLatest(run(6,false,30));r=await select();
 assert.equal(r.meta.reference_time,ref(0),'Partial new hours do not replace the complete run');
 f.setLatest(run(6));r=await select();assert.equal(r.meta.reference_time,ref(6));
 f.data.set(ref(6),run(6));f.setLatest(run(12,false,3));r=await select();
 assert.equal(r.meta.reference_time,ref(6),'The promoted run becomes the next complete fallback');
 f.data.set(ref(12),run(12));f.setLatest(run(18,false,2));r=await select();
 assert.equal(r.meta.reference_time,ref(12),'A completed intervening cycle is found when the page next checks');
 f.setLatest(run(18));r=await select();assert.equal(r.meta.reference_time,ref(18));
});
test('automatic GFS selection waits for its matching complete companion source',async()=>{
 const core=h=>({...run(h),domain:'ncep_gfs013'}),upper=h=>({...run(h),domain:'ncep_gfs025'});
 const complete=h=>({...core(h),sources:[core(h),upper(h)]});
 let incoming={...core(6),sources:[core(6),{...upper(6),completed:false}]};
 const catalogue=createRunCatalogue({loadModel:async()=>incoming,loadRun:async(model,reference)=>{
  if(reference===ref(0))return complete(0);throw missing();
 }});
 let r=await catalogue.select('gfs_global',async()=>({}));assert.equal(r.meta.reference_time,ref(0));
 incoming=complete(6);r=await catalogue.select('gfs_global',async()=>({}));assert.equal(r.meta.reference_time,ref(6));
});
test('completed automatic selection survives stale metadata and retries after a failed check',async()=>{
 let incoming=run(6),fail=false;
 const catalogue=createRunCatalogue({loadModel:async()=>{if(fail)throw Error('Network unavailable');return incoming;},loadRun:async()=>run(0)});
 const select=()=>catalogue.select('ecmwf_ifs',async()=>({}));
 assert.equal((await select()).meta.reference_time,ref(6));
 incoming=run(0);assert.equal((await select()).meta.reference_time,ref(6));
 incoming=run(6,false,2);assert.equal((await select()).meta.completed,true);
 fail=true;await assert.rejects(select(),/Network unavailable/);
 fail=false;incoming=run(12,false,2);
 assert.equal((await select()).meta.reference_time,ref(6),'The failed refresh does not erase the retained complete run');
 incoming=run(12);assert.equal((await select()).meta.reference_time,ref(12));
});
test('run selector lists each real dated run once while following or holding a selection',t=>{
 const original=globalThis.document;globalThis.document={createElement:()=>({value:'',textContent:''})};
 t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
 const select={options:[],dataset:{},replaceChildren(){this.options=[];},append(option){this.options.push(option);}};
 const values=()=>select.options.map(option=>option.value);
 const distinctDatedChoices=()=>{
  assert.equal(new Set(values()).size,select.options.length);
  for(const option of select.options){assert.match(option.value,/@/);assert.doesNotMatch(option.textContent,/\bAuto\b/i);}
 };
 const model='ecmwf_ifs',previous=run(0),pair={latest:run(6,false,2),previous};
 renderRunSelector(select,model,pair,previous,{followLatest:true});
 assert.equal(select.value,selectedRunKey(model,previous));assert.equal(select.disabled,false);
 assert.equal(select.dataset.preferredRun,selectedRunKey(model,previous));
 assert.deepEqual(values(),[selectedRunKey(model,pair.latest),selectedRunKey(model,previous)]);
 assert.match(select.options[0].textContent,/20 Oct · 06Z · Updating/);
 assert.match(select.options[1].textContent,/20 Oct · 00Z · Complete/);
 assert.match(select.title,/Follows the latest complete run automatically/);distinctDatedChoices();
 pair.latest=run(6);renderRunSelector(select,model,pair,pair.latest,{followLatest:true});
 assert.equal(select.value,selectedRunKey(model,pair.latest));
 assert.equal(select.dataset.preferredRun,selectedRunKey(model,pair.latest));
 assert.deepEqual(values(),[selectedRunKey(model,pair.latest),selectedRunKey(model,previous)]);
 assert.match(select.options[0].textContent,/06Z · Complete/);distinctDatedChoices();
 renderRunSelector(select,model,pair,previous);
 assert.equal(select.value,selectedRunKey(model,previous));assert.match(select.title,/selected run stays fixed/);
 assert.equal(select.dataset.preferredRun,selectedRunKey(model,pair.latest),'Choosing the real latest complete run resumes following');
 assert.equal(select.options.length,2);distinctDatedChoices();
 const older=run(-6);renderRunSelector(select,model,pair,older);
 assert.equal(select.value,selectedRunKey(model,older));
 assert.deepEqual(values(),[selectedRunKey(model,pair.latest),selectedRunKey(model,previous),selectedRunKey(model,older)]);
 assert.equal(select.dataset.preferredRun,selectedRunKey(model,pair.latest));distinctDatedChoices();
 renderRunSelector(select,model,{latest:run(12,false,2),previous:null},run(12,false,2),{followLatest:true});
 assert.deepEqual(values(),[selectedRunKey(model,run(12))]);
 assert.equal(select.value,values()[0]);assert.equal(select.dataset.preferredRun,values()[0]);
 assert.match(select.options[0].textContent,/12Z · Updating/);assert.match(select.title,/No completed run could be verified yet/);distinctDatedChoices();
});
test('product run selector excludes newer ordinary runs and uses consistent UTC formatting',t=>{
 const original=globalThis.document;globalThis.document={createElement:()=>({})};
 t.after(()=>{globalThis.document=original;});
 const select={options:[],dataset:{},replaceChildren(){this.options=[];},append(option){this.options.push(option);}};
 const selected=run(18);
 renderRunSelector(select,'ukmo_uk_ensemble_2km',{latest:run(25),previous:run(24)},selected,{product:true});
 assert.equal(select.options.length,1);
 assert.equal(select.value,selectedRunKey('ukmo_uk_ensemble_2km',selected));
 assert.match(select.options[0].textContent,/18Z · ensemble products$/);
 assert.doesNotMatch(select.options[0].textContent,/1800Z|Complete|newest/);
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
