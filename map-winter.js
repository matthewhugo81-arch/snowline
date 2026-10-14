import {THETA_W,diagnosticField,diagnosticVariable} from './map-diagnostics.js?v=20261011-vorticity-purple';
import {typeMethod,ESTIMATE_NOTE,NATIVE_NOTE} from './map-precipitation-type.js?v=20261014-interaction-audit';
export const THETA_SYMBOLS='theta_w_precipitation_symbols';
export const THETA_SYMBOL_FIELDS=[THETA_W,'precipitation','pressure_msl'];
export function winterSources(meta){return (meta?.sources??(meta?[meta]:[])).filter(source=>Date.parse(source.reference_time)===Date.parse(meta.reference_time));}
export function canThetaSymbols(meta){
 const sources=winterSources(meta);
 return sources.some(s=>diagnosticVariable(s,THETA_W))&&['precipitation','pressure_msl'].every(key=>sources.some(s=>s.variables?.includes(key)));
}
export function thetaSymbolsField(){return {...diagnosticField(THETA_W),key:THETA_SYMBOLS,name:'850 hPa theta-w, precipitation symbols & MSLP',group:'Winter Analysis',
 legendNote:'○ Precipitation · ∨ / ▽ Supplied convection · ✳ ICON total snow. Circles show large-scale precipitation where a split is supplied; otherwise total. Larger symbols = heavier precipitation: 0.1–<0.5 / 0.5–<2 / 2–<5 / 5+ mm/h water equivalent. Blue = rain or partitioned total; green = mix; pink = snow; purple = freezing; amber = ice; grey = unknown phase.',
 note:diagnosticField(THETA_W).note+' Dense precipitation symbols sample native cells without smoothing and use the same run and valid time as the shading and MSLP. Small dots grow into larger continuous rings as precipitation strengthens; light convection uses an open V and stronger convection a compact downward triangle. Sizes: 0.1–<0.5, 0.5–<2, 2–<5 and 5+ mm/h water equivalent. Below 0.1 mm/h is unplotted. Circles show total precipitation when the feed cannot separate dynamic and convective precipitation. GFS uses its matching 0.13° surface and 0.25° upper-air grids. See the model-specific note.'};}
export function symbolRecipe(source){
 if(['dwd_icon','dwd_icon_eu'].includes(source?.domain)&&['rain','showers','snowfall_water_equivalent'].every(k=>source.variables.includes(k)))return 'icon';
 if(['ecmwf_aifs025_single','ncep_gfs013'].includes(source?.domain)&&['precipitation','showers'].every(k=>source.variables?.includes(k)))return 'partitioned';
 return typeMethod(source)??'unresolved';
}
export function winterNote(meta,key){
 const source=winterSources(meta).find(s=>s.variables?.includes('precipitation'));
 if(key!==THETA_SYMBOLS)return '';
 const recipe=symbolRecipe(source);
 if(recipe==='icon')return 'ICON: rings use native large-scale rain; small downward triangles use native convective rain. Stars show total snowfall, whose convection split is unavailable. Each component has its own amount and size.';
 if(recipe==='partitioned')return 'GFS / ECMWF AIFS: rings show total precipitation minus native convective precipitation; small downward triangles show the convective component. Both include rain and snow, in water equivalent. Where convection values are missing or inconsistent, a ring shows total precipitation without diagnosing its mechanism. Snowfall is not counted twice or allocated to a mechanism.';
 return (recipe==='native'?NATIVE_NOTE:recipe==='estimated'?ESTIMATE_NOTE:'Grey means unresolved precipitation phase.')+' Circles show total precipitation: this feed has no dynamic / convective split. Neither precipitation intensity nor CAPE is used to invent one.';
}
