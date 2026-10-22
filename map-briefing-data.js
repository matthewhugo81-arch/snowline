import {isPrecipitationRate} from './map-precipitation-rate.js?v=20261018-rates';
import {ensemblePeriodLabel} from './map-ensemble-extra.js?v=20261020-native-levels';
import {appearanceKey} from './map-appearance.js?v=20261013-shared-appearance';
import {ACCUMULATION_KEYS,accumulationHours,accumulationField} from './map-accumulation.js?v=20261014-interaction-audit';
import {directVerticalNote} from './map-direct-vertical.js?v=20261020-native-levels';
import {hasFieldTime,fieldIntervalHours,fieldSource} from './map-sources.js?v=20261020-run-selector';
import {forecastInterval,intervalForecastTimes} from './map-interval.js?v=20261019-12-hour';
import {sourceVariable,availableFields,variableGroup} from './map-catalogue.js?v=20261022-six-hour-probs';
import {WEATHER_COMPOSITE} from './map-weather-composite.js?v=20261018-rates';
import {PRECIPITATION_TYPE,isTypeField,NATIVE_PRECIPITATION_TYPE} from './map-precipitation-type.js?v=20261014-interaction-audit';

import {THETA_SYMBOLS,winterNote} from './map-winter.js?v=20261014-interaction-audit';
import {VERTICAL_MOTION,verticalMotionField} from './map-vertical-motion.js?v=20261020-native-levels';
export const BRIEFING_PRESETS=[
 {id:'weather',name:'Cloud, precipitation & MSLP',field:WEATHER_COMPOSITE,required:[WEATHER_COMPOSITE],note:'White = overcast; dark = clear. Coloured rain overlays cloud. Black isobars every 4 hPa. Rain periods are stated on each chart.'},
 {id:'temperature',name:'2 m air temperature & pressure',field:'temperature_2m',required:['temperature_2m','pressure_msl'],note:'2 m air temperature in °C at the chart valid time, with MSLP isobars every 4 hPa. This is instantaneous air temperature, not a maximum or minimum.'},
 {id:'dew-point',name:'2 m dew point & pressure',field:'dew_point_2m',required:['dew_point_2m','pressure_msl'],note:'2 m dew point in °C at the chart valid time, with MSLP isobars every 4 hPa. UKMO dew point is calculated from matching 2 m temperature and relative humidity on the same grid, run and valid time when no native dew-point field is supplied.'},
 ...['max','min'].map(statistic=>({id:'temperature-'+statistic,name:'2 m '+(statistic==='max'?'maximum':'minimum')+' temperature & pressure',field:'temperature_2m_'+statistic,required:['temperature_2m_'+statistic,'pressure_msl'],note:'Native-period '+(statistic==='max'?'maximum':'minimum')+' 2 m air temperature, not a daily extreme, with MSLP isobars every 4 hPa. The reporting period ends at the chart time; its duration is not supplied in the spatial metadata.'})),
 ...ACCUMULATION_KEYS.map(key=>({id:key,name:accumulationField(key).name+' & pressure',field:key,required:[key,'pressure_msl'],note:accumulationField(key).note+' MSLP isobars describe the ending valid time.'})),
 {id:'airmass',name:'850 hPa temperature & pressure',field:'temperature_850hPa',required:['temperature_850hPa','pressure_msl'],note:'850 hPa air temperature with MSLP isobars every 4 hPa. This is air temperature, not theta-w or a surface snow forecast. With Contours enabled, isotherms every 5°C from −25°C to +25°C are thicker than the intermediate contours.'},
 {id:'upper',name:'500 hPa height & pressure',field:'geopotential_height_500hPa',required:['geopotential_height_500hPa','pressure_msl'],note:'500 hPa geopotential height with MSLP isobars every 4 hPa.'},
 {id:'jet',name:'300 hPa wind speed & direction',field:'wind_speed_300hPa',required:['wind_speed_300hPa','pressure_msl'],note:'300 hPa wind speed in mph, with arrows pointing along the flow and MSLP isobars every 4 hPa. White below 60 mph; coloured bands every 15 mph from 60 to 180+ mph. Arrows and optional grid labels are shown only at 60 mph and above. Longer arrows indicate stronger winds.'},
 {id:'theta-w',name:'850 hPa theta-w & pressure',field:'wet_bulb_potential_temperature_850hPa',required:['wet_bulb_potential_temperature_850hPa','pressure_msl'],note:'Derived 850 hPa wet-bulb potential temperature (theta-w), in °C at 1000 hPa, with MSLP isobars every 4 hPa.'},
 {id:'vertical-motion-700',name:verticalMotionField().name,field:VERTICAL_MOTION,required:[VERTICAL_MOTION],note:verticalMotionField().note},
 ...[300,400].map(level=>({id:'vorticity-'+level,name:level+' hPa relative vorticity & pressure',field:'relative_vorticity_'+level+'hPa',required:['relative_vorticity_'+level+'hPa','pressure_msl'],note:'Derived '+level+' hPa relative vorticity (10⁻⁵ s⁻¹), with MSLP isobars every 4 hPa. Yellow through red = positive (anticlockwise); purple highlights 35–40 and above. Cyan = negative (clockwise). Smoothed over approximately 20 km (Gaussian standard deviation) to reduce grid-scale striping.'}))
];
export {MAP_AREAS as BRIEFING_AREAS} from './map-areas.js?v=20261013-nw-europe-periods';
// Named combinations remain shortcuts, but the main map catalogue determines
// the choices in both briefing views. A missing optional pressure overlay must
// never hide an otherwise available field.
export function briefingPresets(meta,fields){
 if(!fields)return BRIEFING_PRESETS.filter(preset=>preset.required.every(key=>sourceVariable(meta,key)));
 return availableFields(fields,[meta]).map(field=>{
  const named=BRIEFING_PRESETS.find(p=>field.key===WEATHER_COMPOSITE?p.id==='weather':p.id!=='weather'&&p.field===field.key);
  const pressure=!!sourceVariable(meta,'pressure_msl');
  const preset=named?{...named,required:named.id==='weather'?named.required:[named.field],...(!pressure?{name:field.name,note:field.note}:{})}:
   {id:field.key,name:field.name,field:field.key,required:[field.key],note:field.note};
  return {...preset,note:preset.note+' '+winterNote(meta,field.key)+(field.key===VERTICAL_MOTION?' '+directVerticalNote(fieldSource(meta,field.key)):'')+(meta?.ensembleNote?' '+meta.ensembleNote:''),key:field.key,group:variableGroup(field.key)};
 });
}
export function briefingOptions(select,presets){
 select.replaceChildren();const groups=new Map();
 for(const preset of presets){
  const group=preset.group??'Charts';
  if(!groups.has(group)){const el=document.createElement('optgroup');el.label=group;groups.set(group,el);select.append(el);}
  const el=document.createElement('option');el.value=preset.id;el.textContent=preset.name;groups.get(group).append(el);
 }
}
export function briefingTimes(meta,preset,model,interval='3'){
 const native=[...new Map((meta?.valid_times??[]).filter(time=>Number.isFinite(Date.parse(time))&&preset.required.every(key=>hasFieldTime(meta,key,time))).map(time=>[Date.parse(time),time])).values()].sort((a,b)=>Date.parse(a)-Date.parse(b));
 // Accumulation start choices use every complete native window. The view
 // spaces rendered charts by the total duration AFTER choosing its UTC start.
 return accumulationHours(preset.field)?native:intervalForecastTimes(native,forecastInterval([model],interval).hours);
}
export function briefingPage(times,start,count=6){return times.slice(Math.max(0,start),Math.max(0,start)+count);}
export function briefingCaption(meta,preset,time){
 const lead=(Date.parse(time)-Date.parse(meta.reference_time))/3600000;
 const ensembleInterval=ensemblePeriodLabel(meta,preset.field,time);
 if(ensembleInterval)return 'T+'+String(lead).padStart(3,'0')+' · '+ensembleInterval;
 const amount=preset.id==='weather'?'precipitation':preset.field;
 const period=[PRECIPITATION_TYPE,NATIVE_PRECIPITATION_TYPE,THETA_SYMBOLS,'precipitation','rain','showers','snowfall_water_equivalent','precipitation_probability','snowfall_probability'].includes(amount)?fieldIntervalHours(meta,amount,time):null;
 const sourceNote=preset.field===VERTICAL_MOTION?directVerticalNote(fieldSource(meta,preset.field,time)):'';
 return (sourceNote?sourceNote+' · ':'')+'T+'+String(lead).padStart(3,'0')+(period?(isPrecipitationRate(amount)?' · Mean rate (mm/h) over preceding '+period+' h':' · '+period+' h '+(isTypeField(amount)?'precipitation-type / intensity':amount===THETA_SYMBOLS?'precipitation symbols (mean mm/h)':amount==='snowfall_water_equivalent'?'snowfall water equivalent':amount==='precipitation_probability'?'precipitation probability':amount==='snowfall_probability'?'snow probability (≥'+Number((period*.1).toFixed(2))+' mm water)':amount)+' ending at this time'):'')+(/^temperature_2m_(max|min)$/.test(preset.field)?' · Native period ending at this time · duration unspecified':'');
}
export function briefingKey(model,meta,preset,area,time,size=[960,660],overlays={},background='light',appearance={}){return JSON.stringify([model,meta.reference_time,preset.id,area,time,size,!!overlays.contours,!!overlays.grid,background,appearanceKey(appearance)]);}

// Bound retained chart images; a visit to another model must not accumulate
// hundreds of decoded images or unreleased blob URLs.
export class BriefingImages{
 constructor(limit=36,release=url=>URL.revokeObjectURL(url)){this.limit=limit;this.release=release;this.items=new Map();}
 get(key){const value=this.items.get(key);if(value){this.items.delete(key);this.items.set(key,value);}return value;}
 set(key,value){const old=this.items.get(key);if(old&&old!==value)this.release(old);this.items.delete(key);this.items.set(key,value);while(this.items.size>this.limit){const [first,url]=this.items.entries().next().value;this.items.delete(first);this.release(url);}return value;}
 clear(){for(const url of this.items.values())this.release(url);this.items.clear();}
}
