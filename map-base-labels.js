// Country labels use OpenMapTiles ISO codes. Keep the provider's rank filters
// and all other place labels while clearing the large name over UK weather.
export function hideUKCountryLabel(map){
 for(const layer of map.getStyle().layers){
  if(layer.type==='symbol'&&layer['source-layer']==='place'&&layer.id.startsWith('label_country_')){
   map.setFilter(layer.id,['all',layer.filter??true,['!=',['get','iso_a2'],'GB']]);
  }
 }
}
