import test from 'node:test';
import assert from 'node:assert/strict';
import {wetBulb,wetBulbValues,winterPeriodSource,reduceSkin} from '../map-winter-additions.js';
import {availableFields,extendCatalogue,sourceVariable} from '../map-catalogue.js';
import {hasFieldTime,fieldSource} from '../map-sources.js';
import {forecastPeriod} from '../map-validity.js';
import {isWinterField} from '../map-winter-hazards.js';
import {installWinterAdditions} from '../map-winter-additions-reader.js';
const t=h=>new Date(Date.UTC(2026,9,24,h)).toISOString();
const meta=(domain,variables)=>({domain,variables,reference_time:t(0),valid_times:Array.from({length:31},(_,i)=>t(i))});
test('wet bulb follows saturated limit, evaporative cooling and invalid-input masking',()=>{
 assert.equal(wetBulb(-5,100),-5);assert.ok(Math.abs(wetBulb(20,50)-13.7)<.1);
 for(const [t,h]of [[NaN,90],[2,NaN],[-25,95],[0,0],[-5,10],[5,101]])assert.ok(Number.isNaN(wetBulb(t,h)));
 assert.ok(Math.abs(wetBulbValues(new Float32Array([5]),new Float32Array([5]),true)[0]-5)<1e-5);
});
test('period availability rejects missing hours, mixed runs and coarse skin samples',()=>{
 const m=meta('ukmo_uk_deterministic_2km',['surface_temperature','snowfall_water_equivalent']);
 assert.equal(hasFieldTime(m,'surface_temperature_min_24h',t(24)),false);
 assert.equal(hasFieldTime(m,'surface_temperature_min_24h',t(25)),true);
 assert.equal(hasFieldTime(m,'snowfall_total_6h',t(6)),true);
 const gap={...m,valid_times:m.valid_times.filter(x=>x!==t(3))};assert.equal(hasFieldTime(gap,'snowfall_total_6h',t(6)),false);
 const coarse={...m,valid_times:m.valid_times.filter((_,i)=>i%3===0)};assert.equal(winterPeriodSource(coarse,'surface_freezing_hours_24h'),null);
 assert.equal(winterPeriodSource({...m,sources:[{...m,reference_time:t(-3)}]},'snowfall_total_6h'),null);
 const perField={...m,variable_valid_times:{snowfall_water_equivalent:m.valid_times.filter(x=>x!==t(3))}};assert.equal(hasFieldTime(perField,'snowfall_total_6h',t(6)),false);
});
test('skin extrema and zero crossing hours preserve missing cells',()=>{
 const arrays=Array.from({length:25},(_,i)=>new Float32Array([i-12,0,NaN,-2]));
 assert.deepEqual([...reduceSkin(arrays,'surface_temperature_min_24h')].slice(0,2),[-12,0]);
 const h=reduceSkin(arrays,'surface_freezing_hours_24h');assert.equal(h[0],12);assert.equal(h[1],0);assert.ok(Number.isNaN(h[2]));assert.equal(h[3],24);
});
test('model menus require matching inputs and exclude unrelated layers',()=>{
 const uk=meta('ukmo_uk_deterministic_2km',['temperature_2m','relative_humidity_2m','surface_temperature','snowfall_water_equivalent','hail','visibility']);
 const gfs=meta('ncep_gfs013',['temperature_2m','relative_humidity_2m','surface_temperature','categorical_freezing_rain']);
 const dry=meta('jma_gsm',['temperature_2m']);const fields=[];
 extendCatalogue(fields,[uk,gfs,dry],{defaultOmProtocolSettings:{colorScales:{}}},{colorScales:{}});
 const choices=m=>availableFields(fields,[m]).filter(isWinterField).map(f=>f.key);
 assert.ok(choices(uk).includes('hail'));assert.ok(!choices(gfs).includes('hail'));
 assert.ok(choices(gfs).includes('categorical_freezing_rain'));assert.ok(!choices(uk).includes('categorical_freezing_rain'));
 assert.ok(choices(uk).includes('wet_bulb_temperature_2m'));assert.ok(!choices(dry).includes('wet_bulb_temperature_2m'));
 assert.equal(sourceVariable({...dry,sources:[dry,meta('jma_gsm',['relative_humidity_2m'])]},'wet_bulb_temperature_2m'),null);
 for(const key of ['wind_speed_10m','cloud_cover','precipitation','precipitation_total_24h','cape'])assert.equal(isWinterField(key),false);
 assert.deepEqual(forecastPeriod('surface_temperature_min_24h',t(25),uk),{start:t(1),end:t(25)});
});
test('new period reader sums native amounts, not rates, and rejects missing snowfall cells',async()=>{
 const reader={config:{},allDerivationRules:[],readVariable:async(url,key)=>({values:new Float32Array([Number(url.match(/T(\d\d)/)[1]),NaN])})};
 installWinterAdditions({getProtocolInstance:()=>({omFileReader:reader})},{});
 const data=await reader.readVariable('https://example.com/data_spatial/dwd_icon/2026/10/24/0000Z/2026-10-24T0600.om','snowfall_total_6h');
 assert.equal(data.values[0],21);assert.ok(Number.isNaN(data.values[1]));
});
