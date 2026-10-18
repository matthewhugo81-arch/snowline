import test from 'node:test';
import assert from 'node:assert/strict';
import {averageSeries,precipitationTotal} from '../average.js';
import {chartWindow} from '../chart-window.js';
import {VARIABLES,MODELS,normalise,forecastURL} from '../data.js';
import {loadPointForecasts} from '../point-forecasts.js';
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
