import test from 'node:test';
import assert from 'node:assert/strict';
import {createFramePrefetch,forecastTileRequests,tileIntersectsBounds} from '../map-prefetch.js';
import {ForecastFrames} from '../map-frames.js';
import {FakeMap,loaded} from './frame-fake.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('advancing playback prepares the new nearby frame before unfinished distant downloads',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),jobs=new Map(),started=[];
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:2,prefetch:(url,controller)=>new Promise((resolve,reject)=>{
  started.push(url);jobs.set(url,{resolve,controller});controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
 })});
 for(const url of ['t0','t1','t2'])await loaded(cache,map,url);
 cache.show(cache.frames.get('t0'),.8,'linear');
 cache.warm({keep:new Set(['t0','t1','t2']),upcoming:['t1','t2'],all:['far1','far2','far3'],delay:0});t.mock.timers.tick(0);await flush();
 assert.deepEqual(started,['far1','far2']);
 cache.show(await cache.acquire('t1'),.8,'linear');
 cache.warm({keep:new Set(['t0','t1','t2','t3']),upcoming:['t2','t3'],all:['far1','far2','far3'],delay:0});t.mock.timers.tick(0);await flush();
 const next=cache.frames.get('t3');assert.ok(next?.pending,'The next frame starts while both distant downloads are unresolved');
 assert.equal(jobs.get('far1').controller.signal.aborted,false);assert.deepEqual(started,['far1','far2']);
 map.load(next);await next.ready;await flush();assert.equal(cache.isReady('t3'),true);
 jobs.get('far1').resolve();await flush();assert.deepEqual(started,['far1','far2','far3']);cache.clear();
});

test('a live timeline update cannot launch retired URLs from the nearby or distant queues',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),started=[];
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:1,prefetch:async url=>{started.push(url);}});
 cache.show(await loaded(cache,map,'now'),.8,'linear');
 cache.warm({keep:new Set(['now','next','retired-near']),upcoming:['next','retired-near'],all:['retired-far','valid-far'],delay:0});t.mock.timers.tick(0);await flush();
 cache.retain(new Set(['now','next','valid-far']));map.load(cache.frames.get('next'));await flush();await flush();
 assert.equal(cache.frames.has('retired-near'),false);assert.deepEqual(started,['valid-far']);cache.clear();
});

test('acquiring an already prepared frame does not reorder its layers',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const frame=await loaded(cache,map,'ready'),moves=map.moves.length;
 assert.equal(await cache.acquire('ready'),frame);assert.equal(map.moves.length,moves);cache.clear();
});

test('prefetch matches raster rounding, vector flooring and each map view',()=>{
 const calls=[];
 const map={coveringTiles:options=>{calls.push(options);return [{canonical:{z:3,x:3,y:2}},{canonical:{z:3,x:3,y:2}},{canonical:{z:3,x:4,y:2}}];}};
 const metadata={tiles:['om://run?variable=rain/{z}/{x}/{y}'],bounds:[-45,40,0,70],maxzoom:12};
 assert.deepEqual(forecastTileRequests(map,{type:'raster',maxzoom:10},metadata),[{type:'image',url:'om://run?variable=rain/3/3/2'}]);
 forecastTileRequests(map,{type:'vector',maxzoom:10},metadata);
 assert.equal(calls[0].roundZoom,true);assert.equal(calls[1].roundZoom,false);
 assert.equal(calls[0].maxzoom,10);assert.equal(calls[1].tileSize,512);
 assert.equal(tileIntersectsBounds({z:2,x:0,y:1},[170,-80,-170,80]),true);
 assert.equal(tileIntersectsBounds({z:2,x:2,y:1},[170,-80,-170,80]),false);
});

test('a prepared hour includes all enabled overlays and uses the same shared tile cache',async()=>{
 const requests=[],map={coveringTiles:()=>[{canonical:{z:4,x:7,y:5}}]};
 let completePressure;
 const cache={protocol:async p=>({data:{tiles:[p.url+'/{z}/{x}/{y}']}}),prefetch:async p=>{requests.push(p);if(p.url.includes('pressure'))await new Promise(resolve=>completePressure=resolve);}};
 const prefetch=createFramePrefetch(map,cache,()=>[{source:{type:'vector',url:'om://pressure'}}]);
 let done=false;const work=prefetch('om://rain',new AbortController()).then(()=>done=true);
 await flush();assert.equal(done,false);assert.deepEqual(requests,[{url:'om://rain/4/7/5',type:'image'},{url:'om://pressure/4/7/5',type:'arrayBuffer'}]);
 completePressure();await work;assert.equal(done,true);
});

