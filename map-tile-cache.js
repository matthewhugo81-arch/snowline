// Keep prepared PNG/vector tiles on disk, with a small hot memory cache. MapLibre
// can then recreate a distant frame without downloading/decoding the model again.
import {cacheDiskBudget,SharedForecastStorage,cleanupObsoleteCaches} from './map-cache-storage.js?v=20261024-cache-liveness2';
const PREFIX='snowline-forecast-tiles-v1-';
// A preparation slot includes network waits, not just worker CPU time. Allow
// capable desktops to overlap more reads while reserving four foreground slots.
// Keep the existing budgets on mobile and lower-memory devices.
export function forecastRenderBudget({hardwareConcurrency=4,deviceMemory,mobile=false}={}){
 if(mobile)return {concurrency:4,backgroundConcurrency:2};
 // Firefox does not expose deviceMemory. Missing information must not silently
 // disable desktop throughput or halve the slots reserved for selected charts.
 // Explicit low-memory reports and mobile devices retain their smaller budgets.
 if(hardwareConcurrency>=8&&(deviceMemory==null||deviceMemory>=8))return {concurrency:16,backgroundConcurrency:12};
 return {concurrency:8,backgroundConcurrency:hardwareConcurrency>=8&&deviceMemory>=4?6:4};
}
const abort=()=>new DOMException('Aborted','AbortError');
const copy=value=>({...value,data:structuredClone(value.data)});
// The native renderer returns ImageBitmap, not encoded PNG bytes. Response(bitmap)
// stores the literal text "[object ImageBitmap]", and JSON sizing counts it as {}.
// Encode once so memory limits, disk restoration and worker transfers all use
// owned, valid bytes. Release the renderer's graphics allocation after encoding.
async function cacheable(result){
 const bitmap=result.data;
 if(typeof ImageBitmap!=='undefined'&&bitmap instanceof ImageBitmap){
  try{
   const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
   const context=canvas.getContext('2d');
   if(!context)throw Error('Cannot prepare forecast image');
   context.drawImage(bitmap,0,0);
   return {...result,data:await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()};
  }finally{bitmap.close();}
 }
 return result;
}
const retryable=error=>!(/\b(?:400|401|403|404|410)\b/.test(error?.message??'')||[400,401,403,404,410].includes(error?.status));
const wait=(ms,signal)=>new Promise((resolve,reject)=>{
 if(signal.aborted){reject(abort());return;}
 const cancelled=()=>{clearTimeout(timer);reject(abort());};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',cancelled);resolve();},ms);
 signal.addEventListener('abort',cancelled,{once:true});
});
export class ForecastTileCache{
 constructor(load,{storage=globalThis.caches,memoryBytes=32*1024*1024,onLimit=()=>{},retries=2,retryDelay=150,abortDelay=120,maxContexts=3,persistent=false,diskBytes=256*1024*1024,diskEntries=16384,maxAge=3600000,cacheVersion='render-20261021-complete-tiles',concurrency=8,backgroundConcurrency=4,maxPendingWrites=32,coordinate=false,adaptive=false}={}){
  Object.assign(this,{load,storage,memoryBytes,onLimit,retries,retryDelay,abortDelay,maxContexts,persistent,diskBytes,diskEntries,maxAge,concurrency,backgroundConcurrency,maxPendingWrites});
  this.saveReservations=new Set();
  this.renderQueue=[];this.rendering=new Set();this.foreground=null;
  this.diskStates=new WeakMap();
  this.sharedStores=new WeakMap();
  this.backgroundBudget=backgroundConcurrency;
  this.coordinated=coordinate&&persistent&&!!globalThis.navigator?.locks&&!!globalThis.indexedDB;
  this.leaseCapable=persistent&&!!globalThis.navigator?.locks&&!!globalThis.indexedDB;
  this.isolated=coordinate&&!this.coordinated;
  this.limitReason=null;
  this.contexts=new Map();this.contextSequence=0;this.retentionRevision=0;
  this.context=null;this.generation=0;this.memory=new Map();this.bytes=0;this.pending=new Map();this.writes=new Map();this.limited=false;
  // Run/field/style URLs and complete tile coordinates isolate pixels. A revision
  // invalidates releases. Callers may disable the default per-entry lifetime
  // when they validate source files and rotate cacheVersion on corrections.
  this.session=persistent&&!this.isolated?'persistent-'+encodeURIComponent(cacheVersion):Date.now()+'-'+Math.random().toString(36).slice(2);
  this.cleanup=()=>{
   const shared=this.contexts.get(this.context)?.shared;
   if(!this.coordinated||!shared||this.cleaning)return;
   this.cleaning=shared.lease().then(()=>cleanupObsoleteCaches({storage:this.storage,db:shared.db,locks:shared.locks,prefix:PREFIX,currentPrefix:PREFIX+this.session+'-'})).catch(()=>{}).finally(()=>{this.cleaning=null;});
  };
  if(this.coordinated)this.cleanupTimer=setInterval(()=>this.cleanup(),60000);
  // Only remove this feature's abandoned caches, never other site data.
  storage?.keys().then(names=>Promise.all(names.filter(name=>name.startsWith(PREFIX)&&
   (name.startsWith(PREFIX+'persistent-')?false:
    Number(name.slice(PREFIX.length).split('-')[0])<Date.now()-172800000)).map(name=>storage.delete(name)))).catch(()=>{});
  if(adaptive){
   this.mobile=globalThis.navigator?.userAgentData?.mobile||globalThis.matchMedia?.('(max-width: 650px), (pointer: coarse)')?.matches;
   this.budgetReady=Promise.resolve().then(()=>globalThis.navigator?.storage?.estimate()).catch(()=>null).then(estimate=>{
    this.diskBytes=cacheDiskBudget({mobile:this.mobile,deviceMemory:globalThis.navigator?.deviceMemory,...estimate});
    if(this.isolated)this.diskBytes=Math.min(this.diskBytes,256*1024*1024);
    for(const entry of this.contexts.values())entry.shared?.update({budget:this.diskBytes});
    this.onLimit();
   });
  }
 }
 setContext(context){
  if(context===this.context)return false;
  this.contexts.get(this.context)?.shared?.update({sequence:[],protected:[],participating:false});
  this.resetPending();this.context=context;this.limited=false;this.limitReason=null;
  let entry=this.contexts.get(context);
  if(!entry){const name=PREFIX+this.session+'-'+(this.persistent?encodeURIComponent(context):++this.contextSequence);entry={name,disk:this.storage?.open(name).catch(()=>null)??Promise.resolve(null)};}
  this.contexts.delete(context);this.contexts.set(context,entry);
  this.name=entry.name;this.disk=entry.disk;
  // Briefing caches keep their own accounting, but still announce liveness so
  // another tab cannot retire their cache version while charts are in use.
  if(this.leaseCapable&&!this.coordinated&&!this.isolated&&!entry.lease){
   entry.lease=new SharedForecastStorage({name:entry.name,store:entry.disk,budget:this.diskBytes});
   entry.lease.lease().catch(()=>{});
  }
  if(this.coordinated&&!entry.shared){
   entry.shared=new SharedForecastStorage({name:entry.name,store:entry.disk,budget:this.diskBytes,entries:this.diskEntries,onChange:()=>{
    if(this.contexts.get(this.context)?.shared!==entry.shared)return;
    this.backgroundConcurrency=Math.max(1,Math.floor(this.backgroundBudget/Math.max(1,entry.shared.activeWindows??entry.shared.stats?.windows??1)));
    this.drain();
    clearTimeout(this.statsTimer);this.statsTimer=setTimeout(()=>this.onLimit(),150);
   },onEvict:keys=>{
    for(const key of keys){
     const memoryKey=new URL(key).searchParams.get('key'),saved=this.memory.get(memoryKey);if(saved)saved.durable=false;
     if(this.retainedRequest(key))this.limit('budget');
    }
   }});
   entry.disk.then(store=>{if(store)this.sharedStores.set(store,entry.shared);}).catch(()=>{});
  }
  while(this.contexts.size>this.maxContexts){const [key,old]=this.contexts.entries().next().value;this.contexts.delete(key);old.shared?.close();old.lease?.close();if(!this.coordinated)old.disk.then(()=>this.storage?.delete(old.name)).catch(()=>{});}
  if(this.coordinated&&!this.cleanupTimer)this.cleanupTimer=setInterval(()=>this.cleanup(),60000);
  entry.shared?.update({participating:true,active:!globalThis.document?.hidden});
  this.cleanup();
  if(this.persistent&&!this.coordinated)entry.disk.then(async()=>{
   const active=new Set([...this.contexts.values()].map(item=>item.name));
   const others=(await this.storage?.keys()??[]).filter(name=>name.startsWith(PREFIX+this.session+'-')&&!active.has(name));
   await Promise.all(others.slice(0,Math.max(0,others.length+active.size-this.maxContexts)).map(name=>this.storage.delete(name)));
  }).catch(()=>{});
  return true;
 }
 resetPending(){
  this.generation++;
  for(const job of this.pending.values()){clearTimeout(job.abortTimer);job.controller.abort();}
  this.pending.clear();this.writes.clear();this.saveReservations.clear();this.memory.clear();this.bytes=0;
 }
 release(){
  clearInterval(this.cleanupTimer);this.cleanupTimer=null;
  clearTimeout(this.statsTimer);for(const entry of this.contexts.values()){entry.shared?.close();entry.lease?.close();}
  this.resetPending();
  if(!this.persistent||this.isolated)for(const entry of this.contexts.values())entry.disk.then(()=>this.storage?.delete(entry.name)).catch(()=>{});
  this.contexts.clear();this.context=null;
  this.disk=null;this.name=null;
 }
 limit(reason='storage-unavailable'){this.retentionRevision++;if(!this.limited||this.limitReason!==reason){this.limited=true;this.limitReason=reason;this.onLimit();}}
 storageStatus(){const shared=this.contexts.get(this.context)?.shared;return {...shared?.stats,activeWindows:shared?.activeWindows,budget:shared?.stats?.budget??this.diskBytes,reason:this.limitReason,coordinated:this.coordinated};}
 setProtected(urls){this.protectedURLs=[...new Set(urls)];this.contexts.get(this.context)?.shared?.update({protected:this.protectedURLs});}
 setSequence(urls){
  const next=[...new Set(urls)].sort();
  if(JSON.stringify(next)===JSON.stringify(this.sequenceURLs))return;
  this.sequenceURLs=next;
  this.contexts.get(this.context)?.shared?.update({sequence:next});
  // Changing model/layer frees obsolete sequence capacity. A cache that filled
  // during earlier analysis must not permanently stop every later selection.
  if(this.limited){this.limited=false;this.limitReason=null;this.onLimit();}
 }
 retainedRequest(request){
  if(!this.sequenceURLs)return true;
  const [,url]=JSON.parse(new URL(request).searchParams.get('key'));
  return this.sequenceURLs.some(source=>url===source||url.startsWith(source+'/'));
 }
 async put(store,request,response,bytes,generation=this.generation){
  const shared=this.sharedStores.get(store);
  if(shared){await this.budgetReady;return shared.put(request,response,bytes);}
  if(!this.persistent)return store.put(request,response);
  let state=this.diskStates.get(store);
  if(!state){
   state={entries:new Map(),bytes:0,queue:Promise.resolve()};this.diskStates.set(store,state);
   state.queue=(async()=>{
    for(const key of await store.keys()){
     const saved=await store.match(key),size=Number(saved?.headers.get('x-snowline-bytes'));
     if(saved?.headers.get('x-snowline-bytes')===null||!Number.isFinite(size)||size<0){await store.delete(key);continue;}
     state.entries.set(typeof key==='string'?key:key.url,size);state.bytes+=size;
    }
   })();
  }
  // Serialize only background disk writes, never foreground image delivery.
  const write=state.queue.then(async()=>{
   if(bytes>this.diskBytes)throw Error('Forecast tile exceeds storage budget');
   const old=state.entries.get(request)??0;
   state.entries.delete(request);state.bytes-=old;
   while((state.bytes+bytes>this.diskBytes||state.entries.size>=this.diskEntries)&&state.entries.size){
    const [key,size]=[...state.entries].find(([key])=>!this.retainedRequest(key))??state.entries.entries().next().value;
    await store.delete(key);state.entries.delete(key);state.bytes-=size;
    // A complete sequence no longer fits. Stop speculative full-sequence work
    // instead of repeatedly evicting earlier frames while claiming all are kept.
    // Late writes for an old viewport must not limit the currently active view.
    if(generation===this.generation&&this.retainedRequest(key)){
     const entry=this.memory.get(new URL(key).searchParams.get('key'));
     if(entry)entry.durable=false;
     this.limit('budget');
    }
   }
   await store.put(request,response);state.entries.set(request,bytes);state.bytes+=bytes;
  });
  state.queue=write.catch(()=>{});return write;
 }
 fresh(created,url=''){
  // Immutable archive commits cannot be corrected in place. Retain their
  // prepared pixels for the run-retention window, avoiding another native
  // download/decode on next-day comparisons. Mutable feeds keep the short TTL.
  const immutable=/^om:\/\/https:\/\/raw\.githubusercontent\.com\/matthewhugo81-arch\/snowline\/[a-f0-9]{40}\/ensemble-data\/snowline_(?:ecmwf|gefs)_ensemble\//.test(url);
  return Number.isFinite(created)&&created>0&&Date.now()>=created&&Date.now()-created<(immutable?Math.max(48*3600000,this.maxAge):this.maxAge);
 }
 remember(key,result,durable,persisting=false,created=Date.now()){
  const bytes=result.data instanceof ArrayBuffer?result.data.byteLength:new TextEncoder().encode(JSON.stringify(result.data)).length;
  const old=this.memory.get(key);if(old)this.bytes-=old.bytes;
  const entry={result,bytes,durable,persisting,created};
  this.memory.delete(key);this.memory.set(key,entry);this.bytes+=bytes;
  while(this.bytes>this.memoryBytes&&this.memory.size){
   const [first,item]=this.memory.entries().next().value;this.memory.delete(first);this.bytes-=item.bytes;
   if(!item.durable&&!item.persisting)this.limit(item.storageReason??this.limitReason??'memory');
  }
  return entry;
 }
 persist(key,request,entry,store,generation,type){
  // Display now; save separately. Keep pending writes bounded if storage stalls.
  const job={entry,generation};this.writes.set(key,job);
  job.promise=Promise.resolve().then(()=>this.put(store,request,new Response(type==='json'?JSON.stringify(entry.result.data):entry.result.data,{headers:{'x-snowline-type':type==='json'?'json':'bytes','x-snowline-bytes':String(entry.bytes),'x-snowline-created':String(entry.created)}}),entry.bytes,generation))
   .then(()=>{entry.durable=true;},error=>{entry.storageReason=error?.cacheReason??(error?.name==='QuotaExceededError'?'browser-quota':'storage-unavailable');if(generation===this.generation)this.limit(entry.storageReason);})
   .finally(()=>{
    entry.persisting=false;
    if(this.writes.get(key)===job)this.writes.delete(key);
    if(generation===this.generation&&!entry.durable&&this.memory.get(key)!==entry)this.limit(entry.storageReason);
    this.drain();
   });
 }
 setForeground(urls,nearby=[]){
  this.foreground=[...new Set(urls)];
  this.nearby=[...new Set(nearby)];
  for(const job of this.pending.values())job.background=!this.isForeground(job.url);
  this.drain();
 }
 isForeground(url){return this.foreground.some(source=>url===source||url.startsWith(source+'/'));}
 drain(){
  // Foreground pixels can finish even if disk writes are stalled. Keep those
  // waiting saves in the bounded hot cache, and flush them as capacity returns.
  for(const [key,entry]of this.memory){
   if(this.writes.size>=this.maxPendingWrites)break;
   if(!entry.save)continue;
   const {request,store,generation,type}=entry.save;delete entry.save;
   if(generation!==this.generation)continue;
   entry.persisting=true;this.persist(key,request,entry,store,generation,type);
  }
  // Bound native reads, worker renders and PNG encoding across all panels.
  // Background frames cannot fill the foreground slots. Cached bytes bypass
  // this queue altogether, and selecting a queued tile promotes its shared job.
  while(this.rendering.size<this.concurrency){
   // Reserve save capacity before generating more bytes. A busy disk must slow
   // speculative rendering, not silently drop saves and invalidate the sequence.
   // Keep capacity for selected tiles even when background writes are stalled.
   const saving=this.writes.size+this.saveReservations.size;
   const reserve=Math.min(this.concurrency,Math.max(1,Math.floor(this.maxPendingWrites/4)));
   const hasRoom=entry=>!entry.job.background||!entry.job.canSave||this.saveReservations.has(entry.job)||saving<Math.max(1,this.maxPendingWrites-reserve);
   let index=this.renderQueue.findIndex(entry=>!entry.job.background&&hasRoom(entry));
   if(index<0){
    if([...this.rendering].filter(entry=>entry.job.background).length>=this.backgroundConcurrency)return;
    // Adjacent rendered frames outrank distant disk preloads across all panels.
    index=this.renderQueue.findIndex(entry=>hasRoom(entry)&&this.nearby?.some(source=>entry.job.url===source||entry.job.url.startsWith(source+"/")));
    if(index<0)index=this.renderQueue.findIndex(hasRoom);
   }
   if(index<0)return;
   const entry=this.renderQueue.splice(index,1)[0];if(!entry)return;
   if(entry.job.canSave&&entry.job.background)this.saveReservations.add(entry.job);
   this.rendering.add(entry);entry.start();
  }
 }
 render(params,job){
  return new Promise((resolve,reject)=>{
   const {controller}=job;
   if(controller.signal.aborted){reject(abort());return;}
   const cancel=()=>{
    const index=this.renderQueue.indexOf(entry);
    if(index<0)return; // An active renderer owns cancellation until it settles.
    this.renderQueue.splice(index,1);controller.signal.removeEventListener('abort',cancel);reject(abort());
   };
   const entry={job,start:()=>{
    let result;
    try{result=this.load(params,controller);}catch(error){result=Promise.reject(error);}
    Promise.resolve(result).then(cacheable).then(resolve,reject).finally(()=>{
     controller.signal.removeEventListener('abort',cancel);this.rendering.delete(entry);this.drain();
    });
   }};
   controller.signal.addEventListener('abort',cancel,{once:true});
   this.renderQueue.push(entry);this.drain();
  });
 }
 async resolve(params,controller,generation,disk,job){
  const key=JSON.stringify([params.type,params.url]),cached=this.memory.get(key);
  if(cached&&(!this.persistent||this.fresh(cached.created,params.url))){this.memory.delete(key);this.memory.set(key,cached);return cached.result;}
  if(cached){this.memory.delete(key);this.bytes-=cached.bytes;}
  // A pending save still owns reusable bytes, even after hot-memory eviction.
  // Selecting that frame must not wait for the disk or render it a second time.
  const saving=this.writes.get(key);
  if(saving?.generation===generation&&(!this.persistent||this.fresh(saving.entry.created,params.url)))return saving.entry.result;
  // CacheStorage keys are local lookup keys. No request is sent to this URL.
  const request='https://snowline-cache.invalid/tile?key='+encodeURIComponent(key);
  let store=await disk;
  if(controller.signal.aborted||generation!==this.generation)throw abort();
  try{
   // A just-evicted tile may still be being saved. Do not render it twice.
   await this.writes.get(key)?.promise;
   const response=await store?.match(request);
   const created=Number(response?.headers.get('x-snowline-created'));
   if(response&&(!this.persistent||this.fresh(created,params.url))){
    const result={data:response.headers.get('x-snowline-type')==='json'?await response.json():await response.arrayBuffer()};
    if(controller.signal.aborted||generation!==this.generation)throw abort();
    this.remember(key,result,true,false,created);return result;
   }
  }catch(error){if(error.name==='AbortError')throw error;store=null;}
  job.canSave=!!store;
  try{
  let result;
  for(let attempt=0;;attempt++){
   if(controller.signal.aborted||generation!==this.generation)throw abort();
   try{
    result=await this.render(params,job);break;
   }
   catch(error){
    if(controller.signal.aborted||generation!==this.generation)throw abort();
    if(attempt>=this.retries||!retryable(error))throw error;
    // Retry the missing tile only; all successful image/overlay tiles are reused.
    await wait(this.retryDelay*3**attempt,controller.signal);
   }
  }
  if(controller.signal.aborted||generation!==this.generation)throw abort();
  // Own the bytes before MapLibre transfers its copy to a worker.
  const saved=copy(result),persisting=!!store&&this.writes.size<this.maxPendingWrites;
  const entry=this.remember(key,saved,false,persisting);
  if(persisting)this.persist(key,request,entry,store,generation,params.type);
  else if(store)entry.save={request,store,generation,type:params.type};
  return saved;
  }finally{this.saveReservations.delete(job);this.drain();}
 }
 protocol(params,consumer,{background=false,copyResult=true}={}){
  if(consumer.signal.aborted)return Promise.reject(abort());
  // MapLibre also prepares nearby hidden frames. They must share the bounded
  // speculative budget, rather than masquerading as selected-chart requests.
  if(this.foreground)background=!this.isForeground(params.url);
  const key=JSON.stringify([params.type,params.url]);let job=this.pending.get(key);
  if(!job){
   job={controller:new AbortController(),users:0,background,url:params.url};this.pending.set(key,job);
   job.promise=this.resolve(params,job.controller,this.generation,this.disk,job).finally(()=>{clearTimeout(job.abortTimer);if(this.pending.get(key)===job)this.pending.delete(key);});
  }else if(!background&&job.background){
   job.background=false;this.drain();
  }
  clearTimeout(job.abortTimer);
  job.users++;
  return new Promise((resolve,reject)=>{
   let done=false;
   const finish=(error,result)=>{
    if(done)return;done=true;consumer.signal.removeEventListener('abort',cancel);job.users--;
    if(!job.users&&error?.name==='AbortError'){
     // Source replacement often immediately asks for the same tile. Let it join
     // the existing work, instead of cancelling a worker and restarting it.
     job.abortTimer=setTimeout(()=>{if(!job.users){job.controller.abort();if(this.pending.get(key)===job)this.pending.delete(key);}},this.abortDelay);
    }
    if(error)reject(error);else resolve(copyResult?copy(result):undefined);
   };
   const cancel=()=>finish(abort());consumer.signal.addEventListener('abort',cancel,{once:true});
   job.promise.then(result=>finish(null,result),error=>finish(error));
  });
 }
 async prefetch(params,controller){
  // Use the same de-duplicated path as a foreground map. Only complete bytes
  // count as prepared; cancellation or a partial overlay never counts as ready.
  // No bytes are transferred to a renderer here. Avoid copying each PNG and
  // vector buffer solely to discard it after background preparation.
  await this.protocol(params,controller,{background:true,copyResult:false});
 }
}
