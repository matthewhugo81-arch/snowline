// UKV interval amounts on one native grid, initialization and valid time.
// Categories are an estimate, not a supplied UKV weather-type diagnosis.
export const PRECIPITATION_TYPE='ukv_precipitation_type';
export const PRECIPITATION_TYPE_SOURCE=PRECIPITATION_TYPE+'_derived';
export const TYPE_INPUTS=['precipitation','rain','snowfall_water_equivalent'];
export const TYPE_LABELS=['Below 0.1 mm','Rain','Sleet / mix','Snow','Other / unresolved'];
export function canDerivePrecipitationType(meta){
 return meta?.domain==='ukmo_uk_deterministic_2km'&&TYPE_INPUTS.every(key=>meta.variables?.includes(key));
}
export function precipitationCategory(total,rain,snow){
 if(![total,rain,snow].every(Number.isFinite)||Math.min(total,rain,snow)<0)return NaN;
 if(total<.1)return 0;
 const sum=rain+snow;if(sum<.1)return 4;
 const fraction=snow/sum;return fraction<=.1?1:fraction>=.9?3:2;
}
export function precipitationTypeField(){return {
 key:PRECIPITATION_TYPE,name:'Precipitation type · estimated',group:'Winter Analysis',unit:'type',
 categorical:true,bands:true,stops:[0,1,2,3,4],colors:['#ffffff00','#1663d6','#1cab50','#ea51aa','#737985'],categoryLabels:TYPE_LABELS,
 legendNote:'Estimated from native rain and snow amounts; below 0.1 mm unshaded.',
 note:'UKV precipitation-type estimate from total precipitation, rain and snowfall water equivalent on the same grid, run and native interval. Blue = rain; green = sleet / rain–snow mix; pink = snow. Below 0.1 mm total is unshaded. Snow fraction of rain + snow water: at most 10% = rain; at least 90% = snow; between = estimated mix. Grey = precipitation whose type cannot be resolved from those amounts. Missing inputs remain missing. A mixture across the interval can mean rain changing to snow, rather than simultaneous sleet. This estimate does not distinguish freezing rain or hail and does not predict lying-snow depth.'
};}
export function precipitationTypeValues(total,rain,snow){
 if(total.length!==rain.length||total.length!==snow.length)throw Error('Precipitation-type input grids do not match.');
 const values=new Float32Array(new total.buffer.constructor(total.byteLength));
 for(let i=0;i<values.length;i++)values[i]=precipitationCategory(total[i],rain[i],snow[i]);
 return {values,directions:undefined,scaleFactor:1};
}
const installed=new WeakSet();
export function installPrecipitationType(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader;if(installed.has(reader))return;installed.add(reader);
 const read=reader.readVariable.bind(reader),prefetch=reader.prefetchVariable?.bind(reader);
 const selected=(url,key)=>{
  if(key!==PRECIPITATION_TYPE_SOURCE)return false;
  if(!new URL(url).pathname.includes('/ukmo_uk_deterministic_2km/'))throw Error('Precipitation-type estimate is only supported for UKV.');
  return true;
 };
 reader.readVariable=async(url,key,ranges=null,signal)=>{
  if(!selected(url,key))return read(url,key,ranges,signal);
  const inputs=[];
  for(const variable of TYPE_INPUTS){signal?.throwIfAborted();inputs.push((await read(url,variable,ranges,signal)).values);}
  signal?.throwIfAborted();return precipitationTypeValues(...inputs);
 };
 reader.prefetchVariable=async(url,key,ranges=null,signal)=>{
  if(!selected(url,key))return prefetch?.(url,key,ranges,signal);
  for(const variable of TYPE_INPUTS){signal?.throwIfAborted();await prefetch?.(url,variable,ranges,signal);}
 };
}
