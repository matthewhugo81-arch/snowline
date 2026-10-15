import {MODELS,normalise,fetchJSON,forecastURL} from './data.js?v=20261015-shared-cache';
import {FORECAST_SERVICE_URL,pointForecastURL} from './forecast-service.js?v=20261015-shared-cache-live';
import {POINT_LOCATIONS,POINT_TTL,POINT_MAX_AGE,pointKey,usableForecast,snapshotFor} from './point-snapshots.js';

export async function loadPointForecasts(location,{signal,force=false,onModel=()=>{},onError=()=>{},onProgress=()=>{},load=fetchJSON,service=FORECAST_SERVICE_URL}={}){
 let shared=null;
 if(POINT_LOCATIONS.some(point=>pointKey(point)===pointKey(location))){
  try{shared=snapshotFor(await load('./point-data/'+pointKey(location)+'.json',signal,{force,ttl:300000,staleTtl:POINT_MAX_AGE}),location);}catch{/* Exact-location browser cache and direct API remain available. */}
 }
 signal?.throwIfAborted();
 let next=0,done=0;
 async function worker(){while(next<MODELS.length&&!signal?.aborted){
  const model=MODELS[next++];let json=shared?.models[model.id];
  if(!usableForecast(json))json=null;
  try{
   if(json&&Date.now()-json._retrievedAt<POINT_TTL)json={...json,_source:'shared cache'};
   else{
    try{const live=await load(pointForecastURL(location,model,service)??forecastURL(location,model),signal,{force,ttl:POINT_TTL,staleTtl:POINT_MAX_AGE,forceMinAge:service?POINT_TTL:60000,preserveRetrievedAt:!!service});if(!usableForecast(live))throw Error('No current forecast data returned.');json=live;}
    catch(error){
     if(signal?.aborted||!json||error.status&&error.status!==429&&error.status<500)throw error;
     json={...json,_stale:true,_refreshError:error.message,_retryAt:error.retryAt,_source:'shared cache'};
    }
   }
   signal?.throwIfAborted();
   if(!usableForecast(json))throw Error('No current forecast data for this location.');
   const parsed=normalise(json,model);
   onModel(parsed);
  }catch(error){if(!signal?.aborted)onError(model,error);}
  finally{if(!signal?.aborted)onProgress(++done,MODELS.length);}
 }}
 await Promise.all([worker(),worker(),worker()]);
 signal?.throwIfAborted();
 return shared;
}
