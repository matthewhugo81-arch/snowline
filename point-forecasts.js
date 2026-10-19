import {MODELS,normalise,fetchJSON,forecastURL} from './data.js?v=20261019-ec-ens';
import {FORECAST_SERVICE_URL,pointForecastURL} from './forecast-service.js?v=20261015-shared-cache-live';
import {POINT_LOCATIONS,POINT_TTL,POINT_MAX_AGE,pointKey,usableForecast,snapshotFor} from './point-snapshots.js';

function mergeHourlyFields(json,extra,keys){
 const indices=new Map((extra.hourly?.time??[]).map((t,i)=>[Date.parse(/Z$/.test(t)?t:t+'Z'),i]));
 const hourly={...json.hourly},hourly_units={...json.hourly_units};
 for(const key of keys){
  if(!Object.hasOwn(extra.hourly??{},key))continue;
  hourly[key]=json.hourly.time.map(t=>extra.hourly[key]?.[indices.get(Date.parse(/Z$/.test(t)?t:t+'Z'))]??null);
  if(extra.hourly_units?.[key])hourly_units[key]=extra.hourly_units[key];
 }
 return {...json,hourly,hourly_units};
}

export async function loadPointForecasts(location,{signal,force=false,withWindDirection=false,withPressure=false,onModel=()=>{},onError=()=>{},onProgress=()=>{},load=fetchJSON,service=FORECAST_SERVICE_URL}={}){
 const requested=[...(withWindDirection?['wind_direction_10m']:[]),...(withPressure?['pressure_msl']:[])];
 const missingFields=json=>requested.filter(key=>!Object.hasOwn(json.hourly,key));
 let shared=null;
 if(POINT_LOCATIONS.some(point=>pointKey(point)===pointKey(location))){
  try{shared=snapshotFor(await load('./point-data/'+pointKey(location)+'.json',signal,{force,ttl:300000,staleTtl:POINT_MAX_AGE}),location);}catch{/* Exact-location browser cache and direct API remain available. */}
 }
 signal?.throwIfAborted();
 let next=0,done=0;
 async function worker(){while(next<MODELS.length&&!signal?.aborted){
  const model=MODELS[next++];let json=shared?.models[model.id],checkedService=false;
  if(!usableForecast(json))json=null;
  try{
   if(json&&Date.now()-json._retrievedAt<POINT_TTL)json={...json,_source:'shared cache'};
   else{
    try{checkedService=!!service;const live=await load(pointForecastURL(location,model,service)??forecastURL(location,model),signal,{force,ttl:POINT_TTL,staleTtl:POINT_MAX_AGE,forceMinAge:service?POINT_TTL:60000,preserveRetrievedAt:!!service});if(!usableForecast(live))throw Error('No current forecast data returned.');json=live;}
    catch(error){
     if(signal?.aborted||!json||error.status&&error.status!==429&&error.status<500)throw error;
     json={...json,_stale:true,_refreshError:error.message,_retryAt:error.retryAt,_source:'shared cache'};
    }
   }
   signal?.throwIfAborted();
   if(!usableForecast(json))throw Error('No current forecast data for this location.');
   if(missingFields(json).length){
    try{
     // Published town snapshots can predate fields now present in Cloudflare.
     // Check that shared payload before spending a direct provider request.
     if(service&&!checkedService){
      const extra=await load(pointForecastURL(location,model,service),signal,{force,ttl:POINT_TTL,staleTtl:POINT_MAX_AGE,forceMinAge:POINT_TTL,preserveRetrievedAt:true});
      if(!usableForecast(extra))throw Error('No current shared forecast data.');
      json=mergeHourlyFields(json,extra,missingFields(json));
      if(extra._stale||extra._retryAt>Date.now())throw Error('Shared refresh unavailable.');
     }
     const missing=missingFields(json);
     // A present all-null field is the provider's availability answer. Do not
     // retry it, or bypass a shared-service failure/cooldown with direct calls.
     if(missing.length&&!json._stale&&!(json._retryAt>Date.now())){
     const url=new URL(forecastURL(location,model));url.searchParams.set('hourly',missing.join(','));
     const extra=await load(url.href,signal,{force,ttl:POINT_TTL,staleTtl:POINT_MAX_AGE,forceMinAge:POINT_TTL});
     json=mergeHourlyFields(json,extra,missing);
     }
    }catch{signal?.throwIfAborted();} // Existing forecasts remain usable if supplemental data is unavailable.
   }
   signal?.throwIfAborted();
   const parsed=normalise(json,model);
   onModel(parsed);
  }catch(error){if(!signal?.aborted)onError(model,error);}
  finally{if(!signal?.aborted)onProgress(++done,MODELS.length);}
 }}
 await Promise.all([worker(),worker(),worker()]);
 signal?.throwIfAborted();
 return shared;
}
