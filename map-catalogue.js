// Build choices from each run's actual spatial catalogue, not a fixed shortlist.
export function sourceVariable(meta,key){
 const vars=meta?.variables??[];
 if(key.startsWith('wind_speed_')){
  const suffix=key.slice(11),u='wind_u_component_'+suffix,v='wind_v_component_'+suffix;
  if(vars.includes(key)&&vars.includes('wind_direction_'+suffix))return key;
  if(vars.includes(u)&&vars.includes(v))return u;
  return null;
 }
 if(key==='ocean_current_speed')return vars.includes('ocean_u_current')&&vars.includes('ocean_v_current')?'ocean_u_current':null;
 return vars.includes(key)?key:null;
}
export function canonicalVariable(key){
 if(/^wind_[uv]_component_/.test(key))return key.replace(/^wind_[uv]_component_/,'wind_speed_');
 if(key.startsWith('wind_direction_'))return key.replace('wind_direction_','wind_speed_');
 if(/^ocean_[uv]_current$/.test(key))return 'ocean_current_speed';
 return key;
}
export function variableGroup(key){
 if(/hPa/.test(key))return 'Pressure levels';
 if(/^soil_/.test(key))return 'Soil';
 if(/radiation|heat_flux|^uv_/.test(key))return 'Radiation & energy';
 if(/ocean|sea_ice|sea_level/.test(key))return 'Ocean';
 if(/_(\d+)m$/.test(key)&&!/_2m$|_10m$/.test(key))return 'Height levels';
 if(/spread$/.test(key))return 'Ensemble spread';
 return 'Surface & atmosphere';
}
const hex=rgba=>'#'+rgba.slice(0,3).map(n=>Math.round(n).toString(16).padStart(2,'0')).join('')+Math.round((rgba[3]??1)*255).toString(16).padStart(2,'0');
const plain=key=>key.replace(/_/g,' ').replace(/hPa/g,' hPa').replace(/(\d)(cm|m)\b/g,'$1 $2').replace(/\bto\b/g,'–').replace(/^./,s=>s.toUpperCase());
export function describeVariable(key,OM){
 const group=variableGroup(key);
 let scaleKey=key,unit,note='Native model field at the displayed valid time.',categorical=false;
 const defaults=OM.defaultOmProtocolSettings.colorScales;
 if(/^temperature|^surface_temperature|^soil_temperature/.test(key))scaleKey='temperature';
 else if(/^dew_point/.test(key))scaleKey='dew_point';
 else if(/^relative_humidity/.test(key))scaleKey='relative';
 else if(/^cloud_cover/.test(key))scaleKey='cloud_cover';
 else if(/^wind_|^ocean_current/.test(key))scaleKey='wind';
 else if(/^soil_moisture/.test(key)){scaleKey='soil_moisture';unit='m³/m³';}
 else if(/^geopotential_height/.test(key))scaleKey=key;
 else if(/^vertical_velocity/.test(key))scaleKey='vertical_velocity';
 else if(/^shortwave_radiation/.test(key))scaleKey='shortwave';
 else if(/^uv_index/.test(key))scaleKey='uv';
 else if(/^total_column_integrated_water_vapour/.test(key))scaleKey='total_column';
 else if(key==='pressure_msl')scaleKey='pressure';
 else if(/^(rain|showers|hail|runoff|precipitation_spread)$/.test(key)){scaleKey='precipitation';note='Water amount over the native model interval.';}
 else if(key==='snowfall_height')scaleKey='freezing_level_height';
 else if(key==='snowfall_water_equivalent'||key==='snow_depth_water_equivalent')scaleKey='precipitation';
 else if(key==='sea_ice_thickness'||key==='sea_level_height_msl'){scaleKey='snow_depth';unit='m';}
 else if(key==='pressure_msl_spread'){unit='native pressure units';note='Ensemble pressure spread in the spatial feed’s native units; not mean sea-level pressure.';}
 let scale;
 if(key==='pressure_msl_spread'){
  scale={breakpoints:[0,10,25,50,100,250,500,1000,2000],colors:['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#08519c','#08306b']};
 }else if(key==='weather_code'||key==='precipitation_type'){
  categorical=true;unit=key==='weather_code'?'WMO code':'model code';
  scale={breakpoints:key==='weather_code'?[0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]:[0,1,2,3,4,5,6,7,8],colors:[]};
  const palette=['#f5f5f5','#b5d4ee','#7faace','#6b7685','#afb2ba','#887f96','#7fb3ff','#467cdb','#263ac9','#9877d7','#634b9c','#459ed1','#176cac','#073c7e','#d879b7','#a23e91','#e0adf6','#b67ee9','#7942be','#dfd1ec','#3b95c8','#20608e','#0c3159','#a157c6','#5b278d','#ecab30','#e87725','#c42929'];
  scale.colors=scale.breakpoints.map((_,i)=>palette[i%palette.length]);
  note=key==='weather_code'?'WMO weather code. Discrete categories; no interpolation or contours.':'Native precipitation-type code. Code meanings are model-specific; equal codes need not mean the same type across models.';
 }else{
  // Never silently fall back to a temperature scale for an unknown variable.
  if(!defaults[scaleKey]&&!/^geopotential_height_\d+hPa/.test(scaleKey))return null;
  const raw=OM.getColorScale(scaleKey,false);
  scale={breakpoints:raw.breakpoints,colors:raw.colors.map(hex)};unit??=raw.unit;
 }
 let name=plain(key);
 if(/^wind_speed_/.test(key)){name=plain(key).replace('Wind speed','Wind speed & direction');note='Shading shows speed in m/s; arrows show flow direction. Calculated from U/V components where supplied.';}
 if(key==='ocean_current_speed'){name='Ocean current speed & direction';note='Speed and flow direction calculated from the model’s U/V ocean-current components.';}
 if(key==='surface_temperature')note='Model surface (skin) temperature; not a road-surface forecast.';
 if(group==='Pressure levels'){const level=key.match(/_(\d+)hPa/);if(level)name=level[1]+' hPa · '+name.replace(/ \d+ hPa/,'');}
 if(group==='Pressure levels')note+=' Pressure surfaces can lie below terrain.';
 return {key,name,group,unit,note,stops:scale.breakpoints,colors:scale.colors,categorical,bands:categorical,contourValues:categorical?[]:undefined};
}
export function extendCatalogue(fields,metas,OM,settings){
 const keys=[...new Set(metas.flatMap(m=>m.variables??[]).map(canonicalVariable))];
 const omitted=[];
 for(const key of keys){
  if(!fields.some(f=>f.key===key)){
   const field=describeVariable(key,OM);if(!field){omitted.push(key);continue;}fields.push(field);
  }
  const field=fields.find(f=>f.key===key);
  if(/hPa/.test(key))field.group='Pressure levels';
  if(key==='wind_speed_10m'){field.name='10 m wind speed & direction';field.note='Shading shows wind speed in m/s; arrows show flow direction. Calculated from U/V components where supplied.';}
  for(const meta of metas){const source=sourceVariable(meta,key);if(!source)continue;
   settings.colorScales[source]={type:'breakpoint',unit:field.unit,breakpoints:field.stops,colors:field.colors.map(c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16),c.length===9?parseInt(c.slice(7,9),16)/255:1])};
  }
 }
 return omitted;
}
