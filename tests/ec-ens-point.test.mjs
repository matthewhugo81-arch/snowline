import test from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,VARIABLES,forecastURL,normalise,agreement} from '../data.js';
import {averageSeries} from '../average.js';
import {MAP_MODELS} from '../map-models.js';

const ec=MODELS.find(m=>m.id==='ecmwf_ifs025_ensemble_mean');
test('EC ENS point mean does not add an unsupported or duplicate map choice',()=>{
 assert.ok(!MAP_MODELS.some(m=>m.id===ec.id));
 assert.equal(MAP_MODELS.filter(m=>m.id==='snowline_ecmwf_ensemble').length,1);
});
test('point endpoints keep deterministic and HGEFS requests separate from EC ENS',()=>{
 for(const model of MODELS.filter(m=>m.api!=='mogreps')){
  const url=new URL(forecastURL({latitude:53.9239,longitude:-2.1949},model));
  assert.equal(url.origin+url.pathname,model===ec?'https://ensemble-api.open-meteo.com/v1/ensemble':'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('models'),model.id);
  assert.deepEqual(url.searchParams.get('hourly').split(','),VARIABLES.map(v=>v.key));
 }
});
test('EC ENS preserves missing values, converts units, and counts once in the selected-model mean',()=>{
 const model=normalise({hourly:{time:['2026-10-19T12:00'],snowfall:[0.2],snow_depth:[0.12],temperature_2m:[6],wind_speed_10m:[10]},hourly_units:{snow_depth:'m',wind_speed_10m:'mp/h'}},ec);
 assert.equal(model.ensemble,true);assert.equal(model.values.snow_depth[0],12);
 assert.equal(model.values.wind_speed_10m[0],10);assert.equal(model.values.cloud_cover[0],null);
 assert.deepEqual(averageSeries([{values:[4]},{values:model.values.temperature_2m}],1),{values:[5],counts:[2]});
 assert.deepEqual(agreement([model],model.time[0]),{valid:0,snow:0,percent:null});
});
