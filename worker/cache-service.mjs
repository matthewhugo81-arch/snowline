import {MODELS,forecastURL} from '../data.js';
import {POINT_TTL,POINT_MAX_AGE,usableForecast,pointKey} from '../point-snapshots.js';
import {retryTime} from '../cache.js';
const MAX_ENTRIES=256;
export function parsePoint(url){
 const query=new URL(url).searchParams;
 if([...query.keys()].some(k=>!['latitude','longitude','model'].includes(k))||[...query.keys()].some(k=>query.getAll(k).length!==1))throw Error('Unsupported forecast parameters.');
 const latitude=query.get('latitude'),longitude=query.get('longitude');
 if(!latitude?.trim()||!longitude?.trim()||!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude))||Math.abs(Number(latitude))>90||Math.abs(Number(longitude))>180)throw Error('Invalid coordinates.');
 const model=MODELS.find(m=>m.id===query.get('model'));if(!model)throw Error('Unsupported model.');
 const location={latitude:Number(Number(latitude).toFixed(4)),longitude:Number(Number(longitude).toFixed(4))};
 return {location,model,key:pointKey(location)+'/'+model.id};
}
export class ForecastCache {
 constructor(storage,{fetcher=(...args)=>globalThis.fetch(...args),now=()=>Date.now(),dailyBudget=1000}={}){
  this.storage=storage;this.fetcher=fetcher;this.now=now;
  this.budget=Number.isInteger(Number(dailyBudget))&&Number(dailyBudget)>0?Number(dailyBudget):1000;
  this.inflight=new Map();this.active=0;this.waiters=[];
  this.ready=(async()=>{this.entries=await storage.list({prefix:'entry:'});this.state=await storage.get('state')??{};})();
 }
 day(){const date=new Date(this.now()).toISOString().slice(0,10);if(this.state.date!==date)this.state={date,cooldown:this.state.cooldown,requests:0,hits:0,joined:0,upstream:0,stale:0,errors:0,blocked:0};return this.state;}
 async persist(){await this.storage.put('state',structuredClone(this.state));}
 async stats(){await this.ready;return {...this.day(),entries:this.entries.size,inflight:this.inflight.size,dailyHttpBudget:this.budget};}
 async store(key,entry){
  const name='entry:'+key;this.entries.delete(name);this.entries.set(name,entry);
  const deleted=[];
  for(const [k,v] of this.entries){if(v.at+POINT_MAX_AGE<=this.now()||this.entries.size>MAX_ENTRIES){this.entries.delete(k);deleted.push(k);}}
  await this.storage.put(name,entry);if(deleted.length)await this.storage.delete(deleted);
 }
 async slot(){if(this.active<3){this.active++;return;}if(this.waiters.length>=60)throw Object.assign(Error('Forecast service busy. Try again shortly.'),{status:503});await new Promise(resolve=>this.waiters.push(resolve));}
 release(){const next=this.waiters.shift();if(next)next();else this.active--;}
 async get(point){
  await this.ready;this.day().requests++;
  const entry=this.entries.get('entry:'+point.key),now=this.now();
  if(entry?.value&&usableForecast(entry.value,now)&&now-entry.at<POINT_TTL){this.state.hits++;await this.persist();return {...entry.value,_source:'shared cache'};}
  if(this.inflight.has(point.key)){this.state.joined++;return structuredClone(await this.inflight.get(point.key));}
  const pending=this.refresh(point,entry);this.inflight.set(point.key,pending);
  try{return structuredClone(await pending);}finally{this.inflight.delete(point.key);}
 }
 async refresh(point,entry){
  let acquired=false;
  try{
   await this.slot();acquired=true;const state=this.day(),now=this.now();
   if(state.cooldown?.retryAt>now)throw Object.assign(Error(state.cooldown.message),{status:429,retryAt:state.cooldown.retryAt});
   if(entry?.retryAt>now)throw Object.assign(Error(entry.message),{status:entry.status,retryAt:entry.retryAt});
   if(state.upstream>=this.budget){state.blocked++;throw Object.assign(Error('Shared forecast daily safety budget reached.'),{status:429,retryAt:(Math.floor(now/86400000)+1)*86400000+60000});}
   // Persist the reservation before the outbound request, including across restarts.
   state.upstream++;await this.persist();
   let response;
   try{response=await this.fetcher(forecastURL(point.location,point.model),{signal:AbortSignal.timeout(18000),redirect:'manual'});}catch{throw Object.assign(Error('Forecast request failed. Try again shortly.'),{status:502});}
   const json=await response.json().catch(()=>null);
   if(!response.ok||json?.error){
    const redirected=response.status>=300&&response.status<400;
    const message=redirected?'Forecast provider unexpectedly redirected the request.':json?.reason??`Forecast provider returned ${response.status}`;
    const status=response.ok||redirected?502:response.status;
    const retryAt=status===429?retryTime(response,message,this.now()):this.now()+(status===400?300000:60000);
    if(status===429)this.state.cooldown={message,retryAt};
    throw Object.assign(Error(message),{status,retryAt});
   }
   const at=this.now(),value={...json,_retrievedAt:at};
   if(!usableForecast(value,at))throw Object.assign(Error('Provider returned no current forecast.'),{status:502});
   await this.store(point.key,{at,value});await this.persist();
   return {...value,_source:'shared cache'};
  }catch(error){
   this.day().errors++;
   const retryAt=error.retryAt??this.now()+60000;
   if(error.status!==429)await this.store(point.key,{at:entry?.at??this.now(),value:entry?.value,retryAt,status:error.status??502,message:error.message});
   if(entry?.value&&usableForecast(entry.value,this.now())&&(!error.status||error.status===429||error.status>=500)){
    this.state.stale++;await this.persist();
    return {...entry.value,_stale:true,_refreshError:error.message,_retryAt:retryAt,_source:'shared cache'};
   }
   await this.persist();throw Object.assign(error,{retryAt});
  }finally{if(acquired)this.release();}
 }
}
