import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastTileCache} from '../map-tile-cache.js';
const params=(url,type='image')=>({url:'om://'+url,type});
const bytes=()=>({data:new Uint8Array([10,20,30,40]).buffer});
const storage=()=>{
 const caches=new Map();
 return {keys:async()=>[...caches.keys()],delete:async name=>caches.delete(name),open:async name=>{
  if(!caches.has(name))caches.set(name,new Map());const entries=caches.get(name);
  return {keys:async()=>[...entries.keys()],delete:async key=>entries.delete(key),match:async key=>entries.get(key)?.clone(),put:async(key,value)=>entries.set(key,value.clone())};
 }};
};
const read=(cache,url,type)=>cache.protocol(params(url,type),new AbortController());
const saved=cache=>Promise.all([...cache.writes.values()].map(job=>job.promise));

test('disk capacity stops full preloading without preventing selected frames from loading',async()=>{
 for(const budget of [{diskBytes:8},{diskEntries:2}]){
  let limited=0,calls=0;
  const cache=new ForecastTileCache(async()=>{calls++;return bytes();},{storage:storage(),persistent:true,memoryBytes:4,...budget,onLimit:()=>limited++});
  cache.setContext('view');
  for(const url of ['one','two']){await read(cache,url);await saved(cache);}
  assert.equal(cache.limited,false,'The retained sequence fits before eviction');
  await read(cache,'three');await saved(cache);
  assert.equal(cache.limited,true);assert.equal(limited,1,'Capacity is reported when a previously retained tile is evicted');
  await read(cache,'three');assert.equal(calls,3,'The selected retained tile remains reusable');
  await read(cache,'one');await saved(cache);assert.equal(calls,4,'An evicted selection can still load normally');
  assert.equal(limited,1,'Capacity reporting does not restart on each selection');
  cache.setContext('another view');assert.equal(cache.limited,false);cache.release();
 }
});

test('late capacity eviction for an old viewport cannot limit the new viewport',async()=>{
 const base=storage();let releaseEviction,evictionStarted;
 const started=new Promise(resolve=>evictionStarted=resolve);
 const disk={...base,open:async name=>{
  const store=await base.open(name);
  return {...store,delete:async key=>{evictionStarted();await new Promise(resolve=>releaseEviction=resolve);return store.delete(key);}};
 }};
 const cache=new ForecastTileCache(async()=>bytes(),{storage:disk,persistent:true,diskBytes:4});
 cache.setContext('old view');await read(cache,'one');await saved(cache);
 await read(cache,'two');const saving=saved(cache);await started;
 cache.setContext('new view');releaseEviction();await saving;
 assert.equal(cache.limited,false);cache.release();
});

test('persistent tiles survive reload with independent bytes, bounded storage and expiry',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,18,12,10)});
 const disk=storage();let calls=0;
 const create=()=>new ForecastTileCache(async()=>{calls++;return bytes();},{storage:disk,persistent:true,diskBytes:8,memoryBytes:4});
 const first=create();first.setContext('wide');await read(first,'rate-1');await saved(first);await read(first,'rate-2');await saved(first);first.release();
 const reload=create();reload.setContext('wide');const restored=await read(reload,'rate-1');assert.equal(calls,2);new Uint8Array(restored.data)[0]=0;
 await read(reload,'rate-3');await saved(reload);assert.equal(calls,3);reload.release();
 const again=create();again.setContext('wide');await read(again,'rate-2');assert.equal(calls,3,'retained tile reused');await read(again,'rate-1');assert.equal(calls,4,'oldest disk entry evicted at byte cap');await saved(again);again.release();
 const moved=create();moved.setContext('different viewport');await read(moved,'rate-2');assert.equal(calls,5,'different native read coverage cannot reuse pixels');await saved(moved);moved.release();
 t.mock.timers.tick(3600000);
 const expired=create();expired.setContext('wide');await read(expired,'rate-2');assert.equal(calls,6,'expiry refreshes native data');await saved(expired);expired.release();
});

