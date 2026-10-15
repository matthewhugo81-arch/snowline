// Serialize speculative native-input reads across briefing/history renderers.
// Tile rendering keeps the OM renderer's own bounded worker scheduler.
export class ForecastWorkQueue{
 constructor(){this.active=0;this.jobs=[];}
 run(task,signal){
  if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
  return new Promise((resolve,reject)=>{
   const job={task,signal,resolve,reject};
   job.cancel=()=>{const index=this.jobs.indexOf(job);if(index>=0){this.jobs.splice(index,1);reject(new DOMException('Aborted','AbortError'));}};
   signal.addEventListener('abort',job.cancel,{once:true});this.jobs.push(job);this.drain();
  });
 }
 drain(){
  if(this.active||!this.jobs.length)return;
  const job=this.jobs.shift();job.signal.removeEventListener('abort',job.cancel);this.active++;
  let result;try{job.signal.throwIfAborted();result=job.task();}catch(error){result=Promise.reject(error);}
  Promise.resolve(result).then(job.resolve,job.reject).finally(()=>{this.active--;this.drain();});
 }
}
export const forecastInputWork=new ForecastWorkQueue();
