import {WET_BULB,wetBulbInputs,winterHours,winterPeriodSource} from './map-winter-registry.js?v=20261024-winter-panel-controls';
import {isPrecipitationRate} from './map-precipitation-rate.js?v=20261018-rates';
import {accumulationHours,accumulationSource} from './map-accumulation.js?v=20261014-interaction-audit';
import {WEATHER_COMPOSITE,COMPOSITE_REQUIRED_FIELDS,compositeMeta} from './map-weather-composite.js?v=20261018-rates';
import {chooseRun,hasTime,forecastTimes,publishedRun} from './map-runs.js?v=20261021-harmonie-pressure';
import {UKV,UKV_NOWCAST,ukvRunFamily,selectUKVRun} from './ukv-run-selection.js?v=20261011-live-runs';
import {sourceVariable} from './map-catalogue.js?v=20261024-ifs-gem-showers1';
import {PRECIPITATION_TYPE,TYPE_KEYS,isTypeField} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {ENSEMBLE_DOMAINS,ensemblePublicationStatus} from './map-ensemble.js?v=20261020-native-levels';
import {ENSEMBLE_EXTRAS,verifiedEnsembleExtra,ensemblePeriod} from './map-ensemble-extra.js?v=20261020-native-levels';
import {MOGREPS_MODELS,verifiedSnowMetadata} from './map-mogreps.js?v=20261014-clean-symbols';
import {MOGREPS_UK,mogrepsUKCycle,selectMogrepsUKRun} from './mogreps-run-selection.js?v=20261022-three-hour-runs';
import {MOGREPS_GLOBAL,verifiedMogrepsGlobal,MOGREPS_GLOBAL_NOTE} from './map-mogreps-global.js?v=20261020-native-levels';

