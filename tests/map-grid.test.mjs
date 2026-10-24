import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {nearestGridPoint,visibleGridPoints,gridValueLabel} from '../map-grid.js';
import {createPanelOverlays} from '../map-panels.js';

const nativeGrid=id=>OM.GridFactory.create(OM.domainOptions.find(item=>item.value===id).grid);
// Each synthetic value is its native index, so an incorrect coordinate or row
// would read a different value through the renderer's own interpolation path.
const indexValues=new Proxy({}, {get:(_,key)=>Number(key)});
for(const domain of ['ukmo_uk_deterministic_2km','ncep_gfs013','ecmwf_ifs']){
 test(domain+' labels snap to the same native points read by the renderer',()=>{
  const grid=nativeGrid(domain);
  for(const [lat,lon]of [[51.507,-.128],[57.2,-4.71],[53.5,-7.1],[55.8,1.3]]){
   const point=nearestGridPoint(grid,lat,lon);
   assert.ok(point);
   assert.equal(grid.getInterpolatedValue(indexValues,lat,lon,'nearest'),point.id);
   assert.equal(grid.getInterpolatedValue(indexValues,point.lat,point.lon,'nearest'),point.id);
  }
 });
}

test('grid bounds reject unsupported points and regular global grids wrap longitude',()=>{
 const ukv=nativeGrid('ukmo_uk_deterministic_2km');
 assert.equal(nearestGridPoint(ukv,-40,130),null);
 assert.equal(nearestGridPoint(ukv,NaN,-3),null);
 assert.equal(nearestGridPoint(ukv,91,-3),null);
 const gfs=nativeGrid('ncep_gfs013');
 assert.deepEqual(nearestGridPoint(gfs,55,-4),nearestGridPoint(gfs,55,356));
});

test('screen thinning bounds label count and deduplicates coarse native points',()=>{
 const grid=nativeGrid('ncep_gfs013');
 const points=visibleGridPoints(grid,1920,1080,([x,y])=>({lat:61-y/90,lng:-12+x/100}),([lon,lat])=>({x:(lon+12)*100,y:(61-lat)*90}));
 assert.ok(points.length>300&&points.length<=540);
 assert.equal(new Set(points.map(point=>point.id)).size,points.length);
 const repeated=visibleGridPoints(grid,800,500,()=>({lat:55,lng:-4}),()=>({x:400,y:250}));
 assert.equal(repeated.length,1);
});

test('grid label units preserve small amounts and reject missing values',()=>{
 assert.equal(gridValueLabel(100120,{key:'pressure_msl',unit:'hPa'}),'1001');
 assert.equal(gridValueLabel(.035,{unit:'m snow'}),'0.035');
 assert.equal(gridValueLabel(.8,{unit:'mm water'}),'0.8');
 assert.equal(gridValueLabel(3.9,{unit:'°C'}),'4');
 assert.equal(gridValueLabel(-2.7,{unit:'°C'}),'-3');
 assert.equal(gridValueLabel(.4,{unit:'°C'}),'0');
 assert.equal(gridValueLabel(-.4,{unit:'°C'}),'0');
 assert.equal(gridValueLabel(-.001,{unit:'°C'}),'0');
 for(const value of [NaN,Infinity,null,undefined])assert.equal(gridValueLabel(value,{unit:'°C'}),null);
});

test('each panel owns independent contour, pressure and grid switches',()=>{
 const overlays=createPanelOverlays();
 overlays.a.contours=true;overlays.a.isobars=false;overlays.a.grid=true;
 assert.deepEqual(overlays.b,{contours:false,isobars:true,grid:false});
 const fresh=createPanelOverlays();
 assert.deepEqual(fresh.a,overlays.b);
});

// At this zoom a native cell spans 25 px: fixed 42 px sampling used to
// alternate between adjacent columns and skipped columns, leaving stripes.
test('native lattice has no periodically missing rows or columns and zoom reveals every readable cell',()=>{
 const grid=OM.GridFactory.create({type:'regular',nx:1000,ny:1000,latMin:0,lonMin:0,dx:.125,dy:.125});
 const unproject=([x,y])=>({lat:y/200,lng:x/200});
 const project=([lon,lat])=>({x:lon*200,y:lat*200});
 const overview=visibleGridPoints(grid,800,600,unproject,project);
 const close=visibleGridPoints(grid,800,600,unproject,project,{minSpacing:24,maxPoints:1800});
 const gaps=points=>{
  const rows=new Map();for(const p of points){const row=Math.floor(p.id/grid.nx);if(!rows.has(row))rows.set(row,[]);rows.get(row).push(p.id%grid.nx);}
  for(const columns of rows.values()){columns.sort((a,b)=>a-b);const steps=columns.slice(1).map((x,i)=>x-columns[i]);assert.equal(new Set(steps).size,1,'No missing vertical stripes');}
  const ys=[...rows.keys()].sort((a,b)=>a-b);assert.equal(new Set(ys.slice(1).map((y,i)=>y-ys[i])).size,1,'No missing horizontal stripes');
 };
 gaps(overview);gaps(close);assert.ok(close.length>overview.length*2);
 for(const p of close)assert.equal(grid.getInterpolatedValue(indexValues,p.lat,p.lon,'nearest'),p.id);
 const expected=[];grid.forEachPoint(p=>{const s=project([p.lon,p.lat]);if(s.x>=12&&s.x<=788&&s.y>=36&&s.y<=588)expected.push(p.index);},[0,0,4,3]);
 assert.deepEqual(close.map(p=>p.id).sort((a,b)=>a-b),expected.sort((a,b)=>a-b),'All legible native cells are shown at close zoom');
});
