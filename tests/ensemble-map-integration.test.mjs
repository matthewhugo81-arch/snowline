import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {MAP_MODELS} from '../map-models.js';
import {MODELS} from '../data.js';
import {loadSpatialModel,fieldDataURL,hasFieldTime,fieldIntervalHours,SPATIAL_BASE} from '../map-sources.js';
import {extendCatalogue,availableFields} from '../map-catalogue.js';
import {panelForecastTimes} from '../map-panels.js';

const ensembles=['ncep_gefs025','ncep_gefs05','ecmwf_ifs025_ensemble'];
const t=hour=>new Date(Date.UTC(2026,9,10,hour)).toISOString();
const probability='precipitation_probability';
const fixture={completed:true,reference_time:t(0),variables:[probability],valid_times:[0,3,6,9,12,18,24].map(t)};

test('GEFS and ECMWF ENS use their own spatial domains and only published fields',async()=>{
 for(const id of ensembles){
  assert.equal(MAP_MODELS.find(m=>m.id===id)?.ensemble,true);
  assert.equal(MODELS.some(m=>m.id===id),false,'Spatial IDs must not leak into location-chart requests');
  assert.ok(OM.domainOptions.some(domain=>domain.value===id),'Renderer supports the ensemble grid');
  const meta=await loadSpatialModel(id,async url=>{
   assert.ok(['latest.json','in-progress.json'].some(path=>url===SPATIAL_BASE+id+'/'+path));return fixture;
  });
  assert.equal(fieldDataURL(meta,probability,t(3)),SPATIAL_BASE+id+'/2026/10/10/0000Z/2026-10-10T0300.om');
  assert.equal(fieldDataURL(meta,probability,t(0)),null,'No interval at initialization');
  assert.equal(fieldDataURL(meta,probability,t(4)),null,'No interpolated forecast hours');
  assert.equal(hasFieldTime(meta,'pressure_msl',t(3)),false);
  const fields=[{key:'geopotential_height_500hPa',name:'500 hPa height'}],settings={colorScales:{}};
  assert.deepEqual(extendCatalogue(fields,[meta],OM,settings),[]);
  assert.deepEqual(availableFields(fields,[meta]).map(f=>f.key),[probability]);
  const scale=settings.colorScales[probability];
  assert.equal(scale.unit,'%');assert.equal(scale.breakpoints[0],0);assert.equal(scale.breakpoints.at(-1),100);
  assert.deepEqual(OM.getColor(scale,0,true),[255,255,255,1]);
  assert.deepEqual(OM.getColor(scale,100,true),[8,48,107,1]);
 }
});

test('probability periods follow changing native steps and preserve the first complete interval',()=>{
 assert.equal(fieldIntervalHours(fixture,probability,t(0)),null);
 assert.equal(fieldIntervalHours(fixture,probability,t(3)),3);
 assert.equal(fieldIntervalHours(fixture,probability,t(12)),3);
 assert.equal(fieldIntervalHours(fixture,probability,t(18)),6);
 assert.equal(fieldIntervalHours(fixture,probability,t(4)),null);
 assert.equal(fieldIntervalHours({...fixture,valid_times:fixture.valid_times.slice(1)},probability,t(3)),3);
});

test('ensemble comparisons intersect native times across cycles without extending horizons',()=>{
 const state={model:ensembles[0],modelB:ensembles[2],field:probability,fieldB:probability,compare:true,metas:{
  [ensembles[0]]:fixture,
  [ensembles[2]]:{...fixture,reference_time:t(6),valid_times:[6,12,18,24,30].map(t)}
 }};
 assert.deepEqual(panelForecastTimes(state),[12,18,24].map(t));
 assert.equal(fieldIntervalHours(state.metas[ensembles[0]],probability,t(12)),3);
 assert.equal(fieldIntervalHours(state.metas[ensembles[2]],probability,t(12)),6);
 state.compare=false;assert.deepEqual(panelForecastTimes(state),[3,6,9,12,18,24].map(t));
});
