// Expose useful fields only when the selected spatial run actually supplies them.
// Scales follow the bundled Open-Meteo renderer; do not guess units for new keys.
export const PRESSURE_LEVELS = [1000,925,850,700,500,300,250,200,100,50,10];
const HEIGHT_LEVELS = [50,100,200,300];
const GROUPS = ['Temperature','Rain & snow','Wind','Cloud & visibility','Instability & moisture','Soil','Solar radiation','Upper-air temperature','Upper-air wind','Upper-air humidity','Geopotential height'];
// Reference rain colours, with a white dry band for a clean map background.
// The white 0–<0.5 mm band is opaque; missing grid data remains missing.
export const PRECIPITATION_SCALE = {
 stops:[0,.5,1,2,4,6,8,10,15,20,25,30,40,50],
 colors:['#ffffff','#231496','#1538c7','#125c13','#807e10','#a1a13b','#b08131','#a35a35','#993232','#c43650','#ba2388','#dec4c4','#c9bcbc','#f0e7e7'],
 bands:true
};
export function sourceVariable(meta,key){
 if(meta?.sources){for(const source of meta.sources){const variable=sourceVariable(source,key);if(variable)return variable;}return null;}
 const vars=meta?.variables??[];
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
 wind_gusts_10m:['10 m wind gusts','wind','Maximum gust over the model interval, in m/s. Location-chart gusts are shown in mph.'],
 visibility:['Visibility','visibility','Horizontal visibility in metres; lower values can highlight fog and poor visibility.'],
 cloud_cover_low:['Low cloud cover','cloud_cover','Low-level cloud fraction; layer boundaries vary by model.'],
 cloud_cover_mid:['Mid-level cloud cover','cloud_cover','Mid-level cloud fraction; layer boundaries vary by model.'],
 cloud_cover_high:['High cloud cover','cloud_cover','High-level cloud fraction; layer boundaries vary by model.'],
 cloud_cover_2m:['Near-surface cloud (2 m)','cloud_cover','Model cloud fraction near the surface, useful alongside visibility when assessing fog.'],
 cloud_base:['Cloud base','cloud_base','Model cloud-base height in metres.'],
 surface_temperature:['Surface (skin) temperature','temperature','Model surface (skin) temperature; not a road-surface forecast.'],
 rain:['Rain','precipitation','Rain water amount over the native model interval.'],
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
 let [name,scaleKey,note]=extras[key]??[];
 if(key==='rain'||key==='showers')return {key,name,note,group:variableGroup(key),unit:'mm water',...PRECIPITATION_SCALE};
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
 return fields.filter(f=>!f.overlayOnly&&metas.some(m=>sourceVariable(m,f.key))).sort((a,b)=>{
  const group=GROUPS.indexOf(variableGroup(a.key))-GROUPS.indexOf(variableGroup(b.key));
  if(group)return group;
  const ap=a.key.match(/_(\d+)hPa$/),bp=b.key.match(/_(\d+)hPa$/);
  return ap&&bp?Number(bp[1])-Number(ap[1]):a.name.localeCompare(b.name,'en',{numeric:true});
 });
}
export function extendCatalogue(fields,metas,OM,settings){
 const keys=[...new Set(metas.flatMap(m=>m.variables??[]).map(canonicalVariable))];
 const omitted=[];
 for(const key of keys){
  if(!metas.some(meta=>sourceVariable(meta,key)))continue;
  if(!fields.some(f=>f.key===key)){
   const field=describeVariable(key,OM);if(!field){omitted.push(key);continue;}fields.push(field);
  }
  const field=fields.find(f=>f.key===key);
  field.group=variableGroup(key);
  if(key==='wind_speed_10m'){field.name='10 m wind speed & direction';field.note='Shading, legend and readouts display mph; underlying spatial data remains in m/s. Arrows show flow direction.';}
  for(const meta of metas){const source=sourceVariable(meta,key);if(!source)continue;
   settings.colorScales[source]={type:'breakpoint',unit:field.unit,breakpoints:field.stops,colors:field.colors.map(c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16),c.length===9?parseInt(c.slice(7,9),16)/255:1])};
  }
 }
 return omitted;
}
