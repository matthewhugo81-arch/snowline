import {THETA_W,diagnosticField,diagnosticVariable} from './map-diagnostics.js?v=20261022-theta-label';
import {typeMethod,ESTIMATE_NOTE,NATIVE_NOTE} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {SYMBOL_SIZE_NOTE} from './map-precipitation-glyphs.js?v=20261023-theta-phase';
export const THETA_SYMBOLS='theta_w_precipitation_symbols';
export const THETA_SYMBOL_FIELDS=[THETA_W,'precipitation','pressure_msl'];
export function winterSources(meta){return (meta?.sources??(meta?[meta]:[])).filter(source=>Date.parse(source.reference_time)===Date.parse(meta.reference_time));}
export function canThetaSymbols(meta){
 const sources=winterSources(meta);
 return sources.some(s=>diagnosticVariable(s,THETA_W))&&['precipitation','pressure_msl'].every(key=>sources.some(s=>s.variables?.includes(key)));
}
export function thetaSymbolsField(){return {...diagnosticField(THETA_W),key:THETA_SYMBOLS,name:'850 hPa theta-w, precipitation symbols & MSLP',group:'Winter Analysis',
 legendNote:'○ Precipitation · ∨ / ▽ Supplied convection · ✳ Snow (all models). Circles show large-scale precipitation where a split is supplied; otherwise total. Larger symbols = heavier precipitation. '+SYMBOL_SIZE_NOTE+' Model-supplied phase is preferred; otherwise 850 hPa θw estimates snow ≤0°C, mix >0 to <2°C, rain ≥2°C. This is guidance, not guaranteed surface phase. Blue = rain or unresolved partitioned total; green = mix; pink = snow; purple = freezing; amber = ice; grey = unknown phase.',
 note:diagnosticField(THETA_W).note+' Precipitation symbols sample native cells without smoothing and use the same run and valid time as the shading and MSLP. Symbol size increases continuously with interval-average precipitation rate, rather than jumping between four broad classes. '+SYMBOL_SIZE_NOTE+' Light convection uses an open V and stronger convection a compact downward triangle. Concurrent components are spaced apart, and overlapping neighbouring groups are thinned on a stable screen lattice; light precipitation retains dense coverage. Symbol density is not a measure of intensity. Phase colours are unchanged, so this is not a copy of Visual Weather\'s colour scale. Circles show total precipitation when the feed cannot separate dynamic and convective precipitation. GFS uses its matching 0.13° surface and 0.25° upper-air grids. See the model-specific note.'};}
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
 if(recipe==='partitioned')return 'GFS / ECMWF AIFS: rings show total precipitation minus native convective precipitation; small downward triangles show the convective component. Both include rain and snow, in water equivalent; their phase is estimated from matching 850 hPa theta-w, with snowflakes for snow. Where convection values are missing or inconsistent, a ring shows total precipitation without diagnosing its mechanism. Snowfall is not counted twice or allocated to a mechanism.';
 return (recipe==='native'?NATIVE_NOTE.replace('Wet intervals with no resolved valid-time type are grey.',''):recipe==='estimated'?ESTIMATE_NOTE.replace('Missing inputs remain missing; inconsistent amounts are grey.',''):'Phase estimated from 850 hPa theta-w where available.')+' Unresolved phase uses matching 850 hPa theta-w: ≤0°C snow, >0 to <2°C mix, ≥2°C rain. Grey means neither source resolves phase. Snow uses snowflakes. Circles show total precipitation: this feed has no dynamic / convective split. Neither precipitation intensity nor CAPE is used to invent one.';
}