test('repeated visits retain at most three persistent viewport caches',async()=>{
 const disk=storage();
 for(let i=0;i<8;i++){
  const cache=new ForecastTileCache(async()=>bytes(),{storage:disk,persistent:true});cache.setContext('view-'+i);await read(cache,'rate');await saved(cache);await new Promise(resolve=>setImmediate(resolve));cache.release();
 }
 assert.ok((await disk.keys()).length<=3);
});

test('empty overlay tiles are retained but cannot create an unbounded disk cache',async()=>{
 const disk=storage();let calls=0;
 const create=()=>new ForecastTileCache(async()=>{calls++;return {data:new ArrayBuffer(0)};},{storage:disk,persistent:true,diskEntries:2});
 const first=create();first.setContext('view');for(const key of ['one','two','three']){await read(first,key,'arrayBuffer');await saved(first);}first.release();
 const second=create();second.setContext('view');await read(second,'two','arrayBuffer');assert.equal(calls,3);await read(second,'one','arrayBuffer');assert.equal(calls,4);await saved(second);second.release();
 const store=await disk.open((await disk.keys())[0]);assert.equal((await store.keys()).length,2);
});

test('prepared raster, vector and metadata survive worker transfer and memory eviction',async()=>{
 let calls=0;const cache=new ForecastTileCache(async p=>{calls++;return p.type==='json'?{data:{tiles:['om://run/tile']}}:bytes();},{storage:storage(),memoryBytes:4});
 cache.setContext('view-one');
 const image=await read(cache,'run/temp/z4/x/y');
 structuredClone(image.data,{transfer:[image.data]});assert.equal(image.data.byteLength,0);
 await read(cache,'run/pressure/z4/x/y','arrayBuffer');
 await read(cache,'run/temp','json');
 assert.deepEqual(new Uint8Array((await read(cache,'run/temp/z4/x/y')).data),new Uint8Array([10,20,30,40]));
 assert.equal(calls,3,'Distant frame is restored from disk without renderer/network work');
 assert.deepEqual((await read(cache,'run/temp','json')).data,{tiles:['om://run/tile']});
 assert.equal(calls,3);assert.equal(cache.limited,false);cache.release();
});

test('same tiles share work across panels, with independent cancellation and owned buffers',async()=>{
 let finish,calls=0,signal;const cache=new ForecastTileCache((p,c)=>{calls++;signal=c.signal;return new Promise(resolve=>finish=resolve);},{storage:null});cache.setContext('view');
 const first=new AbortController(),second=new AbortController();
 const a=cache.protocol(params('rain'),first),b=cache.protocol(params('rain'),second);
 const rejected=assert.rejects(a,{name:'AbortError'});await Promise.resolve();first.abort();await rejected;
 assert.equal(signal.aborted,false);finish(bytes());const result=await b;
 assert.equal(calls,1);new Uint8Array(result.data)[0]=99;
 assert.equal(new Uint8Array((await read(cache,'rain')).data)[0],10);cache.release();
});

test('abandoned work aborts, failed requests retry, and changed views cannot reuse old pixels',async()=>{
 let calls=0,finish,signal;const cache=new ForecastTileCache((p,c)=>{calls++;signal=c.signal;return calls===1?new Promise(resolve=>finish=resolve):Promise.resolve(bytes());},{storage:storage()});cache.setContext('view-one');
 const controller=new AbortController(),pending=cache.protocol(params('rain'),controller);
 const rejected=assert.rejects(pending,{name:'AbortError'});await Promise.resolve();await Promise.resolve();controller.abort();await rejected;
 await new Promise(resolve=>setTimeout(resolve,140));finish?.(bytes());assert.equal(signal?.aborted??true,true);
 assert.deepEqual(new Uint8Array((await read(cache,'rain')).data),new Uint8Array([10,20,30,40]));
 const before=calls;cache.setContext('view-two');await read(cache,'rain');assert.equal(calls,before+1);cache.release();
});

test('renderer errors are not cached; storage denial still allows forecasts and reports capacity',async()=>{
 let calls=0,limited=0;const cache=new ForecastTileCache(async()=>{if(++calls===1)throw Error('Temporary outage');return bytes();},{retries:0,storage:{keys:async()=>[],open:async()=>{throw Error('Denied');}},memoryBytes:4,onLimit:()=>limited++});cache.setContext('view');
 await assert.rejects(read(cache,'rain'),/Temporary outage/);await read(cache,'rain');await read(cache,'snow');
 assert.equal(calls,3);assert.equal(cache.limited,true);assert.equal(limited,1);cache.release();
});

