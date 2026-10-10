const PREFIX='snowline-cache-v1:';const USAGE='snowline-requests-v1';
const memory=new Map();
function stored(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
export function usage(){const today=new Date().toISOString().slice(0,10);const saved=stored(USAGE);return saved?.date===today?saved:{date:today,forecast:0,search:0,metadata:0};}
export function countRequest(kind){const value=usage();value[kind]=(value[kind]??0)+1;try{localStorage.setItem(USAGE,JSON.stringify(value));}catch{}if(typeof window!=='undefined')window.dispatchEvent(new Event('snowline-usage'));}
export function usageText(){const u=usage();return `Recorded in this browser today (UTC): ${u.forecast} forecast requests, ${u.search} location searches and ${u.metadata} map metadata requests. Map-file and basemap tile downloads are not included. This is a local activity counter, not the provider’s remaining quota.`;}
export async function cachedJSON(url,{signal,force=false,ttl=1200000,kind='forecast'}={}){
 const key=PREFIX+url;let saved=memory.get(key)??stored(key);
 if(!force&&saved&&Date.now()-saved.at<Math.min(ttl,saved.ttl??ttl)){if(saved.negative)throw Object.assign(new Error(saved.message),{status:saved.status});return {...saved.value,_retrievedAt:saved.at};}
 countRequest(kind);const timeout=AbortSignal.timeout(25000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const response=await fetch(url,{signal:combined,cache:force?'reload':kind==='metadata'?'no-cache':'default'});const value=await response.json().catch(error=>{if(response.ok)throw error;return {};});if(!response.ok||value.error){const message=value.reason??`Data service returned ${response.status}`;if(response.status===400){const negative={at:Date.now(),ttl:120000,negative:true,message,status:response.status};memory.set(key,negative);try{localStorage.setItem(key,JSON.stringify(negative));}catch{}}throw Object.assign(new Error(message),{status:response.status});}
 saved={at:Date.now(),value};memory.set(key,saved);
 try{const keys=Object.keys(localStorage).filter(k=>k.startsWith(PREFIX));for(const k of keys){const old=stored(k);if(!old||Date.now()-old.at>1200000)localStorage.removeItem(k);}const current=Object.keys(localStorage).filter(k=>k.startsWith(PREFIX));if(current.length>=48){const oldest=current.sort((a,b)=>(stored(a)?.at??0)-(stored(b)?.at??0));for(const k of oldest.slice(0,current.length-47))localStorage.removeItem(k);}localStorage.setItem(key,JSON.stringify(saved));}catch{/* The in-memory cache remains usable when storage is unavailable. */}
 return {...value,_retrievedAt:saved.at};
}
