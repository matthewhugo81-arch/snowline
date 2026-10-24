const PREFIX='snowline-cache-v1:';const USAGE='snowline-requests-v1';
const memory=new Map();
const pendingMetadata=new Map();
const limits=new Map();
const LIMIT_PREFIX='snowline-service-limit-v1:';
function stored(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
export function retryTime(response,message,now=Date.now()){
 const header=response.headers?.get('Retry-After');
 if(header){const seconds=Number(header),until=Number.isFinite(seconds)?now+seconds*1000:Date.parse(header);if(until>now)return until;}
 if(/daily|tomorrow/i.test(message))return (Math.floor(now/86400000)+1)*86400000+60000;
 if(/hourly/i.test(message))return (Math.floor(now/3600000)+1)*3600000+60000;
 return now+60000;
}
export function serviceLimit(url){
 const host=new URL(url,import.meta.url).origin,key=LIMIT_PREFIX+host;
 const limit=limits.get(key)??stored(key);
 return limit?.retryAt>Date.now()?limit:null;
}
export function usage(){const today=new Date().toISOString().slice(0,10);const saved=stored(USAGE);return saved?.date===today?saved:{date:today,forecast:0,search:0,metadata:0};}
export function countRequest(kind){const value=usage();value[kind]=(value[kind]??0)+1;try{localStorage.setItem(USAGE,JSON.stringify(value));}catch{}if(typeof window!=='undefined')window.dispatchEvent(new Event('snowline-usage'));}
export function usageText(){const u=usage();return `Recorded in this browser today (UTC): ${u.forecast} forecast requests, ${u.search} location searches and ${u.metadata} map metadata requests. Map-file and basemap tile downloads are not included. This is a local activity counter, not the provider’s remaining quota.`;}
export function cachedJSON(url,options={}){
 // Only share uncancellable metadata reads with identical cache semantics.
 // Location requests and callers owning an AbortSignal remain independent.
 if(options.kind!=='metadata'||options.signal)return readJSON(url,options);
 const key=JSON.stringify([url,options]);
 if(!pendingMetadata.has(key))pendingMetadata.set(key,readJSON(url,options).finally(()=>pendingMetadata.delete(key)));
 return pendingMetadata.get(key);
}
async function readJSON(url,{signal,force=false,ttl=1200000,kind='forecast',staleTtl=0,forceMinAge=0,preserveRetrievedAt=false}={}){
 signal?.throwIfAborted();
 const key=PREFIX+url;let saved=memory.get(key)??stored(key);
 if(saved&&Date.now()-saved.at<(force?(saved.negative?0:forceMinAge):Math.min(ttl,saved.ttl??ttl))){if(saved.negative)throw Object.assign(new Error(saved.message),{status:saved.status});return {...saved.value,_retrievedAt:saved.at};}
 const fallback=error=>{
  // Keep original retrieval time. A cancelled location must never render an old response.
  if(!signal?.aborted&&saved?.value&&staleTtl&&Date.now()-saved.at<staleTtl&&(!error.status||error.status===429||error.status>=500))return {...saved.value,_retrievedAt:saved.at,_stale:true,_refreshError:error.message,_retryAt:error.retryAt};
  throw error;
 };
 const limited=serviceLimit(url);
 if(limited)return fallback(Object.assign(new Error(limited.message),{status:429,retryAt:limited.retryAt}));
 try{
 countRequest(kind);const timeout=AbortSignal.timeout(25000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const response=await fetch(url,{signal:combined,cache:force?'reload':kind==='metadata'?'no-cache':'default'});const value=await response.json().catch(error=>{if(response.ok)throw error;return {};});if(!response.ok||value.error){const message=value.reason??`Data service returned ${response.status}`;
  let retryAt;
  if(response.status===429){retryAt=retryTime(response,message);const limitKey=LIMIT_PREFIX+new URL(url,import.meta.url).origin,limit={message,retryAt};limits.set(limitKey,limit);save(limitKey,limit);}
  // Missing dated publications may appear shortly. Coalesce probes for only
  // 30 seconds; force refresh bypasses this. Never retain missing latest indexes,
  // so selecting a newly available model can discover it immediately.
  const missingCycle=kind==='metadata'&&response.status===404&&/\/\d{4}\/\d{2}\/\d{2}\/\d{4}Z\/meta\.json(?:[?#]|$)/.test(url);
  if((response.status===400||missingCycle)&&!saved?.value&&!(memory.get(key)??stored(key))?.value){const negative={at:Date.now(),ttl:response.status===404?30000:120000,negative:true,message,status:response.status};memory.set(key,negative);save(key,negative);}
  throw Object.assign(new Error(message),{status:response.status,retryAt});
 }
 signal?.throwIfAborted();
 const retrievedAt=preserveRetrievedAt?value._retrievedAt:Date.now();
 if(!Number.isFinite(retrievedAt)||retrievedAt>Date.now()+60000)throw Error('Invalid forecast retrieval time.');
 saved={at:retrievedAt,value,retention:Math.max(ttl,staleTtl)};memory.set(key,saved);
 try{const keys=Object.keys(localStorage).filter(k=>k.startsWith(PREFIX));for(const k of keys){const old=stored(k);if(!old||Date.now()-old.at>(old.retention??1200000))localStorage.removeItem(k);}const current=Object.keys(localStorage).filter(k=>k.startsWith(PREFIX)&&k!==key);if(current.length>=96){const oldest=current.sort((a,b)=>(stored(a)?.at??0)-(stored(b)?.at??0));for(const k of oldest.slice(0,current.length-95))localStorage.removeItem(k);}localStorage.setItem(key,JSON.stringify(saved));}catch{/* The in-memory cache remains usable when storage is unavailable. */}
 return {...value,_retrievedAt:saved.at};
 }catch(error){return fallback(error);}
}
