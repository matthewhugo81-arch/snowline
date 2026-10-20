export const UKV='ukmo_uk_deterministic_2km';
export const hasTime=(meta,time)=>!!meta?.valid_times?.some(value=>Date.parse(value)===Date.parse(time));
export const forecastTimes=metas=>[...new Map(metas.flatMap(m=>m.valid_times??[]).filter(time=>Number.isFinite(Date.parse(time))).map(time=>[Date.parse(time),time])).values()].sort((a,b)=>Date.parse(a)-Date.parse(b));
export function runCycleUTC(time){const d=new Date(time);return Number.isFinite(d.getTime())?d.toISOString().slice(11,16).replace(':','')+'Z':'Unknown';}
export function runLabel(meta){if(!meta?.reference_time)return 'Run unavailable';const d=new Date(meta.reference_time);return Number.isFinite(d.getTime())?d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'})+' · '+runCycleUTC(meta.reference_time):'Run unavailable';}
export function publishedRun(meta){
 const reference=Date.parse(meta?.reference_time);
 return Number.isFinite(reference)&&Array.isArray(meta.variables)&&meta.variables.length>0&&Array.isArray(meta.valid_times)&&meta.valid_times.length>0&&meta.valid_times.every(time=>Number.isFinite(Date.parse(time))&&Date.parse(time)>=reference);
}
export async function chooseRun(latest,inProgress){
 const candidates=[latest,inProgress].filter(publishedRun).sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time)||b.valid_times.length-a.valid_times.length||Number(b.completed===true)-Number(a.completed===true));
 if(!candidates.length)throw new Error('No published forecast hours are available. Use Check latest runs to retry.');
 return candidates[0];
}
export function runAvailability(meta){
 if(!publishedRun(meta))return 'Awaiting forecast hours';
 const lead=(Math.max(...meta.valid_times.map(Date.parse))-Date.parse(meta.reference_time))/3600000;
 return (meta.completed===false?'Updating':'Available')+' · to T+'+lead+' h';
}
export function runSignature(meta){
 return JSON.stringify((meta?.sources??(meta?[meta]:[])).map(source=>[source.domain,source.reference_time,source.completed,source.variables,source.valid_times,source.variable_valid_times??null,source.variable_intervals??null]));
}
// Revalidation must not regress an open page on a transient stale response.
// Same-run growth is safe to combine; different cycles are never spliced.
export function retainRunProgress(previous,next){
 if(!previous||Date.parse(next.reference_time)>Date.parse(previous.reference_time))return next;
 if(Date.parse(next.reference_time)<Date.parse(previous.reference_time))return previous;
 const incoming=next.sources??[next],old=previous.sources??[previous];
 const sources=[...new Set([...incoming,...old].map(source=>source.domain))].map(domain=>{
  const a=old.find(source=>source.domain===domain),b=incoming.find(source=>source.domain===domain);
  if(!a||!b)return b??a;
  const variableKeys=[...new Set([...Object.keys(a.variable_valid_times??{}),...Object.keys(b.variable_valid_times??{})])];
  const periods=[...new Set([...Object.keys(a.variable_intervals??{}),...Object.keys(b.variable_intervals??{})])];
  return {...b,completed:a.completed===true||b.completed===true,variables:[...new Set([...b.variables,...a.variables])],valid_times:forecastTimes([a,b]),
   ...(variableKeys.length?{variable_valid_times:Object.fromEntries(variableKeys.map(key=>[key,forecastTimes([{valid_times:a.variable_valid_times?.[key]??[]},{valid_times:b.variable_valid_times?.[key]??[]}])]))}:{}),
   ...(periods.length?{variable_intervals:Object.fromEntries(periods.map(key=>[key,{...a.variable_intervals?.[key],...b.variable_intervals?.[key]}]))}:{})};
 });
 return {...next,sources,completed:sources.every(source=>source.completed!==false),variables:[...new Set(sources.flatMap(source=>source.variables))],valid_times:forecastTimes(sources)};
}
