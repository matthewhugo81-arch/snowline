// Keep prepared PNG/vector tiles on disk, with a small hot memory cache. MapLibre
// can then recreate a distant frame without downloading/decoding the model again.
const PREFIX='snowline-forecast-tiles-v1-';
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
 constructor(load,{storage=globalThis.caches,memoryBytes=32*1024*1024,onLimit=()=>{},retries=2,retryDelay=150,abortDelay=120,maxContexts=3,persistent=false,diskBytes=256*1024*1024,diskEntries=16384,maxAge=3600000,cacheVersion='render-20261021-complete-tiles',concurrency=8,backgroundConcurrency=4}={}){
  Object.assign(this,{load,storage,memoryBytes,onLimit,retries,retryDelay,abortDelay,maxContexts,persistent,diskBytes,diskEntries,maxAge,concurrency,backgroundConcurrency});
  this.renderQueue=[];this.rendering=new Set();this.foreground=null;
  this.diskStates=new WeakMap();
  this.contexts=new Map();this.contextSequence=0;
  this.context=null;this.generation=0;this.memory=new Map();this.bytes=0;this.pending=new Map();this.writes=new Map();this.limited=false;
  // Run/field/style URLs and complete tile coordinates isolate pixels. A revision
  // invalidates releases; a rolling per-entry lifetime bounds source corrections
  // without throwing away a freshly prepared tile at the next clock hour.
  this.session=persistent?'persistent-'+encodeURIComponent(cacheVersion):Date.now()+'-'+Math.random().toString(36).slice(2);
  // Only remove this feature's abandoned caches, never other site data.
  storage?.keys().then(names=>Promise.all(names.filter(name=>name.startsWith(PREFIX)&&
   (name.startsWith(PREFIX+'persistent-')?persistent&&!name.startsWith(PREFIX+this.session+'-'):
    Number(name.slice(PREFIX.length).split('-')[0])<Date.now()-172800000)).map(name=>storage.delete(name)))).catch(()=>{});
 }
 setContext(context){
  if(context===this.context)return false;
  this.resetPending();this.context=context;this.limited=false;
  let entry=this.contexts.get(context);
  if(!entry){const name=PREFIX+this.session+'-'+(this.persistent?encodeURIComponent(context):++this.contextSequence);entry={name,disk:this.storage?.open(name).catch(()=>null)??Promise.resolve(null)};}
  this.contexts.delete(context);this.contexts.set(context,entry);
  this.name=entry.name;this.disk=entry.disk;
  while(this.contexts.size>this.maxContexts){const [key,old]=this.contexts.entries().next().value;this.contexts.delete(key);old.disk.then(()=>this.storage?.delete(old.name)).catch(()=>{});}
  if(this.persistent)entry.disk.then(async()=>{
   const active=new Set([...this.contexts.values()].map(item=>item.name));
   const others=(await this.storage?.keys()??[]).filter(name=>name.startsWith(PREFIX+this.session+'-')&&!active.has(name));
   await Promise.all(others.slice(0,Math.max(0,others.length+active.size-this.maxContexts)).map(name=>this.storage.delete(name)));
  }).catch(()=>{});
  return true;
 }
 resetPending(){
  this.generation++;
  for(const job of this.pending.values()){clearTimeout(job.abortTimer);job.controller.abort();}
  this.pending.clear();this.writes.clear();this.memory.clear();this.bytes=0;
 }
 release(){
  this.resetPending();
  if(!this.persistent)for(const entry of this.contexts.values())entry.disk.then(()=>this.storage?.delete(entry.name)).catch(()=>{});
  this.contexts.clear();this.context=null;
  this.disk=null;this.name=null;
 }
 limit(){if(!this.limited){this.limited=true;this.onLimit();}}
 setSequence(urls){
  const next=[...new Set(urls)].sort();
  if(JSON.stringify(next)===JSON.stringify(this.sequenceURLs))return;
  this.sequenceURLs=next;
  // Changing model/layer frees obsolete sequence capacity. A cache that filled
  // during earlier analysis must not permanently stop every later selection.
  if(this.limited){this.limited=false;this.onLimit();}
 }
 retainedRequest(request){
  if(!this.sequenceURLs)return true;
  const [,url]=JSON.parse(new URL(request).searchParams.get('key'));
  return this.sequenceURLs.some(source=>url===source||url.startsWith(source+'/'));
 }
 async put(store,request,response,bytes,generation=this.generation){
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
     this.limit();
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
  const immutable=/^om:\/\/https:\/\/raw\.githubusercontent\.com\/matthewhugo81-arch\/snowline\/[a-f0-9]{40}\/ensemble-data\/snowline_ecmwf_ensemble\//.test(url);
  return Number.isFinite(created)&&created>0&&Date.now()>=created&&Date.now()-created<(immutable?48*3600000:this.maxAge);
 }
 remember(key,result,durable,persisting=false,created=Date.now()){
  const bytes=result.data instanceof ArrayBuffer?result.data.byteLength:new TextEncoder().encode(JSON.stringify(result.data)).length;
  const old=this.memory.get(key);if(old)this.bytes-=old.bytes;
  const entry={result,bytes,durable,persisting,created};
  this.memory.delete(key);this.memory.set(key,entry);this.bytes+=bytes;
  while(this.bytes>this.memoryBytes&&this.memory.size){
   const [first,item]=this.memory.entries().next().value;this.memory.delete(first);this.bytes-=item.bytes;
   if(!item.durable&&!item.persisting)this.limit();
  }
  return entry;
 }
 persist(key,request,entry,store,generation,type){
  // Display now; save separately. Keep pending writes bounded if storage stalls.
  const job={};this.writes.set(key,job);
  job.promise=Promise.resolve().then(()=>this.put(store,request,new Response(type==='json'?JSON.stringify(entry.result.data):entry.result.data,{headers:{'x-snowline-type':type==='json'?'json':'bytes','x-snowline-bytes':String(entry.bytes),'x-snowline-created':String(entry.created)}}),entry.bytes,generation))
   .then(()=>{entry.durable=true;},()=>{/* Storage denial must not stop a map. */})
   .finally(()=>{
    entry.persisting=false;
    if(this.writes.get(key)===job)this.writes.delete(key);
    if(generation===this.generation&&!entry.durable&&this.memory.get(key)!==entry)this.limit();
   });
 }
 setForeground(urls){
  this.foreground=[...new Set(urls)];
  for(const job of this.pending.values())job.background=!this.isForeground(job.url);
  this.drain();
 }
 isForeground(url){return this.foreground.some(source=>url===source||url.startsWith(source+'/'));}
 drain(){
  // Bound native reads, worker renders and PNG encoding across all panels.
  // Background frames cannot fill the foreground slots. Cached bytes bypass
  // this queue altogether, and selecting a queued tile promotes its shared job.
  while(this.rendering.size<this.concurrency){
   let index=this.renderQueue.findIndex(entry=>!entry.job.background);
   if(index<0){
    if([...this.rendering].filter(entry=>entry.job.background).length>=this.backgroundConcurrency)return;
    index=0;
   }
   const entry=this.renderQueue.splice(index,1)[0];if(!entry)return;
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
  const saved=copy(result),persisting=!!store&&this.writes.size<32;
  const entry=this.remember(key,saved,false,persisting);
  if(persisting)this.persist(key,request,entry,store,generation,params.type);
  return saved;
 }
 protocol(params,consumer,{background=false}={}){
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
    if(error)reject(error);else resolve(copy(result));
   };
   const cancel=()=>finish(abort());consumer.signal.addEventListener('abort',cancel,{once:true});
   job.promise.then(result=>finish(null,result),error=>finish(error));
  });
 }
 async prefetch(params,controller){
  // Use the same de-duplicated path as a foreground map. Only complete bytes
  // count as prepared; cancellation or a partial overlay never counts as ready.
  const result=await this.protocol(params,controller,{background:true});
  result.data?.close?.();
 }
}
