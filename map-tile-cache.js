// Keep prepared PNG/vector tiles on disk, with a small hot memory cache. MapLibre
// can then recreate a distant frame without downloading/decoding the model again.
const PREFIX='snowline-forecast-tiles-v1-';
const abort=()=>new DOMException('Aborted','AbortError');
const copy=value=>({...value,data:structuredClone(value.data)});
export class ForecastTileCache{
 constructor(load,{storage=globalThis.caches,memoryBytes=32*1024*1024,onLimit=()=>{}}={}){
  Object.assign(this,{load,storage,memoryBytes,onLimit});
  this.context=null;this.generation=0;this.memory=new Map();this.bytes=0;this.pending=new Map();this.limited=false;
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
  for(const job of this.pending.values())job.controller.abort();
  this.pending.clear();this.memory.clear();this.bytes=0;
  const old=this.disk,name=this.name;
  if(old&&name)old.then(()=>this.storage?.delete(name)).catch(()=>{});
  this.disk=null;this.name=null;
 }
 remember(key,result,durable){
  const bytes=result.data instanceof ArrayBuffer?result.data.byteLength:new TextEncoder().encode(JSON.stringify(result.data)).length;
  const old=this.memory.get(key);if(old)this.bytes-=old.bytes;
  this.memory.delete(key);this.memory.set(key,{result,bytes,durable});this.bytes+=bytes;
  while(this.bytes>this.memoryBytes&&this.memory.size){
   const [first,item]=this.memory.entries().next().value;this.memory.delete(first);this.bytes-=item.bytes;
   if(!item.durable&&!this.limited){this.limited=true;this.onLimit();}
  }
 }
 async resolve(params,controller,generation,disk){
  const key=JSON.stringify([params.type,params.url]),cached=this.memory.get(key);
  if(cached){this.memory.delete(key);this.memory.set(key,cached);return cached.result;}
  // CacheStorage keys are local lookup keys. No request is sent to this URL.
  const request='https://snowline-cache.invalid/tile?key='+encodeURIComponent(key);
  let store=await disk;
  if(controller.signal.aborted||generation!==this.generation)throw abort();
  try{
   const response=await store?.match(request);
   if(response){
    const result={data:response.headers.get('x-snowline-type')==='json'?await response.json():await response.arrayBuffer()};
    if(controller.signal.aborted||generation!==this.generation)throw abort();
    this.remember(key,result,true);return result;
   }
  }catch(error){if(error.name==='AbortError')throw error;store=null;}
  const result=await this.load(params,controller);
  if(controller.signal.aborted||generation!==this.generation)throw abort();
  // Own the bytes before MapLibre transfers its copy to a worker.
  const saved=copy(result);let durable=false;
  try{
   if(store){
    const json=params.type==='json';
    await store.put(request,new Response(json?JSON.stringify(saved.data):saved.data,{headers:{'x-snowline-type':json?'json':'bytes'}}));durable=true;
   }
  }catch{/* Storage denial/quota must never prevent viewing a forecast. */}
  if(controller.signal.aborted||generation!==this.generation)throw abort();
  this.remember(key,saved,durable);return saved;
 }
 protocol(params,consumer){
  if(consumer.signal.aborted)return Promise.reject(abort());
  const key=JSON.stringify([params.type,params.url]);let job=this.pending.get(key);
  if(!job){
   job={controller:new AbortController(),users:0};this.pending.set(key,job);
   job.promise=this.resolve(params,job.controller,this.generation,this.disk).finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
  }
  job.users++;
  return new Promise((resolve,reject)=>{
   let done=false;
   const finish=(error,result)=>{
    if(done)return;done=true;consumer.signal.removeEventListener('abort',cancel);job.users--;
    if(!job.users&&error?.name==='AbortError'){
     job.controller.abort();if(this.pending.get(key)===job)this.pending.delete(key);
    }
    if(error)reject(error);else resolve(copy(result));
   };
   const cancel=()=>finish(abort());consumer.signal.addEventListener('abort',cancel,{once:true});
   job.promise.then(result=>finish(null,result),error=>finish(error));
  });
 }
}
