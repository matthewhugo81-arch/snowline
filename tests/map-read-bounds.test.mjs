import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastReadBounds,forecastTileReadBounds} from '../vendor/forecast-read-bounds.mjs';
import * as OM from '../vendor/index.mjs';
const view=[-128.4367843299916,30.268630075242456,98.43678432998934,74.56855067084584];
test('read bounds contain every visible point without expanding a wide view to the whole globe',()=>{
 const bounds=forecastReadBounds(view);OM.updateCurrentBounds(view);assert.deepEqual(OM.currentBounds,bounds);
 for(const input of [view,[-12,48,6,61],[-5,50,-4.8,50.2],[-180,-85,180,85],[-180,-90,180,90]]){
  const output=forecastReadBounds(input);
  assert.ok(output[0]<=input[0]&&output[2]>=input[2]);
  assert.ok(output[1]<=Math.max(-85.0511287798066,input[1])+1e-10);
  assert.ok(output[3]>=Math.min(85.0511287798066,input[3])-1e-10);
 }
 for(const domain of ['ecmwf_ifs','ukmo_global_deterministic_10km','ncep_gfs013']){
  const config=OM.domainOptions.find(item=>item.value===domain).grid;
  const count=ranges=>ranges.reduce((n,r)=>n*(r.end-r.start),1);
  const old=count(OM.getRanges(config,[-180,0,180,85.0511287798066])),next=count(OM.getRanges(config,bounds));
  assert.ok(next<old*.6,domain+' reads at least 40% fewer native cells');
 }
});

test('complete tile reads are stable, share adjacent grids and include a native halo',()=>{
 const lat=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
 for(const tile of [{z:0,x:0,y:0},{z:5,x:15,y:10},{z:10,x:511,y:320},{z:5,x:31,y:31}]){
  const bounds=forecastTileReadBounds(tile),{z,x,y}=tile;
  assert.ok(bounds[0]<=x/2**z*360-180&&bounds[2]>=(x+1)/2**z*360-180);
  assert.ok(bounds[1]<lat(y+1,z)&&bounds[3]>lat(y,z));
  assert.ok(bounds[0]>=-180&&bounds[2]<=180&&bounds[1]>=-90&&bounds[3]<=90);
 }
 assert.deepEqual(forecastTileReadBounds({z:5,x:14,y:10}),forecastTileReadBounds({z:5,x:15,y:11}));
 const bounds=forecastTileReadBounds({z:5,x:15,y:10});
 OM.updateCurrentBounds([-2,52,0,54]);assert.deepEqual(forecastTileReadBounds({z:5,x:15,y:10}),bounds);
 OM.updateCurrentBounds([20,30,40,60]);assert.deepEqual(forecastTileReadBounds({z:5,x:15,y:10}),bounds);
});
test('wrapped views still read both sides and small pans reuse the same read bounds',()=>{
 assert.deepEqual(forecastReadBounds([170,40,190,60]).filter((_,i)=>i%2===0),[-180,180]);
 assert.deepEqual(forecastReadBounds([170,40,-170,60]).filter((_,i)=>i%2===0),[-180,180]);
 assert.deepEqual(forecastReadBounds(view),forecastReadBounds(view.map(x=>x+.001)));
});
