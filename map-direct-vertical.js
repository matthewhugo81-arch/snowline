// Native-resolution subsets keep this UK/Europe diagnostic within Pages storage.
export const DIRECT_VERTICAL_MODELS={gem_global:'snowline_gem_700',icon_eu:'snowline_icon_eu_700'};
export const DIRECT_VERTICAL_FIELDS=['omega_700hPa','geopotential_height_700hPa','wind_u_component_700hPa','wind_v_component_700hPa'];
export const DIRECT_VERTICAL_UNITS={'omega_700hPa':'0.1 Pa/s','geopotential_height_700hPa':'m','wind_u_component_700hPa':'m/s','wind_v_component_700hPa':'m/s'};
export const DIRECT_VERTICAL_DOMAINS=[
 {value:'snowline_gem_700',label:'GEM 700 hPa',grid:{type:'regular',nx:674,ny:301,latMin:30,lonMin:-66,dx:.15,dy:.15,zoom:3},time_interval:'3_hourly',model_interval:'12_hourly'},
 {value:'snowline_icon_eu_700',label:'ICON Europe 700 hPa',grid:{type:'regular',nx:937,ny:569,latMin:35,lonMin:-23.5,dx:.0625,dy:.0625,zoom:4},time_interval:'hourly',model_interval:'3_hourly'}
];
export function verifiedDirectVertical(meta,domain=meta?.domain){
 const definition=DIRECT_VERTICAL_DOMAINS.find(d=>d.value===domain),reference=Date.parse(meta?.reference_time);
 return !!definition&&meta?.format_version===1&&meta.domain===domain&&Number.isFinite(reference)&&
  Array.isArray(meta.valid_times)&&meta.valid_times.length>0&&meta.valid_times.every(t=>Number.isFinite(Date.parse(t))&&Date.parse(t)>=reference)&&
  DIRECT_VERTICAL_FIELDS.every(key=>meta.variables?.includes(key)&&meta.units?.[key]===DIRECT_VERTICAL_UNITS[key])&&
  Object.entries(definition.grid).every(([key,value])=>meta.grid?.[key]===value);
}
export function directVerticalNote(meta){
 if(!verifiedDirectVertical(meta))return '';
 return meta.domain==='snowline_gem_700'?
  'Data source: Environment and Climate Change Canada · native 0.15° grid · coverage 66°W–35°E, 30–75°N.':
  'Data source: Deutscher Wetterdienst · native 0.0625° grid · coverage 23.5°W–35°E, 35–70.5°N.';
}
