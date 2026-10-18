import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ForecastWorkerData} from '../vendor/forecast-worker-data.mjs';
const wrapper=readFileSync(new URL('../vendor/worker.js',import.meta.url),'utf8').split('// Reuse decoded grids across tile requests;')[1];
const data=value=>({values:new Float32Array(4).fill(value),directions:new Float32Array(4).fill(90),scaleFactor:10});
function worker(){const rendered=[],self={onmessage:event=>rendered.push(event.data)};vm.runInNewContext('// Reuse decoded grids across tile requests;'+wrapper,{self,Map,Error});return {self,rendered};}
test('each worker receives a grid once, with geometry/ranges retained per request',()=>{
 const encoder=new ForecastWorkerData(64),a=worker(),b=worker(),grid=data(3);
 const message={layers:[{data:grid,ranges:[1,2],domain:'test'}]};
 const first=encoder.encode(a,message),next=encoder.encode(a,{layers:[{data:grid,ranges:[3,4],domain:'test'}]}),other=encoder.encode(b,message);
 assert.equal(first.layers[0].data,grid);assert.equal(next.layers[0].data,undefined);assert.equal(other.layers[0].data,grid);
 a.self.onmessage({data:structuredClone(first)});a.self.onmessage({data:structuredClone(next)});
 assert.deepEqual([...a.rendered[1].layers[0].data.values],[3,3,3,3]);assert.deepEqual(a.rendered[1].layers[0].ranges,[3,4]);
 assert.equal(a.rendered[0].layers[0].data,a.rendered[1].layers[0].data);
});
test('bounded worker retention handles eviction, multi-layer reuse, oversize grids and resets',()=>{
 const encoder=new ForecastWorkerData(32),a=worker(),one=data(1),two=data(2);
 for(const grids of [[one],[two],[one,two,one],[two],[one]]){
  const message=encoder.encode(a,{layers:grids.map(data=>({data}))});a.self.onmessage({data:structuredClone(message)});
  assert.deepEqual(a.rendered.at(-1).layers.map(layer=>layer.data.values[0]),grids.map(data=>data.values[0]));
  assert.ok(encoder.workers.get(a).bytes<=32);
 }
 encoder.reset(a);assert.equal(encoder.encode(a,{layers:[{data:one}]}).layers[0].data,one);
 const large={values:new Float32Array(100)};assert.equal(encoder.encode(a,{layers:[{data:large}]}).layers[0].dataRef,undefined);
});
