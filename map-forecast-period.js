export const FORECAST_PERIODS=[24,36,48,72,96,120];
export function forecastPeriodHours(value){const hours=Number(value);return FORECAST_PERIODS.includes(hours)?hours:0;}
// Each panel starts at its own initialization, including comparisons of old runs.
// Keep unavailable hours out of the priority count; never alter the full timeline.
export function forecastPeriodURLs(urls,times,reference,hours){
 const start=Date.parse(reference),end=start+forecastPeriodHours(hours)*3600000;
 if(!forecastPeriodHours(hours)||!Number.isFinite(start))return [];
 return [...new Set(urls.filter((url,index)=>url&&Date.parse(times[index])>=start&&Date.parse(times[index])<=end))];
}
// Fast panels wait for the other panels' requested period before warming the
// remainder. Failed/exhausted frames and storage limits cannot hold this gate.
export class ForecastPeriodPriority{
 constructor(entries){this.entries=entries;this.waiters=new Set();}
 pending(){return this.entries().some(({cache,urls})=>cache&&cache.canPreload()&&urls.some(url=>!cache.preloaded.has(url)&&cache.canRetry(url)));}
 progress(){if(!this.waiters.size||this.pending())return;for(const done of [...this.waiters])done();}
 wait(signal){
  if(signal.aborted||!this.pending())return Promise.resolve();
  return new Promise(resolve=>{
   const done=()=>{this.waiters.delete(done);signal.removeEventListener('abort',done);resolve();};
   this.waiters.add(done);signal.addEventListener('abort',done,{once:true});
  });
 }
}
