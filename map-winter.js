import {THETA_W,diagnosticField,diagnosticVariable} from './map-diagnostics.js?v=20261011-vorticity-purple';
import {typeMethod,ESTIMATE_NOTE,NATIVE_NOTE} from './map-precipitation-type.js?v=20261014-winter-intensity';
export const THETA_SYMBOLS='theta_w_precipitation_symbols';
export const THETA_SYMBOL_FIELDS=[THETA_W,'precipitation','pressure_msl'];
export function winterSources(meta){return (meta?.sources??(meta?[meta]:[])).filter(source=>Date.parse(source.reference_time)===Date.parse(meta.reference_time));}
export function canThetaSymbols(meta){
 const sources=winterSources(meta);
 return sources.some(s=>diagnosticVariable(s,THETA_W))&&['precipitation','pressure_msl'].every(key=>sources.some(s=>s.variables?.includes(key)));
}
export function thetaSymbolsField(){return {...diagnosticField(THETA_W),key:THETA_SYMBOLS,name:'850 hPa theta-w, precipitation symbols & MSLP',group:'Winter Analysis',
 legendNote:'Circles = rain (not diagnosed fronts); triangles = supplied convection; stars = snow. Symbol sizes: 0.1–<0.5 / 0.5–<2 / 2–<5 / 5+ mm/h water equivalent. Green = estimated mix; purple = native freezing rain/drizzle; amber = native ice pellets; grey = unresolved phase.',
 note:diagnosticField(THETA_W).note+' Precipitation symbols sample native cells without smoothing and use the same run and valid time as the shading and MSLP. Sizes: 0.1–<0.5, 0.5–<2, 2–<5 and 5+ mm/h water equivalent. Below 0.1 mm/h is unplotted. Circles do not diagnose a weather front. GFS uses its matching 0.13° surface and 0.25° upper-air grids. See the model-specific phase/convection note.'};}
export function symbolRecipe(source){
 if(['dwd_icon','dwd_icon_eu'].includes(source?.domain)&&['rain','showers','snowfall_water_equivalent'].every(k=>source.variables.includes(k)))return 'icon';
 return typeMethod(source)??'unresolved';
}
export function winterNote(meta,key){
 const source=winterSources(meta).find(s=>s.variables?.includes('precipitation'));
 if(key!==THETA_SYMBOLS)return '';
 const recipe=symbolRecipe(source);
 return recipe==='icon'?'ICON: circles use native large-scale rain, triangles use native convective rain and stars use total native snowfall water equivalent. Each component has its own amount and size. Snow convection is not separated.':recipe==='native'?NATIVE_NOTE:recipe==='estimated'?ESTIMATE_NOTE+' Convection is not separated on this chart; rain circles do not imply frontal rain.':'This feed does not resolve precipitation phase here. Grey circles show total precipitation of unknown type; no rain/snow or convection diagnosis is inferred.';
}
