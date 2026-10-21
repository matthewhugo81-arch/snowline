import {precipitationStepHours} from './map-accumulation.js?v=20261014-interaction-audit';
// Retain the original key for existing UKV links.
export const PRECIPITATION_TYPE='ukv_precipitation_type';
export const NATIVE_PRECIPITATION_TYPE='native_precipitation_type_intensity';
export const TYPE_KEYS=[PRECIPITATION_TYPE,NATIVE_PRECIPITATION_TYPE];
export const PRECIPITATION_TYPE_SOURCE=PRECIPITATION_TYPE+'_derived';
export const NATIVE_TYPE_SOURCE=NATIVE_PRECIPITATION_TYPE+'_derived';
export const TYPE_INPUTS=['precipitation','rain','snowfall_water_equivalent'];
export const RATE_LABELS=['0.1–<0.5','0.5–<2','2–<5','5+'];
export const TYPE_NAMES=['Rain','Sleet / mix','Snow','Other / unresolved','Freezing rain / drizzle','Ice pellets'];
export const TYPE_PALETTES=[['#a8d3ff','#5298ec','#185bc7','#103784'],['#b2e6b0','#64c677','#259745','#10622c'],['#f7bddd','#ec7bb7','#d3388c','#951257'],['#cdd0d4','#a2a8b0','#727b88','#485365'],['#d1b3f2','#ae79df','#8647bd','#562477'],['#ffe3aa','#efbd58','#c5891c','#8d5c08']];
const amountDomains=new Set(['ecmwf_ifs','ecmwf_aifs025_single','dwd_icon','dwd_icon_eu','cmc_gem_gdps_15km','ncep_gfs013','ukmo_uk_deterministic_2km','knmi_harmonie_arome_europe','meteofrance_arpege_europe','meteofrance_arome_france0025']);
export const isTypeField=key=>TYPE_KEYS.includes(key);
export function typeMethod(meta){
 const vars=meta?.variables??[];if(!vars.includes('precipitation'))return null;
 if(meta.domain==='ecmwf_ifs025'&&vars.includes('precipitation_type'))return 'native';
 if(amountDomains.has(meta.domain)&&vars.includes('snowfall_water_equivalent'))return 'estimated';
 return null;
}
export const canDerivePrecipitationType=meta=>typeMethod(meta)==='estimated';
export const typeInputs=method=>method==='native'?['precipitation','precipitation_type']:['precipitation','snowfall_water_equivalent'];
export function nativeCategory(code){return ({1:1,3:5,5:3,6:3,7:2,8:6,12:5})[code]??(Number.isFinite(code)?4:NaN);}
export function precipitationCategory(total,rain,snow){
 if(![total,rain,snow].every(Number.isFinite)||Math.min(total,rain,snow)<0)return NaN;
 if(total<.1)return 0;const sum=rain+snow;if(sum<.1)return 4;
 const fraction=snow/sum;return fraction<=.1+1e-7?1:fraction>=.9-1e-7?3:2;
}
export function estimatedCategory(total,snow){
 if(!Number.isFinite(total)||!Number.isFinite(snow)||total<0||snow<0)return NaN;
 if(total===0)return snow===0?0:4;
 if(snow>total+Math.max(.1,total*.02))return 4;
 const fraction=snow/total;return fraction<=.1+1e-7?1:fraction>=.9-1e-7?3:2;
}
export function rateBand(rate){return rate<.1?-1:rate<.5?0:rate<2?1:rate<5?2:3;}
export function intensityCode(category,total,hours){
 if(!Number.isFinite(category)||!Number.isFinite(total)||total<0||!(hours>0))return NaN;
 const band=rateBand(total/hours);if(band<0)return 0;
 return 1+((category||4)-1)*4+band;
}
export const TYPE_LABELS=['Below 0.1 mm/h',...TYPE_NAMES.flatMap(name=>RATE_LABELS.map(rate=>name+' · '+rate+' mm/h water equivalent'))];
export const TYPE_NOTE='Shades show interval-average total precipitation in mm/h water equivalent: 0.1–<0.5, 0.5–<2, 2–<5 and 5+. Below 0.1 mm/h is unshaded. These are display bands, not official rain/snow intensity classifications or snowfall depth. Native cells are not smoothed.';
export const ESTIMATE_NOTE='Type estimated from native total precipitation and snowfall water equivalent in the same grid, run and interval: snow fraction at most 10% = rain, at least 90% = snow, otherwise sleet / mix. An interval mixture can mean a change of phase rather than simultaneous sleet. Freezing rain and hail cannot be diagnosed by this estimate. Missing inputs remain missing; inconsistent amounts are grey.';
export const NATIVE_NOTE='Native ECMWF precipitation type at the valid time, paired with total precipitation averaged over the preceding model interval. The instantaneous type does not establish the phase throughout that interval. Wet snow uses the snow palette; freezing rain/drizzle is purple and ice pellets amber. Wet intervals with no resolved valid-time type are grey.';
export function precipitationTypeField(key=PRECIPITATION_TYPE){return {
 key,name:'Precipitation type & intensity · '+(key===NATIVE_PRECIPITATION_TYPE?'native':'estimated'),group:'Winter Analysis',unit:'type',
 categorical:true,bands:true,stops:Array.from({length:25},(_,i)=>i),colors:['#ffffff00',...TYPE_PALETTES.flat()],categoryLabels:TYPE_LABELS,
 legendNote:TYPE_NOTE,note:TYPE_NOTE+' '+(key===NATIVE_PRECIPITATION_TYPE?NATIVE_NOTE:ESTIMATE_NOTE)
};}
export function precipitationTypeScales(native=false){return TYPE_PALETTES.slice(0,native?6:4).map((colors,i)=>({name:TYPE_NAMES[i]+' · mm/h water equivalent',colors:[...colors],labels:RATE_LABELS,bands:true,note:i===0?'Interval-average rate · below 0.1 mm/h unshaded · '+(native?'native valid-time type':'estimated interval type'):''}));}
export function precipitationTypeValues(total,phase,hours,method='estimated'){
 if(total.length!==phase.length)throw Error('Precipitation-type input grids do not match.');
 const values=new Float32Array(new total.buffer.constructor(total.byteLength));
 for(let i=0;i<values.length;i++)values[i]=intensityCode(method==='native'?nativeCategory(phase[i]):estimatedCategory(total[i],phase[i]),total[i],hours);
 return {values,directions:undefined,scaleFactor:1};
}
export function precipitationFileInfo(url){
 const path=new URL(url).pathname;
 const match=path.match(/\/(?:data_spatial|ensemble-data)\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})(\d{2})Z\/(\d{4}-\d{2}-\d{2}T\d{2})(\d{2})\.om$/);
 if(!match)throw Error('Unrecognized precipitation file time.');
 const [,domain,y,m,d,h,min,valid,vm]=match,reference=`${y}-${m}-${d}T${h}:${min}:00Z`,time=valid+':'+vm+':00Z';
 if(path.includes('/ensemble-data/')&&domain!=='snowline_ukmo_early')throw Error('Unsupported precipitation source.');
 const lead=(Date.parse(time)-Date.parse(reference))/3600000,hours=precipitationStepHours(domain,lead);
 if(!hours||lead%hours)throw Error('Unknown native precipitation interval.');
 return {domain,hours,reference,time};
}
const installed=new WeakSet();
export function installPrecipitationType(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader;if(installed.has(reader))return;installed.add(reader);
 const read=reader.readVariable.bind(reader),prefetch=reader.prefetchVariable?.bind(reader);
 const selected=(url,key)=>{
  if(![PRECIPITATION_TYPE_SOURCE,NATIVE_TYPE_SOURCE].includes(key))return null;
  const info=precipitationFileInfo(url),method=key===NATIVE_TYPE_SOURCE?'native':'estimated';
  if(method==='native'?info.domain!=='ecmwf_ifs025':!amountDomains.has(info.domain))throw Error('Unsupported precipitation-type source.');
  return {...info,method};
 };
 reader.readVariable=async(url,key,ranges=null,signal)=>{
  const spec=selected(url,key);if(!spec)return read(url,key,ranges,signal);
  const inputs=[];for(const variable of typeInputs(spec.method)){signal?.throwIfAborted();inputs.push((await read(url,variable,ranges,signal)).values);}
  signal?.throwIfAborted();return precipitationTypeValues(...inputs,spec.hours,spec.method);
 };
 reader.prefetchVariable=async(url,key,ranges=null,signal)=>{
  const spec=selected(url,key);if(!spec)return prefetch?.(url,key,ranges,signal);
  for(const variable of typeInputs(spec.method)){signal?.throwIfAborted();await prefetch?.(url,variable,ranges,signal);}
 };
}
