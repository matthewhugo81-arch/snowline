// Local-only fixture. Exercise the production cache through workerd's native fetch,
// using a data URL so no Open-Meteo request or external connectivity is required.
import {ForecastCache,parsePoint} from '../../worker/cache-service.mjs';
function storage(){const values=new Map();return {get:async key=>values.get(key),put:async(key,value)=>values.set(key,value),list:async()=>new Map(),delete:async keys=>{for(const key of [].concat(keys))values.delete(key);}};}
export default {async fetch(){
 try{
  const native=new ForecastCache(storage());await native.ready;let calls=0;
  const payload={hourly:{time:[new Date().toISOString()],temperature_2m:[5]},hourly_units:{temperature_2m:'°C'}};
  const cache=new ForecastCache(storage(),{fetcher:async(url,init)=>{calls++;return native.fetcher('data:application/json,'+encodeURIComponent(JSON.stringify(payload)),init);}});
  const point=parsePoint('https://fixture/forecast?latitude=53&longitude=-2&model=ecmwf_ifs');
  const first=await cache.get(point),second=await cache.get(point);
  if(calls!==1||first.hourly.temperature_2m[0]!==5||first._retrievedAt!==second._retrievedAt)throw Error('Native fetch/cache mismatch.');
  return Response.json({ok:true,nativeFetch:true,upstream:calls,reused:true});
 }catch(error){return Response.json({ok:false,reason:error.message},{status:500});}
}};
