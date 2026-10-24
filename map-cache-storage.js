// Disk capacity is independent of the small in-memory/rendering budgets.
const MiB=1024*1024;
export function cacheDiskBudget({mobile=false,deviceMemory,quota,usage=0}={}){
 const ceiling=mobile||deviceMemory<=2?256*MiB:1024*MiB;
 // Unknown quota uses the conservative existing allowance. Leave ample room
 // for other site data; quota is an estimate, not a promise of free disk space.
 return Number.isFinite(quota)&&quota>0?Math.max(0,Math.floor(Math.min(ceiling,quota*.1,Math.max(0,quota-usage)*.5))):256*MiB;
}
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const complete=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error??Error('Cache index unavailable'));});
const matches=(url,sources)=>{
 // Tile URLs append /z/x/y to a source. Set membership avoids comparing every
 // tile against every frame in four long forecast sequences during eviction.
 for(let prefix=url;prefix.includes('/');prefix=prefix.slice(0,prefix.lastIndexOf('/')))if(sources.has(prefix))return true;
 return sources.has(url);
};
export const cacheLimitError=reason=>Object.assign(Error(reason),{cacheReason:reason});

// A version change must not strand whole caches on disk. Wait for a grace
// period and honour the leases of older tabs before removing their version.
export async function cleanupObsoleteCaches({storage,db,locks,prefix,currentPrefix,now=Date.now(),grace=120000}){
 if(!storage||!locks||!db)return;
 return locks.request('snowline-cache-cleanup',async()=>{
  const database=await db;
  for(const name of await storage.keys()){
   if(!name.startsWith(prefix+'persistent-')||name.startsWith(currentPrefix))continue;
   await locks.request('snowline-disk:'+name,async()=>{
    const tx=database.transaction(['clients','totals'],'readonly'),done=complete(tx);
    const [clients,marker]=await Promise.all([request(tx.objectStore('clients').getAll()),request(tx.objectStore('totals').get('cleanup:'+name))]);await done;
    const active=clients.some(c=>c.cache===name&&c.expires>now);
    if(active||!marker||now-marker.seen<grace){
     if(active||!marker){const mark=database.transaction('totals','readwrite'),marked=complete(mark);mark.objectStore('totals').put({id:'cleanup:'+name,seen:now});await marked;}
     return;
    }
    await storage.delete(name);
    const clean=database.transaction(['tiles','totals','clients'],'readwrite'),cleaned=complete(clean);
    const cursor=clean.objectStore('tiles').index('cache').openCursor(name);
    cursor.onsuccess=()=>{const entry=cursor.result;if(entry){entry.delete();entry.continue();}};
    clean.objectStore('totals').delete(name);clean.objectStore('totals').delete('cleanup:'+name);
    for(const client of clients)if(client.cache===name)clean.objectStore('clients').delete(client.id);
    await cleaned;
   });
  }
 });
}

