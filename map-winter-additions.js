import {accumulationSlots} from './map-accumulation.js?v=20261014-interaction-audit';
import {humidityFromDewPoint} from './map-surface-derived.js?v=20261020-ifs-coverage';
import {registerWinterAdditions} from './map-winter-registry.js?v=20261024-winter-panel-controls';
export const WET_BULB='wet_bulb_temperature_2m';
export const WINTER_PERIOD_KEYS=['snowfall_total_6h','snowfall_total_12h','snowfall_total_24h','surface_temperature_min_24h','surface_freezing_hours_24h'];
export const WINTER_ADDITION_KEYS=[WET_BULB,'categorical_freezing_rain','hail',...WINTER_PERIOD_KEYS];
export function winterHours(key){return WINTER_PERIOD_KEYS.includes(key)?Number(key.match(/_(\d+)h$/)[1]):null;}
export const winterInput=key=>key.startsWith('snowfall_total_')?'snowfall_water_equivalent':'surface_temperature';
export function wetBulbInputs(meta){
 const vars=meta?.variables??[];
 if(!vars.includes('temperature_2m'))return null;
 if(vars.includes('relative_humidity_2m'))return ['temperature_2m','relative_humidity_2m'];
 if(vars.includes('dew_point_2m'))return ['temperature_2m','dew_point_2m'];
 return null;
}
// Stull approximation used by Open-Meteo Meteorology.swift. Deliberately mask
// the poorly constrained cold/dry corner and values outside its stated domain.
export function wetBulb(t,rh){
 if(!Number.isFinite(t)||!Number.isFinite(rh)||t< -20||t>50||rh<5||rh>100||(t<0&&rh<20))return NaN;
 if(rh===100)return t;
 return Math.min(t,t*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(t+rh)-Math.atan(rh-1.676331)+.00391838*rh**1.5*Math.atan(.023101*rh)-4.686035);
}
export function winterVariable(meta,key){
 if(key===WET_BULB){const inputs=wetBulbInputs(meta);return inputs?'winter_wet_bulb_'+(inputs[1]==='dew_point_2m'?'dew':'rh'):null;}
 if(key==='hail')return meta?.domain==='ukmo_uk_deterministic_2km'&&meta.variables?.includes(key)?key:null;
 if(key==='categorical_freezing_rain')return ['ncep_gfs013','ncep_gfs025'].includes(meta?.domain)&&meta.variables?.includes(key)?key:null;
 return null;
}
const HOUR=3600000;
export function winterSlots(domain,reference,end,key){
 const hours=winterHours(key),finish=Date.parse(end),start=finish-hours*HOUR;
 if(!hours||!Number.isFinite(finish)||start<Date.parse(reference))return null;
 if(key.startsWith('snowfall_total_'))return accumulationSlots(domain,reference,end,hours);
 // Hourly endpoint samples only; do not manufacture fine-scale extrema from
// coarser output. Include the beginning to integrate zero crossings.
 return Array.from({length:hours+1},(_,i)=>new Date(start+i*HOUR).toISOString());
}
const plans=new WeakMap();
export function winterPeriodSource(meta,key,end){
 if(!meta||!winterHours(key))return null;
 let cache=plans.get(meta);if(!cache){cache=new Map();plans.set(meta,cache);}
 const id=key+'|'+(end??'any');if(cache.has(id))return cache.get(id);
 const result=(meta.sources??[meta]).find(s=>{
  const input=winterInput(key);
  if(Date.parse(s.reference_time)!==Date.parse(meta.reference_time)||!s.variables?.includes(input))return false;
  const times=s.variable_valid_times?.[input]??s.valid_times??[],available=new Set(times.map(Date.parse));
  return (end?[end]:times).some(t=>{
   const slots=winterSlots(s.domain,s.reference_time,t,key);
   return slots?.every(slot=>available.has(Date.parse(slot))&&
    // UKV surface temperature is not supplied in the initialization file.
    !(input==='surface_temperature'&&s.domain==='ukmo_uk_deterministic_2km'&&Date.parse(slot)===Date.parse(s.reference_time)));
  });
 })??null;cache.set(id,result);return result;
}
const temp={unit:'°C',stops:[-20,-10,-5,-2,0,2,5,10,20],colors:['#6133a2','#3955bd','#368fcb','#77cee1','#e8f3ec','#ffe09b','#f3ac62','#df6745','#ac263b'],decimals:1};
const snow={unit:'mm water',stops:[0,.1,1,2,5,10,20,40,60],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83','#641847'],decimals:1};
export function winterAdditionField(key){
 const common={key,group:'Winter Analysis'};
 if(key===WET_BULB)return {...common,...temp,name:'2 m wet-bulb temperature · approximate',note:'Stull approximation from matching 2 m temperature and humidity (or humidity derived from dew point) in the same model grid and time. Uses the Open-Meteo formulation; assumes sea-level pressure and is less reliable over high ground or near freezing. Not a rain/snow classification. Outside −20 to 50°C, RH 5–100%, and below 0°C with RH below 20%, values are withheld.'};
 if(key==='categorical_freezing_rain')return {...common,name:'Freezing rain · native GFS flag',unit:'flag',categorical:true,bands:true,stops:[0,1],colors:['#ffffff','#aa35c2'],categoryLabels:['Not flagged','Freezing rain flagged'],note:'Native GFS CFRZR flag: 0 = not flagged, 1 = freezing rain flagged. Not probability or ice accretion. Nearest-neighbour shading preserves categories; unknown codes remain missing.'};
 if(key==='hail')return {...common,...snow,name:'Hail · UKV accumulation (1 h)',note:'Native UKV hail-fall accumulation during the preceding hour, in mm water equivalent. Not hailstone diameter, probability or hail depth.',legendNote:'Preceding 1 h · mm water equivalent'};
 if(key.startsWith('snowfall_total_')&&winterHours(key))return {...common,...snow,name:`${winterHours(key)} h snowfall total · water equivalent`,periodHours:winterHours(key),note:'Sum of native snowfall water-equivalent interval amounts over the complete period ending at the selected time, from one run and grid. Not centimetres of snow. Missing intervals/cells remain unavailable; no constant snow-to-liquid ratio is applied.'};
 if(key==='surface_temperature_min_24h')return {...common,...temp,name:'24 h minimum skin temperature · hourly samples',periodHours:24,note:'Lowest of 25 hourly surface-skin temperature samples spanning the preceding 24 hours. May miss minima between samples; not a native continuous minimum or road temperature. Requires every hourly sample from one run.'};
 if(key==='surface_freezing_hours_24h')return {...common,unit:'hours',stops:[0,1,3,6,9,12,18,24],colors:['#ffffff','#d9f0fa','#a9d4ec','#6eafd6','#417fc0','#5253ac','#783d97','#ad3285'],decimals:1,name:'24 h skin temperature below 0°C · estimated hours',periodHours:24,note:'Estimated time strictly below 0°C from linear crossings between hourly skin-temperature samples over the preceding 24 hours. Requires all 25 samples; missing cells remain missing. Not road-ice duration.'};
 return null;
}
export function reduceSkin(arrays,key){
 if(arrays.length!==25||arrays.some(a=>a.length!==arrays[0].length))throw Error('A complete 25-sample skin-temperature window is required.');
 return Float32Array.from(arrays[0],(_,i)=>{
  const values=arrays.map(a=>a[i]);if(values.some(v=>!Number.isFinite(v)))return NaN;
  if(key==='surface_temperature_min_24h')return Math.min(...values);
  let hours=0;for(let j=1;j<values.length;j++){const a=values[j-1],b=values[j];hours+=a<0&&b<0?1:a>=0&&b>=0?0:a<0?-a/(b-a):-b/(a-b);}
  return hours;
 });
}
export function wetBulbValues(t,second,dew=false){
 if(t.length!==second.length)throw Error('Wet-bulb input grids do not match.');
 return Float32Array.from(t,(v,i)=>wetBulb(v,dew?humidityFromDewPoint(v,second[i]):second[i]));
}
registerWinterAdditions({WINTER_ADDITION_KEYS,winterHours,winterPeriodSource,winterVariable,winterAdditionField,wetBulbInputs});
