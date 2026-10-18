import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastReadBounds} from '../vendor/forecast-read-bounds.mjs';
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
test('wrapped views still read both sides and small pans reuse the same read bounds',()=>{
 assert.deepEqual(forecastReadBounds([170,40,190,60]).filter((_,i)=>i%2===0),[-180,180]);
 assert.deepEqual(forecastReadBounds([170,40,-170,60]).filter((_,i)=>i%2===0),[-180,180]);
 assert.deepEqual(forecastReadBounds(view),forecastReadBounds(view.map(x=>x+.001)));
});
