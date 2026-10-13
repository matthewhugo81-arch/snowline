// Geography for the cloud/rain composite, independent of forecast values.
export const WEATHER_LAND='#dedbcf',WEATHER_SEA='#9fb6c5',MAX_CLOUD_OPACITY=.8;
export const cloudOpacity=value=>Math.max(0,Math.min(MAX_CLOUD_OPACITY,Number.isFinite(value)?value:MAX_CLOUD_OPACITY));
const prefix='weather-geography-';
export function setWeatherBackground(map,enabled,before){
 if(enabled&&!map.getLayer(prefix+'land')){
  const layers=map.getStyle().layers;
  const water=layers.filter(layer=>layer.type==='fill'&&(layer['source-layer']==='water'||layer.id==='water'));
  before??=layers.find(layer=>['line','symbol'].includes(layer.type))?.id;
  map.addLayer({id:prefix+'land',type:'background',paint:{'background-color':WEATHER_LAND}},before);
  for(const [index,layer]of water.entries())map.addLayer({...layer,id:prefix+'water-'+index,layout:{...layer.layout,visibility:'visible'},paint:{'fill-color':WEATHER_SEA,'fill-opacity':1}},before);
 }
 for(const layer of map.getStyle().layers)if(layer.id.startsWith(prefix))map.setLayoutProperty(layer.id,'visibility',enabled?'visible':'none');
}
const cloudy=hex=>'#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*(1-MAX_CLOUD_OPACITY)+255*MAX_CLOUD_OPACITY).toString(16).padStart(2,'0')).join('');
// Both geographic backgrounds use the same 0–100% cloud-cover scale.
export const cloudLegendRows=()=>[WEATHER_LAND,WEATHER_SEA].map(color=>[color,cloudy(color)]);
export const cloudLegendCSS=()=>cloudLegendRows().map((colors,i)=>'linear-gradient(to right,'+colors.join(',')+') left '+(i?'bottom':'top')+' / 100% 50% no-repeat').join(',');
