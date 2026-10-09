export const UKV='ukmo_uk_deterministic_2km';
export const hasTime=(meta,time)=>!!meta?.valid_times?.includes(time);
export const forecastTimes=metas=>[...new Set(metas.flatMap(m=>m.valid_times))].sort((a,b)=>Date.parse(a)-Date.parse(b));
export async function chooseRun(latest,base,load,mode='extended'){
 if(mode==='latest')return latest;
 const newest=Date.parse(latest.reference_time),cycle=6*3600000;let best=latest;
 const candidates=[];
 for(let time=Math.floor(newest/cycle)*cycle;time>=newest-24*3600000;time-=cycle){
  if(time===newest)continue;const iso=new Date(time).toISOString();
  candidates.push({time,path:iso.slice(0,10).replaceAll('-','/')+'/'+iso.slice(11,13)+'00Z/meta.json'});
 }
 const results=await Promise.allSettled(candidates.map(async ({time,path})=>({time,meta:await load(base+path)})));
 for(const result of results){if(result.status!=='fulfilled')continue;const {time,meta}=result.value;
  if(meta.completed!==true||Date.parse(meta.reference_time)!==time||!Array.isArray(meta.variables)||!meta.valid_times?.length)continue;
  if(Date.parse(meta.valid_times.at(-1))>Date.parse(best.valid_times.at(-1)))best=meta;
 }
 return best;
}
