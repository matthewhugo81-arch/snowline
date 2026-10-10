import {chooseRun,hasTime,forecastTimes} from './map-runs.js?v=20261010-valid-frames';
import {sourceVariable} from './map-catalogue.js?v=20261009-white-rain';

export const SPATIAL_BASE='https://openmeteo.s3.amazonaws.com/data_spatial/';
const domains={ecmwf_ifs:'ecmwf_ifs',ecmwf_ifs025:'ecmwf_ifs025',ecmwf_aifs025_single:'ecmwf_aifs025_single',icon_global:'dwd_icon',icon_eu:'dwd_icon_eu',gem_global:'cmc_gem_gdps_15km',gfs_global:'ncep_gfs013',ukmo_global_deterministic_10km:'ukmo_global_deterministic_10km',ukmo_uk_deterministic_2km:'ukmo_uk_deterministic_2km',ncep_aigfs025:'ncep_aigfs025',ncep_hgefs025_ensemble_mean:'ncep_hgefs025_ensemble_mean',jma_gsm:'jma_gsm',knmi_harmonie_arome_europe:'knmi_harmonie_arome_europe',meteofrance_arpege_europe:'meteofrance_arpege_europe',meteofrance_arome_france:'meteofrance_arome_france0025'};
// Open-Meteo splits GFS surface and pressure/upper-air fields into two grids.
// Companion data must come from the selected primary run, never a different cycle.
const companions={gfs_global:['ncep_gfs025']};
export function runPath(referenceTime){
 const iso=new Date(referenceTime).toISOString();
 return iso.slice(0,10).replaceAll('-','/')+'/'+iso.slice(11,16).replace(':','')+'Z/';
}
export function combineSources(primary,other=[]){
 const sources=[primary,...other.filter(meta=>Date.parse(meta.reference_time)===Date.parse(primary.reference_time))];
 return {...primary,sources,variables:[...new Set(sources.flatMap(meta=>meta.variables))],valid_times:forecastTimes(sources)};
}
export function fieldSource(meta,key,time){
 return (meta?.sources??(meta?[meta]:[])).find(source=>sourceVariable(source,key)&&(!time||hasTime(source,time)))??null;
}
export function hasFieldTime(meta,key,time){return !!fieldSource(meta,key,time);}
export function fieldDataURL(meta,key,time){
 const source=fieldSource(meta,key,time);
 if(!source)return null;
 return SPATIAL_BASE+source.domain+'/'+runPath(source.reference_time)+time.slice(0,16).replace(':','')+'.om';
}
export async function loadSpatialModel(model,load,mode='extended'){
 const domain=domains[model];
 if(!domain)throw new Error('Unknown spatial model');
 const base=SPATIAL_BASE+domain+'/';
 const latest=await load(base+'latest.json');
 const primary={...await chooseRun(latest,base,load,mode),domain};
 const warnings=[];
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