// Web Locks serialize only disk mutation. IndexedDB supplies authoritative
// accounting across tabs, including ones that missed a BroadcastChannel event.
// Tile bytes remain in CacheStorage; the index stores no weather data.
export class SharedForecastStorage{
 constructor({name,store,budget,entries=65536,onChange=()=>{},onEvict=()=>{},locks=navigator.locks,indexedDB=globalThis.indexedDB,channel=globalThis.BroadcastChannel}={}){
  Object.assign(this,{name,store,budget,entries,onChange,onEvict,locks});
  this.id=crypto.randomUUID();this.sequence=[];this.protected=[];this.closed=false;
  this.active=!globalThis.document?.hidden;
  this.db=new Promise((resolve,reject)=>{
   const r=indexedDB.open('snowline-chart-cache-index-v1',1);
   r.onupgradeneeded=()=>{
    const db=r.result,t=db.createObjectStore('tiles',{keyPath:'id'});t.createIndex('cache','cache');
    db.createObjectStore('totals',{keyPath:'id'});db.createObjectStore('clients',{keyPath:'id'});
   };
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  // An unavailable index must not become an unhandled error or block imagery.
  this.db.catch(()=>{});
  this.channel=channel?new channel('snowline-chart-cache-v1'):null;
  if(this.channel)this.channel.onmessage=({data})=>{
   if(data?.cache!==this.name)return;
   if(data.type==='evict')this.onEvict(data.keys);
   if(data.type==='usage'){this.stats=data.stats;this.onChange();}
   if(data.type==='clients')void this.refreshActivity().catch(()=>{});
  };
  this.onVisibility=()=>this.update({active:!globalThis.document?.hidden});
  globalThis.document?.addEventListener('visibilitychange',this.onVisibility);
  this.timer=setInterval(()=>this.lease().catch(()=>{}),30000);
 }
 async refreshActivity(){
  const db=await this.db;if(this.closed)return;
  const tx=db.transaction(['clients','totals'],'readonly'),done=complete(tx);
  const [all,total]=await Promise.all([request(tx.objectStore('clients').getAll()),request(tx.objectStore('totals').get(this.name))]);await done;
  if(this.closed)return;
  const clients=all.filter(c=>c.cache===this.name&&c.expires>Date.now());
  // Older clients lack the activity flag; count them conservatively as active.
  this.activeWindows=clients.filter(c=>c.active!==false).length;
  this.stats={...this.stats,bytes:total?.bytes??0,entries:total?.count??0,budget:Math.min(this.budget,...clients.map(c=>c.budget)),windows:clients.length,activeWindows:this.activeWindows};
  this.onChange();
 }
 async lease(){
  if(this.closed)return;
  if(this.leasePending){await this.leasePending;return this.lease();}
  if(this.lastLeaseRevision===(this.leaseRevision??0)&&Date.now()-this.lastLease<30000)return;
  this.leasePending=(async()=>{
   const db=await this.db;if(this.closed)return;
   const revision=this.leaseRevision??0,now=Date.now(),tx=db.transaction('clients','readwrite'),done=complete(tx);
   tx.objectStore('clients').put({id:this.id,cache:this.name,expires:now+120000,sequence:this.sequence,protected:this.protected,budget:this.budget,active:this.active});
   await done;this.lastLeaseRevision=revision;this.lastLease=now;
   await this.refreshActivity();this.channel?.postMessage({cache:this.name,type:'clients'});
  })();
  try{await this.leasePending;}finally{this.leasePending=null;}
 }
 update({sequence=this.sequence,protected:protectedURLs=this.protected,budget=this.budget,active=this.active}={}){
  Object.assign(this,{sequence,protected:protectedURLs,budget,active});
  this.leaseRevision=(this.leaseRevision??0)+1;
  // Selection changes coalesce; never write the whole sequence per tile.
  clearTimeout(this.leaseTimer);this.leaseTimer=setTimeout(()=>this.lease().catch(()=>{}),0);
 }
 async close(){
  this.closed=true;clearInterval(this.timer);clearTimeout(this.leaseTimer);
  globalThis.document?.removeEventListener('visibilitychange',this.onVisibility);
  try{
   await this.leasePending;
   const db=await this.db,tx=db.transaction('clients','readwrite'),done=complete(tx);tx.objectStore('clients').delete(this.id);await done;
   this.channel?.postMessage({cache:this.name,type:'clients'});db.close();
  }catch{}finally{this.channel?.close();}
 }
 notify(keys,stats){
  if(keys.length){this.onEvict(keys);this.channel?.postMessage({cache:this.name,type:'evict',keys});}
  this.stats=stats;this.onChange();this.channel?.postMessage({cache:this.name,type:'usage',stats});
 }
 async put(key,response,bytes){
  if(this.closed)throw cacheLimitError('storage-unavailable');
  return this.locks.request('snowline-disk:'+this.name,async()=>{
   if(this.closed)throw cacheLimitError('storage-unavailable');
   const db=await this.db,store=await this.store;
   await this.lease();
   const tx=db.transaction(['tiles','totals','clients'],'readonly'),done=complete(tx);
   const tiles=tx.objectStore('tiles'),id=this.name+'|'+key;
   const [saved,old,allClients]=await Promise.all([request(tx.objectStore('totals').get(this.name)),request(tiles.get(id)),request(tx.objectStore('clients').getAll())]);await done;
   const clients=allClients.filter(c=>c.cache===this.name&&c.expires>Date.now());
   const budget=Math.min(this.budget,...clients.map(c=>c.budget)),total=saved??{id:this.name,bytes:0,count:0};
   const stats=()=>({bytes:total.bytes,budget,entries:total.count,windows:clients.length});
   if(bytes>budget){this.notify([],stats());throw cacheLimitError('budget');}
   const expired=allClients.filter(c=>c.expires<=Date.now());
   if(expired.length){const clean=db.transaction('clients','readwrite'),finished=complete(clean);for(const c of expired)clean.objectStore('clients').delete(c.id);await finished;}
   const evicted=[];
   if(total.bytes-(old?.bytes??0)+bytes>budget||total.count-(old?1:0)>=this.entries){
    const scan=db.transaction('tiles','readonly'),scanned=complete(scan);
    const candidates=await request(scan.objectStore('tiles').index('cache').getAll(this.name));await scanned;
    const protectedURLs=new Set(clients.flatMap(c=>c.protected)),sequences=new Set(clients.flatMap(c=>c.sequence));
    for(const entry of candidates)entry.rank=matches(entry.url,protectedURLs)?2:matches(entry.url,sequences)?1:0;
    candidates.sort((a,b)=>a.rank-b.rank||a.touched-b.touched);
    for(const entry of candidates){
     // Free a small batch so the next tile need not scan the index again.
     if(total.bytes-(old?.bytes??0)+bytes<=budget*.95&&total.count-(old?1:0)<Math.max(1,Math.floor(this.entries*.95)))break;
     if(entry.id===id||entry.rank===2)continue;
     // Commit the removal first. A crash can leave conservative accounting,
     // but cannot create uncounted cache growth or evict protected frames.
     await store.delete(entry.key);total.bytes-=entry.bytes;total.count--;
     const remove=db.transaction(['tiles','totals'],'readwrite'),removed=complete(remove);
     remove.objectStore('tiles').delete(entry.id);remove.objectStore('totals').put(total);await removed;
     evicted.push(entry.key);
    }
   }
   if(total.bytes-(old?.bytes??0)+bytes>budget||total.count-(old?1:0)>=this.entries){this.notify(evicted,stats());throw cacheLimitError('budget');}
   // Reserve space before writing bytes. Failed CacheStorage writes roll back
   // the reservation and retain an overwritten tile's previous accounting.
   const before={...total};total.bytes+=bytes-(old?.bytes??0);total.count+=old?0:1;
   const reserve=db.transaction(['tiles','totals'],'readwrite'),reserved=complete(reserve);
   const url=JSON.parse(new URL(key).searchParams.get('key'))[1];
   reserve.objectStore('tiles').put({id,cache:this.name,key,url,bytes,touched:Date.now()});reserve.objectStore('totals').put(total);await reserved;
   try{await store.put(key,response);}catch(error){
    const undo=db.transaction(['tiles','totals'],'readwrite'),undone=complete(undo);
    if(old)undo.objectStore('tiles').put(old);else undo.objectStore('tiles').delete(id);
    undo.objectStore('totals').put(before);await undone;Object.assign(total,before);this.notify(evicted,stats());
    throw cacheLimitError(error?.name==='QuotaExceededError'?'browser-quota':'storage-unavailable');
   }
   this.notify(evicted,stats());
  });
 }
}
