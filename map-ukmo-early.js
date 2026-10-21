// Direct native-resolution regional charts supplement UKMO while the full feed arrives.
export const UKMO_NATIVE='ukmo_global_deterministic_10km';
export const UKMO_EARLY='snowline_ukmo_early';
export const UKMO_EARLY_GRID={type:'regular',nx:753,ny:480,latMin:30.046875,lonMin:-65.8828125,dx:.140625,dy:.09375,zoom:3};
export const UKMO_EARLY_DOMAINS=[{value:UKMO_EARLY,label:'UKMO direct native subset',grid:UKMO_EARLY_GRID,time_interval:'hourly',model_interval:'6_hourly'}];
const units={temperature_2m:'°C',temperature_850hPa:'°C',geopotential_height_500hPa:'m',pressure_msl:'hPa',cloud_cover:'%',precipitation:'mm'};
export function verifiedUKMOEarly(meta,reference){
 const init=Date.parse(meta?.reference_time);
 return !!meta&&meta.format_version===1&&meta.domain===UKMO_EARLY&&meta.completed===false&&Number.isFinite(init)&&
  (!reference||init===Date.parse(reference))&&Object.entries(UKMO_EARLY_GRID).every(([key,value])=>meta.grid?.[key]===value)&&
  Array.isArray(meta.valid_times)&&meta.valid_times.length>0&&meta.valid_times.every(t=>Number.isFinite(Date.parse(t))&&Date.parse(t)>=init&&Date.parse(t)<=init+168*3600000)&&
  Array.isArray(meta.variables)&&meta.variables.length>0&&meta.variables.every(key=>Object.hasOwn(units,key)&&meta.units?.[key]===units[key]&&Array.isArray(meta.variable_valid_times?.[key])&&meta.variable_valid_times[key].length>0&&meta.variable_valid_times[key].every(t=>meta.valid_times.includes(t)&&(key!=='precipitation'||Date.parse(t)>init)));
}
// A small early subset cannot establish completeness. Once the full native run
// completes, the retained subset no longer blocks that same initialization.
export function completedSources(sources){
 const native=sources.find(s=>s.domain===UKMO_NATIVE&&s.completed===true);
 return sources.length>0&&sources.every(s=>s.completed===true||
  (s.domain===UKMO_EARLY&&native&&Date.parse(s.reference_time)===Date.parse(native.reference_time)));
}
export const UKMO_EARLY_NOTE='Early UKMO charts from the Met Office native 10 km feed cover the North Atlantic, UK and Europe (66°W–40°E, 30–75°N). Other fields arrive with the full feed. British Crown copyright, Met Office, CC BY-SA 4.0.';
