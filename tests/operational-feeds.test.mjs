import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP_MODELS} from '../map-models.js';
import {ensembleFreshnessWarning,ensemblePublicationStatus} from '../map-ensemble.js';
import {modelOptionLabel} from '../map-model-run-menu.js';
import {UKV,cycleFamily,selectUKVRun} from '../ukv-run-selection.js';
const now=Date.parse('2026-10-13T09:00:00Z');
test('one UKV entry, no probability-only entries; useful ensembles survive',()=>{
 assert.deepEqual(MAP_MODELS.filter(m=>m.id.startsWith(UKV)).map(m=>[m.id,m.name]),[[UKV,'UKV']]);
 for(const id of ['ncep_gefs025','ncep_gefs05','ecmwf_ifs025_ensemble'])assert.ok(!MAP_MODELS.some(m=>m.id===id));
 for(const id of ['ncep_hgefs025_ensemble_mean','snowline_gefs_ensemble','snowline_ecmwf_ensemble'])assert.ok(MAP_MODELS.some(m=>m.id===id));
});
test('all eight main cycles retain hourly valid steps and ignore intervening initializations',async()=>{
 for(const hour of [0,3,6,9,12,15,18,21]){
  const reference_time=new Date(Date.UTC(2026,9,13,hour)).toISOString();
  const expected={reference_time,variables:['temperature_2m'],valid_times:Array.from({length:55},(_,i)=>new Date(Date.parse(reference_time)+i*3600000).toISOString()),completed:true};
  const latest={...expected,reference_time:new Date(Date.parse(reference_time)+3600000).toISOString()};
  const selected=await selectUKVRun(latest,'https://example.invalid/',async()=>expected,'main');
  assert.equal(cycleFamily(selected.reference_time),'main');assert.equal(selected.reference_time,reference_time);assert.equal(selected.valid_times.length,55);
 }
});
test('source mismatch and missed checks are disclosed without redating charts',()=>{
 const meta={domain:'snowline_gefs_ensemble',reference_time:'2026-10-12T18:00:00Z',completed:true};
 const health={checked_at:'2026-10-13T08:59:00Z',models:[{model:meta.domain,source_reference:'2026-10-13T00:00:00Z',status:'newer-source-run'}]};
 const warning=ensembleFreshnessWarning(meta,health,now);assert.match(warning,/Newer official/);
 assert.match(modelOptionLabel({name:'GEFS'},{meta:{...meta,publicationStatus:ensemblePublicationStatus(meta,health,now)}}),/12 Oct · 18Z · new run pending/);
 assert.match(ensembleFreshnessWarning(meta,{...health,checked_at:'2026-10-13T06:00:00Z'},now),/Newer official/,'Known missing cycles remain disclosed even when the check is old');
 assert.match(ensembleFreshnessWarning(meta,{...health,models:[{model:meta.domain,status:'check-failed'}]},now),/check failed/);
 assert.equal(ensembleFreshnessWarning({...meta,reference_time:'2026-10-13T00:00:00Z'},health,now),null);
});

test('an overdue source check does not assert a newer run exists; recovery clears the label',()=>{
 const meta={domain:'snowline_gefs_ensemble',reference_time:'2026-10-13T00:00:00Z',completed:true,valid_times:['2026-10-13T00:00:00Z']};
 const health={checked_at:'2026-10-13T08:00:00Z',models:[{model:meta.domain,source_reference:meta.reference_time,source_hours:[0],status:'current'}]};
 const status=ensemblePublicationStatus(meta,health,now);
 assert.equal(status.code,'check-overdue');
 assert.match(modelOptionLabel({name:'GEFS'},{meta:{...meta,publicationStatus:status}}),/check overdue/);
 assert.doesNotMatch(status.message,/refresh overdue/);
 assert.equal(ensemblePublicationStatus(meta,{...health,checked_at:'2026-10-13T08:59:00Z'},now),null);
 assert.equal(ensemblePublicationStatus(meta,null,now).code,'check-unavailable');
 const more={...health,models:[{...health.models[0],source_hours:[0,3]}]};
 assert.equal(ensemblePublicationStatus(meta,more,now).code,'hours-pending');
 const caughtUp={...meta,valid_times:[...meta.valid_times,'2026-10-13T03:00:00Z']};
 assert.equal(ensemblePublicationStatus(caughtUp,{...more,checked_at:'2026-10-13T08:59:00Z'},now),null);
});