test('distant hours prepare concurrently without hidden map sources; selection cancels them',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),started=[],jobs=new Map();
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:2,prefetch:(url,controller)=>{started.push(url);return new Promise((resolve,reject)=>{jobs.set(url,{resolve,controller});controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));});}});
 cache.show(await loaded(cache,map,'t0'),.8,'linear');
 cache.warm({keep:new Set(['t0']),upcoming:[],all:['t1','t2','t3','t4'],delay:0});t.mock.timers.tick(0);await flush();
 assert.deepEqual(started,['t1','t2']);assert.equal(map.sourceAdds,1);
 jobs.get('t2').resolve();await flush();assert.deepEqual(started,['t1','t2','t3']);assert.equal(cache.preloaded.has('t2'),true);
 const selected=cache.acquire('t4');await flush();
 assert.equal(jobs.get('t1').controller.signal.aborted,true);assert.equal(jobs.get('t3').controller.signal.aborted,true);
 map.load(cache.frames.get('t4'));assert.equal((await selected).url,'t4');
 assert.equal(cache.failures.size,0);assert.equal(cache.current.url,'t0');cache.clear();
});

test('background tile failure does not interrupt display and retries remain bounded',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{maxAttempts:2,prefetch:async()=>{calls++;throw Error('Missing variable');}});
 cache.show(await loaded(cache,map,'now'),.8,'linear');
 cache.warm({keep:new Set(['now']),upcoming:[],all:['bad'],delay:0});t.mock.timers.tick(0);await flush();await flush();
 assert.equal(calls,2);assert.equal(cache.current.url,'now');assert.equal(cache.preloaded.has('bad'),false);assert.equal(cache.failures.has('bad'),true);cache.clear();
});

test('changing area rejects late background pixels and clears progress',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let finish;
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{prefetch:()=>new Promise(resolve=>finish=resolve)});
 cache.show(await loaded(cache,map,'now'),.8,'linear');
 cache.warm({keep:new Set(['now']),upcoming:[],all:['future'],delay:0});t.mock.timers.tick(0);await flush();
 cache.invalidateView();finish();await flush();assert.equal(cache.preloaded.size,0);assert.equal(cache.failures.size,0);cache.clear();
});

test('slow background requests release their slot and have a bounded retry count',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{timeout:100,maxAttempts:2,prefetch:(url,controller)=>new Promise((resolve,reject)=>{calls++;controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));})});
 cache.warm({keep:new Set(),upcoming:[],all:['slow'],delay:0});t.mock.timers.tick(0);await flush();
 t.mock.timers.tick(100);await flush();t.mock.timers.tick(100);await flush();
 assert.equal(calls,2);assert.equal(cache.prefetches.size,0);assert.equal(cache.failures.has('slow'),true);cache.clear();
});

test('ready playback retains useful downloads across buffer advances without exceeding concurrency',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),started=[],jobs=new Map();let active=0,peak=0,aborted=0;
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:2,prefetch:(url,controller)=>{
  started.push(url);active++;peak=Math.max(peak,active);
  return new Promise((resolve,reject)=>{
   const finish=()=>{controller.signal.removeEventListener('abort',cancel);active--;resolve();};
   const cancel=()=>{active--;aborted++;reject(new DOMException('Aborted','AbortError'));};
   jobs.set(url,{finish,controller});controller.signal.addEventListener('abort',cancel,{once:true});
  });
 }});
 for(const url of ['t0','t1','t2'])await loaded(cache,map,url);
 cache.show(cache.frames.get('t0'),.8,'linear');
 const work={keep:new Set(['t0','t1','t2']),upcoming:['t1','t2'],all:['distant1','distant2','later'],delay:0};
 cache.warm(work);t.mock.timers.tick(0);await flush();
 assert.deepEqual(started,['distant1','distant2']);
 const first=jobs.get('distant1'),second=jobs.get('distant2');
 for(const url of ['t1','t2']){
  cache.show(await cache.acquire(url),.8,'linear');
  cache.warm(work);t.mock.timers.tick(0);await flush();
  assert.equal(first.controller.signal.aborted,false);assert.equal(second.controller.signal.aborted,false);
 }
 first.finish();await flush();assert.equal(cache.preloaded.has('distant1'),true);
 assert.equal(started.filter(url=>url==='distant1').length,1);assert.equal(started.filter(url=>url==='distant2').length,1);
 assert.equal(peak,2);assert.equal(aborted,0);
 second.finish();jobs.get('later').finish();await flush();cache.clear();
});
