import test from 'node:test';
import assert from 'node:assert/strict';
import {UKV,UKV_NOWCAST,ukvRunFamily,cycleFamily,ukvRunPath,selectUKVRun} from '../ukv-run-selection.js';
const base = 'https://example.test/ukv/';
const run = (reference_time,hours,changes={}) => ({reference_time,completed:true,variables:['temperature_2m','precipitation'],valid_times:Array.from({length:hours+1},(_,i)=>new Date(Date.parse(reference_time)+i*3600000).toISOString()),...changes});
const missing = () => Object.assign(new Error('Not published'),{status:404});
function loader(records) {
 const requested=[];
 const load=async url=>{requested.push(url);if (!(url in records))throw missing();const result=records[url];if(result instanceof Error)throw result;return result;};
 return {load,requested};
}
test('all 24 UTC cycles are split into disjoint main and nowcast groups',()=>{
 for(let h=0;h<24;h++)assert.equal(cycleFamily(`2026-10-10T${String(h).padStart(2,'0')}:00:00Z`),h%3===0?'main':'nowcast');
 assert.equal(ukvRunFamily(UKV),'main');assert.equal(ukvRunFamily(UKV_NOWCAST),'nowcast');assert.equal(ukvRunFamily('gfs_global'),null);
 assert.equal(cycleFamily('invalid'),null);assert.equal(cycleFamily('2026-10-10T02:30Z'),null);
});
test('0200Z nowcast no longer replaces 0000Z multi-day guidance',async()=>{
 const latest=run('2026-10-10T02:00Z',12),main=run('2026-10-10T00:00Z',54);
 const {load,requested}=loader({[base+ukvRunPath(main.reference_time)+'meta.json']:main});
 const selected=await selectUKVRun(latest,base,load,'main');
 assert.equal(selected.reference_time,main.reference_time);assert.equal(selected.valid_times.at(-1),'2026-10-12T06:00:00.000Z');
 assert.equal(selected.runFamily,'main');assert.deepEqual(selected.selectionWarnings,[]);assert.equal(requested.length,1);
 const nowcast=await selectUKVRun(latest,base,load,'nowcast');assert.equal(nowcast.reference_time,latest.reference_time);assert.equal(nowcast.valid_times.at(-1),'2026-10-10T14:00:00.000Z');
});
test('newer 0600Z main run wins over an older 0300Z 120-hour run',async()=>{
 const latest=run('2026-10-10T08:00Z',12),main=run('2026-10-10T06:00Z',54),longer=run('2026-10-10T03:00Z',120);
 const {load,requested}=loader({[base+ukvRunPath(main.reference_time)+'meta.json']:main,[base+ukvRunPath(longer.reference_time)+'meta.json']:longer});
 assert.equal((await selectUKVRun(latest,base,load,'main')).reference_time,main.reference_time);
 assert.equal(requested.length,1);
});
test('nowcast stays in its own group when latest.json points to a main cycle',async()=>{
 const latest=run('2026-10-10T06:00Z',54),nowcast=run('2026-10-10T05:00Z',12);
 const {load}=loader({[base+ukvRunPath(nowcast.reference_time)+'meta.json']:nowcast});
 assert.equal((await selectUKVRun(latest,base,load,'nowcast')).reference_time,nowcast.reference_time);
});
test('midnight and UTC offsets retain the correct cycle, date and file path',async()=>{
 const latest=run('2026-10-10T00:00Z',54),nowcast=run('2026-10-09T23:00Z',12);
 const {load}=loader({[base+'2026/10/09/2300Z/meta.json']:nowcast});
 assert.equal((await selectUKVRun(latest,base,load,'nowcast')).reference_time,nowcast.reference_time);
 assert.equal(cycleFamily('2026-10-10T04:00:00+01:00'),'main');
 assert.equal(ukvRunPath('2026-10-10T00:00:00+01:00'),'2026/10/09/2300Z/');
});
test('incomplete and not-yet-published cycles permit only an explicit same-family fallback',async()=>{
 const latest=run('2026-10-10T08:00Z',12),prior=run('2026-10-10T03:00Z',120);
 for(const unpublished of [run('2026-10-10T06:00Z',4,{completed:false}),missing()]){
  const {load}=loader({[base+'2026/10/10/0600Z/meta.json']:unpublished,[base+'2026/10/10/0300Z/meta.json']:prior});
  const chosen=await selectUKVRun(latest,base,load,'main');assert.equal(chosen.reference_time,prior.reference_time);assert.equal(chosen.selectionWarnings.length,1);
 }
});
test('service and timeout errors cannot silently select an older run',async()=>{
 const latest=run('2026-10-10T08:00Z',12);
 for(const error of [new TypeError('Network failed'),Object.assign(new Error('Service down'),{status:500}),Object.assign(new Error('Forbidden'),{status:403})]){
  const {load,requested}=loader({[base+'2026/10/10/0600Z/meta.json']:error});
  await assert.rejects(selectUKVRun(latest,base,load,'main'),e=>e===error);assert.equal(requested.length,1);
 }
});
test('malformed or mismatched metadata fails closed',async()=>{
 const latest=run('2026-10-10T08:00Z',12);
 for(const meta of [run('2026-10-10T03:00Z',120),run('2026-10-10T06:00Z',54,{variables:[]}),run('2026-10-10T06:00Z',54,{valid_times:['bad']})]){
  const {load}=loader({[base+'2026/10/10/0600Z/meta.json']:meta});await assert.rejects(selectUKVRun(latest,base,load,'main'),/metadata/);
 }
});
test('empty search has a bounded lookback and never substitutes the other family',async()=>{
 const latest=run('2026-10-10T08:00Z',12),{load,requested}=loader({});
 await assert.rejects(selectUKVRun(latest,base,load,'main',{lookbackHours:6}),/other run group has not been substituted/);
 assert.equal(requested.length,2);
});
test('the newest group run is retained with actual supplied coverage, not a fabricated full horizon',async()=>{
 const latest=run('2026-10-10T06:00Z',7),before=structuredClone(latest);
 const selected=await selectUKVRun(latest,base,()=>{throw Error('Unexpected fetch');},'main');
 assert.equal(selected.valid_times.length,8);assert.deepEqual(latest,before);
});
