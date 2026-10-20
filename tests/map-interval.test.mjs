import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastInterval,intervalForecastTimes} from '../map-interval.js';
import {MAP_MODELS} from '../map-models.js';
import {panelForecastTimes} from '../map-panels.js';
import {fieldIntervalHours} from '../map-sources.js';
const time=hour=>new Date(Date.UTC(2026,9,11,hour)).toISOString();
const models=(...ids)=>ids.map(id=>MAP_MODELS.find(model=>model.id===id));
const hourly=Array.from({length:49},(_,index)=>time(index));

test('global and ensemble maps default to three-hour steps, with native, six and twelve-hour choices',()=>{
 for(const model of MAP_MODELS.filter(model=>!model.regional||model.ensemble)){
  assert.deepEqual(forecastInterval([model]),{shortRange:false,hours:3},model.id);
  assert.equal(forecastInterval([model],'native').hours,0);
  assert.equal(forecastInterval([model],'6').hours,6);
  assert.equal(forecastInterval([model],'12').hours,12);
 }
 assert.deepEqual(intervalForecastTimes(hourly,3),Array.from({length:17},(_,i)=>time(i*3)));
 assert.deepEqual(intervalForecastTimes(hourly,6),Array.from({length:9},(_,i)=>time(i*6)));
 assert.deepEqual(intervalForecastTimes(hourly,12),[0,12,24,36,48].map(time));
 assert.deepEqual(intervalForecastTimes(hourly,0),hourly);
});

test('every short-range model keeps native detail even after a six-hour global selection',()=>{
 const regional=MAP_MODELS.filter(model=>model.regional&&!model.ensemble);
 assert.equal(regional.some(model=>model.id==='ukmo_uk_deterministic_2km_nowcast'),false);
 assert.ok(regional.some(model=>model.id==='ukmo_uk_deterministic_2km'));
 for(const model of regional){
  for(const selection of ['3','6','12','native']){
   const interval=forecastInterval([model],selection);
   assert.deepEqual(interval,{shortRange:true,hours:0},model.id);
   assert.deepEqual(intervalForecastTimes(hourly,interval.hours),hourly);
  }
 }
 assert.equal(forecastInterval(models('gfs_global','ukmo_uk_deterministic_2km'),'6').hours,0);
 assert.equal(forecastInterval(models('ukmo_uk_deterministic_2km','gfs_global'),'6').hours,0);
});

test('comparison retains each panel at the chosen interval without filling gaps in its data',()=>{
 const sixHourly=hourly.filter((_,i)=>i%6===0);
 const meta=times=>({reference_time:time(0),valid_times:times,variables:['temperature_2m']});
 const state={compare:true,model:'gfs_global',field:'temperature_2m',modelB:'ncep_gefs05',fieldB:'temperature_2m',metas:{gfs_global:meta(hourly),ncep_gefs05:meta(sixHourly)}};
 assert.deepEqual(panelForecastTimes(state,3),Array.from({length:17},(_,i)=>time(i*3)));
 assert.deepEqual(panelForecastTimes(state,0),hourly);
 assert.deepEqual(state.metas.ncep_gefs05.valid_times,sixHourly,'Coarse panel metadata keeps its own native steps');
 const missing=hourly.filter((_,i)=>i!==9);
 assert.equal(intervalForecastTimes(missing,3).includes(time(9)),false);
 assert.deepEqual(intervalForecastTimes([],3),[]);
});

test('off-cycle coarse panel times survive beside an hourly model at a selected interval',()=>{
 const meta=times=>({reference_time:time(0),valid_times:times,variables:['temperature_2m']});
 const offCycle=[1,7,13,19].map(time);
 const state={compare:true,model:'hourly',field:'temperature_2m',modelB:'coarse',fieldB:'temperature_2m',metas:{hourly:meta(hourly.slice(0,25)),coarse:meta(offCycle)}};
 assert.deepEqual(panelForecastTimes(state,3),[0,1,3,6,7,9,12,13,15,18,19,21,24].map(time));
 assert.deepEqual(panelForecastTimes(state,6),[0,1,6,7,12,13,18,19,24].map(time));
 state.compare=false;
 assert.deepEqual(panelForecastTimes(state,6),[0,6,12,18,24].map(time));
});

test('UTC steps are independent of run cycle, while short and off-cycle feeds remain usable',()=>{
 assert.deepEqual(intervalForecastTimes(hourly.slice(1,13),3),[3,6,9,12].map(time));
 assert.deepEqual(intervalForecastTimes(hourly.slice(1,13),6),[6,12].map(time));
 assert.deepEqual(intervalForecastTimes(hourly.slice(1,25),12),[12,24].map(time));
 const offCycle=[1,7,13,19].map(time);
 assert.deepEqual(intervalForecastTimes(offCycle,3),offCycle);
 assert.deepEqual(intervalForecastTimes(offCycle,6),offCycle);
 assert.deepEqual(intervalForecastTimes([time(1),time(2)],3),[time(1)]);
 assert.deepEqual(intervalForecastTimes([time(2)],6),[time(2)]);
 const halfHours=[.5,1.5,2.5,3.5].map(h=>new Date(Date.parse(time(0))+h*3600000).toISOString());
 assert.deepEqual(intervalForecastTimes(halfHours,3),[halfHours[0],halfHours[3]]);
});

test('three-hour viewing reduces downloads without changing the rain or snow averaging period',()=>{
 for(const field of ['precipitation','snowfall_water_equivalent']){
  const meta={domain:'ncep_gfs013',reference_time:time(0),valid_times:hourly,variables:[field]};
  const state={model:'gfs_global',field,metas:{gfs_global:meta}};
  const native=panelForecastTimes(state),selected=intervalForecastTimes(native,3);
  assert.equal(native.length,48);
  assert.equal(selected.length,16);
  assert.equal(selected.includes(time(0)),false);
  for(const valid of selected)assert.equal(fieldIntervalHours(meta,field,valid),1);
 }
});

test('interactive panels can choose intervals for UKV and mixed comparisons without losing hourly availability',()=>{
 const options={allowRegionalSteps:true};
 for(const selected of [models('ukmo_uk_deterministic_2km'),models('gfs_global','ukmo_uk_deterministic_2km','icon_global')]){
  assert.equal(forecastInterval(selected,null,options).hours,0,'Regional default retains all supplied hours');
  for(const choice of ['3','6','12']){
   const {hours}=forecastInterval(selected,choice,options);
   assert.equal(hours,Number(choice));
   const shown=intervalForecastTimes(hourly,hours);
   assert.ok(shown.length<hourly.length);
   assert.ok(shown.every(t=>Date.parse(t)%(hours*3600000)===0));
  }
  assert.deepEqual(intervalForecastTimes(hourly,forecastInterval(selected,'native',options).hours),hourly);
 }
 assert.equal(forecastInterval(models('gfs_global'),null,options).hours,3);
});
