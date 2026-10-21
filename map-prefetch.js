// Prepare the exact tiles used by the visible map, without creating hundreds of
// hidden MapLibre sources, GPU textures, symbol layouts and render cycles.
const latitude=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
export function tileIntersectsBounds({x,y,z},bounds){
 if(!bounds)return true;
 const [west,south,east,north]=bounds,left=x/2**z*360-180,right=(x+1)/2**z*360-180;
 return latitude(y,z)>south&&latitude(y+1,z)<north&&(west<=east?right>west&&left<east:right>west||left<east);
}
export function forecastTileRequests(map,source,metadata){
 const raster=source.type==='raster';
 const tiles=map.coveringTiles({tileSize:512,minzoom:metadata.minzoom??0,maxzoom:Math.min(source.maxzoom??10,metadata.maxzoom??10),roundZoom:raster,reparseOverscaled:!raster});
 const requests=new Map();
 for(const tile of tiles){
  const point=tile.canonical;
  if(!tileIntersectsBounds(point,metadata.bounds))continue;
  const url=metadata.tiles[0].replace('{z}',point.z).replace('{x}',point.x).replace('{y}',point.y);
  requests.set(url,{url,type:raster?'image':'arrayBuffer'});
 }
 return [...requests.values()];
}
export function createFramePrefetch(map,cache,decorate){
 return async(url,controller,progress=()=>{})=>{
  const sources=[{type:'raster',url,maxzoom:10},...decorate(url).map(group=>group.source)];
  await Promise.all(sources.map(async source=>{
   const {data}=await cache.protocol({url:source.url,type:'json'},controller,{background:true});
   if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
   progress();
   await Promise.all(forecastTileRequests(map,source,data).map(async params=>{await cache.prefetch(params,controller);progress();}));
  }));
 };
}
