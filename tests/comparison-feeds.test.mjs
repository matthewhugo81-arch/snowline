import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {GEM_UPPER_FIELDS,DIRECT_VERTICAL_DOMAINS,verifiedDirectVertical} from '../map-direct-vertical.js';
import {loadSpatialModel,fieldDataURL,loadSpatialRun} from '../map-sources.js';
import {extendCatalogue,availableFields} from '../map-catalogue.js';
const reference='2026-10-20T00:00:00Z',time='2026-10-20T12:00:00Z';
const upper={format_version:1,domain:'snowline_gem_upper',reference_time:reference,valid_times:[time],variables:GEM_UPPER_FIELDS,
 grid:DIRECT_VERTICAL_DOMAINS.find(d=>d.value==='snowline_gem_upper').grid,
 units:Object.fromEntries(GEM_UPPER_FIELDS.map(k=>[k,k.startsWith('temperature_')?'°C':k.startsWith('geopotential_height_')?'m':k.startsWith('relative_humidity_')?'%':'m/s']))};
test('GEM upper-air comparisons use native same-run files for latest and archived runs',async()=>{
 assert.ok(verifiedDirectVertical(upper));
 const load=async url=>{
  if(url.includes('/snowline_gem_upper/'))return upper;
  if(url.includes('/ensemble-data/'))throw Error('unavailable');
  return {reference_time:reference,valid_times:[time],variables:['temperature_2m'],completed:true};
 };
 for(const meta of [await loadSpatialModel('gem_global',load),await loadSpatialRun('gem_global',reference,load)]){
  const fields=[];extendCatalogue(fields,[meta],OM,{colorScales:{}});
  const keys=availableFields(fields,[meta]).map(f=>f.key);
  for(const key of ['wind_speed_300hPa','temperature_850hPa','geopotential_height_500hPa','relative_humidity_700hPa']){
   assert.ok(keys.includes(key),key);
   assert.match(fieldDataURL(meta,key,time),/snowline_gem_upper\/2026\/10\/20\/0000Z/);
   assert.equal(fieldDataURL(meta,key,'2026-10-20T13:00:00Z'),null);
  }
 }
 const wrong=await loadSpatialModel('gem_global',async url=>url.includes('/snowline_gem_upper/')?{...upper,reference_time:'2026-10-19T12:00:00Z'}:load(url));
 assert.equal(fieldDataURL(wrong,'wind_speed_300hPa',time),null);
 assert.equal(verifiedDirectVertical({...upper,units:{...upper.units,wind_u_component_300hPa:'km/h'}}),false);
});
test('published heights and clouds at non-curated levels remain selectable',()=>{
 const meta={variables:['temperature_6750m','wind_u_component_40m','wind_v_component_40m','cloud_cover_975hPa','cloud_cover_1000m','temperature_175hPa','geopotential_height_650hPa']};
 const fields=[];assert.deepEqual(extendCatalogue(fields,[meta],OM,{colorScales:{}}),[]);
 assert.equal(availableFields(fields,[meta]).length,6);
});
