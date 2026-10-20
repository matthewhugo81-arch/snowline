// Keep every arrow press in the requested index, but prepare only the latest
// cold selection in a rapid burst. Ready frames never wait for the debounce.
export class ForecastNavigation{
 constructor({select,delay=70}){this.select=select;this.delay=delay;this.pending=null;}
 request({ready=false}={}){
  this.cancel();
  const job={timer:null};
  job.promise=new Promise((resolve,reject)=>Object.assign(job,{resolve,reject}));
  // Event handlers may leave completion unobserved. The returned promise still
  // rejects for callers that await it, without leaking an unhandled rejection.
  job.promise.catch(()=>{});
  this.pending=job;
  if(ready)this.flush();else job.timer=setTimeout(()=>this.flush(),this.delay);
  return job.promise;
 }
 cancel(){
  const job=this.pending;this.pending=null;
  if(job){clearTimeout(job.timer);job.resolve(false);}
 }
 flush(){
  const job=this.pending;if(!job)return null;
  // select() may itself cancel navigation or schedule a newer selection.
  this.pending=null;clearTimeout(job.timer);
  try{Promise.resolve(this.select()).then(job.resolve,job.reject);}
  catch(error){job.reject(error);}
  return job.promise;
 }
}
