import test from 'node:test';
import assert from 'node:assert/strict';
import {chartWindow, indexAtX, selectionRange, transformRange} from '../chart-window.js';
import {buildDataset, datasetCSV, datasetHTML} from '../export.js';
import {normalise, VARIABLES} from '../data.js';

const times = Array.from({length:168}, (_,i)=>new Date(Date.UTC(2026,9,12,19+i)).toISOString().replace('.000Z','Z'));
const layout = {left:43, inner:600, n:168, start:0};
const x = (i, l=layout)=>l.left + (i-l.start)/(l.n-1)*l.inner;

test('all preset horizons preserve the original timeline',()=>{
  for(const hours of [24,48,72,120,168]) assert.deepEqual(chartWindow({times,hours}),{start:0,end:hours-1,times:times.slice(0,hours)});
});
test('zoom includes both actual hourly endpoints without mutating source times',()=>{
  assert.deepEqual(chartWindow({times,hours:168,zoom:{start:45,end:70}}),{start:45,end:70,times:times.slice(45,71)});
  assert.equal(times.length,168);
});
test('left-to-right and right-to-left selections produce the same interval',()=>{
  assert.deepEqual(selectionRange(x(45),x(70),layout),{start:45,end:70});
  assert.deepEqual(selectionRange(x(70),x(45),layout),{start:45,end:70});
});
test('nested zoom maps to absolute forecast hours, not the start of the dataset',()=>{
  const nested={...layout,n:26,start:45};
  assert.equal(indexAtX(x(60,nested),nested),60);
  assert.deepEqual(selectionRange(x(50,nested),x(65,nested),nested),{start:50,end:65});
});
test('off-chart releases clamp to the current visible range',()=>{
  const nested={...layout,n:26,start:45};
  assert.deepEqual(selectionRange(-1000,10000,nested),{start:45,end:70});
});
test('zero-span selection and invalid coordinates are ignored',()=>{
  assert.equal(selectionRange(x(2),x(2)+.1,layout),null);
  assert.equal(selectionRange(NaN,x(3),layout),null);
  assert.equal(selectionRange(10,20,{...layout,n:1}),null);
  assert.equal(indexAtX(20,{...layout,inner:0}),null);
});
test('the minimum useful zoom is two adjacent hourly samples',()=>{
  assert.deepEqual(selectionRange(x(10),x(11),layout),{start:10,end:11});
  assert.equal(chartWindow({times,zoom:{start:10,end:11}}).times.length,2);
});
test('empty, short and invalid stored windows do not create invalid timestamps',()=>{
  assert.deepEqual(chartWindow({times:[]}),{start:0,end:-1,times:[]});
  assert.equal(chartWindow({times:times.slice(0,2),hours:168}).end,1);
  for(const zoom of [{start:40,end:20},{start:180,end:200},{start:NaN,end:20},{start:4,end:4}]) assert.equal(chartWindow({times,zoom}).start,0);
  assert.deepEqual(chartWindow({times,hours:24,zoom:{start:20,end:30}}).times,times.slice(20,24));
});
test('reset restores the chosen horizon',()=>{
  const state={times,hours:72,zoom:{start:30,end:50}};
  assert.equal(chartWindow(state).times.length,21);
  state.zoom=null;
  assert.deepEqual(chartWindow(state).times,times.slice(0,72));
});

test('pinch keeps the hour under the finger midpoint anchored',()=>{
  assert.deepEqual(transformRange({start:20,end:100},{length:168,scale:2,anchor:.25}),{start:30,end:70});
  assert.deepEqual(transformRange({start:30,end:70},{length:168,scale:.5,anchor:.25}),{start:20,end:100});
});
test('two-finger translation pans the window in either direction',()=>{
  assert.deepEqual(transformRange({start:40,end:80},{length:168,anchor:.5,midpoint:.75}),{start:30,end:70});
  assert.deepEqual(transformRange({start:40,end:80},{length:168,anchor:.5,midpoint:.25}),{start:50,end:90});
});
test('pinch and buttons clamp to the chosen horizon and adjacent hourly samples',()=>{
  assert.deepEqual(transformRange({start:20,end:40},{length:72,scale:.01}),{start:0,end:71});
  assert.deepEqual(transformRange({start:20,end:40},{length:72,scale:100}),{start:30,end:31});
  assert.deepEqual(transformRange({start:20,end:40},{length:72,midpoint:100}),{start:0,end:20});
  assert.deepEqual(transformRange({start:20,end:40},{length:72,midpoint:-100}),{start:51,end:71});
});
test('degenerate pinch input never creates an invalid shared range',()=>{
  for(const scale of [0,-1,NaN,Infinity]) assert.equal(transformRange({start:0,end:23},{length:24,scale}),null);
  assert.equal(transformRange({start:0,end:0},{length:1}),null);
});
test('UTC timestamps retain the correct midnight/day boundary',()=>{
  const view=chartWindow({times,zoom:{start:4,end:7}});
  assert.deepEqual(view.times,['2026-10-12T23:00:00Z','2026-10-13T00:00:00Z','2026-10-13T01:00:00Z','2026-10-13T02:00:00Z']);
});
const variable=VARIABLES.find(v=>v.key==='temperature_2m');
const defs=[{id:'one',name:'One'},{id:'two',name:'Two'}];
const models=new Map(defs.map((m,k)=>[m.id,normalise({hourly:{time:times,temperature_2m:times.map((_,i)=>i===51&&k===1?null:i===50?0:i+k)},hourly_units:{temperature_2m:'°C'}},m)]));
const input={variable,modelDefinitions:defs,models,times:chartWindow({times,zoom:{start:50,end:53}}).times,full:false,location:{name:'Test',latitude:54,longitude:-2},loading:false,errors:new Map()};
test('chart-window data, means, CSV and HTML all use the zoomed dates',()=>{
  const dataset=buildDataset(input);
  assert.equal(dataset.rows.length,4);
  assert.equal(dataset.rows[0].time,times[50]);
  assert.deepEqual(dataset.rows[0].values,[0,0]);
  assert.equal(dataset.rows[0].average,0);
  assert.equal(dataset.rows[1].average,51);
  assert.equal(dataset.rows[1].averageCount,1);
  for(const exported of [datasetCSV(dataset),datasetHTML(dataset)]) {
    assert.ok(exported.includes(times[50]));
    assert.ok(exported.includes(times[53]));
    assert.ok(!exported.includes(times[49]));
    assert.ok(!exported.includes(times[54]));
  }
});
test('the explicit full-model dataset option is not clipped by chart zoom',()=>{
  const dataset=buildDataset({...input,full:true});
  assert.equal(dataset.rows.length,168);
  assert.equal(dataset.rows[0].time,times[0]);
  assert.equal(dataset.rows.at(-1).time,times[167]);
});
