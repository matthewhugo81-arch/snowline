import test from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,VARIABLES,forecastURL,normalise,agreement,valueAt} from '../data.js';
import {MAP_MODELS} from '../map-models.js';
import {loadPointForecasts} from '../point-forecasts.js';
import {parsePoint,ForecastCache} from '../worker/cache-service.mjs';
import {buildDataset,datasetCSV,datasetCoverage} from '../export.js';

const uk=MODELS.find(m=>m.id==='ukmo_uk_ensemble_mean_2km');
const global=MODELS.find(m=>m.api==='mogreps');
const location={latitude:53.928,longitude:-2.195,name:'UK point'};
// Values and absent fields verified against the provider on 19 October 2026.
function response(){return {_retrievedAt:Date.now(),hourly:{time:[new Date().toISOString().replace(/\.\d+Z$/,'Z')],
 snowfall:[0],snow_depth:[null],temperature_2m:[7.7],dew_point_2m:[5.5],precipitation:[0],cloud_cover:[82],
 wind_speed_10m:[10.7],wind_gusts_10m:[14.5],wind_direction_10m:[54],relative_humidity_2m:[86],
 soil_temperature_0cm:[5.5],pressure_msl:[1031.6],temperature_850hPa:[null],temperature_500hPa:[null]},
 hourly_units:{wind_speed_10m:'mp/h',wind_gusts_10m:'mp/h'}};}

test('UK point mean has its own regional ensemble identity, preserving both map models',()=>{
 assert.ok(uk.regional&&uk.ensemble);assert.equal(uk.api,'ensemble');assert.notEqual(uk.id,global.id);
 assert.notEqual(uk.color,global.color);assert.match(uk.detail,/3 members/);
 const url=new URL(forecastURL(location,uk));
 assert.equal(url.origin,'https://ensemble-api.open-meteo.com');assert.equal(url.searchParams.get('models'),uk.id);
 assert.deepEqual(url.searchParams.get('hourly').split(','),VARIABLES.map(v=>v.key));
 assert.ok(!MAP_MODELS.some(m=>m.id===uk.id));
 assert.equal(MAP_MODELS.filter(m=>m.id==='ukmo_uk_ensemble_2km').length,1);
 assert.equal(MAP_MODELS.filter(m=>m.id==='snowline_mogreps_global').length,1);
});

test('UK available fields, true zeroes and missing upper air stay distinct in charts and downloads',()=>{
 const model=normalise(response(),uk),time=model.time[0];
 assert.equal(VARIABLES.filter(v=>valueAt(model,v.key,time)!==null).length,11);
 assert.equal(valueAt(model,'snowfall',time),0);assert.equal(valueAt(model,'wind_speed_10m',time),10.7);
 for(const key of ['snow_depth','temperature_850hPa','temperature_500hPa'])assert.equal(valueAt(model,key,time),null);
 assert.deepEqual(agreement([model],time),{valid:0,snow:0,percent:null});
 const options={modelDefinitions:[uk],models:new Map([[uk.id,model]]),times:[time],location,errors:new Map()};
 const surface=buildDataset({...options,variable:VARIABLES.find(v=>v.key==='temperature_2m')});
 assert.equal(surface.rows[0].average,7.7);assert.equal(surface.rows[0].averageCount,1);
 assert.match(datasetCSV(surface),/MOGREPS-UK 2 km mean.*3-member hourly mean/);
 assert.match(datasetCoverage(surface),/2 km regional grid/);
 const upper=buildDataset({...options,variable:VARIABLES.find(v=>v.key==='temperature_500hPa')});
 assert.equal(upper.hasData,false);assert.equal(upper.rows[0].average,null);
 assert.match(datasetCoverage(upper),/No values/);
});

test('shared cache accepts the UK mean, keeps its identity and retains present null fields',async()=>{
 const values=new Map(),db={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),delete:async()=>{},list:async()=>new Map()};
 let calls=0;
 const cache=new ForecastCache(db,{fetcher:async raw=>{calls++;assert.equal(new URL(raw).searchParams.get('models'),uk.id);return Response.json(response());}});
 const point=parsePoint('https://cache.test/forecast?'+new URLSearchParams({latitude:location.latitude,longitude:location.longitude,model:uk.id}));
 await cache.get(point);const cached=await cache.get(point);
 assert.equal(calls,1);assert.deepEqual(cached.hourly.temperature_500hPa,[null]);
});

test('UK availability does not trigger supplemental calls or blend in MOGREPS-G',async()=>{
 const loaded=[],calls=[];let nativeCalls=0;
 await loadPointForecasts(location,{models:[uk,global],withTemperature500:true,withPressure:true,withWindDirection:true,
 load:async url=>{calls.push(url);assert.equal(new URL(url).searchParams.get('model'),uk.id);return response();},
 loadMogreps:async()=>{nativeCalls++;return {...global,marker:'native G'};},onModel:m=>loaded.push(m)});
 assert.equal(calls.length,1);assert.equal(nativeCalls,1);
 assert.equal(loaded.find(m=>m.id===uk.id).values.temperature_500hPa[0],null);
 assert.equal(loaded.find(m=>m.id===global.id).marker,'native G');
});

test('outside UK coverage remains unavailable without a global substitute',async()=>{
 let calls=0;const errors=[],loaded=[];
 await loadPointForecasts({latitude:40.7128,longitude:-74.006},{models:[uk],withTemperature500:true,
 load:async()=>{calls++;throw Object.assign(Error('No data is available for this location'),{status:400});},
 loadMogreps:async()=>assert.fail('Must not substitute MOGREPS-G'),onModel:m=>loaded.push(m),onError:(m,e)=>errors.push([m.id,e.message])});
 assert.equal(calls,1);assert.equal(loaded.length,0);
 assert.deepEqual(errors,[[uk.id,'No data is available for this location']]);
});
