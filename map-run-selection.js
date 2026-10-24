import {loadSpatialModel,loadSpatialRun,ensembleHistoryURL} from './map-sources.js?v=20261024-winter-hazards';
import {publishedRun,retainRunProgress} from './map-runs.js?v=20261021-harmonie-pressure';
import {runCandidates} from './map-previous-run-data.js?v=20261024-winter-hazards';
import {formatModelRun} from './map-model-run-menu.js?v=20261024-winter-hazards';
import {ukvRunFamily,cycleFamily} from './ukv-run-selection.js?v=20261011-live-runs';
import {completedSources} from './map-ukmo-early.js?v=20261021-early';
import {MOGREPS_UK,mogrepsUKCycle} from './mogreps-run-selection.js?v=20261022-three-hour-runs';

export const sourceModel=id=>id.split('@')[0].replace(/_previous$/,'');
export const selectedReference=id=>id.includes('@')?id.slice(id.indexOf('@')+1):null;
export const selectedRunKey=(model,meta)=>sourceModel(model)+'@'+new Date(meta.reference_time).toISOString();
export function completedModelRun(model,meta){
 if(!publishedRun(meta))return false;
 if(sourceModel(model)===MOGREPS_UK&&!mogrepsUKCycle(meta.reference_time))return false;
 const sources=(meta.sources??[meta]).filter(s=>!(model==='knmi_harmonie_arome_europe'&&s.harmoniePressureSupplement===true)),reference=Date.parse(meta.reference_time);
 if(!completedSources(sources)||!sources.every(s=>Date.parse(s.reference_time)===reference))return false;
 return model!=='gfs_global'||sources.some(s=>s.domain==='ncep_gfs025');
}
export const preferredCompleteRun=(model,pair)=>completedModelRun(sourceModel(model),pair.latest)?pair.latest:pair.previous??pair.latest;
const withoutHistory=meta=>{const {previousCompletedRun,...run}=meta;return run;};

// Keep only metadata. Native grids remain at their immutable provider URLs.
// An undated key follows the latest complete run. Dated keys stay pinned.
export function createRunCatalogue({loadModel=loadSpatialModel,loadRun=loadSpatialRun}={}){
 const records=new Map(),checks=new WeakMap();
 async function check(model,load,onReady){
  const incoming=await loadModel(model,load),old=records.get(model);
  const latest=retainRunProgress(old?.latest,incoming),reference=Date.parse(latest.reference_time);
  const retained=[old?.previous,old?.latest,incoming.previousCompletedRun].filter(m=>completedModelRun(model,m)&&Date.parse(m.reference_time)<reference)
   .sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time))[0]??null;
  let previous=retained,warning=null;
  // A verified complete latest run can supply layer choices immediately.
  // Continue discovering older choices without delaying the selected chart.
  onReady({latest,previous,warning});
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
  if(hint&&(!family||cycleFamily(hint)===family)&&(model!==MOGREPS_UK||mogrepsUKCycle(hint))&&Date.parse(hint)<reference&&!candidates.some(t=>Date.parse(t)===Date.parse(hint)))candidates.push(hint);
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
 function discovery(model,load){
  model=sourceModel(model);
  if(!checks.has(load))checks.set(load,new Map());
  const pending=checks.get(load);
  if(!pending.has(model)){
   let release;
   const ready=new Promise(resolve=>release=resolve),complete=check(model,load,release);
   complete.then(release,()=>release(null));
   pending.set(model,{ready,complete});
  }
  return pending.get(model);
 }
 const catalogue=(model,load)=>discovery(model,load).complete;
 return {
  catalogue,
  async select(key,load,{deferPrevious=false}={}){
   const model=sourceModel(key),reference=selectedReference(key),check=discovery(model,load);
   let pair=deferPrevious?await check.ready:null;
   const early=pair&&completedModelRun(model,pair.latest)&&!key.endsWith('_previous')&&(!reference||Date.parse(reference)===Date.parse(pair.latest.reference_time));
   if(!early)pair=await check.complete;
   const choices=[pair.latest,pair.previous].filter(Boolean);
   let meta=reference?choices.find(m=>Date.parse(m.reference_time)===Date.parse(reference)):
    key.endsWith('_previous')?pair.previous:preferredCompleteRun(model,pair);
   if(!meta&&!reference)throw Error('No previous complete run could be verified. Check latest runs to retry.');
   if(!meta)meta=await loadRun(model,reference,load);
   if(reference&&Date.parse(meta.reference_time)!==Date.parse(reference))throw Error('Selected run identity changed.');
   const warnings=[...(meta.sourceWarnings??[]),...(pair.warning?[pair.warning]:[])];
   if(!pair.previous&&!completedModelRun(model,pair.latest))warnings.push('No complete run could be verified. Incoming hours remain available; the next check will retry.');
   meta={...meta,sourceWarnings:[...new Set(warnings)]};
   return {...pair,meta,key:selectedRunKey(model,meta),...(early?{completion:check.complete}:{})};
  }
 };
}
export const mapRunCatalogue=createRunCatalogue();

export function renderRunSelector(select,model,pair,selected,{followLatest=false,product=false}={}){
 if(product){
  select.replaceChildren();
  const option=document.createElement('option');
  option.value=selectedRunKey(model,selected);
  option.textContent=formatModelRun(selected)+' · ensemble products';
  select.append(option);select.value=option.value;select.disabled=false;
  select.dataset.preferredRun=option.value;
  select.title='Ensemble product initialization in UTC. These products publish separately from ordinary model charts. Check latest runs to load the latest published products.';
  return;
 }
 const runs=[pair.latest,pair.previous,selected].filter(Boolean);
 const unique=[...new Map(runs.map(m=>[new Date(m.reference_time).toISOString(),m])).values()].sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time));
 select.replaceChildren();
 const preferred=preferredCompleteRun(model,pair),complete=completedModelRun(sourceModel(model),preferred);
 // User changes to this real dated run resume following. Rendering the menu
 // must not change an existing panel's explicit run-selection intent.
 select.dataset.preferredRun=selectedRunKey(model,preferred);
 for(const meta of unique){
  const option=document.createElement('option');
  option.value=selectedRunKey(model,meta);
  const complete=completedModelRun(sourceModel(model),meta);
  option.textContent=formatModelRun(meta)+' · '+(complete?'Complete':'Updating');
  if(meta.reference_time===pair.latest.reference_time)option.textContent+=' · newest';
  select.append(option);
 }
 select.value=selectedRunKey(model,selected);select.disabled=false;
 select.title=[pair.warning,followLatest?
  'Initialization in UTC. Follows the latest complete run automatically, retaining the previous complete run while the next updates.':
  'Initialization in UTC. This selected run stays fixed. Choose the latest complete run to resume automatic updates.',
  !complete?'No completed run could be verified yet. The available incoming run is shown until one completes.':null].filter(Boolean).join(' ');
}
