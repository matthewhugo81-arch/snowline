import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {availableFields,extendCatalogue,describeVariable} from '../map-catalogue.js';
import {hasFieldTime,fieldDataURL,fieldIntervalHours} from '../map-sources.js';
import {BRIEFING_PRESETS,briefingPresets,briefingTimes,briefingCaption} from '../map-briefing-data.js';
const time=h=>new Date(Date.UTC(2026,9,12,h)).toISOString();
const meta={domain:'ecmwf_ifs',reference_time:time(0),variables:['temperature_2m','temperature_2m_max','temperature_2m_min','pressure_msl'],valid_times:[0,1,2,3,6,9].map(time)};
test('native extrema appear only when the selected model supplies them',()=>{
 const fields=[],settings={colorScales:{}};extendCatalogue(fields,[meta],OM,settings);
 assert.deepEqual(availableFields(fields,[meta]).filter(f=>/temperature_2m_(max|min)$/.test(f.key)).map(f=>f.key),['temperature_2m_max','temperature_2m_min']);
 const ukv={...meta,domain:'ukmo_uk_deterministic_2km',variables:['temperature_2m','pressure_msl']};
 assert.ok(!availableFields(fields,[ukv]).some(f=>/temperature_2m_(max|min)$/.test(f.key)));
 assert.ok(!briefingPresets(ukv).some(p=>p.id.startsWith('temperature-')));
 assert.deepEqual(briefingPresets(meta).filter(p=>p.id.startsWith('temperature-')).map(p=>p.id),['temperature-max','temperature-min']);
});
test('max/min use the same Celsius palette and native fields, never instantaneous temperature under a new label',()=>{
 const base={key:'temperature_2m',name:'2 m air temperature',unit:'°C',stops:[-10,0,10],colors:['#123456','#abcdef','#ffcc00'],temperatureBands:3};
 const fields=[base],settings={colorScales:{}};extendCatalogue(fields,[meta],OM,settings);
 for(const key of ['temperature_2m_max','temperature_2m_min']){
  const field=fields.find(f=>f.key===key);
  assert.equal(field.unit,'°C');assert.deepEqual(field.stops,base.stops);assert.deepEqual(field.colors,base.colors);assert.equal(field.temperatureBands,3);
  assert.deepEqual(settings.colorScales[key],settings.colorScales.temperature_2m);
  assert.match(field.note,/Not a daily/);assert.match(field.note,/does not specify the period length/);
  assert.equal(describeVariable(key,OM).unit,'°C');
 }
});
test('extrema have no analysis-time field; max/min charts retain actual run and valid times',()=>{
 for(const key of ['temperature_2m_max','temperature_2m_min']){
  assert.equal(hasFieldTime(meta,key,time(0)),false);
  assert.equal(fieldDataURL(meta,key,time(0)),null);
  assert.equal(hasFieldTime(meta,key,time(1)),true);
  assert.match(fieldDataURL(meta,key,time(3)),/ecmwf_ifs\/2026\/10\/12\/0000Z\/2026-10-12T0300\.om$/);
  assert.equal(fieldIntervalHours(meta,key,time(3)),null,'file spacing is not proof of the extrema reporting period');
  const preset=BRIEFING_PRESETS.find(p=>p.field===key);
  assert.deepEqual(briefingTimes(meta,preset,{regional:true},'6'),[1,2,3,6,9].map(time));
  assert.deepEqual(briefingTimes(meta,preset,{regional:false},'6'),[time(6)]);
  assert.match(briefingCaption(meta,preset,time(6)),/^T\+006 · Native period ending at this time · duration unspecified$/);
 }
});
test('briefing requires matching pressure and extrema times, without a different-model substitute',()=>{
 const primary={...meta,variables:['temperature_2m_max'],valid_times:[time(1),time(3),time(6)]};
 const pressure={...meta,variables:['pressure_msl'],valid_times:[time(3),time(9)]};
 const combined={...meta,sources:[primary,pressure]};
 const preset=BRIEFING_PRESETS.find(p=>p.id==='temperature-max');
 assert.deepEqual(briefingTimes(combined,preset,{regional:true}),[time(3)]);
 assert.equal(briefingPresets(primary).length,0);
});
