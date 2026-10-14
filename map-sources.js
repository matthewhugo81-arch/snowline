import {accumulationHours,accumulationSource} from './map-accumulation.js?v=20261014-interaction-audit';
import {WEATHER_COMPOSITE,COMPOSITE_FIELDS,compositeMeta} from './map-weather-composite.js?v=20261013-map-appearance';
import {chooseRun,hasTime,forecastTimes,publishedRun} from './map-runs.js?v=20261011-live-runs';
import {UKV,UKV_NOWCAST,ukvRunFamily,selectUKVRun} from './ukv-run-selection.js?v=20261011-live-runs';
import {sourceVariable} from './map-catalogue.js?v=20261014-interaction-audit';
import {PRECIPITATION_TYPE,TYPE_KEYS,isTypeField} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {ENSEMBLE_DOMAINS,ensembleFreshnessWarning} from './map-ensemble.js?v=20261013-operational-feeds';
import {MOGREPS_MODELS,verifiedSnowMetadata} from './map-mogreps.js?v=20261014-clean-symbols';

import {THETA_SYMBOLS,THETA_SYMBOL_FIELDS} from './map-winter.js?v=20261014-interaction-audit';
import {precipitationStepHours,precipitationExistsAt} from './map-accumulation.js?v=20261014-interaction-audit';
export const SPATIAL_BASE='https://openmeteo.s3.amazonaws.com/data_spatial/';
const domains={ecmwf_ifs:'ecmwf_ifs',ecmwf_ifs025:'ecmwf_ifs025',ecmwf_aifs025_single:'ecmwf_aifs025_single',icon_global:'dwd_icon',icon_eu:'dwd_icon_eu',gem_global:'cmc_gem_gdps_15km',gfs_global:'ncep_gfs013',ukmo_global_deterministic_10km:'ukmo_global_deterministic_10km',ukmo_uk_deterministic_2km:'ukmo_uk_deterministic_2km',ncep_aigfs025:'ncep_aigfs025',ncep_hgefs025_ensemble_mean:'ncep_hgefs025_ensemble_mean',jma_gsm:'jma_gsm',knmi_harmonie_arome_europe:'knmi_harmonie_arome_europe',meteofrance_arpege_europe:'meteofrance_arpege_europe',meteofrance_arome_france:'meteofrance_arome_france0025'};
// Open-Meteo splits GFS surface and pressure/upper-air fields into two grids.
// Companion data must come from the selected primary run, never a different cycle.
const companions={gfs_global:['ncep_gfs025']};
for(const domain of ['ncep_gefs025','ncep_gefs05','ecmwf_ifs025_ensemble'])domains[domain]=domain;
for(const model of MOGREPS_MODELS)domains[model.id]=model.id;
const ownEnsembles=new Set(ENSEMBLE_DOMAINS.map(d=>d.value));
for(const domain of ownEnsembles)domains[domain]=domain;
const ownBase=new URL('./ensemble-data/',import.meta.url).href;
// Backward sums/averages have no interval at initialization, even when that
// timestamp is in the run-wide metadata: https://github.com/open-meteo/open-data
const intervalFields=new Set([...TYPE_KEYS,'temperature_2m_max','temperature_2m_min','precipitation','precipitation_probability','snowfall_probability','rain','showers','snowfall_water_equivalent','shortwave_radiation','direct_radiation','diffuse_radiation']);
// GFS 0.13° omits these fields at analysis time, although run-wide metadata lists
// them. Verified against the provider's Gfs013DownloadSurfaceVariable.skipHour0:
// https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Gfs/GfsVariableDownloadable.swift
const gfsForecastOnly=new Set(['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','uv_index','uv_index_clear_sky']);
const noInitialGust=new Set(['ecmwf_ifs','ecmwf_ifs025','dwd_icon','dwd_icon_eu','meteofrance_arpege_europe','meteofrance_arome_france0025']);
const aromeForecastOnly=new Set(['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high']);
function fieldPublishedAt(source,key,time){
 const lead=(Date.parse(time)-Date.parse(source.reference_time))/3600000;
 if(key==='precipitation'&&!precipitationExistsAt(source.domain,lead))return false;
 // ECMWF open data switches to 10fg3 for these steps. Open-Meteo's IFS025
 // importer does not ingest that parameter; native OM checks confirm the gap.
 // Keep the valid times on either side and never interpolate across it.
 if(source.domain==='ecmwf_ifs025'&&key==='wind_gusts_10m'&&lead>90&&lead<=144)return false;
 if(lead===0&&(intervalFields.has(key)||(source.domain==='ncep_gfs013'&&gfsForecastOnly.has(key))||
  (key==='wind_gusts_10m'&&noInitialGust.has(source.domain))||
  (source.domain==='meteofrance_arome_france0025'&&aromeForecastOnly.has(key))))return false;
 return true;
}
export function fieldIntervalHours(meta,key,time){
 if(accumulationHours(key))return accumulationHours(key);
 if(key===THETA_SYMBOLS){const s=fieldSource(compositeMeta(meta),'precipitation',time);return s?precipitationStepHours(s.domain,(Date.parse(time)-Date.parse(s.reference_time))/3600000):null;}
 if(isTypeField(key)){const s=fieldSource(meta,key,time);return s?precipitationStepHours(s.domain,(Date.parse(time)-Date.parse(s.reference_time))/3600000):null;}
 if(key===WEATHER_COMPOSITE)return fieldIntervalHours(compositeMeta(meta),'precipitation',time);
 // Extrema may use 3/6-hour or other reporting periods independent of file cadence.
 // Their OM metadata exposes no time bounds: never invent a duration.
 if(/^temperature_2m_(max|min)$/.test(key))return null;
 const source=fieldSource(meta,key,time),times=source?.valid_times??[],index=times.findIndex(t=>Date.parse(t)===Date.parse(time));
 // Derived snowfall files retain their CF accumulation bounds, including gaps.
 if(key==='snowfall_probability')return source?.intervals?.[times[index]]??null;
 // Some feeds omit initialization from valid_times; use the actual run boundary.
 const previous=index>0?times[index-1]:source?.reference_time;
 const hours=(Date.parse(time)-Date.parse(previous))/3600000;
 return index>=0&&hours>0?hours:null;
}
export function runPath(referenceTime){
 const iso=new Date(referenceTime).toISOString();
 return iso.slice(0,10).replaceAll('-','/')+'/'+iso.slice(11,16).replace(':','')+'Z/';
}
export function combineSources(primary,other=[]){
 const sources=[primary,...other.filter(meta=>Date.parse(meta.reference_time)===Date.parse(primary.reference_time))];
 return {...primary,sources,completed:sources.every(meta=>meta.completed!==false),variables:[...new Set(sources.flatMap(meta=>meta.variables))],valid_times:forecastTimes(sources)};
}
export function fieldSource(meta,key,time){
 if(accumulationHours(key))return accumulationSource(meta,key,time);
 if(key===THETA_SYMBOLS){const selected=compositeMeta(meta);return THETA_SYMBOL_FIELDS.every(field=>fieldSource(selected,field,time))?fieldSource(selected,'wet_bulb_potential_temperature_850hPa',time):null;}
 if(key===WEATHER_COMPOSITE){const selected=compositeMeta(meta);return COMPOSITE_FIELDS.every(field=>fieldSource(selected,field,time))?fieldSource(selected,'precipitation',time):null;}
 return (meta?.sources??(meta?[meta]:[])).find(source=>sourceVariable(source,key)&&(!time||(hasTime(source,time)&&fieldPublishedAt(source,key,time))))??null;
}
export function hasFieldTime(meta,key,time){return !!fieldSource(meta,key,time);}
export function fieldDataURL(meta,key,time){
 const source=fieldSource(meta,key,time);
 if(!source)return null;
 return (source.baseURL??SPATIAL_BASE)+source.domain+'/'+runPath(source.reference_time)+time.slice(0,16).replace(':','')+'.om';
}
async function mogrepsSnow(model,load,reference){
 const base=ownBase+model.snowDomain+'/';
 const meta=await load(base+(reference?runPath(reference)+'meta.json':'latest.json'));
 if(!verifiedSnowMetadata(meta,model)||(reference&&Date.parse(meta.reference_time)!==Date.parse(reference)))throw Error('Unverified snowfall run');
 return {...meta,domain:model.snowDomain,baseURL:ownBase};
}
export async function loadSpatialModel(model,load){
 const domain=domains[model===UKV_NOWCAST?UKV:model];
 if(!domain)throw new Error('Unknown spatial model');
 const baseURL=ownEnsembles.has(domain)?ownBase:SPATIAL_BASE;
 const base=baseURL+domain+'/';
 // in-progress.json advances after EACH uploaded forecast hour. latest.json
 // alone deliberately points to the last fully completed run.
 const results=await Promise.allSettled((ownEnsembles.has(domain)?['latest.json','../health.json']:['latest.json','in-progress.json']).map(path=>load(base+path)));
 const published=results.filter(result=>result.status==='fulfilled').map(result=>result.value);
 if(!published.some(publishedRun))throw results.find(result=>result.status==='rejected')?.reason??new Error('No published model hours yet.');
 const latest=await chooseRun(...published);
 const family=ukvRunFamily(model);
 let primary={...(family?await selectUKVRun(latest,base,load,family):await chooseRun(latest)),domain,baseURL};
 const warnings=[...(primary.selectionWarnings??[])];
 if(domain==='ecmwf_ifs025')warnings.push('IFS 0.25° gusts are unavailable from T+93 to T+144 h in the source feed; those gust steps are omitted. Other fields retain their full timelines.');
 if(results.some(result=>result.status==='rejected'&&result.reason?.status!==404))warnings.push('A live run check failed; using verified published data and retrying automatically.');
 const freshnessWarning=ownEnsembles.has(domain)?ensembleFreshnessWarning(primary,results[1]?.status==='fulfilled'?results[1].value:null):null;
 if(freshnessWarning)warnings.push(freshnessWarning);
 const other=await Promise.all((companions[model]??[]).map(async companion=>{
  try{
   const meta=await load(SPATIAL_BASE+companion+'/'+runPath(primary.reference_time)+'meta.json');
   if(Date.parse(meta.reference_time)!==Date.parse(primary.reference_time)||!publishedRun(meta))throw new Error('Matching companion run is not available');
   return {...meta,domain:companion};
  }catch{
   warnings.push('GFS companion fields could not be loaded for this run. Try Check latest runs.');
   return null;
  }
 }));
 const mogreps=MOGREPS_MODELS.find(item=>item.id===model);
 if(mogreps){
  try{
   const snow=await mogrepsSnow(mogreps,load);
   // Both fields always describe one initialization. While snow processing
   // catches up, obtain precipitation from that precise archived cycle.
   if(Date.parse(snow.reference_time)!==Date.parse(primary.reference_time)){
    const matching=await load(SPATIAL_BASE+domain+'/'+runPath(snow.reference_time)+'meta.json');
    if(!publishedRun(matching)||Date.parse(matching.reference_time)!==Date.parse(snow.reference_time))throw Error('Matching precipitation run unavailable');
    if(Date.parse(primary.reference_time)>Date.parse(snow.reference_time))warnings.push('A newer MOGREPS run is being prepared for snowfall; both charts show the stated verified run.');
    primary={...matching,domain,baseURL:SPATIAL_BASE};
   }
   other.push(snow);
   if(Date.now()-Date.parse(snow.reference_time)>8*3600000)warnings.push('MOGREPS snowfall publication is overdue; check the displayed initialization time.');
  }catch{warnings.push('Member snowfall probabilities are currently unavailable; precipitation probability remains available.');}
 }
 return {...combineSources(primary,other.filter(Boolean)),ensembleNote:MOGREPS_MODELS.find(model=>model.id===domain)?.ensembleNote,sourceWarnings:warnings,freshnessWarning};
}

