// Native OM reads ask for many adjacent 64 KiB cache blocks. Fetch neighbouring
// blocks together, then return each exact slice to the existing block cache.
// No extra grid cells, changed values, or cross-file/run reuse is involved.
export function coalesceRangeReads(read,{delay=2,maxBytes=1024*1024}={}){
 let pending=[],timer;
 const aborted=()=>new DOMException('Aborted','AbortError');
 const flush=()=>{
  timer=null;
  const jobs=pending.filter(job=>!job.done).sort((a,b)=>a.start-b.start);pending=[];
  const groups=[];
  for(const job of jobs){
   let group=groups.at(-1);
   if(!group||job.start>group.end||Math.max(group.end,job.end)-group.start>maxBytes){
    group={start:job.start,end:job.end,jobs:[],controller:new AbortController()};groups.push(group);
   }
   group.end=Math.max(group.end,job.end);group.jobs.push(job);job.group=group;
  }
  for(const group of groups){
   Promise.resolve().then(()=>read(group.start,group.end-group.start,group.controller.signal)).then(bytes=>{
    if(!(bytes instanceof Uint8Array)||bytes.length!==group.end-group.start)throw Error('Incomplete forecast data range');
    for(const job of group.jobs)job.finish(null,bytes.slice(job.start-group.start,job.end-group.start));
   }).catch(error=>{for(const job of group.jobs)job.finish(error);});
  }
 };
 return (start,length,signal)=>{
  if(signal?.aborted)return Promise.reject(aborted());
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||!Number.isSafeInteger(start+length)||start<0||length<=0)return Promise.reject(Error('Invalid forecast data range'));
  return new Promise((resolve,reject)=>{
   const job={start,end:start+length,done:false};
   job.finish=(error,bytes)=>{
    if(job.done)return;job.done=true;signal?.removeEventListener('abort',cancel);
    if(error)reject(error);else resolve(bytes);
   };
   const cancel=()=>{
    job.finish(aborted());
    if(job.group&&job.group.jobs.every(item=>item.done))job.group.controller.abort();
   };
   signal?.addEventListener('abort',cancel,{once:true});pending.push(job);
   if(timer==null)timer=setTimeout(flush,delay);
  });
 };
}

const installed=new WeakSet();
export function installRangeReads(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader,pool=reader.backendPool;
 if(!pool||installed.has(pool))return;
 installed.add(pool);
 // Set before the first read. Smaller blocks reduce unused spatial payload;
 // adjacent blocks still coalesce and the shared LRU remains capped at 32 MiB.
 // Ensemble transport installs its own existing 64 KiB cache separately.
 if(OM.LruBlockCache)reader.cache=new OM.LruBlockCache(128*1024,256);
 const original=pool.backend.bind(pool),wrapped=new WeakSet();
 pool.backend=url=>{
  const backend=original(url);
  if(!wrapped.has(backend)){
   wrapped.add(backend);backend.getBytes=coalesceRangeReads(backend.getBytes.bind(backend));
  }
  return backend;
 };
}
