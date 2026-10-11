// Keep prepared PNG/vector tiles on disk, with a small hot memory cache. MapLibre
// can then recreate a distant frame without downloading/decoding the model again.
const PREFIX='snowline-forecast-tiles-v1-';
const abort=()=>new DOMException('Aborted','AbortError');
const copy=value=>({...value,data:structuredClone(value.data)});
const retryable=error=>!(/\b(?:400|401|403|404|410)\b/.test(error?.message??'')||[400,401,403,404,410].includes(error?.status));
const wait=(ms,signal)=>new Promise((resolve,reject)=>{
 if(signal.aborted){reject(abort());return;}
 const cancelled=()=>{clearTimeout(timer);reject(abort());};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',cancelled);resolve();},ms);
 signal.addEventListener('abort',cancelled,{once:true});
});
export class ForecastTileCache{
 constructor(load,{storage=globalThis.caches,memoryBytes=32*1024*1024,onLimit=()=>{},retries=2,retryDelay=150,abortDelay=120}={}){
  Object.assign(this,{load,storage,memoryBytes,onLimit,retries,retryDelay,abortDelay});
  this.context=null;this.generation=0;this.memory=new Map();this.bytes=0;this.pending=new Map();this.writes=new Map();this.limited=false;
  this.session=Date.now()+'-'+Math.random().toString(36).slice(2);
  // Only remove this feature's abandoned caches, never other site data.
  storage?.keys().then(names=>Promise.all(names.filter(name=>name.startsWith(PREFIX)&&Number(name.slice(PREFIX.length).split('-')[0])<Date.now()-172800000).map(name=>storage.delete(name)))).catch(()=>{});
 }
 setContext(context){
  if(context===this.context)return false;
  this.release();this.context=context;this.limited=false;
  const name=PREFIX+this.session+'-'+this.generation;this.name=name;
  this.disk=this.storage?.open(name).catch(()=>null)??Promise.resolve(null);
  return true;
 }
 release(){
  this.generation++;
  for(const job of this.pending.values()){clearTimeout(job.abortTimer);job.controller.abort();}
  this.pending.clear();this.writes.clear();this.memory.clear();this.bytes=0;
  const old=this.disk,name=this.name;
  if(old&&name)old.then(()=>this.storage?.delete(name)).catch(()=>{});
  this.disk=null;this.name=null;
 }
 limit(){if(!this.limited){this.limited=true;this.onLimit();}}
 remember(key,result,durable,persisting=false){
  const bytes=result.data instanceof ArrayBuffer?result.data.byteLength:new TextEncoder().encode(JSON.stringify(result.data)).length;
  const old=this.memory.get(key);if(old)this.bytes-=old.bytes;
  const entry={result,bytes,durable,persisting};
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
  job.promise=Promise.resolve().then(()=>store.put(request,new Response(type==='json'?JSON.stringify(entry.result.data):entry.result.data,{headers:{'x-snowline-type':type==='json'?'json':'bytes'}})))
   .then(()=>{entry.durable=true;},()=>{/* Storage denial must not stop a map. */})
   .finally(()=>{
    entry.persisting=false;
    if(this.writes.get(key)===job)this.writes.delete(key);
    if(generation===this.generation&&!entry.durable&&this.memory.get(key)!==entry)this.limit();
   });
 }
 async resolve(params,controller,generation,disk){
  const key=JSON.stringify([params.type,params.url]),cached=this.memory.get(key);
  if(cached){this.memory.delete(key);this.memory.set(key,cached);return cached.result;}
  // CacheStorage keys are local lookup keys. No request is sent to this URL.
  const request='https://snowline-cache.invalid/tile?key='+encodeURIComponent(key);
  let store=await disk;
  if(controller.signal.aborted||generation!==this.generation)throw abort();
  try{
   // A just-evicted tile may still be being saved. Do not render it twice.
   await this.writes.get(key)?.promise;
   const response=await store?.match(request);
   if(response){
    const result={data:response.headers.get('x-snowline-type')==='json'?await response.json():await response.arrayBuffer()};
    if(controller.signal.aborted||generation!==this.generation)throw abort();
    this.remember(key,result,true);return result;
   }
  }catch(error){if(error.name==='AbortError')throw error;store=null;}
  let result;
  for(let attempt=0;;attempt++){
   if(controller.signal.aborted||generation!==this.generation)throw abort();
   try{result=await this.load(params,controller);break;}
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
 protocol(params,consumer){
  if(consumer.signal.aborted)return Promise.reject(abort());
  const key=JSON.stringify([params.type,params.url]);let job=this.pending.get(key);
  if(!job){
   job={controller:new AbortController(),users:0};this.pending.set(key,job);
   job.promise=this.resolve(params,job.controller,this.generation,this.disk).finally(()=>{clearTimeout(job.abortTimer);if(this.pending.get(key)===job)this.pending.delete(key);});
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
}