// Deliberate historical selection never falls back to latest.json or a different
// run family. Any GFS companion is looked up at this exact initialization.
export async function loadSpatialRun(model,referenceTime,load){
 const domain=domains[model===UKV_NOWCAST?UKV:model];
 if(!domain||ownEnsembles.has(domain))throw Error('Archived runs are not supported for this model.');
 const reference=Date.parse(referenceTime);if(!Number.isFinite(reference))throw Error('Invalid archive run time.');
 const family=ukvRunFamily(model);
 if(family&&((new Date(reference).getUTCHours()%3===0?'main':'nowcast')!==family))throw Error('Archived UKV run is in a different run family.');
 const base=SPATIAL_BASE+domain+'/',data=await load(base+runPath(referenceTime)+'meta.json');
 if(model===UKV&&Date.parse(data?.reference_time)===reference&&data.completed!==true&&Array.isArray(data.valid_times)&&!data.valid_times.length)
  throw Object.assign(Error('This archived run has no published hours yet.'),{code:'NO_PUBLISHED_HOURS'});
 if(Date.parse(data?.reference_time)!==reference||!publishedRun(data))throw Error('Archived metadata does not match the requested run.');
 const primary={...data,domain,baseURL:SPATIAL_BASE,runFamily:family},warnings=[];
 const other=await Promise.all((companions[model]??[]).map(async companion=>{
  try{const meta=await load(SPATIAL_BASE+companion+'/'+runPath(referenceTime)+'meta.json');if(Date.parse(meta?.reference_time)!==reference||!publishedRun(meta))throw Error('Matching companion unavailable');return {...meta,domain:companion,baseURL:SPATIAL_BASE};}
  catch{warnings.push('Archived GFS companion fields are unavailable for '+referenceTime+'.');return null;}
 }));
 const mogreps=MOGREPS_MODELS.find(item=>item.id===model);
 if(mogreps){try{other.push(await mogrepsSnow(mogreps,load,referenceTime));}catch{warnings.push('Member snowfall probabilities are unavailable for this archived run.');}}
 return {...combineSources(primary,other.filter(Boolean)),ensembleNote:MOGREPS_MODELS.find(model=>model.id===domain)?.ensembleNote,sourceWarnings:warnings};
}
