import test from 'node:test';
import assert from 'node:assert/strict';
import {MOGREPS_UK,mogrepsUKCycle,selectMogrepsUKRun} from '../mogreps-run-selection.js';
import {loadSpatialModel,loadSpatialRun} from '../map-sources.js';
import {runCandidates} from '../map-previous-run-data.js';
import {createRunCatalogue} from '../map-run-selection.js';
const ref=h=>new Date(Date.UTC(2026,9,22,h)).toISOString();
const run=(h,changes={})=>({reference_time:ref(h),completed:true,variables:['precipitation_probability'],valid_times:[1,2,3,6].map(i=>ref(h+i)),...changes});
const missing=()=>Object.assign(Error('Missing'),{status:404});

test('all eight UTC cycles are accepted and history is aligned even from an old hourly reference',()=>{
 for(let h=0;h<24;h++)assert.equal(mogrepsUKCycle(ref(h)),h%3===0);
 assert.equal(mogrepsUKCycle('invalid'),false);
 assert.equal(mogrepsUKCycle('2026-10-22T03:30Z'),false);
 assert.equal(mogrepsUKCycle('2026-10-22T04:00:00+01:00'),true);
 assert.deepEqual(runCandidates(MOGREPS_UK,ref(2),8),[ref(0),ref(-3),ref(-6)]);
 assert.deepEqual(runCandidates(MOGREPS_UK,ref(0),6),[ref(-3),ref(-6)]);
});

test('hourly frontier selects exact 00Z without extra requests when already in the completed index',async()=>{
 const chosen=await selectMogrepsUKRun(run(2),'base/',()=>{throw Error('Unexpected request');},[run(0)]);
 assert.equal(chosen.reference_time,ref(0));assert.deepEqual(chosen.valid_times,run(0).valid_times);
});

test('only aligned metadata is requested; missing or empty cycles skip back across midnight',async()=>{
 for(const empty of [null,run(0,{valid_times:[],completed:false})]){
  const calls=[];
  const chosen=await selectMogrepsUKRun(run(2),'base/',async url=>{
   calls.push(url);
   if(url.includes('/22/0000Z/')){if(empty)return empty;throw missing();}
   return run(-3);
  });
  assert.equal(chosen.reference_time,ref(-3));assert.equal(chosen.selectionWarnings.length,1);
  assert.deepEqual(calls,['base/2026/10/22/0000Z/meta.json','base/2026/10/21/2100Z/meta.json']);
 }
});

test('aligned incoming runs advance without changing their supplied forecast steps',async()=>{
 const incoming=run(3,{completed:false});
 const selected=await selectMogrepsUKRun(incoming,'base/',()=>{throw Error('Unexpected request');});
 assert.equal(selected.completed,false);assert.deepEqual(selected.valid_times,incoming.valid_times);
});

test('network failures and wrong metadata cannot silently select an older cycle',async()=>{
 for(const error of [Error('Timeout'),Object.assign(Error('Service down'),{status:500})]){
  let calls=0;
  await assert.rejects(selectMogrepsUKRun(run(2),'base/',async()=>{calls++;throw error;}),e=>e===error);
  assert.equal(calls,1);
 }
 await assert.rejects(selectMogrepsUKRun(run(2),'base/',async()=>run(-3)),/does not match/);
 await assert.rejects(selectMogrepsUKRun(run(2),'base/',async()=>{throw missing();}),/24 hours/);
});

test('native latest, exact snow companion and archived selection obey the same cycle policy',async()=>{
 const calls=[];
 const selected=await loadSpatialModel(MOGREPS_UK,async url=>{
  calls.push(url);
  if(url.includes('snowline_mogreps_uk'))throw missing();
  if(url.endsWith('latest.json'))return run(1);
  if(url.endsWith('in-progress.json'))return run(2,{completed:false});
  return run(0);
 });
 assert.equal(selected.reference_time,ref(0));assert.equal(selected.completedReferenceTime,undefined);
 assert.ok(calls.some(url=>url.includes('snowline_mogreps_uk/2026/10/22/0000Z/meta.json')));
 assert.ok(!calls.some(url=>/\/(0100|0200)Z\/meta.json/.test(url)));
 await assert.rejects(loadSpatialRun(MOGREPS_UK,ref(1),()=>{throw Error('Unexpected fetch');}),/three-hourly/);
});

test('hourly completion hints do not enter Maps or Briefing run catalogues',async()=>{
 const requested=[];
 const catalogue=createRunCatalogue({
  loadModel:async()=>run(3,{completed:false,completedReferenceTime:ref(2),previousCompletedRun:run(1)}),
  loadRun:async(model,reference)=>{requested.push(reference);assert.equal(reference,ref(0));return run(0);}
 });
 const selected=await catalogue.select(MOGREPS_UK,async()=>({}));
 assert.equal(selected.meta.reference_time,ref(0));assert.equal(selected.latest.reference_time,ref(3));
 assert.deepEqual(requested,[ref(0)]);
});
