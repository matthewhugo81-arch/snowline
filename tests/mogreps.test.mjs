import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {MAP_MODELS,MAP_RUN_CHOICES} from '../map-models.js';
import {MODELS} from '../data.js';
import {MOGREPS_MODELS} from '../map-mogreps.js';
import {loadSpatialModel,loadSpatialRun,fieldDataURL,fieldIntervalHours,SPATIAL_BASE} from '../map-sources.js';
import {extendCatalogue,availableFields} from '../map-catalogue.js';
import {briefingPresets,briefingTimes} from '../map-briefing-data.js';
import {panelForecastTimes} from '../map-panels.js';
import {runCandidates} from '../map-previous-run-data.js';

const t=h=>new Date(Date.UTC(2026,9,13,12+h)).toISOString();
const probability='precipitation_probability';
const fixture=()=>({completed:true,reference_time:t(0),variables:[probability],valid_times:Array.from({length:127},(_,i)=>i).map(t)});

test('MOGREPS maps use published native probability grids and preserve their actual horizons',async()=>{
 assert.deepEqual(MOGREPS_MODELS.map(m=>m.id),['ukmo_uk_ensemble_2km']);
 for(const model of MOGREPS_MODELS){
  assert.equal(MAP_MODELS.filter(m=>m.id===model.id&&m.ensemble).length,1);
  assert.equal(MAP_RUN_CHOICES.filter(m=>m.id===model.id).length,1);
  assert.ok(!MODELS.some(m=>m.id===model.id),'Do not add spatial probabilities to point-model averages');
  const grid=OM.domainOptions.find(d=>d.value===model.id).grid;
  assert.equal(grid.nx,1042);assert.equal(grid.ny,970);
  const data=fixture(),meta=await loadSpatialModel(model.id,async url=>{
   assert.ok(['latest.json','in-progress.json'].some(name=>url===SPATIAL_BASE+model.id+'/'+name));return data;
  });
  assert.equal(meta.ensembleNote,model.ensembleNote);
  assert.equal(fieldDataURL(meta,probability,t(1)),SPATIAL_BASE+model.id+'/2026/10/13/1200Z/2026-10-13T1300.om');
  assert.equal(fieldDataURL(meta,probability,t(0)),null);
  assert.equal(fieldDataURL(meta,'precipitation',t(1)),null);
  assert.equal(fieldDataURL(meta,'temperature_2m',t(1)),null);
  const fields=[],settings={colorScales:{}};assert.deepEqual(extendCatalogue(fields,[meta],OM,settings),[]);
  assert.deepEqual(availableFields(fields,[meta]).map(f=>f.key),[probability]);
  assert.equal(settings.colorScales[probability].unit,'%');
  assert.equal(settings.colorScales[probability].breakpoints[0],0);assert.equal(settings.colorScales[probability].breakpoints.at(-1),100);
  const times=panelForecastTimes({model:model.id,field:probability,compare:false,metas:{[model.id]:meta}});
  assert.equal(times[0],t(1));assert.equal(times.at(-1),t(126));
  const [preset]=briefingPresets(meta,fields);assert.match(preset.note,/only 3 members/);
  assert.equal(briefingTimes(meta,preset,model,'native').at(-1),times.at(-1));
  assert.equal(fieldIntervalHours(meta,probability,t(1)),1);
 }
});

test('MOGREPS in-progress and archive selections preserve the exact cycle and published times',async()=>{
 assert.deepEqual(runCandidates(MOGREPS_MODELS[0].id,t(12),3),[t(11),t(10),t(9)]);
 const id=MOGREPS_MODELS[0].id,complete=fixture(),progress={...complete,completed:false,reference_time:t(1),valid_times:[1,2,3,4].map(t)};
 const meta=await loadSpatialModel(id,async url=>url.endsWith('in-progress.json')?progress:complete);
 assert.equal(meta.reference_time,t(1));assert.deepEqual(meta.valid_times,progress.valid_times);
 assert.equal(fieldDataURL(meta,probability,t(5)),null);
 const archive=await loadSpatialRun(id,t(0),async url=>{assert.equal(url,SPATIAL_BASE+id+'/2026/10/13/1200Z/meta.json');return complete;});
 assert.equal(archive.reference_time,t(0));assert.match(archive.ensembleNote,/only 3 members/);
 await assert.rejects(loadSpatialRun(id,t(0),async()=>progress),/does not match/);
});
