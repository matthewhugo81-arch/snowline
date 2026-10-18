import test from 'node:test';
import assert from 'node:assert/strict';
import {installPrecipitationRates,precipitationRateVariable,PRECIPITATION_RATE_FIELDS} from '../map-precipitation-rate.js';
import {fieldIntervalHours} from '../map-sources.js';
import {gridValueLabel} from '../map-grid.js';
import {compositeSettings} from '../map-weather-composite.js';
import {installAccumulations} from '../map-accumulation-reader.js';
import {precipitationFileInfo} from '../map-precipitation-type.js';
const file=(domain,lead)=>'https://openmeteo.s3.amazonaws.com/data_spatial/'+domain+'/2026/10/18/1200Z/'+new Date(Date.UTC(2026,9,18,12+lead)).toISOString().slice(0,16).replace(':','')+'.om';
const cases=[['ecmwf_ifs',90,1],['ecmwf_ifs',93,3],['ecmwf_ifs',150,6],['ukmo_global_deterministic_10km',54,1],['ukmo_global_deterministic_10km',57,3],['ukmo_global_deterministic_10km',144,3],['ukmo_global_deterministic_10km',150,6],['ncep_gfs013',120,1],['ncep_gfs013',123,3],['dwd_icon',78,1],['dwd_icon',81,3],['ecmwf_ifs025',144,3],['ecmwf_ifs025',150,6],['cmc_gem_gdps_15km',84,1],['cmc_gem_gdps_15km',87,3],['ecmwf_aifs025_single',12,6],['ukmo_uk_deterministic_2km',57,1]];
test('equal average rain has equal shading/readout inputs across native cadence changes',async()=>{
 for(const [domain,lead,hours]of cases)for(const field of PRECIPITATION_RATE_FIELDS){
  const original={values:new Float32Array([0,1.25*hours,6*hours,NaN]),scaleFactor:10},calls=[];
  const reader={readVariable:async(...args)=>{calls.push(args);return original;},prefetchVariable:async(...args)=>calls.push(args)};
  const settings={colorScales:{}},OM={getProtocolInstance:()=>({omFileReader:reader})};
  installPrecipitationRates(OM,settings);installPrecipitationRates(OM,settings);
  const url=file(domain,lead),ranges=[{start:1,end:2}],signal=new AbortController().signal;
  const rate=await reader.readVariable(url,precipitationRateVariable(field),ranges,signal);
  assert.deepEqual([...rate.values],[0,1.25,6,NaN],domain+' T+'+lead+' '+field);
  assert.equal(rate.scaleFactor,10*hours);assert.notEqual(rate.values,original.values);
  assert.equal(original.values[1],1.25*hours,'native totals are not mutated');
  assert.deepEqual(calls[0],[url,field,ranges,signal]);
  assert.equal(await reader.readVariable(url,field),original,'raw reads for accumulations and type retain totals');
  await reader.prefetchVariable(url,precipitationRateVariable(field),ranges,signal);
  assert.deepEqual(calls.at(-1),[url,field,ranges,signal]);
 }
});
test('unknown, partial and initialization periods fail closed; cancellation stops reads',async()=>{
 let reads=0;const reader={readVariable:async()=>{reads++;return {values:new Float32Array([3]),scaleFactor:1};}};
 installPrecipitationRates({getProtocolInstance:()=>({omFileReader:reader})},{colorScales:{}});
 for(const url of [file('unknown',3),file('ecmwf_ifs',0),file('ecmwf_ifs',91),file('ncep_aigfs025',6)])await assert.rejects(reader.readVariable(url,'precipitation_hourly_rate'),/interval/);
 const controller=new AbortController();controller.abort();await assert.rejects(reader.readVariable(file('ecmwf_ifs',93),'precipitation_hourly_rate',null,controller.signal),{name:'AbortError'});
 assert.equal(reads,0);
 for(const key of ['precipitation_accumulation_24h','snow_depth','snow_depth_water_equivalent','precipitation_probability'])assert.equal(precipitationRateVariable(key),key);
});
test('rolling totals still sum original amounts when rate and accumulation readers are installed together',async()=>{
 for(const [domain,lead]of [['ecmwf_ifs',96],['ecmwf_ifs',150],['ukmo_global_deterministic_10km',60],['ukmo_global_deterministic_10km',150]]){
  const reader={readVariable:async(url,key)=>{
   assert.equal(key,'precipitation');
   return {values:new Float32Array([precipitationFileInfo(url).hours*2,NaN]),scaleFactor:10};
  }};
  const OM={getProtocolInstance:()=>({omFileReader:reader})},settings={colorScales:{}};
  installPrecipitationRates(OM,settings);const totals=installAccumulations(OM,settings);
  assert.deepEqual([...(await reader.readVariable(file(domain,lead),'precipitation_hourly_rate')).values],[2,NaN]);
  assert.deepEqual([...(await reader.readVariable(file(domain,lead),'precipitation_total_24h')).values],[48,NaN]);
  totals.clear();
 }
});
test('period labels use the verified interval even when published timestamps have gaps',()=>{
 const reference_time='2026-10-18T12:00:00Z',time='2026-10-22T09:00:00Z';
 const meta={domain:'ecmwf_ifs',reference_time,variables:['precipitation','rain','showers','snowfall_water_equivalent'],valid_times:[reference_time,time]};
 for(const key of PRECIPITATION_RATE_FIELDS)assert.equal(fieldIntervalHours(meta,key,time),3);
 assert.equal(gridValueLabel(.8,{key:'precipitation',unit:'mm/h'}),'0.8');
});
test('composite rate scale is transparent only below the rate threshold and does not mutate other panels',()=>{
 const rain={unit:'mm/h',breakpoints:[0,.5,1],colors:[[255,255,255,1],[10,20,30,1],[20,30,40,1]]};
 const settings={colorScales:{precipitation:rain,precipitation_hourly_rate:rain,cloud_cover:{breakpoints:[0,100],colors:[[0,0,0,1],[255,255,255,1]]}}};
 const composite=compositeSettings(settings);
 assert.equal(composite.colorScales.precipitation_hourly_rate.colors[0][3],0);
 assert.equal(settings.colorScales.precipitation_hourly_rate.colors[0][3],1);
 assert.equal(composite.colorScales.precipitation_hourly_rate.colors[1][3],1);
});
