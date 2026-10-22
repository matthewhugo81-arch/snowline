import {productField} from './map-ensemble-products.js?v=20261022-cold-probs';
import {accumulationHours} from './map-accumulation.js?v=20261014-interaction-audit';
import {ensemblePeriod} from './map-ensemble-extra.js?v=20261020-native-levels';
import {fieldIntervalHours} from './map-sources.js?v=20261020-run-selector';
import {WEATHER_COMPOSITE} from './map-weather-composite.js?v=20261018-rates';
import {PRECIPITATION_TYPE,NATIVE_PRECIPITATION_TYPE} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {THETA_SYMBOLS} from './map-winter.js?v=20261014-interaction-audit';

const instant=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const periodStamp=(date,year)=>{
 const parts=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).formatToParts(date);
 const part=type=>parts.find(p=>p.type===type).value;
 return part('day')+' '+part('month')+(year?' '+part('year'):'')+' '+part('hour')+':'+part('minute');
};

const nativePeriods=new Set(['precipitation','rain','showers','snowfall_water_equivalent','precipitation_probability','snowfall_probability',WEATHER_COMPOSITE,PRECIPITATION_TYPE,NATIVE_PRECIPITATION_TYPE,THETA_SYMBOLS]);
const unknownPeriods=new Set(['temperature_2m_min','temperature_2m_max','wind_gusts_10m','shortwave_radiation','direct_radiation','diffuse_radiation']);
export function forecastPeriod(field,time,meta){
 const known=ensemblePeriod(meta,field,time);
 if(known&&Number.isFinite(Date.parse(known.start))&&Date.parse(known.end)===Date.parse(time)&&Date.parse(known.start)<Date.parse(time))return {start:known.start,end:known.end};
 const hours=productField(field)?.periodHours??accumulationHours(field)??(meta&&nativePeriods.has(field)?fieldIntervalHours(meta,field,time):null);
 return hours>0&&Number.isFinite(Date.parse(time))?{start:new Date(Date.parse(time)-hours*3600000).toISOString(),end:new Date(time).toISOString()}:null;
}
const timelineFormats=[false,true].map(year=>new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',...(year?{year:'numeric'}:{}),hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}));
const timelineStamp=(time,year=false)=>{
 const parts=timelineFormats[Number(year)].formatToParts(new Date(time));
 const p=type=>parts.find(v=>v.type===type).value;
 return p('weekday')+' '+p('day')+' '+p('month')+(year?' '+p('year'):'')+' at '+p('hour')+':'+p('minute');
};
export function forecastTimeLabel(field,time,meta){
 if(!Number.isFinite(Date.parse(time)))return '';
 const period=forecastPeriod(field,time,meta);
 const year=period&&new Date(period.start).getUTCFullYear()!==new Date(period.end).getUTCFullYear();
 return period?timelineStamp(period.start,year)+' to '+timelineStamp(period.end,year):timelineStamp(time)+(unknownPeriods.has(field)?' · period end (duration unspecified)':'');
}
// Metadata bounds take precedence over output/playback cadence.
export function forecastValidity(field,time,meta){
 const end=new Date(time),bounds=forecastPeriod(field,time,meta);
 if(!Number.isFinite(end.getTime()))return '';
 if(!bounds)return (unknownPeriods.has(field)?'Period ending ':'Valid ')+instant.format(end)+' UTC'+(unknownPeriods.has(field)?' · duration unspecified':'');
 const start=new Date(bounds.start),year=start.getUTCFullYear()!==end.getUTCFullYear();
 const period='VALID '+periodStamp(start,year)+' to '+periodStamp(end,year)+' UTC';
 if(/^ens_temperature_(min|max)_anomaly$/.test(field)){
  const minimum=field==='ens_temperature_min_anomaly';
  const day=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(minimum?end:start);
  return 'Attributed to '+day+' · '+period;
 }
 return period;
}
