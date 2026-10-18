import {precipitationFileInfo} from './map-precipitation-type.js?v=20261014-interaction-audit';

// Display aliases deliberately leave the native amount variables untouched:
// accumulations, phase diagnostics and weather symbols still need those totals.
export const PRECIPITATION_RATE_FIELDS=['precipitation','rain','showers','snowfall_water_equivalent'];
export const isPrecipitationRate=key=>PRECIPITATION_RATE_FIELDS.includes(key);
export const precipitationRateVariable=key=>isPrecipitationRate(key)?key+'_hourly_rate':key;
const nativeKey=key=>PRECIPITATION_RATE_FIELDS.find(field=>precipitationRateVariable(field)===key);
const installed=new WeakSet();
export function installPrecipitationRates(OM,settings){
 for(const key of PRECIPITATION_RATE_FIELDS){
  const scale=settings.colorScales[key];
  if(scale)settings.colorScales[precipitationRateVariable(key)]={...scale,unit:'mm/h'};
 }
 const reader=OM.getProtocolInstance(settings).omFileReader;
 if(installed.has(reader))return;installed.add(reader);
 const read=reader.readVariable.bind(reader),prefetch=reader.prefetchVariable?.bind(reader);
 reader.readVariable=async(url,key,ranges=null,signal)=>{
  const native=nativeKey(key);if(!native)return read(url,key,ranges,signal);
  signal?.throwIfAborted();
  const {hours}=precipitationFileInfo(url);
  const data=await read(url,native,ranges,signal);
  signal?.throwIfAborted();
  const values=new Float32Array(new data.values.buffer.constructor(data.values.byteLength));
  for(let i=0;i<values.length;i++)values[i]=data.values[i]/hours;
  return {...data,values,scaleFactor:data.scaleFactor*hours};
 };
 reader.prefetchVariable=async(url,key,ranges=null,signal)=>{
  const native=nativeKey(key);
  if(native){signal?.throwIfAborted();precipitationFileInfo(url);}
  return prefetch?.(url,native??key,ranges,signal);
 };
}
