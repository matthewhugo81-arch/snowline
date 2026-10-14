import {ACCUMULATION_KEYS,accumulationHours,accumulationField,accumulationSource} from './map-accumulation.js?v=20261012-accum-history';
import {WEATHER_COMPOSITE,COMPOSITE_FIELDS,compositeMeta} from './map-weather-composite.js?v=20261013-map-appearance';
import {ensembleField} from './map-ensemble.js?v=20261013-operational-feeds';
import {canDeriveDewPoint,DERIVED_DEW_POINT} from './map-dew-point.js';
import {DIAGNOSTIC_KEYS,diagnosticVariable,diagnosticField} from './map-diagnostics.js?v=20261011-vorticity-purple';
import {isJetWind,JET_WIND_SCALE,is850Temperature} from './map-chart-style.js?v=20261012-chart-style';
import {PRECIPITATION_TYPE,PRECIPITATION_TYPE_SOURCE,NATIVE_PRECIPITATION_TYPE,NATIVE_TYPE_SOURCE,TYPE_KEYS,isTypeField,typeMethod,canDerivePrecipitationType,precipitationTypeField} from './map-precipitation-type.js?v=20261014-synoptic-symbols';
import {THETA_SYMBOLS,canThetaSymbols,thetaSymbolsField} from './map-winter.js?v=20261014-synoptic-symbols';
export {JET_WIND_SCALE};
// Expose useful fields only when the selected spatial run actually supplies them.
// Scales follow the bundled Open-Meteo renderer; do not guess units for new keys.
export const PRESSURE_LEVELS = [1000,925,850,700,500,300,250,200,100,50,10];
// Shared menu policy for every model and both panels. Native inputs remain
// available internally for diagnostics such as 850 hPa theta-w.
const MENU_PRESSURE_LEVELS = {
 temperature:[1000,850,500,250],
 wind_speed:[1000,500,300,200],
 relative_humidity:[1000,700,300],
 geopotential_height:[500,300,200]
};
function menuField(key){
 const pressure=key.match(/^(temperature|wind_speed|relative_humidity|geopotential_height)_(\d+)hPa$/);
 return !pressure||MENU_PRESSURE_LEVELS[pressure[1]].includes(Number(pressure[2]));
}
const HEIGHT_LEVELS = [50,100,200,300];
const GROUPS = ['Combined weather','Winter Analysis','Ensemble mean','Ensemble spread','Temperature','Accumulated precipitation','Rain & snow','Wind','Cloud & visibility','Instability & moisture','Derived diagnostics','Soil','Solar radiation','Upper-air temperature','Upper-air wind','Upper-air humidity','Geopotential height'];
// Reference rain colours, with a white dry band for a clean map background.
// The white 0–<0.5 mm band is opaque; missing grid data remains missing.
export const PRECIPITATION_SCALE = {
 stops:[0,.5,1,2,4,6,8,10,15,20,25,30,40,50],
 colors:['#ffffff','#231496','#1538c7','#125c13','#807e10','#a1a13b','#b08131','#a35a35','#993232','#c43650','#ba2388','#dec4c4','#c9bcbc','#f0e7e7'],
 bands:true
};
// All cloud fractions use dark clear skies and white complete cloud cover.
export const CLOUD_COVER_SCALE = {
 stops:[0,20,40,60,75,85,95,100],
 colors:['#263c55','#3b5573','#56738e','#7391ac','#96b1c7','#bdcfdf','#dce9f1','#ffffff']
};
export const PRECIPITATION_PROBABILITY_SCALE = {
 stops:[0,10,25,50,75,90,100],
 colors:['#ffffff','#dbeefd','#9ecae1','#4292c6','#2171b5','#08519c','#08306b']
};
export function sourceVariable(meta,key){
 if(accumulationHours(key))return accumulationSource(meta,key)?key:null;
 if(key===THETA_SYMBOLS)return canThetaSymbols(meta)?'wet_bulb_potential_temperature_850hPa_derived':null;
 if(key===WEATHER_COMPOSITE){const selected=compositeMeta(meta);return COMPOSITE_FIELDS.every(field=>sourceVariable(selected,field))?'precipitation':null;}
 if(meta?.sources){for(const source of meta.sources){const variable=sourceVariable(source,key);if(variable)return variable;}return null;}
 const vars=meta?.variables??[];
 if(key===NATIVE_PRECIPITATION_TYPE)return typeMethod(meta)==='native'?NATIVE_TYPE_SOURCE:null;
 if(key===PRECIPITATION_TYPE)return canDerivePrecipitationType(meta)?PRECIPITATION_TYPE_SOURCE:null;
 if(DIAGNOSTIC_KEYS.includes(key))return diagnosticVariable(meta,key);
 if(key==='dew_point_2m'&&!vars.includes(key)&&canDeriveDewPoint(meta))return DERIVED_DEW_POINT;
 // These scales describe our verified unit conversions, not similarly named
 // arrays from another provider whose spread units have not been checked.
 if(ensembleField(key)&&!['snowline_gefs_ensemble','snowline_ecmwf_ensemble'].includes(meta?.domain))return null;
 if(key==='pressure_msl'&&vars.includes('pressure_msl_mean'))return 'pressure_msl_mean';
 if(key.startsWith('wind_speed_')){
  const suffix=key.slice(11),u='wind_u_component_'+suffix,v='wind_v_component_'+suffix;
  if(vars.includes(key)&&vars.includes('wind_direction_'+suffix))return key;
  if(vars.includes(u)&&vars.includes(v))return u;
  return null;
 }
 return vars.includes(key)?key:null;
}
export function canonicalVariable(key){
 if(/^wind_[uv]_component_/.test(key))return key.replace(/^wind_[uv]_component_/,'wind_speed_');
 if(key.startsWith('wind_direction_'))return key.replace('wind_direction_','wind_speed_');
 return key;
}
export function variableGroup(key){
 if(isTypeField(key)||key===THETA_SYMBOLS||key==='snowfall_probability')return 'Winter Analysis';
 if(accumulationHours(key))return 'Accumulated precipitation';
 if(key===WEATHER_COMPOSITE)return 'Combined weather';
 if(DIAGNOSTIC_KEYS.includes(key))return 'Derived diagnostics';
 const ensemble=ensembleField(key);if(ensemble)return ensemble.group;
 if(/^temperature_\d+hPa$/.test(key))return 'Upper-air temperature';
 if(/^wind_speed_\d+hPa$/.test(key))return 'Upper-air wind';
 if(/^relative_humidity_\d+hPa$/.test(key))return 'Upper-air humidity';
 if(/^geopotential_height_/.test(key))return 'Geopotential height';
 if(/^soil_/.test(key))return 'Soil';
 if(/radiation|^uv_/.test(key))return 'Solar radiation';
 if(/^wind_/.test(key))return 'Wind';
 if(/^cloud_|^visibility$/.test(key))return 'Cloud & visibility';
 if(/^(precipitation|rain|showers|snow|freezing_level)/.test(key))return 'Rain & snow';
 if(/temperature|dew_point/.test(key))return 'Temperature';
 return 'Instability & moisture';
}
const hex=rgba=>'#'+rgba.slice(0,3).map(n=>Math.round(n).toString(16).padStart(2,'0')).join('')+Math.round((rgba[3]??1)*255).toString(16).padStart(2,'0');
const plain=key=>key.replace(/_/g,' ').replace(/(\d)(cm|m)\b/g,'$1 $2').replace(/\bto\b/g,'–').replace(/^./,s=>s.toUpperCase());
const extras={
 temperature_2m_max:['2 m maximum temperature · native period','temperature','Native maximum 2 m air temperature over the provider’s reporting period ending at the valid time. Not a daily maximum. The spatial metadata does not specify the period length; do not infer it from the playback interval.'],
 temperature_2m_min:['2 m minimum temperature · native period','temperature','Native minimum 2 m air temperature over the provider’s reporting period ending at the valid time. Not a daily minimum. The spatial metadata does not specify the period length; do not infer it from the playback interval.'],
 wind_gusts_10m:['10 m wind gusts','wind','Maximum gust over the model interval, in m/s. Location-chart gusts are shown in mph.'],
 visibility:['Visibility','visibility','Horizontal visibility in metres; lower values can highlight fog and poor visibility.'],
 cloud_cover_low:['Low cloud cover','cloud_cover','Low-level cloud fraction; layer boundaries vary by model.'],
 cloud_cover_mid:['Mid-level cloud cover','cloud_cover','Mid-level cloud fraction; layer boundaries vary by model.'],
 cloud_cover_high:['High cloud cover','cloud_cover','High-level cloud fraction; layer boundaries vary by model.'],
 cloud_cover_2m:['Near-surface cloud (2 m)','cloud_cover','Model cloud fraction near the surface, useful alongside visibility when assessing fog.'],
 cloud_base:['Cloud base','cloud_base','Model cloud-base height in metres.'],
 surface_temperature:['Surface (skin) temperature','temperature','Model surface (skin) temperature; not a road-surface forecast.'],
 rain:['Rain','precipitation','Rain water amount over the native model interval, excluding frozen precipitation. Some model feeds supply convective showers separately. Use Precipitation for the total water amount.'],
 showers:['Showers','precipitation','Convective precipitation water amount over the native model interval.'],
 snowfall_height:['Snowfall height','snowfall_height','Model snowfall-height estimate in metres; distinct from the freezing level and not a guarantee of settling snow.'],
 cape:['CAPE','cape','Convective available potential energy: instability guidance, not a thunderstorm probability.'],
 convective_inhibition:['Convective inhibition (CIN)','convective_inhibition','Energy barrier to convection in J/kg; interpret alongside CAPE and a lifting mechanism.'],
 boundary_layer_height:['Boundary-layer height','boundary_layer_height','Depth of the model atmospheric boundary layer in metres.'],
 total_column_integrated_water_vapour:['Total-column water vapour','total_column','Column moisture in kg/m², numerically equivalent to millimetres of precipitable water.'],
 shortwave_radiation:['Shortwave solar radiation','shortwave','Downward shortwave radiation over the native model interval.'],
 direct_radiation:['Direct solar radiation','direct_radiation','Direct solar radiation over the native model interval.'],
 diffuse_radiation:['Diffuse solar radiation','diffuse_radiation','Diffuse solar radiation over the native model interval.'],
 uv_index:['UV index','uv','Model UV index.'],
 uv_index_clear_sky:['Clear-sky UV index','uv','UV index assuming clear skies, rather than the forecast cloud cover.']
};
export function describeVariable(key,OM){
 if(key==='snowfall_probability')return {
  key,name:'Snow risk · member snowfall probability',group:'Winter Analysis',unit:'%',
  stops:[0,10,25,50,75,90,100],colors:['#ffffff','#d9f0ff','#8fc8f5','#5879db','#7652bd','#a63498','#720c68'],
  contourValues:[10,25,50,75,90],contourLabel:'10, 25, 50, 75 and 90%',
  note:'Percentage of MOGREPS-UK members forecasting falling snow at an average rate of at least 0.1 mm/hour liquid-water equivalent over the stated period. This is a raw member fraction, not a calibrated probability, settling-snow risk or snow depth. Missing members leave a gap; they are never counted as dry.'
 };
 if(isTypeField(key))return precipitationTypeField(key);
 if(key===THETA_SYMBOLS)return thetaSymbolsField();
 const accumulation=accumulationField(key);if(accumulation)return accumulation;
 const diagnostic=diagnosticField(key);if(diagnostic)return diagnostic;
 const ensemble=ensembleField(key);if(ensemble)return ensemble;
 if(isJetWind(key))return {
  key,name:key.match(/\d+/)[0]+' hPa wind speed & direction',group:variableGroup(key),unit:'m/s',...JET_WIND_SCALE,
  contourValues:JET_WIND_SCALE.stops.slice(1),contourLabel:'15 mph from 60 to 180 mph',
  note:'Jet-stream winds at '+key.match(/\d+/)[0]+' hPa. White below 60 mph; coloured bands every 15 mph from 60 to 180 mph. The final colour includes 180 mph and above. Arrows and optional grid labels are shown only at 60 mph and above. Clicked values retain the actual speed, including below the display threshold.'
 };
 let [name,scaleKey,note]=extras[key]??[];
 if(key==='precipitation_probability')return {
  key,name:'Precipitation probability',group:variableGroup(key),unit:'%',...PRECIPITATION_PROBABILITY_SCALE,
  note:'Share of ensemble members predicting at least 0.1 mm/h averaged over the model interval, including rain and snow water equivalent. The threshold and period are shown beside the scale.'
 };
 if(key==='rain'||key==='showers')return {key,name,note,group:variableGroup(key),unit:'mm water',...PRECIPITATION_SCALE};
 if(scaleKey==='cloud_cover')return {key,name,note,group:variableGroup(key),unit:'%',...CLOUD_COVER_SCALE};
 let unit;
 const pressure=key.match(/^(temperature|relative_humidity|wind_speed|geopotential_height)_(\d+)hPa$/);
 const height=key.match(/^(temperature|wind_speed)_(\d+)m$/);
 if(pressure&&PRESSURE_LEVELS.includes(Number(pressure[2]))){
  const kind=pressure[1];
  name=pressure[2]+' hPa '+({temperature:'temperature',relative_humidity:'relative humidity',wind_speed:'wind speed & direction',geopotential_height:'geopotential height'}[kind]);
  scaleKey={temperature:'temperature',relative_humidity:'relative',wind_speed:'wind',geopotential_height:key}[kind];
  note='Native model field on the '+pressure[2]+' hPa pressure surface, which can lie below high terrain.';
 }else if(height&&HEIGHT_LEVELS.includes(Number(height[2]))){
  name=height[2]+' m '+(height[1]==='temperature'?'temperature':'wind speed & direction');
  scaleKey=height[1]==='temperature'?'temperature':'wind';
  note='Model field at '+height[2]+' m above ground.';
 }else if(/^soil_(temperature|moisture)_\d+(?:_to_\d+)?cm$/.test(key)){
  name=plain(key);scaleKey=key.startsWith('soil_temperature_')?'temperature':'soil_moisture';
  note='Native model soil layer; depths vary by model.';
  if(scaleKey==='soil_moisture')unit='m³/m³';
 }
 if(!scaleKey)return null;
 if(!OM.defaultOmProtocolSettings.colorScales[scaleKey]&&!/^geopotential_height_\d+hPa$/.test(scaleKey))return null;
 const raw=OM.getColorScale(scaleKey,false);
 if(key.startsWith('wind_speed_'))note+=' Shading, legend and readouts display mph; underlying spatial data remains in m/s. Arrows show flow direction.';
 return {key,name,group:variableGroup(key),unit:unit??raw.unit,note,stops:raw.breakpoints,colors:raw.colors.map(hex)};
}
export function availableFields(fields,metas){
 return fields.filter(f=>!f.overlayOnly&&menuField(f.key)&&metas.some(m=>sourceVariable(m,f.key))).sort((a,b)=>{
  const group=GROUPS.indexOf(variableGroup(a.key))-GROUPS.indexOf(variableGroup(b.key));
  if(group)return group;
  const ap=a.key.match(/_(\d+)hPa$/),bp=b.key.match(/_(\d+)hPa$/);
  return ap&&bp?Number(bp[1])-Number(ap[1]):a.name.localeCompare(b.name,'en',{numeric:true});
 });
}
export function extendCatalogue(fields,metas,OM,settings){
 const keys=[...new Set(metas.flatMap(m=>m.variables??[]).map(canonicalVariable))];
 for(const key of ACCUMULATION_KEYS)if(metas.some(meta=>sourceVariable(meta,key)))keys.push(key);
 for(const key of DIAGNOSTIC_KEYS)if(metas.some(meta=>sourceVariable(meta,key)))keys.push(key);
 for(const key of [...TYPE_KEYS,THETA_SYMBOLS])if(metas.some(meta=>sourceVariable(meta,key)))keys.push(key);
 if(metas.some(meta=>sourceVariable(meta,'dew_point_2m'))&&!keys.includes('dew_point_2m'))keys.push('dew_point_2m');
 const omitted=[];
 for(const key of keys){
  if(!metas.some(meta=>sourceVariable(meta,key)))continue;
  if(!fields.some(f=>f.key===key)){
   const field=describeVariable(key,OM);if(!field){omitted.push(key);continue;}fields.push(field);
  }
  const field=fields.find(f=>f.key===key);
  field.group=variableGroup(key);
  if(is850Temperature(key))field.contourLabel='2°C intermediate contours, with thicker contours every 5°C from −25°C to +25°C';
  // Use exactly the same temperature palette for instantaneous and extreme
  // temperatures, so equal values always have equal colours.
  if(/^temperature_2m_(max|min)$/.test(key)){
   const base=fields.find(item=>item.key==='temperature_2m');
   if(base){for(const property of ['unit','stops','colors','temperatureBands','bands'])if(property in base)field[property]=base[property];}
  }
  if(key==='wind_speed_10m'){field.name='10 m wind speed & direction';field.note='Shading, legend and readouts display mph; underlying spatial data remains in m/s. Arrows show flow direction.';}
  for(const meta of metas){const source=sourceVariable(meta,key);if(!source)continue;
   settings.colorScales[source]={type:'breakpoint',unit:field.unit,breakpoints:field.stops,colors:field.colors.map(c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16),c.length===9?parseInt(c.slice(7,9),16)/255:1])};
  }
 }
 return omitted;
}
