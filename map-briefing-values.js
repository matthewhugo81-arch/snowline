import {WEATHER_COMPOSITE} from './map-weather-composite.js?v=20261013-map-appearance';
import {fieldSource,fieldDataURL} from './map-sources.js?v=20261014-winter-intensity';
import {sourceVariable} from './map-catalogue.js?v=20261014-winter-intensity';
import {visibleGridPoints,gridValueLabel} from './map-grid.js?v=20261014-winter-intensity';

// One clipped native grid supplies every label, including derived diagnostics.
// There are no point-forecast API calls and no requests per labelled cell.
export async function briefingValueLabels({OM,settings,meta,field,time,bounds,width,height,unproject,project,signal}){
 signal?.throwIfAborted();
 const key=field.key===WEATHER_COMPOSITE?'precipitation':field.key==='theta_w_precipitation_symbols'?'wet_bulb_potential_temperature_850hPa':field.key;
 const source=fieldSource(meta,key,time),domain=settings.domainOptions.find(item=>item.value===source?.domain);
 if(!domain)throw Error('Grid values are unavailable for this model grid.');
 const grid=OM.GridFactory.create(domain.grid);
 const points=visibleGridPoints(grid,width,height,unproject,project);
 if(!points.length)return [];
 const ranges=OM.getRanges(domain.grid,bounds),sampleGrid=OM.GridFactory.create(domain.grid,ranges);
 const reader=OM.getProtocolInstance(settings).omFileReader;
 const data=await reader.readVariable(fieldDataURL(meta,key,time),sourceVariable(source,key),ranges,signal);
 signal?.throwIfAborted();
 return points.flatMap(point=>{
  const value=sampleGrid.getInterpolatedValue(data.values,point.lat,point.lon,'nearest'),label=gridValueLabel(value,field);
  if(label===null)return [];
  const {x,y}=project([point.lon,point.lat]);return [{x,y,lon:point.lon,lat:point.lat,label,value}];
 });
}
