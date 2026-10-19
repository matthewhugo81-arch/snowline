import {previousCompletedUKV,completedUKV} from './map-ukv-runs.js?v=20261018-rates';
import {briefingTimes,briefingPresets} from './map-briefing-data.js?v=20261019-ensemble-extra';
import {ENSEMBLE_DOMAINS} from './map-ensemble.js?v=20261019-ensemble-extra';
import {fieldIntervalHours,loadSpatialRun,ensembleHistoryURL} from './map-sources.js?v=20261019-ensemble-extra';
import {UKV,UKV_NOWCAST,cycleFamily} from './ukv-run-selection.js?v=20261011-live-runs';
import {PRECIPITATION_TYPE,TYPE_KEYS} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {THETA_SYMBOLS} from './map-winter.js?v=20261014-interaction-audit';
const HOUR=3600000;
export function runCandidates(model,reference,lookbackHours=48){
 if(!Number.isInteger(lookbackHours)||lookbackHours<1||lookbackHours>48)throw Error('Archive search is limited to 48 hours.');
 const init=Date.parse(reference);if(!Number.isFinite(init)||init%HOUR)throw Error('Invalid model initialization.');
 const cadence=model===UKV?3:model===UKV_NOWCAST||['knmi_harmonie_arome_europe','ukmo_uk_ensemble_2km'].includes(model)?1:['icon_eu','meteofrance_arome_france'].includes(model)?3:model==='gem_global'?12:6;
 const out=[];
 for(let delta=cadence;delta<=lookbackHours;delta+=cadence){const time=new Date(init-delta*HOUR).toISOString();if(model===UKV_NOWCAST&&cycleFamily(time)!=='nowcast')continue;out.push(time);}
 return out;
}
export async function discoverPreviousRuns({model,latest,load,signal,lookbackHours=48,concurrency=3,loadRun=loadSpatialRun,retainedRuns=[]}){
 const ensemble=ENSEMBLE_DOMAINS.some(domain=>domain.value===model);
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
 let candidates=runCandidates(model,latest.reference_time,lookbackHours);
 const runs=[latest],unavailable=[],errors=[];let index=0;
 if(ensemble){
  try{
   const archive=await load(ensembleHistoryURL(model));signal?.throwIfAborted();
   if(archive?.format_version!==1||!Array.isArray(archive.runs)||archive.runs.some(t=>typeof t!=='string'||!Number.isFinite(Date.parse(t))))throw Error('Invalid ensemble archive index');
   const reference=Date.parse(latest.reference_time),cadence=model==='snowline_ecmwf_ensemble'?12:6;
   candidates=[...new Set(archive.runs.map(Date.parse))].filter(t=>t<reference&&reference-t<=lookbackHours*HOUR&&t%(cadence*HOUR)===0).sort((a,b)=>b-a).map(t=>new Date(t).toISOString());
  }catch(error){
   if(signal?.aborted)throw error;
   return {runs,unavailable,errors:[{message:error.message}],notice:'Ensemble archive index could not be checked. Retry Load latest three runs; no substitute runs are used.'};
  }
 }
 async function worker(){
  while(index<candidates.length&&!signal?.aborted){
   const time=candidates[index++];
   try{const meta=await loadRun(model,time,load);signal?.throwIfAborted();runs.push(meta);}
   catch(error){if(signal?.aborted)throw error;if(error.status===404)unavailable.push(time);else errors.push({time,message:error.message});}
  }
 }
 await Promise.all(Array.from({length:Math.max(1,Math.min(3,concurrency))},worker));signal?.throwIfAborted();
 const unique=[...new Map(runs.map(meta=>[Date.parse(meta.reference_time),meta])).values()].sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time));
 return {runs:unique,unavailable,errors,...(ensemble&&unique.length<3?{notice:'Only '+unique.length+' verified ensemble runs are published. Three distinct runs are needed for comparison; Forecast sequence remains available.'}:{})};
}
export function previousRunPresets(runs,count=3,fields){
 if(runs.length!==count||new Set(runs.map(meta=>Date.parse(meta.reference_time))).size!==count)return [];
 const catalogues=runs.map(meta=>briefingPresets(meta,fields));
 const sets=catalogues.map(presets=>new Set(presets.map(p=>p.id)));
 return catalogues[0].filter(p=>sets.every(set=>set.has(p.id)));
}
export function previousRunTimes(runs,preset,model,interval='3'){
 if(runs.length!==3||!preset||new Set(runs.map(m=>Date.parse(m.reference_time))).size!==runs.length)return [];
 const series=runs.map(meta=>briefingTimes(meta,preset,model,interval)),sets=series.slice(1).map(times=>new Set(times.map(Date.parse)));
 const amount=preset.id==='weather'?'precipitation':preset.field;
 const intervalAmount=[...TYPE_KEYS,THETA_SYMBOLS,'precipitation','rain','showers','snowfall_water_equivalent','precipitation_probability','snowfall_probability'].includes(amount)||runs.some(meta=>meta.sources?.some(source=>source.variable_intervals?.[amount]));
 return series[0].filter(time=>sets.every(set=>set.has(Date.parse(time)))&&(!intervalAmount||new Set(runs.map(meta=>fieldIntervalHours(meta,amount,time))).size===1));
}
export function newerRunAvailable(runs,incoming){return !!incoming&&runs.length>0&&Date.parse(incoming.reference_time)>Math.max(...runs.map(meta=>Date.parse(meta.reference_time)));}
