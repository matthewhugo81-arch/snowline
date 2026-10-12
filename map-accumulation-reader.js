import {accumulationHours,accumulationSlots} from './map-accumulation.js?v=20261012-accum-history';
const abort=()=>new DOMException('Accumulation cancelled','AbortError');
function check(signal){if(signal?.aborted)throw signal.reason??abort();}
export function accumulationFiles(url,key){
 const hours=accumulationHours(key);if(!hours)return null;
 const parsed=new URL(url),match=parsed.pathname.match(/\/data_spatial\/([^/]+)\/(\d{4}\/\d{2}\/\d{2})\/(\d{2})(\d{2})Z\/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})\.om$/);
 if(!match)throw Error('Invalid accumulation source URL.');
 const [,domain,day,hh,mm,date,hour,minute]=match,reference=day.replaceAll('/','-')+'T'+hh+':'+mm+':00Z',end=date+'T'+hour+':'+minute+':00Z';
 const times=accumulationSlots(domain,reference,end,hours);
 if(!times)throw Error('The complete accumulation period is not available.');
 const base=url.slice(0,url.lastIndexOf('/')+1);
 return {domain,reference,hours,times,urls:times.map(time=>base+time.slice(0,16).replace(':','')+'.om')};
}
// A bounded, subscriber-aware queue. Cancelling one panel never aborts work
// still needed by the other; abandoned background work releases its slots.
export class SharedGridReads{
 constructor(read,{concurrency=3,maxBytes=32*1024*1024}={}){this.read=read;this.concurrency=concurrency;this.maxBytes=maxBytes;this.bytes=0;this.active=0;this.queue=[];this.cache=new Map();this.pending=new Map();this.stats={reads:0,hits:0,peak:0};}
 async get(url,ranges,signal){
  check(signal);const key=JSON.stringify([url,ranges]),cached=this.cache.get(key);
  if(cached){this.cache.delete(key);this.cache.set(key,cached);this.stats.hits++;return cached;}
  let job=this.pending.get(key);
  if(!job){
   const controller=new AbortController();job={key,url,ranges,controller,users:0};
   job.promise=new Promise((resolve,reject)=>Object.assign(job,{resolve,reject}));job.promise.catch(()=>{});
   this.pending.set(key,job);this.queue.push(job);
  }
  job.users++;this.pump();
  let cancel;const stopped=new Promise((_,reject)=>{cancel=()=>reject(signal.reason??abort());signal?.addEventListener('abort',cancel,{once:true});});
  try{check(signal);return await (signal?Promise.race([job.promise,stopped]):job.promise);}
  finally{signal?.removeEventListener('abort',cancel);job.users--;if(!job.users&&this.pending.get(key)===job){this.pending.delete(key);job.controller.abort();job.reject(abort());this.pump();}}
 }
 pump(){
  while(this.active<this.concurrency&&this.queue.length){
   const job=this.queue.shift();if(job.controller.signal.aborted||!job.users)continue;
   this.active++;this.stats.reads++;this.stats.peak=Math.max(this.stats.peak,this.active);
   Promise.resolve().then(()=>this.read(job.url,job.ranges,job.controller.signal)).then(data=>{
    check(job.controller.signal);
    if(data.byteLength<=this.maxBytes){
     while(this.bytes+data.byteLength>this.maxBytes&&this.cache.size){const [key,value]=this.cache.entries().next().value;this.cache.delete(key);this.bytes-=value.byteLength;}
     if(!this.cache.has(job.key)){this.cache.set(job.key,data);this.bytes+=data.byteLength;}
    }
    job.resolve(data);
   },error=>job.reject(error)).catch(error=>job.reject(error)).finally(()=>{this.active--;if(this.pending.get(job.key)===job)this.pending.delete(job.key);this.pump();});
  }
 }
 clear(){this.cache.clear();this.bytes=0;for(const job of this.pending.values()){job.controller.abort();job.reject(abort());}this.pending.clear();this.queue=[];}
}
export class RollingAccumulations{
 constructor(read,{useSAB=false,maxSnapshotBytes=32*1024*1024,...options}={}){this.inputs=new SharedGridReads(read,options);this.snapshots=new Map();this.snapshotBytes=0;this.maxSnapshotBytes=maxSnapshotBytes;this.useSAB=useSAB;this.stats={full:0,rolling:0};}
 async read(url,key,ranges,signal){
  check(signal);const spec=accumulationFiles(url,key);if(!spec)throw Error('Not an accumulation field.');
  const group=JSON.stringify([url.slice(0,url.lastIndexOf('/')),ranges,spec.hours]),wanted=new Set(spec.urls);
  let previous=null,best=spec.urls.length;
  for(const snapshot of this.snapshots.values()){
   if(snapshot.group!==group)continue;
   const cost=snapshot.urls.filter(u=>!wanted.has(u)).length+spec.urls.filter(u=>!snapshot.set.has(u)).length;
   if(cost<best){best=cost;previous=snapshot;}
  }
  let sum=previous?previous.sum.slice():null,missing=previous?previous.missing.slice():null;
  const changes=previous?[...previous.urls.filter(u=>!wanted.has(u)).map(u=>[u,-1]),...spec.urls.filter(u=>!previous.set.has(u)).map(u=>[u,1])]:spec.urls.map(u=>[u,1]);
  this.stats[previous?'rolling':'full']++;
  // Three input grids at a time: bounded memory and network load, deterministic
  // summation order, regular yielding while adding large clipped native grids.
  for(let i=0;i<changes.length;i+=3){
   check(signal);const batch=changes.slice(i,i+3),settled=await Promise.allSettled(batch.map(([u])=>this.inputs.get(u,ranges,signal)));
   check(signal);const failure=settled.find(r=>r.status==='rejected');if(failure)throw failure.reason;
   for(let j=0;j<batch.length;j++){
    const values=settled[j].value,sign=batch[j][1];
    if(!sum){sum=new Float64Array(values.length);missing=new Uint16Array(values.length);}
    if(values.length!==sum.length)throw Error('Accumulation input grids do not match.');
    for(let k=0;k<values.length;k++){const v=values[k];if(Number.isFinite(v)&&v>=0)sum[k]+=sign*v;else missing[k]+=sign;}
   }
   if(changes.length>3)await new Promise(resolve=>setTimeout(resolve,0));
  }
  check(signal);if(!sum)throw Error('No precipitation intervals to sum.');
  const values=new Float32Array(new (this.useSAB?SharedArrayBuffer:ArrayBuffer)(sum.length*4));
  for(let i=0;i<sum.length;i++)values[i]=missing[i]||sum[i]<-1e-6?NaN:Math.max(0,sum[i]);
  const snapshot={group,sum,missing,urls:spec.urls,set:wanted},id=group+'|'+spec.urls.at(-1),bytes=sum.byteLength+missing.byteLength;
  const old=this.snapshots.get(id);if(old){this.snapshotBytes-=old.sum.byteLength+old.missing.byteLength;this.snapshots.delete(id);}
  if(bytes<=this.maxSnapshotBytes){
   while((this.snapshotBytes+bytes>this.maxSnapshotBytes||this.snapshots.size>=4)&&this.snapshots.size){const [id,item]=this.snapshots.entries().next().value;this.snapshots.delete(id);this.snapshotBytes-=item.sum.byteLength+item.missing.byteLength;}
   this.snapshots.set(id,snapshot);this.snapshotBytes+=bytes;
  }
  return {values,directions:undefined,scaleFactor:100};
 }
 clear(){this.inputs.clear();this.snapshots.clear();this.snapshotBytes=0;}
}
const installed=new WeakMap();
export function installAccumulations(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader;if(installed.has(reader))return installed.get(reader);
 const original=reader.readVariable.bind(reader),prefetch=reader.prefetchVariable?.bind(reader);
 const totals=new RollingAccumulations(async(url,ranges,signal)=>{
  check(signal);
  const domain=new URL(url).pathname.split('/data_spatial/')[1]?.split('/')[0],grid=OM.domainOptions?.find(d=>d.value===domain)?.grid;
  // Reuse the reader's cached header. A provider grid revision must not be
  // combined with another shape merely because a cropped read has equal size.
  if(grid&&reader.withReader)await reader.withReader(url,async file=>{
   const child=await file.getChildByName('precipitation');if(!child)throw Error('Native precipitation is missing from an accumulation interval.');
   try{const dims=child.getDimensions(),shape=grid.ny===1?[grid.nx]:[grid.ny,grid.nx],actual=dims.length===2&&dims[0]===1?[dims[1]]:dims;
    if(actual.length!==shape.length||actual.some((n,i)=>n!==shape[i]))throw Error('Native precipitation grid dimensions changed. Accumulation withheld.');
   }finally{child.dispose();}
  });
  const data=await original(url,'precipitation',ranges,signal);check(signal);return data.values;
 },{useSAB:reader.config?.useSAB??false});
 reader.readVariable=(url,key,ranges=null,signal)=>accumulationHours(key)?totals.read(url,key,ranges,signal):original(url,key,ranges,signal);
 // The renderer requests the aggregate once; it is not useful to prefetch all
 // native files a second time, or to start a full-horizon accumulation queue.
 reader.prefetchVariable=(url,key,ranges=null,signal)=>accumulationHours(key)?totals.read(url,key,ranges,signal).then(()=>{}):prefetch?.(url,key,ranges,signal);
 installed.set(reader,totals);return totals;
}
