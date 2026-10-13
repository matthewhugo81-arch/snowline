import {previousCompletedUKV,completedUKV} from './map-ukv-runs.js?v=20261013-ukv-retention';
import {briefingTimes,briefingPresets,BRIEFING_PRESETS} from './map-briefing-data.js?v=20261013-nw-europe-periods';
import {fieldIntervalHours,loadSpatialRun} from './map-sources.js?v=20261013-ukv-retention';
import {UKV,UKV_NOWCAST,cycleFamily} from './ukv-run-selection.js?v=20261011-live-runs';
const HOUR=3600000;
export function runCandidates(model,reference,lookbackHours=48){
 if(!Number.isInteger(lookbackHours)||lookbackHours<1||lookbackHours>48)throw Error('Archive search is limited to 48 hours.');
 const init=Date.parse(reference);if(!Number.isFinite(init)||init%HOUR)throw Error('Invalid model initialization.');
 const cadence=model===UKV?3:model===UKV_NOWCAST||model==='knmi_harmonie_arome_europe'?1:['icon_eu','meteofrance_arome_france'].includes(model)?3:model==='gem_global'?12:6;
 const out=[];
 for(let delta=cadence;delta<=lookbackHours;delta+=cadence){const time=new Date(init-delta*HOUR).toISOString();if(model===UKV_NOWCAST&&cycleFamily(time)!=='nowcast')continue;out.push(time);}
 return out;
}
export async function discoverPreviousRuns({model,latest,load,signal,lookbackHours=48,concurrency=3,loadRun=loadSpatialRun,retainedRuns=[]}){
 if(model===UKV){
  const result=await previousCompletedUKV(latest,load,loadRun,latest.previousCompletedRun,{lookbackHours,signal});
  const runs=[latest,...(result.previous?[result.previous]:[])],warnings=[...result.warnings];
  if(result.previous){
   const remaining=lookbackHours-(Date.parse(latest.reference_time)-Date.parse(result.previous.reference_time))/HOUR;
   if(remaining>=3){
    const retained=retainedRuns.filter(run=>completedUKV(run)&&Date.parse(run.reference_time)<Date.parse(result.previous.reference_time)&&Date.parse(run.reference_time)>=Date.parse(latest.reference_time)-lookbackHours*HOUR).sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time))[0];
    const older=await previousCompletedUKV(result.previous,load,loadRun,retained,{lookbackHours:remaining,signal});
    if(older.previous)runs.push(older.previous);
    warnings.push(...older.warnings);
   }
  }
  return {runs,unavailable:[],errors:warnings.map(message=>({message}))};
 }
 const candidates=runCandidates(model,latest.reference_time,lookbackHours),runs=[latest],unavailable=[],errors=[];let index=0;
 async function worker(){
  while(index<candidates.length&&!signal?.aborted){
   const time=candidates[index++];
   try{const meta=await loadRun(model,time,load);signal?.throwIfAborted();runs.push(meta);}
   catch(error){if(signal?.aborted)throw error;if(error.status===404)unavailable.push(time);else errors.push({time,message:error.message});}
  }
 }
 await Promise.all(Array.from({length:Math.max(1,Math.min(3,concurrency))},worker));signal?.throwIfAborted();
 const unique=[...new Map(runs.map(meta=>[Date.parse(meta.reference_time),meta])).values()].sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time));
 return {runs:unique,unavailable,errors};
}
export function previousRunPresets(runs,count=3){
 if(runs.length!==count||new Set(runs.map(meta=>Date.parse(meta.reference_time))).size!==count)return [];
 const sets=runs.map(meta=>new Set(briefingPresets(meta).map(p=>p.id)));
 return BRIEFING_PRESETS.filter(p=>sets.every(set=>set.has(p.id)));
}
export function previousRunTimes(runs,preset,model,interval='3'){
 if(runs.length!==3||!preset||new Set(runs.map(m=>Date.parse(m.reference_time))).size!==runs.length)return [];
 const series=runs.map(meta=>briefingTimes(meta,preset,model,interval)),sets=series.slice(1).map(times=>new Set(times.map(Date.parse)));
 return series[0].filter(time=>sets.every(set=>set.has(Date.parse(time)))&&(preset.id!=='weather'||new Set(runs.map(meta=>fieldIntervalHours(meta,'precipitation',time))).size===1));
}
export function newerRunAvailable(runs,incoming){return !!incoming&&runs.length>0&&Date.parse(incoming.reference_time)>Math.max(...runs.map(meta=>Date.parse(meta.reference_time)));}
