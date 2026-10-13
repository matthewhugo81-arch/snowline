// Forecast cloud, total precipitation and pressure: never observed satellite data.
// Keep colour changes request-local so comparison panels cannot recolour each other.
export const WEATHER_COMPOSITE='cloud_precipitation_mslp';
export const COMPOSITE_FIELDS=['cloud_cover','precipitation','pressure_msl'];
export function compositeMeta(meta){
 if(!meta?.sources)return meta;
 const reference=Date.parse(meta.reference_time);
 return {...meta,sources:meta.sources.filter(source=>Number.isFinite(reference)&&Date.parse(source.reference_time)===reference)};
}
export function compositeField(precipitationScale){
 return {key:WEATHER_COMPOSITE,name:'Cloud, precipitation & MSLP',unit:'mm water',...precipitationScale,
  note:'Satellite-style modelled total cloud cover, not satellite observations: dark = clear, white = overcast. Coloured shading is TOTAL precipitation, including the water equivalent of snow, over the stated native interval. Below 0.5 mm the cloud remains visible; this does not imply zero precipitation. MSLP isobars every 4 hPa. All components use the same model run and valid time. Optional contours, grid values and clicked values refer to precipitation in mm water.'};
}
export function compositeSettings(settings){
 const cloud=settings.colorScales.cloud_cover,rain=settings.colorScales.precipitation;
 return {...settings,colorScales:{...settings.colorScales,
  cloud_cover:{...cloud,colors:cloud.colors.map((_,index)=>{const shade=Math.round(65+165*cloud.breakpoints[index]/100);return [shade,shade,shade,1];})},
  precipitation:{...rain,colors:rain.colors.map((color,index)=>index===0?[...color.slice(0,3),0]:[...color])}
 }};
}
// The flag stays in TileJSON templates and worker/cache keys, not the data-file URL.
export const compositeURL=url=>url+'&weather_composite=1&cloud_style=20261013-white90';
export const isCompositeURL=url=>/[?&]weather_composite=1(?:[&/]|$)/.test(url);
export function compositeUnderlay(url){
 return {id:'cloud',placement:'underlay',source:{type:'raster',url,tileSize:512,maxzoom:10},
  layers:[{id:'cloud-image',type:'raster',paint:{'raster-opacity':1,'raster-resampling':'linear','raster-fade-duration':0,'raster-opacity-transition':{duration:0}}}]};
}
