import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {ENSEMBLE_EXTRA_DOMAINS,extraEnsembleField,ensemblePeriodLabel,verifiedEnsembleExtra} from '../map-ensemble-extra.js';
import {loadSpatialModel,loadSpatialRun,fieldDataURL,hasFieldTime,fieldIntervalHours,combineSources} from '../map-sources.js';
import {sourceVariable,availableFields,extendCatalogue} from '../map-catalogue.js';
import {panelForecastTimes} from '../map-panels.js';
import {briefingCaption,briefingTimes} from '../map-briefing-data.js';
import {overlayGroups} from '../map-overlay-specs.js';
const t=h=>new Date(Date.UTC(2026,9,19,h)).toISOString();
const probability='precipitation_probability_10mm_24h';
const variables=['temperature_2m_mean','dew_point_2m_mean','wind_speed_10m_mean','wind_gusts_10m_mean','cloud_cover_mean','precipitation_mean','snowfall_water_equivalent_mean','wind_speed_250hPa_mean','wind_speed_250hPa_spread',probability];
const extra={format_version:2,domain:'snowline_ecmwf_extra',reference_time:t(0),completed:true,member_count:51,variables,
 valid_times:[0,3,6,12,24,36,48].map(t),
 variable_valid_times:Object.fromEntries(variables.map(key=>[key,(key===probability?[24,36,48]:['precipitation_mean','snowfall_water_equivalent_mean','wind_gusts_10m_mean'].includes(key)?[3,6,12,24,36,48]:[0,3,6,12,24,36,48]).map(t)])),
 variable_intervals:{[probability]:Object.fromEntries([24,36,48].map(h=>[t(h),{start:t(h-24),end:t(h),hours:24}])),precipitation_mean:{[t(6)]:{start:t(3),end:t(6),hours:3}}}};
const primary={reference_time:t(0),completed:true,domain:'snowline_ecmwf_ensemble',valid_times:extra.valid_times,variables:['pressure_msl_mean']};
const meta=combineSources(primary,[extra]);
test('additional fields have separate scales and raw scalar winds require no invented direction',()=>{
 const fields=[],settings={colorScales:{}};
 assert.deepEqual(extendCatalogue(fields,[meta],OM,settings),[]);
 assert.equal(availableFields(fields,[meta]).length,variables.length+1);
 for(const key of variables){const field=extraEnsembleField(key);assert.ok(field);assert.equal(field.stops.length,field.colors.length);assert.ok(field.stops.every((v,i)=>i===0||v>field.stops[i-1]));assert.equal(sourceVariable(meta,key),key);}
 assert.equal(settings.colorScales.precipitation_mean.unit,'mm/h');
 assert.equal(sourceVariable({...extra,domain:'unverified'},'precipitation_mean'),null);
 assert.equal(extraEnsembleField('precipitation_spread'),null,'Do not difference cumulative standard deviations');
 const layers=overlayGroups({field:extraEnsembleField('wind_speed_10m_mean'),url:'om://wind',isobars:false,contours:false});
 assert.deepEqual(layers,[]);
});
test('probabilities keep their 24-hour window and only actual 12-hourly valid times',()=>{
 const state={model:'ec',field:probability,metas:{ec:meta}};
 assert.deepEqual(panelForecastTimes(state),[24,36,48].map(t));
 assert.equal(hasFieldTime(meta,probability,t(12)),false);
 assert.equal(fieldIntervalHours(meta,probability,t(36)),24);
 assert.equal(fieldIntervalHours(meta,'precipitation_mean',t(6)),3);
 assert.equal(hasFieldTime(meta,'precipitation_mean',t(0)),false);
 assert.equal(hasFieldTime(meta,'temperature_2m_mean',t(0)),true);
 assert.match(ensemblePeriodLabel(meta,probability,t(36)),/≥10 mm \/ 24 h/);
 assert.match(briefingCaption(meta,{field:probability},t(36)),/10-19 12:00 to 10-20 12:00 UTC/);
 assert.deepEqual(briefingTimes(meta,{field:probability,required:[probability]}, {ensemble:true},'3'),[24,36,48].map(t));
});
test('companions load the exact main initialization for latest and archived maps',async()=>{
 const calls=[];const load=async url=>{calls.push(url);if(url.endsWith('/snowline_ecmwf_ensemble/latest.json')||url.endsWith('/snowline_ecmwf_ensemble/2026/10/19/0000Z/meta.json'))return primary;if(url.endsWith('/snowline_ecmwf_extra/2026/10/19/0000Z/meta.json'))return extra;throw Error('not found');};
 for(const loaded of [await loadSpatialModel(primary.domain,load),await loadSpatialRun(primary.domain,t(0),load)]){
  assert.equal(loaded.sources.length,2);assert.ok(fieldDataURL(loaded,probability,t(24)).endsWith('/snowline_ecmwf_extra/2026/10/19/0000Z/2026-10-20T0000.om'));
 }
 assert.ok(!calls.some(url=>url.endsWith('/snowline_ecmwf_extra/latest.json')));
 assert.equal(verifiedEnsembleExtra({...extra,reference_time:t(12)},extra.domain,t(0)),false);
 assert.equal(verifiedEnsembleExtra({...extra,member_count:50},extra.domain,t(0)),false);
});
test('extra grids preserve the native spacing and cover all map presets',()=>{
 for(const domain of ENSEMBLE_EXTRA_DOMAINS){const grid=OM.GridFactory.create(domain.grid);assert.equal(grid.nx,domain.grid.nx);assert.equal(domain.grid.lonMin+(domain.grid.nx-1)*domain.grid.dx,36);assert.equal(domain.grid.latMin+(domain.grid.ny-1)*domain.grid.dy,74);}
});
