// Chart initializations only. The full lagged ensemble still needs hourly inputs.
export const MOGREPS_UK='ukmo_uk_ensemble_2km';
const HOUR=3600000;
export const mogrepsUKCycle=reference=>Number.isFinite(Date.parse(reference))&&Date.parse(reference)%(3*HOUR)===0;
export async function selectMogrepsUKRun(latest,base,load,known=[]){
 const newest=Date.parse(latest?.reference_time);
 if(!Number.isFinite(newest)||newest%HOUR)throw Error('Invalid MOGREPS-UK initialization.');
 const skipped=[];
 for(let time=Math.floor(newest/(3*HOUR))*3*HOUR;time>=newest-24*HOUR;time-=3*HOUR){
  const reference=new Date(time).toISOString();
  let meta=[latest,...known].find(m=>Date.parse(m?.reference_time)===time);
  if(!meta){
   const path=reference.slice(0,10).replaceAll('-','/')+'/'+reference.slice(11,16).replace(':','')+'Z/meta.json';
   try{meta=await load(base+path);}
   catch(error){if(error.status===404){skipped.push(reference);continue;}throw error;}
  }
  if(Date.parse(meta?.reference_time)!==time)throw Error('MOGREPS-UK metadata does not match the requested initialization.');
  if(Array.isArray(meta.valid_times)&&!meta.valid_times.length){skipped.push(reference);continue;}
  if(!Array.isArray(meta.variables)||!meta.variables.length||!Array.isArray(meta.valid_times)||meta.valid_times.some(t=>!Number.isFinite(Date.parse(t))||Date.parse(t)<time))
   throw Error('Invalid MOGREPS-UK metadata.');
  return {...meta,selectionWarnings:skipped.length?['A newer three-hourly MOGREPS-UK run has no published hours yet; showing the newest available three-hourly run.']:[]};
 }
 throw Error('No published three-hourly MOGREPS-UK run is available within the last 24 hours.');
}
