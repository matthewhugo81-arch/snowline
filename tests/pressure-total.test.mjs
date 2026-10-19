import test from 'node:test';
import assert from 'node:assert/strict';
import {averageSeries,precipitationTotal} from '../average.js';
import {chartWindow} from '../chart-window.js';
import {VARIABLES,MODELS as ALL_MODELS,normalise,forecastURL} from '../data.js';
import {loadPointForecasts as loadAllPointForecasts} from '../point-forecasts.js';
import {POINT_LOCATIONS} from '../point-snapshots.js';
const MODELS=ALL_MODELS.filter(model=>model.api!=='mogreps');
test('total follows hourly average, selected models and displayed window',()=>{
 const times=['a','b','c','d'];
 const series=[{values:[0,2,4,6]},{values:[2,4,6,8]}];
 const mean=averageSeries(series,4).values;
 assert.equal(precipitationTotal(mean),16);
 const {start,end}=chartWindow({times,hours:4,zoom:{start:1,end:2}});
 assert.equal(precipitationTotal(mean.slice(start,end+1)),8);
 assert.equal(precipitationTotal(averageSeries(series.slice(0,1),4).values),12);
 assert.equal(precipitationTotal([0,0]),0);
 assert.equal(precipitationTotal([0,null]),null);
 assert.equal(precipitationTotal([]),null);
});

test('an outlier contributes only through the hourly average line',()=>{
 const series=Array.from({length:10},(_,i)=>({values:[0,i===0?50:0,2]}));
 const mean=averageSeries(series,3).values;
 assert.deepEqual(mean,[0,5,2]);
 assert.equal(precipitationTotal(mean),7);
 assert.equal(precipitationTotal(mean.slice(1,2)),5);
 assert.equal(precipitationTotal(averageSeries(series.slice(1),3).values),2);
});
test('pressure is requested and normalised in hPa with realistic absolute axis',()=>{
 const pressure=VARIABLES.find(v=>v.key==='pressure_msl');
 assert.equal(pressure.unit,'hPa');assert.equal(pressure.absolute,true);
 assert.ok(new URL(forecastURL({latitude:54,longitude:-2},MODELS[0])).searchParams.get('hourly').includes('pressure_msl'));
 const m=normalise({hourly:{time:['2026-10-18T00:00'],pressure_msl:[1024.5]}},MODELS[0]);
 assert.equal(m.values.pressure_msl[0],1024.5);
});
test('older cached payloads supplement pressure and direction together, aligned by UTC hour',async()=>{
 const time=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
 const loaded=[];let supplements=0;
 await loadPointForecasts({latitude:52,longitude:1},{withPressure:true,withWindDirection:true,load:async url=>{
  if(new URL(url).searchParams.get('hourly')){supplements++;assert.equal(new URL(url).searchParams.get('hourly'),'wind_direction_10m,pressure_msl');return {hourly:{time:[time],pressure_msl:[1020],wind_direction_10m:[270]},hourly_units:{pressure_msl:'hPa'}};}
  return {_retrievedAt:Date.now(),hourly:{time:[time],precipitation:[1]}};
 },onModel:m=>loaded.push(m)});
 assert.equal(supplements,MODELS.length);assert.equal(loaded.length,MODELS.length);
 assert.ok(loaded.every(m=>m.values.pressure_msl[0]===1020&&m.values.wind_direction_10m[0]===270));
});

test('a fresh town snapshot checks Cloudflare for new fields before any direct request',async()=>{
 const point=POINT_LOCATIONS[0],time=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
 const base={_retrievedAt:Date.now(),hourly:{time:[time],precipitation:[1]}};
 const requests=[],models=[];
 await loadPointForecasts(point,{withPressure:true,withWindDirection:true,force:true,load:async(url,signal,options)=>{
  requests.push(url);
  if(url.startsWith('./point-data/'))return {version:1,location:point,models:Object.fromEntries(MODELS.map(m=>[m.id,base]))};
  assert.match(url,/workers.dev\/forecast/);assert.equal(options.forceMinAge,3600000);
  return {...base,hourly:{...base.hourly,pressure_msl:[1012],wind_direction_10m:[90]}};
 },onModel:m=>models.push(m)});
 assert.equal(requests.length,MODELS.length+1);assert.equal(models.length,MODELS.length);
 assert.ok(models.every(m=>m.values.pressure_msl[0]===1012));
});

test('cache fields, including all-null pressure, never trigger provider supplements',async()=>{
 const time=new Date().toISOString(),requests=[],models=[];
 await loadPointForecasts({latitude:52,longitude:1},{withPressure:true,withWindDirection:true,load:async url=>{
  requests.push(url);assert.match(url,/workers.dev/);
  return {_retrievedAt:Date.now(),hourly:{time:[time],precipitation:[1],pressure_msl:[null],wind_direction_10m:[90]}};
 },onModel:m=>models.push(m)});
 assert.equal(requests.length,MODELS.length);assert.equal(models.length,MODELS.length);
 assert.ok(models.every(m=>m.values.pressure_msl[0]===null));
});

test('missing-field supplements align reordered UTC hours and Refresh respects hourly reuse',async()=>{
 const hour=Math.floor(Date.now()/3600000)*3600000,time=[hour,hour+3600000].map(t=>new Date(t).toISOString()),models=[];
 await loadPointForecasts({latitude:52,longitude:1},{withPressure:true,force:true,load:async(url,signal,options)=>{
  if(url.includes('api.open-meteo.com')){
   assert.equal(new URL(url).searchParams.get('hourly'),'pressure_msl');assert.equal(options.forceMinAge,3600000);
   return {hourly:{time:[time[1],time[0]],pressure_msl:[1020,1010]},hourly_units:{pressure_msl:'hPa'}};
  }
  return {_retrievedAt:Date.now(),hourly:{time,precipitation:[1,2]}};
 },onModel:m=>models.push(m)});
 assert.equal(models.length,MODELS.length);assert.deepEqual(models[0].values.pressure_msl,[1010,1020]);
});

test('shared-cache failure retains town data without bypassing its limit for pressure',async()=>{
 const point=POINT_LOCATIONS[0],base={_retrievedAt:Date.now(),hourly:{time:[new Date().toISOString()],precipitation:[1]}},models=[];
 await loadPointForecasts(point,{withPressure:true,load:async url=>{
  if(url.startsWith('./point-data/'))return {version:1,location:point,models:Object.fromEntries(MODELS.map(m=>[m.id,base]))};
  assert.match(url,/workers.dev/);throw Object.assign(Error('Daily limit'),{status:429});
 },onModel:m=>models.push(m)});
 assert.equal(models.length,MODELS.length);assert.ok(models.every(m=>m.values.precipitation[0]===1&&m.values.pressure_msl[0]===null));
});

test('total averages each available hour before summing when model horizons differ',()=>{
 const mean=averageSeries([{values:[2,4,null]},{values:[4,null,6]}],3);
 assert.deepEqual(mean.values,[3,4,6]);assert.equal(precipitationTotal(mean.values),13);
});


function loadPointForecasts(location,options){return loadAllPointForecasts(location,{...options,models:MODELS});}