import {THETA_SYMBOLS,PRECIP_SYMBOLS,canPrecipSymbols,THETA_SYMBOL_FIELDS} from './map-winter.js?v=20261024-ifs-gem-showers1';
import {precipitationStepHours,precipitationExistsAt} from './map-accumulation.js?v=20261014-interaction-audit';
import {DIRECT_VERTICAL_MODELS,verifiedDirectVertical} from './map-direct-vertical.js?v=20261020-native-levels';
import {UKMO_NATIVE,UKMO_EARLY,verifiedUKMOEarly,completedSources,UKMO_EARLY_NOTE} from './map-ukmo-early.js?v=20261021-early';
import {withHarmoniePressure} from './map-harmonie-pressure.js?v=20261021-pressure';
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
export const COMPANION_BASE='https://matthewhugo81-arch.github.io/snowline-ensembles/ensemble-data/';
const generatedBase=domain=>domain===MOGREPS_GLOBAL?COMPANION_BASE:ownBase;
const historyBases=new Map();
export function ensembleHistoryURL(model){
 if(!ownEnsembles.has(model))throw Error('Unknown statistical ensemble model');
 return (historyBases.get(model)??generatedBase(model))+model+'/history.json';
}
// Backward sums/averages have no interval at initialization, even when that
// timestamp is in the run-wide metadata: https://github.com/open-meteo/open-data
const intervalFields=new Set([...TYPE_KEYS,'temperature_2m_max','temperature_2m_min','precipitation','precipitation_probability','snowfall_probability','rain','showers','hail','categorical_freezing_rain','snowfall_water_equivalent','shortwave_radiation','direct_radiation','diffuse_radiation']);
// GFS 0.13° omits these fields at analysis time, although run-wide metadata lists
// them. Verified against the provider's Gfs013DownloadSurfaceVariable.skipHour0:
// https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Gfs/GfsVariableDownloadable.swift
const gfsForecastOnly=new Set(['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','uv_index','uv_index_clear_sky']);
const noInitialGust=new Set(['ecmwf_ifs','ecmwf_ifs025','dwd_icon','dwd_icon_eu','meteofrance_arpege_europe','meteofrance_arome_france0025']);
const aromeForecastOnly=new Set(['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high']);
function fieldPublishedAt(source,key,time){
 if(key==='pressure_msl'&&source.variables?.includes('pressure_msl_mean')&&!source.variables.includes(key))key='pressure_msl_mean';
 if(source.variable_valid_times){const times=source.variable_valid_times[key];return Array.isArray(times)&&times.some(t=>Date.parse(t)===Date.parse(time));}
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
 if(winterHours(key))return winterHours(key);
 if(key==='hail')return 1;
 const period=ensemblePeriod(meta,key,time);if(period)return period.hours;
 if(accumulationHours(key))return accumulationHours(key);
 if(key===THETA_SYMBOLS||key===PRECIP_SYMBOLS){const s=fieldSource(compositeMeta(meta),'precipitation',time);return s?precipitationStepHours(s.domain,(Date.parse(time)-Date.parse(s.reference_time))/3600000):null;}
 if(isTypeField(key)){const s=fieldSource(meta,key,time);return s?precipitationStepHours(s.domain,(Date.parse(time)-Date.parse(s.reference_time))/3600000):null;}
 if(key===WEATHER_COMPOSITE)return fieldIntervalHours(compositeMeta(meta),'precipitation',time);
 if(isPrecipitationRate(key)){const s=fieldSource(meta,key,time);return s?precipitationStepHours(s.domain,(Date.parse(time)-Date.parse(s.reference_time))/3600000):null;}
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
 return {...primary,sources,completed:completedSources(sources),variables:[...new Set(sources.flatMap(meta=>meta.variables))],valid_times:forecastTimes(sources)};
}
export function fieldSource(meta,key,time){
 if(winterHours(key))return winterPeriodSource(meta,key,time);
 if(key===WET_BULB)return (meta?.sources??(meta?[meta]:[])).find(source=>wetBulbInputs(source)&&(!time||(hasTime(source,time)&&wetBulbInputs(source).every(input=>fieldPublishedAt(source,input,time)))))??null;
 if(accumulationHours(key))return accumulationSource(meta,key,time);
 if(key===PRECIP_SYMBOLS)return (meta?.sources??(meta?[meta]:[])).find(s=>canPrecipSymbols(s)&&(!time||(hasTime(s,time)&&fieldPublishedAt(s,'precipitation',time))))??null;
 if(key===THETA_SYMBOLS){const selected=compositeMeta(meta);return THETA_SYMBOL_FIELDS.every(field=>fieldSource(selected,field,time))?fieldSource(selected,'wet_bulb_potential_temperature_850hPa',time):null;}
 if(key===WEATHER_COMPOSITE){const selected=compositeMeta(meta);return COMPOSITE_REQUIRED_FIELDS.every(field=>fieldSource(selected,field,time))?fieldSource(selected,'precipitation',time):null;}
 return (meta?.sources??(meta?[meta]:[])).find(source=>sourceVariable(source,key)&&(!time||(hasTime(source,time)&&fieldPublishedAt(source,key,time))))??null;
}
export function hasFieldTime(meta,key,time){return !!fieldSource(meta,key,time);}
export function fieldDataURL(meta,key,time){
 const source=fieldSource(meta,key,time);
 if(!source)return null;
 return (source.baseURL??SPATIAL_BASE)+source.domain+'/'+runPath(source.reference_time)+time.slice(0,16).replace(':','')+'.om';
}
async function directVertical(model,reference,load,domain=DIRECT_VERTICAL_MODELS[model]){
 const baseURL=domain==='snowline_gem_upper'?COMPANION_BASE:ownBase;
 const meta=await load(baseURL+domain+'/'+runPath(reference)+'meta.json');
 if(!verifiedDirectVertical(meta,domain)||Date.parse(meta.reference_time)!==Date.parse(reference))throw Error('Unverified direct 700 hPa run');
 return {...meta,domain,baseURL};
}
async function ukmoEarly(load,reference){
 const meta=await load(COMPANION_BASE+UKMO_EARLY+'/'+(reference?runPath(reference)+'meta.json':'latest.json'));
 if(!verifiedUKMOEarly(meta,reference))throw Error('Unverified UKMO early source');
 return {...meta,baseURL:COMPANION_BASE,sourceWarnings:[UKMO_EARLY_NOTE]};
}
async function ensembleExtra(model,reference,load){
 const domain=ENSEMBLE_EXTRAS[model];
 let failure;
 for(const baseURL of [ownBase,COMPANION_BASE]){
  try{
   const meta=await load(baseURL+domain+'/'+runPath(reference)+'meta.json');
   if(!verifiedEnsembleExtra(meta,domain,reference))throw Error('Unverified additional ensemble fields');
   return {...meta,domain,baseURL};
  }catch(error){failure=error;}
 }
 throw failure;
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
 let baseURL=ownEnsembles.has(domain)?generatedBase(domain):SPATIAL_BASE;
 let base=baseURL+domain+'/';
 // in-progress.json advances after EACH uploaded forecast hour. latest.json
 // alone deliberately points to the last fully completed run.
 const results=await Promise.allSettled((ownEnsembles.has(domain)?['latest.json','../health.json']:['latest.json','in-progress.json']).map(path=>load(path==='../health.json'?ownBase+'health.json':base+path)));
 const published=results.filter(result=>result.status==='fulfilled').map(result=>result.value);
 let early=null;
 if(domain===UKMO_NATIVE){try{early=await ukmoEarly(load);}catch{/* The independent full feed remains usable. */}}
 let companionFallback=false;
 if(domain===MOGREPS_GLOBAL&&!published.some(publishedRun)){
  const retained=await load(ownBase+domain+'/latest.json');
  if(publishedRun(retained)){
   published.push(retained);baseURL=ownBase;base=baseURL+domain+'/';companionFallback=true;
  }
 }
 if(!published.some(publishedRun)&&!early)throw results.find(result=>result.status==='rejected')?.reason??new Error('No published model hours yet.');
 const latest=published.some(publishedRun)?await chooseRun(...published):early;
 const family=ukvRunFamily(model);
 let primary=latest===early?early:{...(family?await selectUKVRun(latest,base,load,family):model===MOGREPS_UK?await selectMogrepsUKRun(latest,base,load,published):await chooseRun(latest)),domain,baseURL};
 if(early&&Date.parse(early.reference_time)>Date.parse(primary.reference_time))primary=early;
 if(domain===MOGREPS_GLOBAL&&!verifiedMogrepsGlobal(primary))throw Error('Unverified MOGREPS-G run metadata.');
 if(domain===MOGREPS_GLOBAL)historyBases.set(domain,baseURL);
 const warnings=[...(primary.selectionWarnings??[])];
 if(early&&Date.parse(early.reference_time)===Date.parse(primary.reference_time))warnings.push(UKMO_EARLY_NOTE);
 if(companionFallback)warnings.push('The companion publication is being prepared or is temporarily unavailable; showing the retained MOGREPS-G run with its original timestamp.');
 if(domain===MOGREPS_GLOBAL&&(primary.variable_valid_times?.geopotential_height_500hPa_anomaly_mean?.length??0)<primary.valid_times.length)warnings.push('Additional MOGREPS-G comparison layers are being prepared. Each layer shows only its published forecast hours.');
 if(domain==='ecmwf_ifs025')warnings.push('IFS 0.25° gusts are unavailable from T+93 to T+144 h in the source feed; those gust steps are omitted. Other fields retain their full timelines.');
 if(results.some(result=>result.status==='rejected'&&result.reason?.status!==404))warnings.push('A live run check failed; using verified published data and retrying automatically.');
 const publicationStatus=ownEnsembles.has(domain)?ensemblePublicationStatus(primary,results[1]?.status==='fulfilled'?results[1].value:null):null;
 const freshnessWarning=publicationStatus?.message??null;
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
 if(early&&primary.domain!==UKMO_EARLY&&Date.parse(early.reference_time)===Date.parse(primary.reference_time))other.push(early);
 if(ENSEMBLE_EXTRAS[model]){
  try{const extra=await ensembleExtra(model,primary.reference_time,load);other.push(extra);if(!extra.completed)warnings.push('Additional ensemble fields are still being prepared for this run. Each layer shows only its verified forecast hours.');}
  catch{warnings.push('Additional ensemble fields are not yet available for this run; the published mean and spread charts remain available.');}
 }
 if(model==='gem_global'){
  try{other.push(await directVertical(model,primary.reference_time,load,'snowline_gem_upper'));}
  catch{warnings.push('Additional GEM upper-air fields are being prepared for this run. Check latest runs to retry.');}
 }
 if(DIRECT_VERTICAL_MODELS[model]){
  try{other.push(await directVertical(model,primary.reference_time,load));}
  catch{warnings.push('Direct 700 hPa charts are not yet available for this run; other fields remain available. Check latest runs to retry.');}
 }
 const mogreps=MOGREPS_MODELS.find(item=>item.id===model);
 if(mogreps){
  try{
   // Publish new precipitation immediately. Snow is looked up for precisely
   // that initialization; an older snow index must never rewind the native run.
   const snow=await mogrepsSnow(mogreps,load,primary.reference_time);
   other.push(snow);
   if(Date.now()-Date.parse(snow.reference_time)>8*3600000)warnings.push('MOGREPS snowfall publication is overdue; check the displayed initialization time.');
  }catch{
   // Keep the complete previous rain/snow run as the default until both fields
   // of this initialization are ready, but expose the incoming rain in Run.
   primary={...primary,completed:false};
   warnings.push('Member snowfall probabilities are being prepared for this initialization; incoming precipitation probability is available.');
  }
 }
 const completedReferenceTime=published.filter(m=>publishedRun(m)&&m.completed===true&&(model!==MOGREPS_UK||mogrepsUKCycle(m.reference_time))).sort((a,b)=>Date.parse(b.reference_time)-Date.parse(a.reference_time))[0]?.reference_time;
 return withHarmoniePressure({...combineSources(primary,other.filter(Boolean)),completedReferenceTime,ensembleNote:domain===MOGREPS_GLOBAL?MOGREPS_GLOBAL_NOTE:MOGREPS_MODELS.find(model=>model.id===domain)?.ensembleNote,sourceWarnings:warnings,freshnessWarning,publicationStatus},load);
}

