import test from 'node:test';
import assert from 'node:assert/strict';
import {createFramePrefetch,forecastTileRequests,tileIntersectsBounds} from '../map-prefetch.js';
import {ForecastFrames,frameWindow} from '../map-frames.js';
import {ForecastTileCache} from '../map-tile-cache.js';
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

test('a cold foreground selection starts immediately while existing distant hours finish once',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),started=[],jobs=new Map();
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:2,prefetch:(url,controller)=>{started.push(url);return new Promise((resolve,reject)=>{jobs.set(url,{resolve,controller});controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));});}});
 cache.show(await loaded(cache,map,'t0'),.8,'linear');
 cache.warm({keep:new Set(['t0']),upcoming:[],all:['t1','t2','t3','t4'],delay:0});t.mock.timers.tick(0);await flush();
 assert.deepEqual(started,['t1','t2']);assert.equal(map.sourceAdds,1);
 jobs.get('t2').resolve();await flush();assert.deepEqual(started,['t1','t2','t3']);assert.equal(cache.preloaded.has('t2'),true);
 const selected=cache.acquire('t4');await flush();
 assert.equal(jobs.get('t1').controller.signal.aborted,false);assert.equal(jobs.get('t3').controller.signal.aborted,false);
 assert.ok(cache.frames.get('t4')?.pending,'The selected image starts without waiting for distant work');
 map.load(cache.frames.get('t4'));assert.equal((await selected).url,'t4');
 jobs.get('t1').resolve();jobs.get('t3').resolve();await flush();
 assert.deepEqual(started,['t1','t2','t3'],'The selected frame is already ready and needs no duplicate prefetch');
 assert.equal(cache.preloaded.size,5);assert.equal(cache.failures.size,0);assert.equal(cache.current.url,'t0');cache.clear();
});

test('rapid cold selections continue background dispatch and discard superseded display frames',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),started=[],jobs=new Map();
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:2,prefetch:(url,controller)=>new Promise((resolve,reject)=>{
  started.push(url);jobs.set(url,{resolve,controller});controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 })});
 cache.show(await loaded(cache,map,'now'),.8,'linear');await loaded(cache,map,'cached');
 cache.warm({keep:new Set(['now','cached']),upcoming:[],all:['far1','far2','later'],delay:0});t.mock.timers.tick(0);await flush();
 assert.deepEqual(started,['far1','far2']);const selections=[];let latest;
 for(const url of ['next1','next2','next3']){
  latest=url;cache.focus(url,new Set(['now',url]));selections.push(cache.acquire(url,()=>latest===url));
  assert.ok(cache.frames.get(url)?.pending);assert.equal(cache.current.url,'now');
  assert.ok(cache.frames.size<=2,'Only the displayed frame and final selection need map sources');
 }
 assert.equal(cache.preloaded.has('cached'),true,'Leaving the decoded window does not erase cached progress');
 for(const job of jobs.values())assert.equal(job.controller.signal.aborted,false);
 jobs.get('far1').resolve();await flush();assert.equal(cache.preloaded.has('far1'),true);
 assert.deepEqual(started,['far1','far2','later'],'Navigation keeps the bounded background sequence moving');
 map.load(cache.frames.get('next3'));const results=await Promise.all(selections);
 assert.deepEqual(results.map(frame=>frame?.url??null),[null,null,'next3']);assert.equal(cache.failures.size,0);
 cache.show(results[2],.8,'linear');
 cache.warm({keep:new Set(['next3']),upcoming:[],all:['far1','far2','later'],delay:0});t.mock.timers.tick(0);await flush();
 assert.deepEqual(started,['far1','far2','later']);jobs.get('far2').resolve();jobs.get('later').resolve();await flush();cache.clear();
});

test('background sequence completes during sustained cold navigation without waiting for a display commit',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),jobs=new Map(),started=[];
 const cache=new ForecastFrames(map,'navigation',{preloadConcurrency:1,prefetch:(url,controller)=>new Promise((resolve,reject)=>{
  started.push(url);jobs.set(url,resolve);controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 })});
 cache.show(await loaded(cache,map,'now'),.8,'linear');
 const sequence=Array.from({length:12},(_,i)=>'background-'+i);
 cache.warm({keep:new Set(['now']),upcoming:[],all:sequence,delay:0});
 // Even navigation before the dispatch timer fires must not erase the queue.
 cache.focus('next',new Set(['now','next']));t.mock.timers.tick(0);await flush();
 for(let i=0;i<sequence.length;i++){
  cache.focus('cold-'+i,new Set(['now','cold-'+i]));
  assert.equal(started.at(-1),sequence[i]);jobs.get(sequence[i])();await flush();
  assert.ok(cache.prefetches.size<=1);
 }
 assert.deepEqual(started,sequence);assert.equal(cache.preloaded.size,13);
 assert.equal(cache.current.url,'now');assert.equal(cache.failures.size,0);cache.clear();
});

