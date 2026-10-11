import {chooseRun,hasTime,forecastTimes} from './map-runs.js?v=20261010-latest-cycles';
import {UKV,UKV_NOWCAST,ukvRunFamily,selectUKVRun} from './ukv-run-selection.js?v=20261010-ukv-families';
import {sourceVariable} from './map-catalogue.js?v=20261011-ensemble-statistics';
import {ENSEMBLE_DOMAINS} from './map-ensemble.js?v=20261011-ensemble-statistics';

export const SPATIAL_BASE='https://openmeteo.s3.amazonaws.com/data_spatial/';
const domains={ecmwf_ifs:'ecmwf_ifs',ecmwf_ifs025:'ecmwf_ifs025',ecmwf_aifs025_single:'ecmwf_aifs025_single',icon_global:'dwd_icon',icon_eu:'dwd_icon_eu',gem_global:'cmc_gem_gdps_15km',gfs_global:'ncep_gfs013',ukmo_global_deterministic_10km:'ukmo_global_deterministic_10km',ukmo_uk_deterministic_2km:'ukmo_uk_deterministic_2km',ncep_aigfs025:'ncep_aigfs025',ncep_hgefs025_ensemble_mean:'ncep_hgefs025_ensemble_mean',jma_gsm:'jma_gsm',knmi_harmonie_arome_europe:'knmi_harmonie_arome_europe',meteofrance_arpege_europe:'meteofrance_arpege_europe',meteofrance_arome_france:'meteofrance_arome_france0025'};
// Open-Meteo splits GFS surface and pressure/upper-air fields into two grids.
// Companion data must come from the selected primary run, never a different cycle.
const companions={gfs_global:['ncep_gfs025']};
for(const domain of ['ncep_gefs025','ncep_gefs05','ecmwf_ifs025_ensemble'])domains[domain]=domain;
const ownEnsembles=new Set(ENSEMBLE_DOMAINS.map(d=>d.value));
for(const domain of ownEnsembles)domains[domain]=domain;
const ownBase=new URL('./ensemble-data/',import.meta.url).href;
// Backward sums/averages have no interval at initialization, even when that
// timestamp is in the run-wide metadata: https://github.com/open-meteo/open-data
const intervalFields=new Set(['precipitation','precipitation_probability','rain','showers','snowfall_water_equivalent','shortwave_radiation','direct_radiation','diffuse_radiation']);
export function fieldIntervalHours(meta,key,time){
 const source=fieldSource(meta,key,time),times=source?.valid_times??[],index=times.findIndex(t=>Date.parse(t)===Date.parse(time));
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
 return {...primary,sources,variables:[...new Set(sources.flatMap(meta=>meta.variables))],valid_times:forecastTimes(sources)};
}
export function fieldSource(meta,key,time){
 return (meta?.sources??(meta?[meta]:[])).find(source=>sourceVariable(source,key)&&(!time||(hasTime(source,time)&&!(intervalFields.has(key)&&Date.parse(time)===Date.parse(source.reference_time)))))??null;
}
export function hasFieldTime(meta,key,time){return !!fieldSource(meta,key,time);}
export function fieldDataURL(meta,key,time){
 const source=fieldSource(meta,key,time);
 if(!source)return null;
 return (source.baseURL??SPATIAL_BASE)+source.domain+'/'+runPath(source.reference_time)+time.slice(0,16).replace(':','')+'.om';
}
export async function loadSpatialModel(model,load){
 const domain=domains[model===UKV_NOWCAST?UKV:model];
 if(!domain)throw new Error('Unknown spatial model');
 const baseURL=ownEnsembles.has(domain)?ownBase:SPATIAL_BASE;
 const base=baseURL+domain+'/';
 const latest=await load(base+'latest.json');
 const family=ukvRunFamily(model);
 const primary={...(family?await selectUKVRun(latest,base,load,family):await chooseRun(latest)),domain,baseURL};
 const warnings=[...(primary.selectionWarnings??[])];
 if(ownEnsembles.has(domain)&&Date.now()-Date.parse(primary.reference_time)>36*3600000)warnings.push('Ensemble run is over 36 hours old. A newer complete run is not yet prepared.');
 const other=await Promise.all((companions[model]??[]).map(async companion=>{
  try{
   const meta=await load(SPATIAL_BASE+companion+'/'+runPath(primary.reference_time)+'meta.json');
   if(Date.parse(meta.reference_time)!==Date.parse(primary.reference_time)||!Array.isArray(meta.variables)||!meta.valid_times?.length)throw new Error('Matching companion run is not available');
   return {...meta,domain:companion};
  }catch{
   warnings.push('GFS companion fields could not be loaded for this run. Try Check latest runs.');
   return null;
  }
 }));
 return {...combineSources(primary,other.filter(Boolean)),sourceWarnings:warnings};
}
