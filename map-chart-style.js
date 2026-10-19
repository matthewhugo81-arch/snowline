import {MPH_PER_MS} from './map-wind-units.js?v=20261019-ensemble-extra4';
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
