import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {DIRECT_VERTICAL_DOMAINS,DIRECT_VERTICAL_FIELDS,DIRECT_VERTICAL_UNITS,DIRECT_VERTICAL_MODELS,verifiedDirectVertical,directVerticalNote} from '../map-direct-vertical.js';
import {loadSpatialModel,loadSpatialRun,fieldSource,fieldDataURL,hasFieldTime,combineSources,SPATIAL_BASE} from '../map-sources.js';
import {sourceVariable,extendCatalogue,availableFields} from '../map-catalogue.js';
import {VERTICAL_MOTION,verticalMotionField,verticalMotionOverlayURLs} from '../map-vertical-motion.js';
import {previousRunPresets,previousRunTimes} from '../map-previous-run-data.js';
import {chartScales} from '../map-image-export.js';
const run='2026-10-15T12:00:00Z',time='2026-10-15T21:00:00Z';
const direct=domain=>({format_version:1,domain,reference_time:run,valid_times:[time],completed:true,variables:DIRECT_VERTICAL_FIELDS,units:DIRECT_VERTICAL_UNITS,grid:DIRECT_VERTICAL_DOMAINS.find(d=>d.value===domain).grid});

test('direct charts require verified pressure units, complete companions and the registered grid',()=>{
 for(const {value:domain} of DIRECT_VERTICAL_DOMAINS.filter(d=>d.value!=='snowline_gem_upper')){
  const meta=direct(domain);assert.equal(verifiedDirectVertical(meta),true);assert.equal(sourceVariable(meta,VERTICAL_MOTION),'omega_700hPa');
  for(const key of DIRECT_VERTICAL_FIELDS)assert.equal(sourceVariable({...meta,variables:meta.variables.filter(k=>k!==key)},VERTICAL_MOTION),null);
  for(const invalid of [{...meta,units:{...meta.units,omega_700hPa:'m/s'}},{...meta,grid:{...meta.grid,lonMin:0}},{...meta,format_version:0}])assert.equal(sourceVariable(invalid,VERTICAL_MOTION),null);
  const fields=[],settings={colorScales:{}};extendCatalogue(fields,[meta],OM,settings);
  assert.ok(availableFields(fields,[meta]).some(f=>f.key===VERTICAL_MOTION));assert.equal(settings.colorScales.omega_700hPa.unit,'0.1 Pa/s');
  assert.match(directVerticalNote(meta),/coverage/);
 }
});

test('latest and archived model choices attach only the same-cycle direct data',async()=>{
 for(const [model,domain] of Object.entries(DIRECT_VERTICAL_MODELS)){
  const upstream=model==='gem_global'?'cmc_gem_gdps_15km':'dwd_icon_eu';
  const primary={reference_time:run,valid_times:[time],completed:true,variables:['temperature_2m','geopotential_height_700hPa','wind_u_component_700hPa','wind_v_component_700hPa']};
  for(const archived of [false,true]){
   const urls=[];const load=async url=>{urls.push(url);return url.includes('/ensemble-data/')?direct(domain):primary;};
   const meta=await (archived?loadSpatialRun(model,run,load):loadSpatialModel(model,load));
   assert.equal(fieldSource(meta,VERTICAL_MOTION,time).domain,domain);
   assert.equal(fieldSource(meta,'temperature_2m',time).domain,upstream);
   assert.match(fieldDataURL(meta,VERTICAL_MOTION,time),new RegExp('/ensemble-data/'+domain+'/2026/10/15/1200Z/2026-10-15T2100.om$'));
   assert.ok(urls.filter(u=>u.includes('/ensemble-data/')).every(u=>u.endsWith('/2026/10/15/1200Z/meta.json')));
   const source=fieldSource(meta,VERTICAL_MOTION,time),urlsForChart=verticalMotionOverlayURLs(VERTICAL_MOTION,key=>'om://'+fieldDataURL(source,key,time)+'?variable='+sourceVariable(source,key));
   for(const url of Object.values(urlsForChart))assert.ok(url.includes('/'+domain+'/'));
   assert.equal(hasFieldTime(meta,VERTICAL_MOTION,'2026-10-15T22:00:00Z'),false);
  }
  for(const unavailable of [null,{...direct(domain),reference_time:'2026-10-15T00:00:00Z'}]){
   const meta=await loadSpatialModel(model,async url=>{if(!url.includes('/ensemble-data/'))return primary;if(unavailable)return unavailable;throw Object.assign(Error('missing'),{status:404});});
   assert.equal(hasFieldTime(meta,'temperature_2m',time),true);assert.equal(hasFieldTime(meta,VERTICAL_MOTION,time),false);assert.match(meta.sourceWarnings.join(' '),/700 hPa/);
  }
 }
});

test('three direct runs support only common valid times in Previous Run Analysis',()=>{
 const runs=[12,0,-12].map(hour=>({...direct('snowline_gem_700'),reference_time:new Date(Date.UTC(2026,9,15,hour)).toISOString()}));
 const fields=[verticalMotionField()],preset=previousRunPresets(runs,3,fields).find(p=>p.field===VERTICAL_MOTION);
 assert.ok(preset);assert.deepEqual(previousRunTimes(runs,preset,{},'native'),[time]);
 runs[1]={...runs[1],valid_times:['2026-10-15T18:00:00Z']};assert.deepEqual(previousRunTimes(runs,preset,{},'native'),[]);
});

test('exported provider and coverage notes retain one copy of the scale explanation',()=>{
 const field=verticalMotionField(),sourceNote=directVerticalNote(direct('snowline_gem_700'));
 const [scale]=chartScales(field,field.legendNote+' '+sourceNote);
 assert.equal(scale.note.split('Black contours:').length-1,1);
 assert.match(scale.note,/Environment and Climate Change Canada/);assert.match(scale.note,/66°W/);
});
