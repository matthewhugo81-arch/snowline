import {fieldSource,fieldDataURL} from './map-sources.js?v=20261012-weather-composite';
import {sourceVariable} from './map-catalogue.js?v=20261012-weather-composite';
import {visibleGridPoints,gridValueLabel} from './map-grid.js?v=20261011-briefing-overlays';

// One clipped native grid supplies every label, including derived diagnostics.
// There are no point-forecast API calls and no requests per labelled cell.
export async function briefingValueLabels({OM,settings,meta,field,time,bounds,width,height,unproject,project,signal}){
 signal?.throwIfAborted();
 const source=fieldSource(meta,field.key,time),domain=settings.domainOptions.find(item=>item.value===source?.domain);
 if(!domain)throw Error('Grid values are unavailable for this model grid.');
 const grid=OM.GridFactory.create(domain.grid);
 const points=visibleGridPoints(grid,width,height,unproject,project,{minSpacing:96,maxPoints:100});
 if(!points.length)return [];
 const ranges=OM.getRanges(domain.grid,bounds),sampleGrid=OM.GridFactory.create(domain.grid,ranges);
 const reader=OM.getProtocolInstance(settings).omFileReader;
 const data=await reader.readVariable(fieldDataURL(meta,field.key,time),sourceVariable(source,field.key),ranges,signal);
 signal?.throwIfAborted();
 return points.flatMap(point=>{
  const value=sampleGrid.getInterpolatedValue(data.values,point.lat,point.lon,'nearest'),label=gridValueLabel(value,field);
  if(label===null)return [];
  const {x,y}=project([point.lon,point.lat]);return [{x,y,label,value}];
 });
}

export function drawBriefingValues(canvas,labels,width,height){
 const context=canvas.getContext('2d');
 context.save();context.scale(canvas.width/width,canvas.height/height);
 context.font='600 20px Arial, sans-serif';context.textAlign='center';context.textBaseline='middle';
 context.lineJoin='round';context.lineWidth=4;context.strokeStyle='rgba(255,255,255,0.94)';context.fillStyle='#101820';
 for(const {x,y,label}of labels){context.strokeText(label,x,y);context.fillText(label,x,y);}
 context.restore();
}
