export const UKV='ukmo_uk_deterministic_2km';
export const hasTime=(meta,time)=>!!meta?.valid_times?.some(value=>Date.parse(value)===Date.parse(time));
export const forecastTimes=metas=>[...new Map(metas.flatMap(m=>m.valid_times??[]).filter(time=>Number.isFinite(Date.parse(time))).map(time=>[Date.parse(time),time])).values()].sort((a,b)=>Date.parse(a)-Date.parse(b));
export function runCycleUTC(time){const d=new Date(time);return Number.isFinite(d.getTime())?d.toISOString().slice(11,16).replace(':','')+'Z':'Unknown';}
export function runLabel(meta){if(!meta?.reference_time)return 'Run unavailable';const d=new Date(meta.reference_time);return Number.isFinite(d.getTime())?d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'})+' · '+runCycleUTC(meta.reference_time):'Run unavailable';}
export async function chooseRun(latest){
 if(!latest||!Number.isFinite(Date.parse(latest.reference_time))||!Array.isArray(latest.variables)||!latest.valid_times?.length||latest.completed===false)throw new Error('Latest model cycle is incomplete or unavailable. Use Check latest runs to retry.');
 return latest;
}
