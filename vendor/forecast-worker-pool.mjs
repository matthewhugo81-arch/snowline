// Open-Meteo worker protocol adapter. A logical tile can be requested again
// before its cancelled worker replies. Every dispatch needs its own wire key.
import {ForecastWorkerData} from './forecast-worker-data.mjs?v=20261018-rates';
export class ForecastWorkerPool {
 constructor(workers=[]){
  this.workers=workers;this.nextWorker=0;this.sequence=0;
  this.pendingRequests=new Map();this.dispatches=new Map();
  this.gridData=new ForecastWorkerData();
  for(const worker of workers){
   worker.onmessage=event=>this.handleMessage(event,worker);
   worker.onerror=event=>this.handleError(event,worker);
  }
 }
 remove(job){
  if(this.pendingRequests.get(job.key)===job)this.pendingRequests.delete(job.key);
  this.dispatches.delete(job.wireKey);
 }
 handleMessage(event,worker){
  const message=event.data,job=this.dispatches.get(message.key);
  if(!job||job.worker!==worker){message.tile?.close?.();return;}
  if(message.type==='cancelled'){
   this.remove(job);
   for(const subscriber of job.subscribers)subscriber.resolve({cancelled:true});
  }else if(message.type.startsWith('return')){
   this.remove(job);
   // Bitmap consumers may encode/close their copy as soon as it is received.
   const results=job.subscribers.map((_,index)=>index?structuredClone(message.tile):message.tile);
   job.subscribers.forEach((subscriber,index)=>subscriber.resolve({data:results[index],cancelled:false}));
  }
 }
 handleError(event,worker){
  this.gridData.reset(worker);
  for(const job of [...this.dispatches.values()])if(job.worker===worker){
   this.remove(job);
   for(const subscriber of job.subscribers)subscriber.reject(Error('Worker error while rendering tile '+job.key+': '+event.message));
  }
 }
 requestTile(request){
  if(request.signal?.aborted)return Promise.resolve({cancelled:true});
  let job=this.pendingRequests.get(request.key),dispatch=false;
  if(!job){
   const worker=this.workers[this.nextWorker];
   if(!worker)return Promise.reject(Error('No forecast render workers available'));
   this.nextWorker=(this.nextWorker+1)%this.workers.length;
   job={key:request.key,wireKey:'forecast-'+(++this.sequence),worker,subscribers:[]};
   this.pendingRequests.set(job.key,job);this.dispatches.set(job.wireKey,job);dispatch=true;
  }
  const promise=new Promise((resolve,reject)=>{
   let done=false;
   const finish=(error,value)=>{
    if(done)return;done=true;request.signal?.removeEventListener('abort',cancel);
    if(error)reject(error);else resolve(value);
   };
   const subscriber={resolve:value=>finish(null,value),reject:error=>finish(error)};
   const cancel=()=>{
    const index=job.subscribers.indexOf(subscriber);
    if(index>=0)job.subscribers.splice(index,1);
    finish(null,{cancelled:true});
    if(!job.subscribers.length&&this.dispatches.get(job.wireKey)===job){
     this.remove(job);job.worker.postMessage({type:'cancel',key:job.wireKey});
    }
   };
   job.subscribers.push(subscriber);request.signal?.addEventListener('abort',cancel,{once:true});
  });
  if(dispatch){
   const {signal,...message}=request;
   try{job.worker.postMessage(this.gridData.encode(job.worker,{...message,key:job.wireKey}));}
   catch(error){this.gridData.reset(job.worker);this.remove(job);for(const subscriber of job.subscribers)subscriber.reject(error);}
  }
  return promise;
 }
}
