import {hasFieldTime,fieldIntervalHours} from './map-sources.js?v=20261011-diagnostics';
import {forecastInterval,intervalForecastTimes} from './map-interval.js?v=20261011-forecast-interval';
import {sourceVariable} from './map-catalogue.js?v=20261011-diagnostics';

export const BRIEFING_PRESETS=[
 {id:'weather',name:'Cloud, rain & pressure',field:'cloud_cover',required:['cloud_cover','precipitation','pressure_msl'],note:'White = overcast; dark = clear. Coloured rain overlays cloud. Black isobars every 4 hPa. Rain periods are stated on each chart.'},
 {id:'airmass',name:'850 hPa temperature & pressure',field:'temperature_850hPa',required:['temperature_850hPa','pressure_msl'],note:'850 hPa air temperature with MSLP isobars every 4 hPa. This is air temperature, not theta-w or a surface snow forecast.'},
 {id:'upper',name:'500 hPa height & pressure',field:'geopotential_height_500hPa',required:['geopotential_height_500hPa','pressure_msl'],note:'500 hPa geopotential height with MSLP isobars every 4 hPa.'},
 {id:'theta-w',name:'850 hPa theta-w & pressure',field:'wet_bulb_potential_temperature_850hPa',required:['wet_bulb_potential_temperature_850hPa','pressure_msl'],note:'Derived 850 hPa wet-bulb potential temperature (theta-w), in °C at 1000 hPa, with MSLP isobars every 4 hPa.'},
 ...[300,400].map(level=>({id:'vorticity-'+level,name:level+' hPa relative vorticity & pressure',field:'relative_vorticity_'+level+'hPa',required:['relative_vorticity_'+level+'hPa','pressure_msl'],note:'Derived '+level+' hPa relative vorticity (10⁻⁵ s⁻¹), with MSLP isobars every 4 hPa. Warm colours = anticlockwise; cool colours = clockwise. Native-grid detail; no smoothing.'}))
];
export const BRIEFING_AREAS=[
 {id:'uk',name:'UK & Ireland',bounds:[-12,48,5,61.5],size:[960,960]},
 {id:'europe',name:'Europe',bounds:[-25,32,35,72]},
 {id:'atlantic',name:'North Atlantic',bounds:[-80,20,30,78]}
];
export function briefingPresets(meta){return BRIEFING_PRESETS.filter(preset=>preset.required.every(key=>sourceVariable(meta,key)));}
export function briefingTimes(meta,preset,model,interval='3'){
 const native=[...new Map((meta?.valid_times??[]).filter(time=>Number.isFinite(Date.parse(time))&&preset.required.every(key=>hasFieldTime(meta,key,time))).map(time=>[Date.parse(time),time])).values()].sort((a,b)=>Date.parse(a)-Date.parse(b));
 return intervalForecastTimes(native,forecastInterval([model],interval).hours);
}
export function briefingPage(times,start,count=6){return times.slice(Math.max(0,start),Math.max(0,start)+count);}
export function briefingCaption(meta,preset,time){
 const lead=(Date.parse(time)-Date.parse(meta.reference_time))/3600000;
 const period=preset.id==='weather'?fieldIntervalHours(meta,'precipitation',time):null;
 return 'T+'+String(lead).padStart(3,'0')+(period?' · '+period+' h precipitation ending at this time':'');
}
export function briefingKey(model,meta,preset,area,time,size=[960,660]){return JSON.stringify([model,meta.reference_time,preset.id,area,time,size]);}

// Bound retained chart images; a visit to another model must not accumulate
// hundreds of decoded images or unreleased blob URLs.
export class BriefingImages{
 constructor(limit=36,release=url=>URL.revokeObjectURL(url)){this.limit=limit;this.release=release;this.items=new Map();}
 get(key){const value=this.items.get(key);if(value){this.items.delete(key);this.items.set(key,value);}return value;}
 set(key,value){const old=this.items.get(key);if(old&&old!==value)this.release(old);this.items.delete(key);this.items.set(key,value);while(this.items.size>this.limit){const [first,url]=this.items.entries().next().value;this.items.delete(first);this.release(url);}return value;}
 clear(){for(const url of this.items.values())this.release(url);this.items.clear();}
}
