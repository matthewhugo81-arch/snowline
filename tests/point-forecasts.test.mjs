import test from 'node:test';
import assert from 'node:assert/strict';
import {MODELS as ALL_MODELS,VARIABLES} from '../data.js';
import {loadPointForecasts as loadAllPointForecasts} from '../point-forecasts.js';
import {POINT_LOCATIONS,POINT_MAX_AGE,usableForecast} from '../point-snapshots.js';
const MODELS=ALL_MODELS.filter(model=>model.api!=='mogreps');
const point=POINT_LOCATIONS[0];
function forecast(age=0){return {_retrievedAt:Date.now()-age,elevation:161,hourly:{time:[new Date(Math.floor(Date.now()/3600000)*3600000).toISOString()],...Object.fromEntries(VARIABLES.map(v=>[v.key,[v.key==='temperature_2m'?5:0]]))},hourly_units:{wind_speed_10m:'mph',wind_gusts_10m:'mph',snow_depth:'m'}};}
function snapshot(age=0){return {version:1,location:point,models:Object.fromEntries(MODELS.map(m=>[m.id,forecast(age)]))};}
test('shared exact-location snapshot loads all registered models and all variables with no API calls, including Refresh',async()=>{
 for(const force of [false,true]){const loaded=[],requests=[];
 await loadPointForecasts(point,{service:'',force,load:async url=>{requests.push(url);assert.ok(url.startsWith('./point-data/'));return snapshot();},onModel:m=>loaded.push(m)});
 assert.equal(requests.length,1);assert.equal(loaded.length,MODELS.length);assert.ok(loaded.every(m=>m.source==='shared cache'&&Object.keys(m.values).length===VARIABLES.length));assert.equal(loaded[0].values.snowfall[0],0);
 }
});
test('partial shared data isolates a failed model without losing the remaining models',async()=>{
 const shared=snapshot();delete shared.models[MODELS[0].id];const loaded=[],errors=[];
 await loadPointForecasts(point,{service:'',load:async url=>{if(url.startsWith('./point-data/'))return shared;throw Object.assign(Error('Bad model'),{status:400});},onModel:m=>loaded.push(m),onError:(m,e)=>errors.push(e)});
 assert.equal(loaded.length,MODELS.length-1);assert.equal(errors.length,1);
});
test('stale shared forecasts retain original timestamp and label on 429; expired forecasts are refused',async()=>{
 const shared=snapshot(7200000),loaded=[];
 await loadPointForecasts(point,{service:'',load:async url=>{if(url.startsWith('./point-data/'))return shared;throw Object.assign(Error('Daily API limit'),{status:429,retryAt:Date.now()+60000});},onModel:m=>loaded.push(m)});
 assert.equal(loaded.length,MODELS.length);assert.ok(loaded.every(m=>m.stale&&m.refreshError==='Daily API limit'));assert.equal(loaded[0].fetchedAt,shared.models[MODELS[0].id]._retrievedAt);
 assert.equal(usableForecast(forecast(POINT_MAX_AGE+1)),false);
 const past=forecast();past.hourly.time=['2020-01-01T00:00:00Z'];assert.equal(usableForecast(past),false);
});
test('wrong-location snapshots are rejected and arbitrary coordinates use their own direct requests',async()=>{
 const shared=snapshot();shared.location={latitude:0,longitude:0};let api=0;
 const load=async url=>{if(url.startsWith('./point-data/'))return shared;api++;return forecast();};
 await loadPointForecasts(point,{service:'',load});assert.equal(api,MODELS.length);
 api=0;await loadPointForecasts({latitude:52,longitude:1},{service:'',load:async url=>{assert.ok(url.includes('latitude=52&longitude=1'));api++;return forecast();}});assert.equal(api,MODELS.length);
});
test('location cancellation never emits a stale model or error',async()=>{
 const controller=new AbortController(),models=[],errors=[];
 await assert.rejects(loadPointForecasts(point,{service:'',signal:controller.signal,load:async()=>{controller.abort();return snapshot();},onModel:m=>models.push(m),onError:(m,e)=>errors.push(e)}),{name:'AbortError'});
 assert.equal(models.length+errors.length,0);
});


function loadPointForecasts(location,options){return loadAllPointForecasts(location,{...options,models:MODELS});}