test('a foreground replacement rejoins abandoned background work without restarting the renderer',async()=>{
 let finish,calls=0,signal;
 const cache=new ForecastTileCache((p,c)=>{calls++;signal=c.signal;return new Promise(resolve=>finish=resolve);},{storage:null});cache.setContext('view');
 const controller=new AbortController(),first=cache.protocol(params('rain'),controller),cancelled=assert.rejects(first,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));controller.abort();await cancelled;
 const replacement=read(cache,'rain');assert.equal(signal.aborted,false);finish(bytes());await replacement;
 assert.equal(calls,1);cache.release();
});

test('temporary tile failures retry once per shared job and successful bytes are cached',async()=>{
 let calls=0;const cache=new ForecastTileCache(async()=>{if(++calls<3)throw new DOMException('Interrupted renderer','AbortError');return bytes();},{storage:null,retryDelay:1});cache.setContext('view');
 const results=await Promise.all([read(cache,'rain'),read(cache,'rain')]);
 assert.equal(calls,3);assert.notEqual(results[0].data,results[1].data);
 await read(cache,'rain');assert.equal(calls,3);cache.release();
});

test('persistent failures have bounded retries and missing files fail promptly',async()=>{
 for(const [message,expected]of [['Network failed',3],['Failed to fetch file size: 404 Not Found',1]]){
  let calls=0;const cache=new ForecastTileCache(async()=>{calls++;throw Error(message);},{storage:null,retryDelay:1});cache.setContext('view');
  await assert.rejects(read(cache,'rain'),new RegExp(message));assert.equal(calls,expected);assert.equal(cache.memory.size,0);cache.release();
 }
});

test('a view change cancels retry backoff without making another request',async()=>{
 let calls=0;const cache=new ForecastTileCache(async()=>{calls++;throw Error('Network failed');},{storage:null,retryDelay:200});cache.setContext('view');
 const pending=read(cache,'rain'),rejected=assert.rejects(pending,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));cache.setContext('new view');await rejected;assert.equal(calls,1);cache.release();
});

test('slow storage does not delay display or duplicate a just-evicted tile',async()=>{
 let finish,calls=0;const entries=new Map();
 const cache=new ForecastTileCache(async()=>{calls++;return bytes();},{memoryBytes:4,storage:{keys:async()=>[],delete:async()=>{},open:async()=>({match:async key=>entries.get(key)?.clone(),put:async(key,response)=>{if(key.includes('rain'))await new Promise(resolve=>finish=resolve);entries.set(key,response.clone());}})}});cache.setContext('view');
 await read(cache,'rain');assert.equal(typeof finish,'function','Image resolves before its storage write');
 await read(cache,'snow');assert.equal(cache.limited,false,'An in-progress save is not a storage failure');
 const again=read(cache,'rain');finish();await again;
 assert.equal(calls,2,'Wait for the existing write instead of rendering the tile again');cache.release();
});

test('a delayed failed write reports limited storage only when its tile was evicted',async()=>{
 let fail;const cache=new ForecastTileCache(async()=>bytes(),{memoryBytes:4,storage:{keys:async()=>[],delete:async()=>{},open:async()=>({match:async()=>null,put:(key)=>key.includes('rain')?new Promise((resolve,reject)=>fail=reject):Promise.resolve()})}});cache.setContext('view');
 await read(cache,'rain');await read(cache,'snow');assert.equal(cache.limited,false);
 fail(Error('Quota'));await new Promise(resolve=>setImmediate(resolve));assert.equal(cache.limited,true);cache.release();
});

test('a context change cancels in-flight work and prevents late writes into the new view',async()=>{
 let finish;const cache=new ForecastTileCache(()=>new Promise(resolve=>finish=resolve),{storage:null});cache.setContext('first');
 const pending=read(cache,'rain'),rejected=assert.rejects(pending,{name:'AbortError'});await new Promise(resolve=>setImmediate(resolve));
 cache.setContext('second');finish(bytes());await rejected;
 assert.equal(cache.memory.size,0);cache.release();
});
