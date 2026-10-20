// Native-resolution subsets keep this UK/Europe diagnostic within Pages storage.
export const DIRECT_VERTICAL_MODELS={gem_global:'snowline_gem_700',icon_eu:'snowline_icon_eu_700'};
export const DIRECT_VERTICAL_FIELDS=['omega_700hPa','geopotential_height_700hPa','wind_u_component_700hPa','wind_v_component_700hPa'];
export const DIRECT_VERTICAL_UNITS={'omega_700hPa':'0.1 Pa/s','geopotential_height_700hPa':'m','wind_u_component_700hPa':'m/s','wind_v_component_700hPa':'m/s'};
export const DIRECT_VERTICAL_DOMAINS=[
 {value:'snowline_gem_700',label:'GEM 700 hPa',grid:{type:'regular',nx:674,ny:301,latMin:30,lonMin:-66,dx:.15,dy:.15,zoom:3},time_interval:'3_hourly',model_interval:'12_hourly'},
 {value:'snowline_icon_eu_700',label:'ICON Europe 700 hPa',grid:{type:'regular',nx:937,ny:569,latMin:35,lonMin:-23.5,dx:.0625,dy:.0625,zoom:4},time_interval:'hourly',model_interval:'3_hourly'}
];
export const GEM_UPPER_FIELDS=Object.entries({temperature:[1000,850,500,250],geopotential_height:[500,300,200],relative_humidity:[1000,700,300],wind_u_component:[1000,500,300,200],wind_v_component:[1000,500,300,200]}).flatMap(([kind,levels])=>levels.map(level=>kind+'_'+level+'hPa'));
DIRECT_VERTICAL_DOMAINS.push({...DIRECT_VERTICAL_DOMAINS[0],value:'snowline_gem_upper',label:'GEM upper air'});
const upperUnit=key=>key.startsWith('temperature_')?'°C':key.startsWith('geopotential_height_')?'m':key.startsWith('relative_humidity_')?'%':'m/s';
export function verifiedDirectVertical(meta,domain=meta?.domain){
 const definition=DIRECT_VERTICAL_DOMAINS.find(d=>d.value===domain),reference=Date.parse(meta?.reference_time);
 return !!definition&&meta?.format_version===1&&meta.domain===domain&&Number.isFinite(reference)&&
  Array.isArray(meta.valid_times)&&meta.valid_times.length>0&&meta.valid_times.every(t=>Number.isFinite(Date.parse(t))&&Date.parse(t)>=reference)&&
  (domain==='snowline_gem_upper'?GEM_UPPER_FIELDS:DIRECT_VERTICAL_FIELDS).every(key=>meta.variables?.includes(key)&&meta.units?.[key]===(domain==='snowline_gem_upper'?upperUnit(key):DIRECT_VERTICAL_UNITS[key]))&&
  Object.entries(definition.grid).every(([key,value])=>meta.grid?.[key]===value);
}
export function directVerticalNote(meta){
 if(!verifiedDirectVertical(meta))return '';
 return meta.domain.startsWith('snowline_gem_')?
  'Data source: Environment and Climate Change Canada · native 0.15° grid · coverage 66°W–35°E, 30–75°N.':
  'Data source: Deutscher Wetterdienst · native 0.0625° grid · coverage 23.5°W–35°E, 35–70.5°N.';
}
