import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastTileCache,forecastRenderBudget} from '../map-tile-cache.js';
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

test('source-validated retention restores disk pixels after two hours; a revision rebuilds corrected pixels',async()=>{
 const disk=storage(),realNow=Date.now;let now=realNow(),calls=0;
 Date.now=()=>now;
 const options={storage:disk,persistent:true,maxAge:Infinity,memoryBytes:0,cacheVersion:'validated-source-1'};
 let cache;
 try{
  cache=new ForecastTileCache(async()=>{calls++;return bytes();},options);cache.setContext('tiles');
  await read(cache,'model/run/frame');await saved(cache);cache.release();
  now+=2*3600000;
  cache=new ForecastTileCache(async()=>{calls++;return bytes();},options);cache.setContext('tiles');
  await read(cache,'model/run/frame');assert.equal(calls,1);cache.release();
  cache=new ForecastTileCache(async()=>{calls++;return bytes();},{...options,cacheVersion:'validated-source-2'});cache.setContext('tiles');
  await read(cache,'model/run/frame');assert.equal(calls,2);await saved(cache);
 }finally{cache?.release();Date.now=realNow;}
});

test('faster devices prepare more tiles without taking the selected chart slots',async()=>{
 assert.deepEqual(forecastRenderBudget({hardwareConcurrency:8,deviceMemory:8,mobile:true}),{concurrency:4,backgroundConcurrency:2});
 assert.deepEqual(forecastRenderBudget({hardwareConcurrency:8,deviceMemory:8}),{concurrency:8,backgroundConcurrency:6});
 for(const device of [{},{hardwareConcurrency:4,deviceMemory:8},{hardwareConcurrency:16,deviceMemory:2}])assert.equal(forecastRenderBudget(device).backgroundConcurrency,4);
 const started=[],jobs=new Map();
 const cache=new ForecastTileCache(p=>new Promise(resolve=>{started.push(p.url);jobs.set(p.url,resolve);}),{storage:null,...forecastRenderBudget({hardwareConcurrency:8})});cache.setContext('tiles');
 const work=Array.from({length:8},(_,i)=>cache.prefetch(params('background-'+i),new AbortController()));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(started.length,6);
 const selected=[read(cache,'selected-rain'),read(cache,'selected-pressure')];
 await new Promise(resolve=>setImmediate(resolve));assert.equal(started.length,8);assert.ok(started.includes('om://selected-pressure'));
 for(const resolve of jobs.values())resolve(bytes());await new Promise(resolve=>setImmediate(resolve));
 for(const resolve of jobs.values())resolve(bytes());await Promise.all([...work,...selected]);cache.release();
});

test('background prefetch does not allocate a discarded consumer copy, foreground bytes remain owned',async()=>{
 let calls=0;const cache=new ForecastTileCache(async()=>{calls++;return bytes();},{storage:null});cache.setContext('tiles');
 assert.equal(await cache.prefetch(params('ready'),new AbortController()),undefined);
 const first=await read(cache,'ready');new Uint8Array(first.data)[0]=99;
 const second=await read(cache,'ready');assert.equal(new Uint8Array(second.data)[0],10);assert.equal(calls,1);cache.release();
});

test('143 comparison frames with 24 raster/overlay tiles each remain reusable beyond the old entry and byte ceilings',async()=>{
 let calls=0;
 const cache=new ForecastTileCache(async()=>{calls++;return {data:new Uint8Array(24*1024).buffer};},{storage:storage(),persistent:true,memoryBytes:1024});
 cache.setContext('complete-tiles');
 for(let i=0;i<143*24;i++){
  await read(cache,'tile-'+i);await saved(cache);
  assert.equal(cache.limited,false,'The comparison must not stop at 2,048 entries / 64 MB');
 }
 assert.ok(cache.bytes<=1024,'Expanded disk capacity does not increase hot memory');
 await read(cache,'tile-0');await read(cache,'tile-'+(143*24-1));
 assert.equal(calls,143*24,'Both ends survive memory eviction without another native read');cache.release();
});

test('background tile fan-out leaves capacity for a selected chart and promotes shared queued tiles',async()=>{
 const started=[],jobs=new Map();
 const cache=new ForecastTileCache((p,c)=>new Promise((resolve,reject)=>{
  started.push(p.url);jobs.set(p.url,resolve);
  c.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 }),{storage:null,concurrency:3,backgroundConcurrency:1});
 cache.setContext('view');
 const background=['slow','queued','target'].map(url=>cache.prefetch(params(url),new AbortController()));
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,['om://slow'],'A whole sequence cannot flood the renderer');
 const selected=read(cache,'target');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,['om://slow','om://target'],'The selected shared tile skips the background backlog');
 const another=read(cache,'other');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,['om://slow','om://target','om://other']);
 const waiting=read(cache,'next');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(started.length,3,'Foreground work also has a bounded fan-out');
 jobs.get('om://target')(bytes());await selected;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(started.at(-1),'om://next','Foreground goes before queued speculation');
 jobs.get('om://other')(bytes());jobs.get('om://next')(bytes());await Promise.all([another,waiting]);
 assert.equal(started.includes('om://queued'),false,'One slow background job cannot consume the reserved foreground slots');
 assert.deepEqual(new Uint8Array((await read(cache,'target')).data),new Uint8Array([10,20,30,40]),'Saved bytes bypass the blocked native queue');
 jobs.get('om://slow')(bytes());await new Promise(resolve=>setImmediate(resolve));
 jobs.get('om://queued')(bytes());await Promise.all(background);
 assert.equal(started.filter(url=>url==='om://target').length,1,'Promotion shares the original render');
 cache.release();
});

