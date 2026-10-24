import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {createValueReader} from '../map-values.js';
const settings=OM.defaultOmProtocolSettings;
const instance=OM.getProtocolInstance(settings);
const url='om://https://example.com/data/ukmo_global_deterministic_10km/000.om?variable=temperature_2m&interpolation=nearest';
test('concurrent readouts retain their native sections despite replacement and eviction',async t=>{
 instance.stateByKey.clear();let reads=0;
 t.mock.method(instance.omFileReader,'readVariable',async(file,variable,ranges)=>{
  reads++;
  await new Promise(resolve=>setTimeout(resolve,5));
  const count=ranges.reduce((n,range)=>n*(range.end-range.start),1);
  return {values:new Float32Array(count).fill(12),scaleFactor:1};
 });
 const read=createValueReader(OM,settings);
 const points=[[57,-15],[57,15],[51,-15],[51,15],[54,-4],[54,-4]];
 for(const zoom of [5,8,10]){
  instance.stateByKey.clear();
  const values=await Promise.all(points.map(([lat,lon])=>read(lat,lon,url,zoom)));
  assert.deepEqual(values.map(result=>result.value),points.map(()=>12),'Every side and row at zoom '+zoom);
 }
 assert.ok(reads<=18,'Duplicate points share native reads');
});

