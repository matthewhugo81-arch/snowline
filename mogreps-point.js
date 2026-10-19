import {VARIABLES} from './data.js?v=20261019-mogreps-uk';
import {fetchMogreps, MOGREPS_VARIABLES} from './mogreps-client.js?v=20261019-mogreps-uk';

export const MOGREPS_POINT='mogreps_global_ensemble_mean';
const hour=3600000;
export function mogrepsMean(raw, model, now=Date.now()){
 const time=raw.hourly.time.map(t=>new Date(t*1000).toISOString().replace('.000Z','Z'));
 const values=Object.fromEntries(VARIABLES.map(v=>[v.key,new Array(time.length).fill(null)]));
 for(const key of MOGREPS_VARIABLES){
  const members=Object.entries(raw.hourly).filter(([name])=>name.startsWith(key+'_member'));
  if(members.length!==18)throw Error('MOGREPS-G requires all 18 members.');
  values[key]=time.map((_,i)=>{
   const numbers=members.map(([,series])=>series[i]);
   if(!numbers.every(v=>typeof v==='number'&&Number.isFinite(v)))return null;
   const mean=numbers.reduce((a,b)=>a+b,0)/18;
   // Preceding three-hour totals become a period-average rate, never an
   // instantaneous hourly forecast. This preserves the amount when integrated.
   return ['precipitation','snowfall'].includes(key)?mean/3:mean;
  });
 }
 return {...model,time,values,index:new Map(time.map((t,i)=>[t,i])),latitude:raw.latitude,longitude:raw.longitude,
  fetchedAt:now,source:'Met Office · CC BY-SA 4.0',sourceUrl:raw.sourceUrl,run:new Date(raw.run*1000).toISOString(),
  intervalHours:3,memberCount:18,missingSteps:raw.missingSteps??[],complete:raw.complete,
  periodNote:'Temperatures at 3 h steps. Rain/snow show the preceding 3 h average rate; no hourly detail. Snowfall uses a 7:1 snow-to-water equivalent.'};
}
export async function fetchMogrepsPoint(location,model,signal,onProgress=()=>{}){
 const raw=await fetchMogreps({lat:location.latitude,lon:location.longitude},signal,
  (data,done,total)=>onProgress(mogrepsMean(data,model),done,total));
 return mogrepsMean(raw,model);
}
export function nativeSeriesPath(series,times,key,x,y){
 let d='',drawing=false;
 const period=['precipitation','snowfall'].includes(key)&&series.intervalHours===3;
 for(let i=0;i<series.values.length;i++){
  const value=series.values[i];
  if(series.intervalHours===3&&!period&&Date.parse(times[i])%(3*hour)!==0)continue;
  if(!Number.isFinite(value)){drawing=false;continue;}
  if(period&&drawing)d+=`L${x(i-1).toFixed(1)},${y(value).toFixed(1)} `;
  d+=`${drawing?'L':'M'}${x(i).toFixed(1)},${y(value).toFixed(1)} `;drawing=true;
 }
 return d;
}
export function mogrepsLabel(model,key){
 return model.intervalHours===3?model.name+(['precipitation','snowfall'].includes(key)?' · 3 h average':' · 3 h steps'):model.name;
}
