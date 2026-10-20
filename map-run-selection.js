import {loadSpatialModel,loadSpatialRun,ensembleHistoryURL} from './map-sources.js?v=20261020-run-selector';
import {publishedRun,retainRunProgress} from './map-runs.js?v=20261020-run-selector';
import {runCandidates} from './map-previous-run-data.js?v=20261020-compact-controls';
import {formatModelRun} from './map-model-run-menu.js?v=20261020-run-selector';
import {ukvRunFamily,cycleFamily} from './ukv-run-selection.js?v=20261011-live-runs';

export const sourceModel=id=>id.split('@')[0].replace(/_previous$/,'');
export const selectedReference=id=>id.includes('@')?id.slice(id.indexOf('@')+1):null;
export const selectedRunKey=(model,meta)=>sourceModel(model)+'@'+new Date(meta.reference_time).toISOString();
export function completedModelRun(model,meta){
 if(!publishedRun(meta))return false;
 const sources=meta.sources??[meta],reference=Date.parse(meta.reference_time);
 if(!sources.every(s=>s.completed===true&&Date.parse(s.reference_time)===reference))return false;
 return model!=='gfs_global'||sources.some(s=>s.domain==='ncep_gfs025');
}
const withoutHistory=meta=>{const {previousCompletedRun,...run}=meta;return run;};

// Keep only metadata. Native grids remain at their immutable provider URLs.
// Each selected panel pins an initialization; only that initialization can grow.
export function createRunCatalogue({loadModel=loadSpatialModel,loadRun=loadSpatialRun}={}){
 const records=new Map(),checks=new WeakMap();
 async function check(model,load){
  const incoming=await loadModel(model,load),old=records.get(model);
  const latest=retainRunProgress(old?.latest,incoming),reference=Date.parse(latest.reference_time);
  const retained=[old?.previous,old?.latest,incoming.previousCompletedRun].filter(m=>completedModelRun(model,m)&&Date.parse(m.reference_time)<reference)
   .sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time))[0]??null;
  let previous=retained,warning=null;
  const candidates=runCandidates(model,latest.reference_time);
  if(model.startsWith('snowline_')){
   try{
    const history=await load(ensembleHistoryURL(model));
    for(const ref of history.runs??[])if(Number.isFinite(Date.parse(ref))&&Date.parse(ref)<reference&&!candidates.some(t=>Date.parse(t)===Date.parse(ref)))candidates.push(ref);
   }catch{/* Exact-cycle checks below still retain a verified fallback. */}
  }
  // latest.json identifies the provider's last complete run during publication.
  // UKV's shared latest index can point to an intervening nowcast. It must
  // not interrupt discovery of the previous complete main initialization.
  const hint=incoming.completedReferenceTime,family=ukvRunFamily(model);
  if(hint&&(!family||cycleFamily(hint)===family)&&Date.parse(hint)<reference&&!candidates.some(t=>Date.parse(t)===Date.parse(hint)))candidates.push(hint);
  candidates.sort((a,b)=>Date.parse(b)-Date.parse(a));
  for(const ref of candidates){
   if(previous&&Date.parse(ref)<=Date.parse(previous.reference_time))break;
   try{
    const archived=await loadRun(model,ref,load);
    if(Date.parse(archived.reference_time)!==Date.parse(ref)||!publishedRun(archived))throw Error('Archived run identity is invalid.');
    if(completedModelRun(model,archived)){previous=withoutHistory(archived);break;}
   }catch(error){
    if(error.status===404||error.code==='NO_PUBLISHED_HOURS')continue;
    warning='Previous complete run check failed; keeping verified data and retrying.';break;
   }
  }
  const newer=records.get(model);
  if(newer&&Date.parse(newer.latest.reference_time)>reference)return newer;
  previous=[previous,newer?.previous].filter(m=>completedModelRun(model,m)&&Date.parse(m.reference_time)<reference)
   .sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time))[0]??null;
  const record={latest:retainRunProgress(newer?.latest,latest),previous,warning};
  records.set(model,record);return record;
 }
 async function catalogue(model,load){
  model=sourceModel(model);
  if(!checks.has(load))checks.set(load,new Map());
  const pending=checks.get(load);
  if(!pending.has(model))pending.set(model,check(model,load));
  return pending.get(model);
 }
 return {
  catalogue,
  async select(key,load){
   const model=sourceModel(key),reference=selectedReference(key),pair=await catalogue(model,load);
   const choices=[pair.latest,pair.previous].filter(Boolean);
   let meta=reference?choices.find(m=>Date.parse(m.reference_time)===Date.parse(reference)):
    key.endsWith('_previous')?pair.previous:completedModelRun(model,pair.latest)?pair.latest:pair.previous??pair.latest;
   if(!meta&&!reference)throw Error('No previous complete run could be verified. Check latest runs to retry.');
   if(!meta)meta=await loadRun(model,reference,load);
   if(reference&&Date.parse(meta.reference_time)!==Date.parse(reference))throw Error('Selected run identity changed.');
   const warnings=[...(meta.sourceWarnings??[]),...(pair.warning?[pair.warning]:[])];
   if(!pair.previous&&!completedModelRun(model,pair.latest))warnings.push('No complete run could be verified. Incoming hours remain available; the next check will retry.');
   meta={...meta,sourceWarnings:[...new Set(warnings)]};
   return {...pair,meta,key:selectedRunKey(model,meta)};
  }
 };
}
export const mapRunCatalogue=createRunCatalogue();

export function renderRunSelector(select,model,pair,selected){
 const runs=[pair.latest,pair.previous,selected].filter(Boolean);
 const unique=[...new Map(runs.map(m=>[new Date(m.reference_time).toISOString(),m])).values()].sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time));
 select.replaceChildren();
 for(const meta of unique){
  const option=document.createElement('option');
  option.value=selectedRunKey(model,meta);
  const complete=completedModelRun(sourceModel(model),meta);
  option.textContent=formatModelRun(meta)+' · '+(complete?'Complete':'Updating');
  if(meta.reference_time===pair.latest.reference_time)option.textContent+=' · newest';
  select.append(option);
 }
 select.value=selectedRunKey(model,selected);select.disabled=false;
 select.title=pair.warning??(!completedModelRun(sourceModel(model),pair.latest)&&!pair.previous?
  'No completed run could be verified yet. Showing the available incoming run.':'Initialization in UTC. This selection stays pinned while new runs arrive.');
}