test('a foreground target shares its in-flight tile without a new render or cancelled prefetch',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),jobs=new Map(),calls=[];
 const tiles=new ForecastTileCache((params,controller)=>new Promise((resolve,reject)=>{
  calls.push(params.url);jobs.set(params.url,{resolve,controller});controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 }),{storage:null});tiles.setContext('view');
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:1,prefetch:(url,controller)=>tiles.prefetch({url,type:'image'},controller)});
 cache.show(await loaded(cache,map,'now'),.8,'linear');
 cache.warm({keep:new Set(['now']),upcoming:[],all:['target','later'],delay:0});t.mock.timers.tick(0);await flush();
 const addSource=map.addSource.bind(map),consumers=new Map();
 map.addSource=(id,source)=>{
  addSource(id,source);const controller=new AbortController();consumers.set(id,controller);
  void tiles.protocol({url:source.url,type:'image'},controller).then(()=>{
   if(map.getSource(id)){map.getSource(id).loaded=true;map.emit('sourcedata',{sourceId:id});}
  },()=>{});
 };
 cache.focus('target',new Set(['now','target']));const selected=cache.acquire('target');await flush();
 assert.deepEqual(calls,['target']);assert.equal(jobs.get('target').controller.signal.aborted,false);
 jobs.get('target').resolve({data:new Uint8Array([1,2,3]).buffer});
 assert.equal((await selected).url,'target');assert.deepEqual(calls,['target']);assert.equal(cache.preloaded.has('target'),true);
 cache.clear();for(const controller of consumers.values())controller.abort();tiles.release();
});

test('prefetch slots remain bounded when active background frames move into the display window',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),jobs=new Map(),started=[];let active=0,peak=0;
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:2,prefetch:(url,controller)=>new Promise((resolve,reject)=>{
  active++;peak=Math.max(peak,active);started.push(url);
  const cancel=()=>{active--;reject(new DOMException('Aborted','AbortError'));};
  jobs.set(url,{finish:()=>{controller.signal.removeEventListener('abort',cancel);active--;resolve();},controller});
  controller.signal.addEventListener('abort',cancel,{once:true});
 })});
 cache.show(await loaded(cache,map,'now'),.8,'linear');
 const all=['first','second','third','fourth'];
 cache.warm({keep:new Set(['now']),upcoming:[],all,delay:0});t.mock.timers.tick(0);await flush();
 cache.focus('first',new Set(['now','first']));const selected=cache.acquire('first');map.load(cache.frames.get('first'));
 cache.show(await selected,.8,'linear');
 for(let i=0;i<3;i++){
  cache.warm({keep:new Set(['first']),upcoming:[],all,delay:0});t.mock.timers.tick(0);await flush();
  assert.deepEqual(started,['first','second'],'The still-active displayed prefetch owns its original slot');
 }
 jobs.get('second').finish();await flush();assert.deepEqual(started,['first','second','third']);
 jobs.get('first').finish();await flush();assert.deepEqual(started,['first','second','third','fourth']);
 assert.equal(peak,2);jobs.get('third').finish();jobs.get('fourth').finish();await flush();cache.clear();
});

test('changing the viewport still cancels jobs retained through rapid navigation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),jobs=[];
 const cache=new ForecastFrames(map,'a',{prefetch:(url,controller)=>new Promise((resolve,reject)=>{
  jobs.push(controller);controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 })});
 cache.show(await loaded(cache,map,'now'),.8,'linear');
 cache.warm({keep:new Set(['now']),upcoming:[],all:['far1','far2'],delay:0});t.mock.timers.tick(0);await flush();
 cache.focus('next',new Set(['now','next']));assert.equal(jobs.some(controller=>controller.signal.aborted),false);
 cache.invalidateView();await flush();assert.equal(jobs.every(controller=>controller.signal.aborted),true);
 assert.equal(cache.prefetches.size,0);assert.equal(cache.preloaded.size,0);assert.equal(cache.failures.size,0);cache.clear();
});

test('a retired URL cannot start after waiting for a surviving prefetch slot',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),started=[],jobs=new Map();
 const cache=new ForecastFrames(map,'a',{preloadConcurrency:1,prefetch:(url,controller)=>new Promise((resolve,reject)=>{
  started.push(url);jobs.set(url,resolve);controller.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 })});
 cache.show(await loaded(cache,map,'now'),.8,'linear');
 cache.warm({keep:new Set(['now']),upcoming:[],all:['active','retired','valid'],delay:0});t.mock.timers.tick(0);await flush();
 cache.focus('active',new Set(['active']));const selected=cache.acquire('active');map.load(cache.frames.get('active'));cache.show(await selected,.8,'linear');
 cache.warm({keep:new Set(['active']),upcoming:[],all:['active','retired','valid'],delay:0});t.mock.timers.tick(0);await flush();
 cache.retain(new Set(['active','valid']));jobs.get('active')();await flush();
 assert.deepEqual(started,['active','valid']);jobs.get('valid')();await flush();cache.clear();
});

test('backward warming follows travel direction within the same bounded frame budget',()=>{
 const urls=['0','1','2','3','4','5','6','7'];
 const forward=frameWindow(urls,3,{ahead:2,behind:1}),backward=frameWindow(urls,3,{ahead:2,behind:1,direction:-1});
 assert.deepEqual(backward.keep,new Set(['1','2','3','4']));assert.deepEqual(backward.upcoming,['2','1']);
 assert.equal(backward.keep.size,forward.keep.size);
 assert.deepEqual(frameWindow(urls,0,{ahead:2,behind:1,direction:-1}),{keep:new Set(['0','1']),upcoming:[]});
 assert.deepEqual(frameWindow(urls,1,{ahead:3,behind:1,direction:-1}),{keep:new Set(['0','1','2']),upcoming:['0']});
 assert.deepEqual(frameWindow(urls,0,{ahead:2,behind:1,direction:-1,loop:true}),{keep:new Set(['6','7','0','1']),upcoming:['7','6']});
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
