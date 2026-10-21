import test from 'node:test';
import assert from 'node:assert/strict';
import {UKMO_NATIVE,UKMO_EARLY,UKMO_EARLY_GRID,verifiedUKMOEarly} from '../map-ukmo-early.js';
import {loadSpatialModel,loadSpatialRun,fieldDataURL,combineSources,SPATIAL_BASE,COMPANION_BASE} from '../map-sources.js';
import {createRunCatalogue,completedModelRun} from '../map-run-selection.js';
import {retainRunProgress} from '../map-runs.js';
import {precipitationFileInfo} from '../map-precipitation-type.js';

const ref='2026-10-20T12:00:00Z',end='2026-10-27T12:00:00Z',earlyTime='2026-10-20T15:00:00Z';
const bridge={format_version:1,domain:UKMO_EARLY,reference_time:ref,completed:false,grid:UKMO_EARLY_GRID,
 variables:['temperature_2m','precipitation'],units:{temperature_2m:'°C',precipitation:'mm'},valid_times:[earlyTime,end],
 variable_valid_times:{temperature_2m:[earlyTime,end],precipitation:[earlyTime,end]}};
const previous={domain:UKMO_NATIVE,reference_time:'2026-10-20T06:00:00Z',completed:true,variables:['temperature_2m','precipitation','wind_speed_10m'],valid_times:['2026-10-20T07:00:00Z','2026-10-22T18:00:00Z']};
const native={...previous,reference_time:ref,completed:false,valid_times:[earlyTime]};
const mock=(live=native)=>async url=>{
 if(url===COMPANION_BASE+UKMO_EARLY+'/latest.json'||url.includes(UKMO_EARLY+'/2026/10/20/1200Z/meta.json'))return bridge;
 if(url===SPATIAL_BASE+UKMO_NATIVE+'/latest.json')return previous;
 if(url===SPATIAL_BASE+UKMO_NATIVE+'/in-progress.json')return live;
 if(url.includes(UKMO_NATIVE+'/2026/10/20/0600Z/meta.json'))return previous;
 if(url.includes(UKMO_NATIVE+'/2026/10/20/1200Z/meta.json')&&live)return live;
 throw Object.assign(Error('Absent'),{status:404});
};

test('a direct incoming UKMO run remains updating and preserves the complete predecessor as default',async()=>{
 const pair=await createRunCatalogue().select(UKMO_NATIVE,mock(null));
 assert.equal(pair.meta.reference_time,previous.reference_time);
 assert.deepEqual(pair.meta.variables,previous.variables);
 assert.equal(pair.latest.reference_time,ref);
 assert.equal(pair.latest.completed,false);
 assert.equal(completedModelRun(UKMO_NATIVE,pair.latest),false);
 assert.equal(fieldDataURL(pair.latest,'temperature_2m',end),COMPANION_BASE+UKMO_EARLY+'/2026/10/20/1200Z/2026-10-27T1200.om');
 assert.equal(fieldDataURL(pair.latest,'wind_speed_10m',end),null);
});
test('same-cycle native hours take priority and direct late hours remain available while both grow',async()=>{
 const meta=await loadSpatialModel(UKMO_NATIVE,mock());
 assert.match(fieldDataURL(meta,'temperature_2m',earlyTime),/data_spatial\/ukmo_global/);
 assert.match(fieldDataURL(meta,'temperature_2m',end),/ensemble-data\/snowline_ukmo_early/);
 assert.equal(meta.completed,false);
 const finished=await loadSpatialModel(UKMO_NATIVE,mock({...native,completed:true,valid_times:[earlyTime,end]}));
 const retained=retainRunProgress(meta,finished);
 assert.equal(retained.completed,true);
 assert.equal(completedModelRun(UKMO_NATIVE,retained),true);
 assert.equal(retained.sources.length,2);
 assert.match(fieldDataURL(retained,'temperature_2m',end),/data_spatial\/ukmo_global/);
});
test('exact early run selection works before the intermediary creates its archive and never changes initialization',async()=>{
 const meta=await loadSpatialRun(UKMO_NATIVE,ref,mock(null));
 assert.equal(meta.reference_time,ref);
 assert.equal(meta.completed,false);
 await assert.rejects(loadSpatialRun(UKMO_NATIVE,'2026-10-20T18:00:00Z',mock(null)));
 const empty=await loadSpatialRun(UKMO_NATIVE,ref,mock({...native,valid_times:[]}));
 assert.equal(empty.sources[0].domain,UKMO_EARLY);
});
test('invalid units, grids, field times and completed subset claims fail closed',()=>{
 assert.equal(verifiedUKMOEarly(bridge),true);
 for(const meta of [{...bridge,completed:true},{...bridge,units:{...bridge.units,precipitation:'mm/h'}},{...bridge,grid:{...bridge.grid,dx:.25}},
  {...bridge,variable_valid_times:{...bridge.variable_valid_times,precipitation:[ref]}},{...bridge,variables:['unverified']},{...bridge,reference_time:'invalid'}])assert.equal(verifiedUKMOEarly(meta),false);
 assert.equal(completedModelRun(UKMO_NATIVE,combineSources(bridge,[{...native,completed:true,reference_time:previous.reference_time}])) ,false);
});
test('direct precipitation uses validated hourly, three-hourly and six-hourly intervals',()=>{
 for(const [time,hours] of [['2026-10-20T1500',1],['2026-10-22T2100',3],['2026-10-27T1200',6]]){
  const info=precipitationFileInfo(COMPANION_BASE+UKMO_EARLY+'/2026/10/20/1200Z/'+time+'.om');
  assert.equal(info.hours,hours);
 }
 assert.throws(()=>precipitationFileInfo(COMPANION_BASE+'snowline_unknown/2026/10/20/1200Z/2026-10-20T1500.om'));
});
