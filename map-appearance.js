import {hideUKCountryLabel} from './map-base-labels.js?v=20261013-three-run-charts';
import {hideProtectedAreas} from './map-backgrounds.js?v=20261013-map-appearance';
import {coastlineController} from './map-coastline.js?v=20261024-loading-verified1';
export {coastlineController};

// Interactive maps, briefing PNGs and their exports share these drawing rules.
export const mapAppearance=({opacity=.8,terrain=true,roads=false}={})=>({opacity,terrain,roads});
export const appearanceKey=appearance=>JSON.stringify(mapAppearance(appearance));
export const rasterResampling=field=>field?.bands||field?.anomalyBands?'nearest':'linear';
export function applyRoads(map,roads=false){for(const layer of map.getStyle().layers)if(['transportation','transportation_name'].includes(layer['source-layer']))map.setLayoutProperty(layer.id,'visibility',roads?'visible':'none');}
export function applyMapAppearance(map,appearance={}){
 const {roads,terrain}=mapAppearance(appearance);
 coastlineController(map).ensure();
 hideUKCountryLabel(map);hideProtectedAreas(map);applyRoads(map,roads);drawTerrain(map,terrain);
}
export function drawCoastline(map,before){
 coastlineController(map).ensure(before);
}
export function drawTerrain(map,terrain=true){
 if(!terrain){if(map.getLayer('terrain-shading'))map.setLayoutProperty('terrain-shading','visibility','none');return;}
 if(!map.getSource('terrain-dem'))map.addSource('terrain-dem',{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,maxzoom:15,encoding:'terrarium',attribution:'Terrain: <a href="map-credits.html#terrain">Mapzen / terrain sources</a>'});
 if(!map.getLayer('terrain-shading')){
  const water=map.getStyle().layers.find(layer=>layer.type==='fill'&&layer['source-layer']==='water');
  map.addLayer({id:'terrain-shading',type:'hillshade',source:'terrain-dem',paint:{'hillshade-exaggeration':.8,'hillshade-illumination-direction':315,'hillshade-illumination-anchor':'map','hillshade-shadow-color':'#263c32','hillshade-highlight-color':'#ffffff','hillshade-accent-color':'#506658'}},water?.id);
 }else map.setLayoutProperty('terrain-shading','visibility','visible');
}

export function orderForecastBasemap(map){
 const base=map.getStyle().layers.filter(layer=>['line','symbol'].includes(layer.type)&&layer.id!=='coast-line');
 for(const layer of base)map.moveLayer(layer.id);
 const rasterBefore=base[0]?.id,overlayBefore=base.find(layer=>layer.type==='symbol')?.id;
 drawCoastline(map,overlayBefore);
 return {rasterBefore,overlayBefore};
}
export function gridLabelLayer(id='grid-labels',source='grid-values'){
 return {id,type:'symbol',source,layout:{'text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':11,'text-padding':4,'text-allow-overlap':false},paint:{'text-color':'#101820','text-halo-color':'rgba(255,255,255,0.9)','text-halo-width':1.5}};
}
