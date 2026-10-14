import test from 'node:test';
import assert from 'node:assert/strict';
import {hasFieldTime,fieldIntervalHours} from '../map-sources.js';
import {accumulationPlan} from '../map-accumulation.js';
import {WEATHER_COMPOSITE} from '../map-weather-composite.js';
import {THETA_SYMBOLS} from '../map-winter.js';
const init='2026-10-14T00:00:00Z',time=h=>new Date(Date.parse(init)+h*3600000).toISOString();
test('AIGFS and HGEFS omit absent first precipitation intervals from every composite and total',()=>{
 for(const domain of ['ncep_aigfs025','ncep_hgefs025_ensemble_mean']){
  const meta={domain,reference_time:init,variables:['temperature_2m','cloud_cover','precipitation','pressure_msl','temperature_850hPa','relative_humidity_850hPa'],valid_times:[6,12,18,24,30].map(time)};
  for(const key of ['precipitation',WEATHER_COMPOSITE,THETA_SYMBOLS])assert.equal(hasFieldTime(meta,key,time(6)),false,key);
  assert.equal(hasFieldTime(meta,'temperature_2m',time(6)),true);
  assert.equal(hasFieldTime(meta,'precipitation',time(12)),true);
  assert.equal(fieldIntervalHours(meta,'precipitation',time(12)),6);
  assert.equal(accumulationPlan(meta,'precipitation_total_6h',time(6)),null);
  assert.equal(accumulationPlan(meta,'precipitation_total_24h',time(24)),null);
  assert.equal(accumulationPlan(meta,'precipitation_total_24h',time(30)).times.length,4);
 }
 const aifs={domain:'ecmwf_aifs025_single',reference_time:init,variables:['precipitation'],valid_times:[6,12].map(time)};
 assert.equal(hasFieldTime(aifs,'precipitation',time(6)),true,'ECMWF AIFS supplies its first interval');
 assert.ok(accumulationPlan(aifs,'precipitation_total_6h',time(6)));
});
