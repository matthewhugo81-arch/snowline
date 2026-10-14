import {UKV,cycleFamily} from './ukv-run-selection.js?v=20261011-live-runs';
import {loadSpatialModel,loadSpatialRun} from './map-sources.js?v=20261014-winter-intensity';
import {publishedRun,retainRunProgress} from './map-runs.js?v=20261011-live-runs';

// A map-only run choice, not another operational model or point-forecast ID.
export const UKV_PREVIOUS=UKV+'_previous';
export const isUKVChoice=id=>id===UKV||id===UKV_PREVIOUS;
const withoutHistory=meta=>{const {previousCompletedRun,...run}=meta;return run;};
export const completedUKV=meta=>publishedRun(meta)&&cycleFamily(meta.reference_time)==='main'&&
 (meta.sources??[meta]).every(source=>source.completed===true&&Date.parse(source.reference_time)===Date.parse(meta.reference_time));

// Search only main initializations. Completion must be explicitly verified;
// a long horizon alone is not proof that a run finished. On an ambiguous error
// keep only an already verified fallback, never silently skip to an older run.
export async function previousCompletedUKV(latest,load,loadRun=loadSpatialRun,retained=null,{lookbackHours=48,signal}={}){
 const newest=Date.parse(latest.reference_time),warnings=[];
 if(cycleFamily(latest.reference_time)!=='main')throw Error('Expected a UKV main cycle.');
 if(!Number.isInteger(lookbackHours)||lookbackHours<3||lookbackHours>48)throw Error('UKV history search is limited to 3–48 hours.');
 const fallback=completedUKV(retained)&&Date.parse(retained.reference_time)<newest?retained:null;
 for(let time=newest-3*3600000;time>=newest-lookbackHours*3600000;time-=3*3600000){
  signal?.throwIfAborted();
  if(fallback&&time<=Date.parse(fallback.reference_time))return {previous:fallback,warnings};
  try{
   const meta=await loadRun(UKV,new Date(time).toISOString(),load);signal?.throwIfAborted();
   if(Date.parse(meta?.reference_time)===time&&meta.completed!==true&&Array.isArray(meta.valid_times)&&!meta.valid_times.length)continue;
   if(Date.parse(meta?.reference_time)!==time||!publishedRun(meta))throw Error('Archived metadata does not match the requested UKV run.');
   if(completedUKV(meta))return {previous:meta,warnings};
  }catch(error){
   if(signal?.aborted)throw error;
   if(error.status===404||error.code==='NO_PUBLISHED_HOURS')continue;
   warnings.push('Previous UKV run check failed; '+(fallback?'keeping the last verified completed run.':'retrying automatically.'));
   return {previous:fallback,warnings};
  }
 }
 return {previous:fallback,warnings};
}

export function createMapRunLoader({loadModel=loadSpatialModel,loadRun=loadSpatialRun}={}){
 let current=null,previous=null;
 const checks=new WeakMap();
 async function pair(load){
  const incoming=await loadModel(UKV,load);
  const next=retainRunProgress(current,incoming);
  const candidates=[previous,current,next.previousCompletedRun].filter(meta=>completedUKV(meta)&&Date.parse(meta.reference_time)<Date.parse(next.reference_time));
  const retained=candidates.sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time))[0]??null;
  const result=await previousCompletedUKV(next,load,loadRun,retained);
  // Other views may have finished a newer check while this one was awaiting IO.
  if(current&&Date.parse(current.reference_time)>Date.parse(next.reference_time))return current;
  current=retainRunProgress(current,next);
  const available=[previous,result.previous].filter(meta=>completedUKV(meta)&&Date.parse(meta.reference_time)<Date.parse(current.reference_time));
  previous=available.length?withoutHistory(available.sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time))[0]):null;
  const warnings=[...(incoming.sourceWarnings??[]),...result.warnings];
  if(Date.parse(incoming.reference_time)<Date.parse(current.reference_time))warnings.push('UKV feed returned an older initialization; keeping the last verified runs and retrying.');
  current={...current,sourceWarnings:warnings,previousCompletedRun:previous};
  return current;
 }
 return async function loadMapRun(model,load){
  if(!isUKVChoice(model))return loadModel(model,load);
  if(!checks.has(load))checks.set(load,pair(load));
  let latest;
  try{latest=await checks.get(load);}finally{checks.delete(load);}
  if(model===UKV)return latest;
  if(!latest.previousCompletedRun)throw Error('No previous completed UKV main run could be verified. Check latest runs to retry.');
  return {...latest.previousCompletedRun,runRole:'previous',sourceWarnings:[...latest.sourceWarnings]};
 };
}

// Shared by normal maps, menu labels, Briefing and Previous Run Analysis.
// Retains metadata only; every field URL remains pinned to its own cycle.
export const loadMapRun=createMapRunLoader();
