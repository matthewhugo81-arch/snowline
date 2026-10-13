export const MAP_BACKGROUNDS={light:'positron',streets:'liberty'};
export const backgroundStyle=(key='light')=>'https://tiles.openfreemap.org/styles/'+(MAP_BACKGROUNDS[key]??MAP_BACKGROUNDS.light);
export const backgroundOptions='<option value="light">Map 1</option><option value="streets">Map 2</option>';

// Protected-area polygons include marine reserves. Their pale dashed outlines
// become misleading shapes when the base map's linework sits above forecasts.
export function hideProtectedAreas(map){
 for(const layer of map.getStyle().layers)if(layer['source-layer']==='park')map.setLayoutProperty(layer.id,'visibility','none');
}
