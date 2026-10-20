import {MPH_PER_MS} from './map-wind-units.js?v=20261019-ensemble-extra4';
export const isSurfaceWind=key=>['wind_speed_10m','wind_gusts_10m','wind_speed_10m_mean','wind_gusts_10m_mean','wind_vector_10m_mean'].includes(key);
// Define the surface scale in mph, then retain native m/s for the renderer.
// Smooth yellow/orange/red transitions distinguish storm speeds; purple is
// reserved for the highest end of the same fixed scale in every model/view.
const surfaceWindMPH=Array.from({length:12},(_,i)=>i*10);
export const SURFACE_WIND_SCALE={
 stops:surfaceWindMPH.map(mph=>mph/MPH_PER_MS),
 colors:['#dceff4','#78c7d5','#48ac97','#68b848','#c4d844','#f5d640','#f7a43b','#ef7132','#de3f32','#c32653','#a03287','#6c2e95'],
 contourValues:surfaceWindMPH.slice(1).map(mph=>mph/MPH_PER_MS),contourLabel:'10 mph',
 legendNote:'Top colour: 110+ mph'
};
export const isJetWind=key=>/^wind_speed_(300|200)hPa$/.test(key);
export const JET_MIN_MS=60/MPH_PER_MS;
export const JET_WIND_SCALE={
 stops:[0,...Array.from({length:9},(_,i)=>60+i*15)].map(mph=>mph/MPH_PER_MS),
 colors:['#ffffff','#003cff','#00cfea','#00dc36','#fff000','#f47700','#d93600','#ac0038','#ec008c','#ff00c8'],
 bands:true,legendStart:1,displayMinimum:JET_MIN_MS,
 legendNote:'White: below 60 mph · top band: 180+ mph'
};
export const MAJOR_850_TEMPERATURES=Object.freeze(Array.from({length:11},(_,i)=>-25+i*5));
// Mean temperatures use the same Celsius isotherms; SD/spread charts do not.
export const is850Temperature=key=>/^temperature_850hPa(?:_mean)?$/.test(key);
export function temperatureContourLevels(field){
 const existing=field.contourValues??Array.from({length:71},(_,i)=>-100+i*2);
 return [...new Set([...existing,...MAJOR_850_TEMPERATURES])].sort((a,b)=>a-b);
}
export function contourLineWidth(field,major=1.8,minor=.7){
 return is850Temperature(field.key)?['match',['to-number',['get','value']],[...MAJOR_850_TEMPERATURES],major,minor]:minor;
}
