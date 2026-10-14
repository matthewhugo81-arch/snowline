// Native spatial precipitation amounts, not rendered colours or point-API totals.
// Verified against Open-Meteo's spatial writer, model downloaders and live feeds.
export const ACCUMULATION_HOURS = Object.freeze([6,12,18,24,36,48,72,120]);
export const accumulationKey = hours => 'precipitation_total_'+hours+'h';
export const ACCUMULATION_KEYS = ACCUMULATION_HOURS.map(accumulationKey);
export function accumulationHours(key) {
 const hours=Number(/^precipitation_total_(\d+)h$/.exec(key)?.[1]);
 return ACCUMULATION_HOURS.includes(hours)?hours:null;
}
export const ACCUMULATION_SCALE = {
 stops:[0,.2,1,2,5,10,15,20,30,40,50,75,100,150,200,300,500],
 colors:['#ffffff','#d5e9ff','#91c5f4','#4f96dd','#2162b5','#254397','#21835b','#54a64b','#a5bd45','#d5c749','#edb349','#e48735','#cc502e','#ad2738','#842765','#633174','#3d214f'],bands:true
};
export function accumulationField(key) {
 const hours=accumulationHours(key);if(!hours)return null;
 return {key,name:hours+' h precipitation total',group:'Accumulated precipitation',unit:'mm water',...ACCUMULATION_SCALE,
  contourValues:[1,5,10,20,30,50,75,100,150,200,300,500],contourLabel:'accumulation thresholds',
  note:'Rolling '+hours+'-hour total ending at the valid time: liquid plus frozen water equivalent, from one model run. All native intervals must be present. Missing cells remain missing. White: below 0.2 mm; not necessarily zero. Only nearby totals are prepared in the background.'};
}
const HOUR=3600000;
// NOAA AI/HGEFS spatial files advertise precipitation run-wide, but their
// first T+6 file omits it. The provider skips the initial 0–6 h message.
// Verified against native OM children and GfsGraphCastDownload.swift.
export const precipitationExistsAt=(domain,lead)=>!['ncep_aigfs025','ncep_hgefs025_ensemble_mean'].includes(domain)||lead>6;
// These are precipitation intervals, not the user's playback interval. Unknown
// or changed cadences fail closed instead of interpreting a missing hour as 3 h.
export function precipitationStepHours(domain,lead) {
 if(!(lead>0&&precipitationExistsAt(domain,lead)&&Number.isInteger(lead)))return null;
 switch(domain){
  case 'ukmo_uk_deterministic_2km':case 'knmi_harmonie_arome_europe':
  case 'meteofrance_arpege_europe':case 'meteofrance_arome_france0025':return 1;
  case 'ecmwf_ifs':return lead<=90?1:lead<=144?3:6;
  case 'ecmwf_ifs025':return lead<=144?3:6;
  case 'ukmo_global_deterministic_10km':return lead<=54?1:lead<=144?3:6;
  case 'ncep_gfs013':return lead<=120?1:3;
  case 'dwd_icon':case 'dwd_icon_eu':return lead<=78?1:3;
  case 'cmc_gem_gdps_15km':return lead<=84?1:3;
  case 'ecmwf_aifs025_single':case 'ncep_aigfs025':
  case 'ncep_hgefs025_ensemble_mean':case 'jma_gsm':return 6;
  default:return null;
 }
}
export function accumulationSlots(domain,reference,end,hours) {
 const init=Date.parse(reference),finish=Date.parse(end),begin=finish-hours*HOUR;
 if(!ACCUMULATION_HOURS.includes(hours)||!Number.isFinite(init+finish)||begin<init)return null;
 const times=[];let cursor=finish;
 while(cursor>begin){
  const lead=(cursor-init)/HOUR,step=precipitationStepHours(domain,lead);
  if(!step||lead%step!==0||cursor-step*HOUR<begin)return null;
  times.push(new Date(cursor).toISOString());cursor-=step*HOUR;
 }
 return times.length&&cursor===begin?times.reverse():null;
}
const indexes=new WeakMap(),plans=new WeakMap();
function sourceIndex(source){
 if(!indexes.has(source))indexes.set(source,new Set((source.valid_times??[]).map(Date.parse).filter(Number.isFinite)));
 return indexes.get(source);
}
function planForSource(source,key,end){
 if(!source?.variables?.includes('precipitation'))return null;
 const hours=accumulationHours(key);if(!hours)return null;
 let cache=plans.get(source);if(!cache){cache=new Map();plans.set(source,cache);}
 const cacheKey=key+'|'+end;if(cache.has(cacheKey))return cache.get(cacheKey);
 const slots=accumulationSlots(source.domain,source.reference_time,end,hours),available=sourceIndex(source);
 const result=slots?.every(time=>available.has(Date.parse(time)))?{source,hours,start:new Date(Date.parse(end)-hours*HOUR).toISOString(),end:new Date(end).toISOString(),times:slots}:null;
 cache.set(cacheKey,result);return result;
}
export function accumulationPlan(meta,key,end){
 if(!meta||!accumulationHours(key))return null;
 for(const source of meta.sources??[meta]){
  if(Date.parse(source.reference_time)!==Date.parse(meta.reference_time))continue;
  const plan=planForSource(source,key,end);if(plan)return plan;
 }
 return null;
}
export function accumulationSource(meta,key,end){
 if(end)return accumulationPlan(meta,key,end)?.source??null;
 for(const time of meta?.valid_times??[]){const plan=accumulationPlan(meta,key,time);if(plan)return plan.source;}
 return null;
}
const stamp=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
export function accumulationPeriod(key,end){
 const hours=accumulationHours(key),time=Date.parse(end);if(!hours||!Number.isFinite(time))return '';
 return hours+' h · '+stamp.format(new Date(time-hours*HOUR))+' → '+stamp.format(new Date(time))+' UTC';
}
