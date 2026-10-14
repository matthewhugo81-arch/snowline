import test from 'node:test';
import assert from 'node:assert/strict';
import {hasFieldTime} from '../map-sources.js';
const initial='2026-10-14T00:00:00Z',next='2026-10-14T03:00:00Z';
const meta=(domain,variables)=>({domain,reference_time:initial,variables,valid_times:[initial,next]});
test('IFS025 gusts retain native steps either side of the un-ingested 10fg3 block',()=>{
 const time=h=>new Date(Date.parse(initial)+h*3600000).toISOString();
 const source={...meta('ecmwf_ifs025',['wind_gusts_10m','temperature_2m']),valid_times:[90,93,120,144,150].map(time)};
 for(const lead of [93,120,144]){assert.equal(hasFieldTime(source,'wind_gusts_10m',time(lead)),false);assert.equal(hasFieldTime(source,'temperature_2m',time(lead)),true);}
 for(const lead of [90,150])assert.equal(hasFieldTime(source,'wind_gusts_10m',time(lead)),true);
 assert.equal(hasFieldTime({...source,domain:'ecmwf_ifs'},'wind_gusts_10m',time(120)),true);
});
test('native gust, UV and AROME cloud fields exclude verified missing initialization steps',()=>{
 for(const domain of ['ecmwf_ifs','ecmwf_ifs025','dwd_icon','dwd_icon_eu','meteofrance_arpege_europe','meteofrance_arome_france0025']){
  const source=meta(domain,['wind_gusts_10m','temperature_2m']);
  assert.equal(hasFieldTime(source,'wind_gusts_10m',initial),false);
  assert.equal(hasFieldTime(source,'wind_gusts_10m',next),true);
  assert.equal(hasFieldTime(source,'temperature_2m',initial),true);
 }
 for(const key of ['uv_index','uv_index_clear_sky']){
  const source=meta('ncep_gfs013',[key]);assert.equal(hasFieldTime(source,key,initial),false);assert.equal(hasFieldTime(source,key,next),true);
 }
 for(const key of ['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high']){
  const source=meta('meteofrance_arome_france0025',[key]);assert.equal(hasFieldTime(source,key,initial),false);assert.equal(hasFieldTime(source,key,next),true);
 }
 for(const domain of ['ukmo_uk_deterministic_2km','ukmo_global_deterministic_10km','ncep_gfs025'])assert.equal(hasFieldTime(meta(domain,['wind_gusts_10m']),'wind_gusts_10m',initial),true);
});
