import {displayValue,displayUnit} from './map-wind-units.js?v=20261019-ensemble-extra4';
const wrap=(value,size)=>((value%size)+size)%size;
const longitude=value=>wrap(value+180,360)-180;

// Match the native regular, projected and reduced Gaussian grids in the renderer.
// Labels are thinned on screen; positions and values remain on the model grid.
export function nearestGridPoint(grid,latitude,lon){
 if(!Number.isFinite(latitude)||!Number.isFinite(lon)||Math.abs(latitude)>90)return null;
 let x,y,lat;
 if(grid.projection){
  const point=grid.findPointInterpolated(latitude,lon);
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
  x=Math.min(grid.nx-1,Math.round(point.x+point.xFraction));
  y=Math.min(grid.ny-1,Math.round(point.y+point.yFraction));
  [lat,lon]=grid.projection.reverse(grid.minX+x*grid.dx,grid.minY+y*grid.dy);
 }else if(grid.latitudeLines){
  const step=180/(2*grid.latitudeLines+.5);
  y=Math.max(0,Math.min(2*grid.latitudeLines-1,Math.round(grid.latitudeLines-1-(latitude-step/2)/step)));
  const count=grid.nxOf(y);x=wrap(Math.round(lon/(360/count)),count);
  return {id:grid.integral(y)+x,lat:(grid.latitudeLines-y-1)*step+step/2,lon:longitude(x*360/count)};
 }else{
  let column=(lon-grid.originLon)/grid.dx,row=(latitude-grid.originLat)/grid.dy;
  if(row<0||row>grid.ny-1||!grid.longitudeWrap&&(column<0||column>grid.nx-1))return null;
  x=Math.round(column);y=Math.round(row);
  if(grid.longitudeWrap)x=wrap(x,grid.nx);else x=Math.min(grid.nx-1,x);
  lat=grid.originLat+y*grid.dy;lon=grid.originLon+x*grid.dx;
 }
 return {id:y*grid.nx+x,lat,lon:longitude(lon)};
}

function indexedGridPoint(grid,x,y){
 let lat,lon;
 if(grid.latitudeLines){
  y=Math.max(0,Math.min(2*grid.latitudeLines-1,y));
  const step=180/(2*grid.latitudeLines+.5),count=grid.nxOf(y);
  x=wrap(x,count);lat=(grid.latitudeLines-y-1)*step+step/2;lon=x*360/count;
  return {id:grid.integral(y)+x,lat,lon:longitude(lon)};
 }
 if(y<0||y>=grid.ny)return null;
 if(grid.longitudeWrap)x=wrap(x,grid.nx);
 if(x<0||x>=grid.nx)return null;
 if(grid.projection)[lat,lon]=grid.projection.reverse(grid.minX+x*grid.dx,grid.minY+y*grid.dy);
 else {lat=grid.originLat+y*grid.dy;lon=grid.originLon+x*grid.dx;}
 return {id:y*grid.nx+x,lat,lon:longitude(lon)};
}
function gridIndices(grid,point){
 if(!grid.latitudeLines)return {x:point.id%grid.nx,y:Math.floor(point.id/grid.nx)};
 const step=180/(2*grid.latitudeLines+.5),y=Math.round(grid.latitudeLines-1-(point.lat-step/2)/step);
 return {x:point.id-grid.integral(y),y};
}
export function gridLabelDensity(zoom){
 const detail=Math.max(0,Math.min(1,(zoom-5)/4));
 return {minSpacing:42-18*detail,maxPoints:Math.round(540+1260*detail)};
}
export function visibleGridPoints(grid,width,height,unproject,project,{minSpacing=42,maxPoints=540}={}){
 const spacing=Math.max(minSpacing,Math.sqrt(width*height/maxPoints)),seen=new Set(),points=[];
 const center=unproject([width/2,height/2]),anchor=nearestGridPoint(grid,center.lat,center.lng);
 let strideX=1,strideY=1;
 if(anchor){
  const {x,y}=gridIndices(grid,anchor),screen=project([anchor.lon,anchor.lat]);
  const distance=point=>{if(!point)return spacing;const p=project([point.lon,point.lat]);return Math.hypot(p.x-screen.x,p.y-screen.y)||spacing;};
  strideX=Math.max(1,Math.ceil(spacing/distance(indexedGridPoint(grid,x+1,y))));
  const nextRowX=grid.latitudeLines&&y+1<2*grid.latitudeLines?Math.round(x*grid.nxOf(y+1)/grid.nxOf(y)):x;
  strideY=Math.max(1,Math.ceil(spacing/distance(indexedGridPoint(grid,nextRowX,y+1))));
 }
 // Select a consistent native lattice, rather than periodically skipping native
 // rows/columns when a fixed screen lattice rounds onto the model grid.
 // Oversampling only discovers candidates; labels remain deduplicated native cells.
 for(let y=0;y<height;y+=spacing/2)for(let x=0;x<width;x+=spacing/2){
  const position=unproject([x,y]),point=nearestGridPoint(grid,position.lat,position.lng);
  if(!point)continue;
  const indices=gridIndices(grid,point),row=Math.round(indices.y/strideY)*strideY;
  const column=grid.latitudeLines?Math.round(longitude(point.lon)/(360/grid.nxOf(Math.max(0,Math.min(2*grid.latitudeLines-1,row))))):indices.x;
  const selected=indexedGridPoint(grid,Math.round(column/strideX)*strideX,row);
  if(!selected||seen.has(selected.id))continue;
  const screen=project([selected.lon,selected.lat]);
  if(screen.x<12||screen.x>width-12||screen.y<36||screen.y>height-12)continue;
  seen.add(selected.id);points.push(selected);
 }
 return points;
}

export function gridValueLabel(value,field){
 if(!Number.isFinite(value)||Number.isFinite(field.displayMinimum)&&value<field.displayMinimum)return null;
 if(field.categoryLabels)return field.categoryLabels[value]??null;
 if(field.key==='pressure_msl'&&value>2000)value/=100;
 value=displayValue(value,field);
 const digits=field.decimals??(field.unit==='m snow'||field.unit==='m³/m³'?3:displayUnit(field)==='mph'?0:field.unit==='m/s'||(field.unit==='mm water'||field.unit==='mm/h')?1:0);
 const rounded=Number(value.toFixed(digits));
 return Object.is(rounded,-0)?'0':String(rounded);
}
