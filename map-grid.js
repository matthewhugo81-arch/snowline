import {displayValue,displayUnit} from './map-wind-units.js';
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

export function visibleGridPoints(grid,width,height,unproject,project){
 const spacing=Math.max(42,Math.sqrt(width*height/540)),seen=new Set(),points=[];
 for(let y=48;y<height-24;y+=spacing)for(let x=28;x<width-20;x+=spacing){
  const position=unproject([x,y]),point=nearestGridPoint(grid,position.lat,position.lng);
  if(!point||seen.has(point.id))continue;
  const screen=project([point.lon,point.lat]);
  if(screen.x<12||screen.x>width-12||screen.y<36||screen.y>height-12)continue;
  seen.add(point.id);points.push(point);
 }
 return points;
}

export function gridValueLabel(value,field){
 if(!Number.isFinite(value))return null;
 if(field.key==='pressure_msl'&&value>2000)value/=100;
 value=displayValue(value,field);
 const digits=field.unit==='m snow'||field.unit==='m³/m³'?3:displayUnit(field)==='mph'?0:field.unit==='m/s'||field.unit==='mm water'?1:0;
 const rounded=Number(value.toFixed(digits));
 return Object.is(rounded,-0)?'0':String(rounded);
}