// Deliberate historical selection never falls back to latest.json or a different
// run family. Any GFS companion is looked up at this exact initialization.
export async function loadSpatialRun(model,referenceTime,load){
 const domain=domains[model===UKV_NOWCAST?UKV:model];
 if(!domain)throw Error('Archived runs are not supported for this model.');
 const reference=Date.parse(referenceTime);if(!Number.isFinite(reference))throw Error('Invalid archive run time.');
 if(model===MOGREPS_UK&&!mogrepsUKCycle(referenceTime))throw Error('MOGREPS-UK charts use 00, 03, 06, 09, 12, 15, 18 and 21 UTC runs. Select a three-hourly run.');
 const family=ukvRunFamily(model);
 if(family&&((new Date(reference).getUTCHours()%3===0?'main':'nowcast')!==family))throw Error('Archived UKV run is in a different run family.');
 let baseURL=ownEnsembles.has(domain)?generatedBase(domain):SPATIAL_BASE;
 let data;
 try{data=await load(baseURL+domain+'/'+runPath(referenceTime)+'meta.json');}
 catch(error){
  if(domain===UKMO_NATIVE){return combineSources(await ukmoEarly(load,referenceTime));}
  if(domain!==MOGREPS_GLOBAL)throw error;
  baseURL=ownBase;data=await load(baseURL+domain+'/'+runPath(referenceTime)+'meta.json');
 }
 if(Date.parse(data?.reference_time)===reference&&data.completed!==true&&Array.isArray(data.valid_times)&&!data.valid_times.length)
  {if(domain===UKMO_NATIVE)return combineSources(await ukmoEarly(load,referenceTime));
   throw Object.assign(Error('This archived run has no published hours yet.'),{code:'NO_PUBLISHED_HOURS'});}
 if(Date.parse(data?.reference_time)!==reference||!publishedRun(data))throw Error('Archived metadata does not match the requested run.');
 if(domain===MOGREPS_GLOBAL&&!verifiedMogrepsGlobal(data))throw Error('Unverified MOGREPS-G archive.');
 if(data.archive_base){
  if(!['snowline_ecmwf_ensemble','snowline_gefs_ensemble'].includes(domain)||!/^https:\/\/raw\.githubusercontent\.com\/matthewhugo81-arch\/snowline\/[a-f0-9]{40}\/ensemble-data\/$/.test(data.archive_base))throw Error('Unverified archive storage location');
  baseURL=data.archive_base;
 }
 let primary={...data,domain,baseURL,runFamily:family};const warnings=[];
 const other=await Promise.all((companions[model]??[]).map(async companion=>{
  try{const meta=await load(SPATIAL_BASE+companion+'/'+runPath(referenceTime)+'meta.json');if(Date.parse(meta?.reference_time)!==reference||!publishedRun(meta))throw Error('Matching companion unavailable');return {...meta,domain:companion,baseURL:SPATIAL_BASE};}
  catch{warnings.push('Archived GFS companion fields are unavailable for '+referenceTime+'.');return null;}
 }));
 if(domain===UKMO_NATIVE){
  try{other.push(await ukmoEarly(load,referenceTime));warnings.push(UKMO_EARLY_NOTE);}catch{/* Optional exact-run early cache. */}
 }
 if(ENSEMBLE_EXTRAS[model]){
  try{other.push(await ensembleExtra(model,primary.reference_time,load));}
  catch{warnings.push('Additional ensemble fields have not been retained for this run. The original mean and spread layers remain available.');}
 }
 if(model==='gem_global'){
  try{other.push(await directVertical(model,primary.reference_time,load,'snowline_gem_upper'));}
  catch{warnings.push('Additional GEM upper-air fields are being prepared for this run. Check latest runs to retry.');}
 }
 if(DIRECT_VERTICAL_MODELS[model]){
  try{other.push(await directVertical(model,primary.reference_time,load));}
  catch{warnings.push('Direct 700 hPa charts are not yet available for this run; other fields remain available. Check latest runs to retry.');}
 }
 const mogreps=MOGREPS_MODELS.find(item=>item.id===model);
 if(mogreps){try{other.push(await mogrepsSnow(mogreps,load,referenceTime));}catch{primary={...primary,completed:false};warnings.push('Member snowfall probabilities are unavailable for this archived run.');}}
 return withHarmoniePressure({...combineSources(primary,other.filter(Boolean)),ensembleNote:domain===MOGREPS_GLOBAL?MOGREPS_GLOBAL_NOTE:MOGREPS_MODELS.find(model=>model.id===domain)?.ensembleNote,sourceWarnings:warnings},load);
}