test('changing viewport cancels queued tiles before they start rendering',async()=>{
 const started=[];
 const cache=new ForecastTileCache((p,c)=>new Promise((resolve,reject)=>{
  started.push(p.url);c.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 }),{storage:null,concurrency:2,backgroundConcurrency:1});
 cache.setContext('old');
 const jobs=['active','queued1','queued2'].map(url=>cache.prefetch(params(url),new AbortController()));
 const done=Promise.all(jobs.map(job=>assert.rejects(job,{name:'AbortError'})));
 await new Promise(resolve=>setImmediate(resolve));cache.setContext('new');await done;
 assert.deepEqual(started,['om://active']);assert.equal(cache.renderQueue.length,0);cache.release();
});

test('hidden map sources use background slots and a changed selection promotes their existing tiles',async()=>{
 const started=[],jobs=new Map();
 const cache=new ForecastTileCache(p=>new Promise(resolve=>{started.push(p.url);jobs.set(p.url,resolve);}),{storage:null,concurrency:3,backgroundConcurrency:1});
 cache.setContext('view');cache.setForeground(['om://current?rain']);
 const work=['near?rain/4/7/5','next?rain/4/7/5','next?pressure/4/7/5'].map(url=>read(cache,url));
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,['om://near?rain/4/7/5'],'Hidden MapLibre sources do not take foreground capacity');
 cache.setForeground(['om://next?rain','om://next?pressure']);
 assert.equal(started.length,3,'Selected rain and its pressure overlay start while nearby work is still blocked');
 for(const resolve of jobs.values())resolve(bytes());
 await Promise.all(work);assert.equal(new Set(started).size,3);cache.release();
});

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

test('switching fields evicts obsolete sequences first and resumes bounded background storage',async()=>{
 let calls=0;
 const cache=new ForecastTileCache(async()=>{calls++;return bytes();},{storage:storage(),persistent:true,diskBytes:8,memoryBytes:4});cache.setContext('tiles');
 cache.setSequence(['om://old','om://keep']);
 for(const url of ['keep/0','old/0','old/1']){await read(cache,url);await saved(cache);}
 assert.equal(cache.limited,true);
 cache.setSequence(['om://new','om://old/1']);assert.equal(cache.limited,false);
 await read(cache,'new/0');await saved(cache);
 assert.equal(cache.limited,false,'An obsolete layer evicted from disk does not stop the new comparison');
 const before=calls;await read(cache,'old/1');assert.equal(calls,before,'A still-selected shared panel survives eviction');cache.release();
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

test('rolling lifetime reuses tiles across the hour without extending their expiry',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,20,12,59)});
 const disk=storage();let calls=0;
 const create=(version='test-v1')=>new ForecastTileCache(async()=>{calls++;return bytes();},{storage:disk,persistent:true,cacheVersion:version});
 const first=create();first.setContext('view');await read(first,'run/field');await saved(first);first.release();
 t.mock.timers.tick(120000);
 const second=create();second.setContext('view');await read(second,'run/field');assert.equal(calls,1,'13:01 reuses 12:59 pixels');
 t.mock.timers.tick(3480000);await read(second,'run/field');assert.equal(calls,2,'restoring a tile did not extend its original lifetime');await saved(second);second.release();
 const revised=create('test-v2');revised.setContext('view');await read(revised,'run/field');assert.equal(calls,3,'renderer revisions invalidate incompatible pixels');await saved(revised);revised.release();
});
test('immutable archived frames remain warm across next-day comparisons without another renderer call',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,21,8)});
 const disk=storage();let calls=0;
 const create=()=>new ForecastTileCache(async()=>{calls++;return bytes();},{storage:disk,persistent:true,cacheVersion:'archive-test'});
 const url='https://raw.githubusercontent.com/matthewhugo81-arch/snowline/'+'a'.repeat(40)+'/ensemble-data/snowline_ecmwf_ensemble/run/frame.om?variable=pressure';
 const first=create();first.setContext('view');await read(first,url);await saved(first);first.release();
 t.mock.timers.tick(24*3600000);
 const second=create();second.setContext('view');await read(second,url);assert.equal(calls,1);
 await read(second,url.replace('a'.repeat(40),'b'.repeat(40)));assert.equal(calls,2,'a corrected snapshot has a different identity');
 await saved(second);second.release();
});
