// Prepared pixels do not expire just because a clock hour has passed. Instead,
// validate the physical OM files that produced them. A source correction gets a
// new namespace and a clean reader lifetime (including derived-field caches).
const KEY='snowline-source-validators-v1';
const immutable=url=>/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//.test(url);
const token=()=>globalThis.crypto?.randomUUID?.()??Date.now()+'-'+Math.random().toString(36).slice(2);
const signature=({eTag,lastModified,fileSize})=>eTag?JSON.stringify(['etag',eTag,fileSize]):lastModified?JSON.stringify(['modified',lastModified,fileSize]):null;
function storage(){try{return globalThis.localStorage;}catch{return null;}}
export class ForecastRetention{
 constructor({store=storage(),fetch=globalThis.fetch?.bind(globalThis),now=Date.now,interval=300000,startupBudget=2500,onChange=()=>{},onStatus=()=>{},maxSources=4096}={}){
  // Without a cross-tab lock, keep a private page cache rather than risk losing
  // a source validator to concurrent localStorage writes from another window.
  if(globalThis.window&&!globalThis.navigator?.locks)store=null;
  Object.assign(this,{store,fetch,now,interval,startupBudget,onChange,onStatus,maxSources});
  this.sources=new Map();this.revision=token();this.changed=false;this.checking=null;
  this.persistent=!!store;
  if(store){try{const saved=JSON.parse(store.getItem(KEY)||'null');if(saved?.revision&&Array.isArray(saved.sources)){this.revision=saved.revision;this.sources=new Map(saved.sources);}}catch{this.store=null;this.persistent=false;this.revision=token();this.sources.clear();}}
 }
 lock(action){return globalThis.navigator?.locks?.request('snowline-source-validation',async()=>action())??Promise.resolve().then(action);}
 save(){this.store?.setItem(KEY,JSON.stringify({revision:this.revision,sources:[...this.sources]}));}
 sync(){
  if(!this.store)return;
  const saved=JSON.parse(this.store.getItem(KEY)||'null');
  if(!saved){this.save();return;}
  if(saved.revision!==this.revision){this.revision=saved.revision;this.sources=new Map(saved.sources??[]);this.changed=true;this.onChange('Another map tab found updated source data.');return;}
  for(const [url,entry]of saved.sources??[]){const old=this.sources.get(url);if(!old||entry.checked>old.checked)this.sources.set(url,entry);}
 }
 invalidate(reason){
  if(this.changed)return;
  this.changed=true;this.revision=token();this.sources.clear();
  try{this.save();}catch{this.persistent=false;}
  this.onChange(reason);
 }
 observe(url,metadata){return this.lock(()=>this.observeLocked(url,metadata));}
 observeLocked(url,metadata){
  if(this.changed)return false;
  if(immutable(url))return true;
  try{
   this.sync();if(this.changed)return false;
   const value=signature(metadata),old=this.sources.get(url);
   // Unverifiable files get a conservative periodic refresh, never an unlimited
   // stale lifetime. Normal providers expose ETag or Last-Modified and length.
   if(old&&old.value!==value){this.invalidate('Corrected weather data is available.');return false;}
   if(!old){
    if(this.sources.size>=this.maxSources){this.invalidate('Refreshing the saved source catalogue.');return false;}
    this.sources.set(url,{value,checked:this.now()});this.save();
   }
   return true;
  }catch{this.invalidate('Refreshing weather storage.');return false;}
 }
 physicalURL(url){
  if(immutable(url))return url;
  const next=new URL(url);next.searchParams.set('snowline_revision',this.revision);return next.href;
 }
 install(pool){
  if(!pool?.withReader)return false;
  const original=pool.withReader.bind(pool);
  pool.withReader=(url,cache,callback)=>{
   const physical=this.physicalURL(url);
   return original(physical,cache,async reader=>{
    if(!await this.observe(url,pool.backend(physical)))throw new DOMException('Source changed','AbortError');
    return callback(reader);
   });
  };
  return true;
 }
 check({force=false,budget=Infinity}={}){
  return this.checking??=this.validate(force,budget).finally(()=>{this.checking=null;});
 }
 async validate(force,budget){
  if(this.changed)return;
  try{await this.lock(()=>this.sync());}catch{this.onStatus('Saved imagery available; source checks will retry.');return;}
  if(this.changed)return;
  const due=[...this.sources].filter(([,entry])=>force||this.now()-entry.checked>=this.interval);
  if(!due.length)return;
  // A returning tab must not wait one network timeout for every saved file.
  // Keep unverified entries due; the visible-page background check retries them.
  const deadline=new AbortController();
  const timer=Number.isFinite(budget)?setTimeout(()=>deadline.abort(),budget):null;
  let failed=0;
  const worker=async()=>{
   while(due.length&&!this.changed&&!deadline.signal.aborted){
    const [url,entry]=due.shift();
    if(!entry.value){await this.lock(()=>{this.sync();this.invalidate('Refreshing imagery whose source cannot be verified.');});break;}
    try{
     const response=await this.fetch(this.physicalURL(url),{method:'HEAD',cache:'no-cache',signal:AbortSignal.any([AbortSignal.timeout(10000),deadline.signal])});
     if(!response.ok)throw Error('Source check failed');
     const value=signature({eTag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),fileSize:Number(response.headers.get('content-length'))});
     if(!value)throw Error('Source validation unavailable');
     await this.lock(()=>{
      if(this.changed)return;
      this.sync();if(this.changed)return;
      if(value!==entry.value){this.invalidate('Corrected weather data is available.');return;}
      this.sources.set(url,{value,checked:this.now()});this.save();
     });
    }catch{failed++;}
   }
  };
  // Small metadata checks only; chart downloads keep their own render budget.
  try{await Promise.all([worker(),worker()]);}finally{clearTimeout(timer);}
  if(!this.changed)this.onStatus(failed||due.length?'Saved imagery available; source checks are incomplete and will retry.':'Saved imagery checked for corrections.');
 }
 async initialize(){
  // A returning page validates old pixels before assigning its cache namespace.
  const onChange=this.onChange;this.onChange=()=>{};
  try{await this.lock(()=>this.sync());}catch{this.store=null;this.persistent=false;this.revision=token();this.sources.clear();}
  await this.check({budget:this.startupBudget});this.changed=false;this.onChange=onChange;
 }
 start(target=globalThis.window){
  this.timer=setInterval(()=>{if(!globalThis.document?.hidden)void this.check();},60000);
  this.onStorage=event=>{if(event.key===KEY){try{this.sync();}catch{}}};
  this.onVisibility=()=>{if(!globalThis.document?.hidden)void this.check();};
  target?.addEventListener('storage',this.onStorage);
  target?.document?.addEventListener('visibilitychange',this.onVisibility);
  this.target=target;
 }
 stop(){clearInterval(this.timer);this.target?.removeEventListener('storage',this.onStorage);this.target?.document?.removeEventListener('visibilitychange',this.onVisibility);}
}
