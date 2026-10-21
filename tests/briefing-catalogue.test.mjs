import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {availableFields,extendCatalogue} from '../map-catalogue.js';
import {briefingPresets,briefingTimes,briefingCaption} from '../map-briefing-data.js';
import {previousRunPresets,previousRunTimes,previousRunHasChart,discoverPreviousRuns} from '../map-previous-run-data.js';
import {WEATHER_COMPOSITE,compositeField} from '../map-weather-composite.js';
import {PRECIPITATION_SCALE} from '../map-catalogue.js';
const hour=3600000,ref=Date.UTC(2026,9,13,0),time=h=>new Date(ref+h*hour).toISOString();
const meta=(domain,variables,init=0)=>({domain,reference_time:time(init),variables,valid_times:Array.from({length:55},(_,i)=>time(init+i))});
function catalogue(metas){
 const fields=[compositeField(PRECIPITATION_SCALE),...['cloud_cover','precipitation','temperature_2m','relative_humidity_2m','dew_point_2m','snow_depth','wind_speed_10m','pressure_msl'].map(key=>({key,name:key,overlayOnly:key==='pressure_msl',unit:'%',stops:[0,100],colors:['#000000','#ffffff']}))];
 extendCatalogue(fields,metas,OM,{colorScales:{}});return fields;
}
const weather=['cloud_cover','precipitation','temperature_2m','pressure_msl'];
test('every chart in the main catalogue is available in sequence and three matching runs',()=>{
 const extra=['cloud_cover_low','cape','visibility','rain','snow_depth','relative_humidity_2m','temperature_850hPa','relative_humidity_850hPa','temperature_500hPa','wind_u_component_10m','wind_v_component_10m','wind_u_component_300hPa','wind_v_component_300hPa','geopotential_height_300hPa'];
 for(const domain of ['ukmo_uk_deterministic_2km','dwd_icon_eu','dwd_icon','ncep_gfs025','ecmwf_ifs025','ecmwf_aifs025_single','knmi_harmonie_arome_europe','cmc_gem_gdps_15km','meteofrance_arpege_europe','jma_gsm','ncep_aigfs025']){
  const runs=[0,-3,-6].map(init=>meta(domain,[...weather,...extra],init)),fields=catalogue(runs);
  const main=availableFields(fields,[runs[0]]).map(f=>f.key);
  assert.deepEqual(briefingPresets(runs[0],fields).map(p=>p.key),main,domain+' forecast sequence');
  assert.deepEqual(previousRunPresets(runs,3,fields).map(p=>p.key),main,domain+' previous runs');
  assert.ok(main.includes('cloud_cover_low'));assert.ok(main.includes('wind_speed_10m'));
  assert.equal(main.includes('pressure_msl'),false,'Overlay-only fields retain the same policy');
 }
});
test('a pressure overlay never removes standalone charts or forecast hours',()=>{
 const m=meta('dwd_icon_eu',['cloud_cover','precipitation','temperature_2m','temperature_850hPa','relative_humidity_850hPa']);
 const fields=catalogue([m]),presets=briefingPresets(m,fields);
 assert.ok(presets.some(p=>p.key===WEATHER_COMPOSITE));
 for(const key of ['temperature_2m','cloud_cover','precipitation','wet_bulb_potential_temperature_850hPa']){
  const p=presets.find(p=>p.key===key);assert.ok(p);assert.deepEqual(p.required,[key]);
  assert.ok(briefingTimes(m,p,{},'native').includes(time(1)));
 }
});
test('IFS feeds retain their own supported fields; theta-w needs same-grid T850 and RH850',()=>{
 // The operational 9 km feed supplies surface fields; pressure-level fields
 // belong to IFS 0.25Â°. No implicit model substitution is allowed.
 const nine=meta('ecmwf_ifs',weather),quarter=meta('ecmwf_ifs025',[...weather,'temperature_850hPa','relative_humidity_850hPa']);
 const fields=catalogue([nine,quarter]);
 for(const m of [nine,quarter])assert.deepEqual(briefingPresets(m,fields).map(p=>p.key),availableFields(fields,[m]).map(f=>f.key));
 assert.ok(!briefingPresets(nine,fields).some(p=>p.id==='theta-w'));
 assert.ok(briefingPresets(quarter,fields).some(p=>p.id==='theta-w'));
 const runs=[quarter,{...quarter,reference_time:time(-6)},{...quarter,reference_time:time(-12),variables:weather}];
 const p=previousRunPresets(runs,3,fields).find(p=>p.id==='theta-w');
 assert.equal(p.availableRunCount,2);
 assert.deepEqual(runs.map(m=>previousRunHasChart(m,p,time(3))),[true,true,false]);
});
test('standalone precipitation comparisons label mean rates and retain verified periods despite gaps',()=>{
 const one=meta('dwd_icon_eu',weather),three={...one,reference_time:time(-3),valid_times:[time(0),time(3),time(6)]},older={...one,reference_time:time(-6)};
 const p=briefingPresets(one,catalogue([one])).find(p=>p.key==='precipitation');
 assert.match(briefingCaption(one,p,time(3)),/Mean rate \(mm\/h\) over preceding 1 h/);
 const times=previousRunTimes([one,three,older],p,{},'native');
 assert.ok(times.includes(time(3)));assert.equal(times.at(-1),time(54));
 assert.equal(previousRunHasChart(three,p,time(7)),false);
});
test('ensemble catalogue is exposed in sequence; absent archives are explained without substituting models',async()=>{
 const m=meta('snowline_ecmwf_ensemble',['temperature_850hPa_mean','temperature_850hPa_spread','pressure_msl_mean']),fields=catalogue([m]);
 assert.deepEqual(briefingPresets(m,fields).map(p=>p.key),availableFields(fields,[m]).map(f=>f.key));
 assert.ok(briefingPresets(m,fields).some(p=>p.key==='temperature_850hPa_spread'));
 const result=await discoverPreviousRuns({model:m.domain,latest:m,load:async()=>({format_version:1,runs:[m.reference_time]}),loadRun:()=>{throw Error('No unlisted archive scan expected');}});
 assert.deepEqual(result.runs,[m]);assert.match(result.notice,/Only 1 verified ensemble runs/);
});
