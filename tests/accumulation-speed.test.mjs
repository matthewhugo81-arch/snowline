import test from 'node:test';
import assert from 'node:assert/strict';
import {RollingAccumulations,cropAccumulation,installAccumulations} from '../map-accumulation-reader.js';
const ref=Date.parse('2026-10-12T12:00:00Z'),hour=3600000;
const url=h=>'https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/10/12/1200Z/'+new Date(ref+h*hour).toISOString().slice(0,16).replace(':','')+'.om';
const key='precipitation_total_72h',wait=ms=>new Promise(r=>setTimeout(r,ms));
test('simultaneous raster, contour, grid-value and prefetch totals calculate once, with independent buffers',async()=>{
 const total=new RollingAccumulations(async()=>{await wait(1);return Float32Array.of(1,NaN,0);});
 const results=await Promise.all(Array.from({length:4},()=>total.read(url(73),key,null)));
 assert.equal(total.stats.full,1);assert.equal(total.inputs.stats.reads,72);assert.ok(total.inputs.stats.peak<=6);
 for(const r of results){assert.equal(r.values[0],72);assert.ok(Number.isNaN(r.values[1]));assert.equal(r.values[2],0);}
 structuredClone(results[0].values,{transfer:[results[0].values.buffer]});assert.equal(results[1].values[0],72);
 assert.equal((await total.read(url(73),key,null)).values[0],72);assert.equal(total.inputs.stats.reads,72);total.clear();
});
test('cached native subregion supplies labels without resumming or resampling',async()=>{
 const cover=[{start:10,end:13},{start:20,end:24}],wanted=[{start:11,end:13},{start:21,end:23}];
 const total=new RollingAccumulations(async()=>Float32Array.from([0,1,2,3,4,5,NaN,7,8,9,10,11]));
 await total.read(url(73),key,cover);const result=await total.read(url(73),key,wanted);
 assert.deepEqual([...result.values],[360,NaN,648,720]);assert.equal(total.inputs.stats.reads,72);assert.equal(total.stats.subsetHits,1);
 total.clear();assert.equal(total.outputs.bytes,0);assert.equal(total.snapshotBytes,0);
});
test('exact crop keeps flattened Gaussian indexing and rejects incomplete coverage or invalid ranges',()=>{
 const data=Float32Array.from([1,2,NaN,4,5]),cover=[{start:0,end:1},{start:100,end:105}];
 assert.deepEqual([...cropAccumulation(data,cover,[{start:0,end:1},{start:101,end:104}])],[2,NaN,4]);
 assert.equal(cropAccumulation(data,cover,[{start:0,end:1},{start:99,end:104}]),null);
 assert.equal(cropAccumulation(data,cover,[{start:0,end:1},{start:101,end:106}]),null);
 assert.equal(cropAccumulation(data,cover,[{start:0,end:1},{start:101,end:101}]),null);
 assert.equal(cropAccumulation(data,cover,null),null);
});
test('pipeline refills ahead of a slow interval instead of waiting at a fixed batch boundary',async()=>{
 const seen=[];const total=new RollingAccumulations(async u=>{seen.push(u);if(u===url(4))await wait(35);return Float32Array.of(1);});
 const pending=total.read(url(12),'precipitation_total_12h',null);await wait(15);
 assert.ok(seen.includes(url(7))&&seen.includes(url(8)),'Later intervals start while an earlier slow read is outstanding');assert.equal((await pending).values[0],12);total.clear();
});
test('aborting one aggregate subscriber leaves the other subscriber and its progress intact',async()=>{
 const total=new RollingAccumulations(async()=>{await wait(1);return Float32Array.of(1);}),c=new AbortController(),events=[];
 const stop=total.subscribe(e=>events.push(e)),a=total.read(url(73),key,null,c.signal),b=total.read(url(73),key,null);c.abort();
 await assert.rejects(a);assert.equal((await b).values[0],72);assert.equal(total.stats.full,1);
 assert.equal(events.at(-1).done,72);assert.equal(events.at(-1).total,72);assert.ok(events.every(e=>e.key===key&&e.url===url(73)));stop();total.clear();
});
test('completed-total cache cannot cross model run, accumulation duration or grid extent',async()=>{
 const total=new RollingAccumulations(async()=>Float32Array.of(1));
 await total.read(url(73),key,[{start:0,end:1}]);await total.read(url(73),'precipitation_total_48h',[{start:0,end:1}]);
 await total.read(url(73).replace('/1200Z/','/0600Z/'),key,[{start:0,end:1}]);await total.read(url(73),key,[{start:1,end:2}]);
 assert.equal(total.stats.full,4);assert.equal(total.stats.subsetHits,0);total.clear();
});
test('additional caches and concurrent reads stay bounded under multiple long-period panels',async()=>{
 const total=new RollingAccumulations(async()=>new Float32Array(30).fill(.25),{maxBytes:600,maxOutputBytes:240,maxSnapshotBytes:600});
 await Promise.all([72,73,74].map(h=>total.read(url(h),key,[{start:0,end:30}])));
 assert.ok(total.inputs.bytes<=600);assert.ok(total.outputs.bytes<=240);assert.ok(total.snapshotBytes<=600);assert.ok(total.inputs.stats.peak<=6);total.clear();
});
test('native grid shape is validated in the same file-reader session used for decoding',async()=>{
 let sessions=0,decodes=0,disposed=0;
 const reader={config:{useSAB:false},readVariable:async()=>({values:Float32Array.of(999)}),withReader:async(u,fn)=>{sessions++;return fn({getChildByName:async()=>({getDimensions:()=>[1,2],dispose(){disposed++;}})});},readSimpleVariable:async()=>{decodes++;return {values:Float32Array.of(1,2)};}};
 const OM={getProtocolInstance:()=>({omFileReader:reader}),domainOptions:[{value:'ecmwf_ifs',grid:{nx:2,ny:1}}]};
 const total=installAccumulations(OM,{});assert.deepEqual([...(await reader.readVariable(url(6),'precipitation_total_6h',null)).values],[6,12]);
 assert.equal(sessions,6);assert.equal(decodes,6);assert.equal(disposed,6);total.clear();
});
