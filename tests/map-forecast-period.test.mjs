import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastPeriodHours,forecastPeriodURLs,ForecastPeriodPriority} from '../map-forecast-period.js';
import {ForecastFrames} from '../map-frames.js';
import {FakeMap,loaded} from './frame-fake.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const reference='2026-10-21T06:00:00Z';
test('periods are inclusive, run-relative and count only available charts without truncating the timeline',()=>{
 const hours=[-6,0,12,24,36,48,72,96,120,144],times=hours.map(h=>new Date(Date.parse(reference)+h*3600000).toISOString()),urls=hours.map(h=>'h'+h);urls[2]=null;
 assert.deepEqual(forecastPeriodURLs(urls,times,reference,72),['h0','h24','h36','h48','h72']);
 assert.deepEqual(forecastPeriodURLs(urls,times,'2026-10-21T00:00:00Z',24),['h-6','h0']);
 assert.deepEqual(forecastPeriodURLs(urls,times,'invalid',72),[]);
 assert.deepEqual(forecastPeriodURLs(urls,times,reference,0),[]);
 assert.equal(urls.length,10);assert.equal(forecastPeriodHours('36'),36);assert.equal(forecastPeriodHours('999'),0);
 assert.deepEqual(forecastPeriodURLs(['a','b'],times.slice(1,3),reference,120),['a','b'],'Short runs do not invent missing hours');
});
test('all panels finish their priority period before any starts the remaining run',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const started=[],jobs=new Map(),entries=[],gate=new ForecastPeriodPriority(()=>entries);
 for(const key of ['a','b','c']){
  const map=new FakeMap(),cache=new ForecastFrames(map,key,{preloadConcurrency:2,onProgress:()=>gate.progress(),prefetch:url=>new Promise(resolve=>{started.push(url);jobs.set(url,resolve);})});
  cache.show(await loaded(cache,map,key+'now'),1,'linear');entries.push({cache,urls:[key+'first',key+'second']});
 }
 for(const [i,{cache,urls}]of entries.entries())cache.warm({keep:new Set([cache.current.url]),upcoming:[],priority:urls,all:[String.fromCharCode(97+i)+'tail',...urls],waitForRemainder:s=>gate.wait(s),delay:0});
 t.mock.timers.tick(0);await flush();assert.deepEqual(started,['afirst','asecond','bfirst','bsecond','cfirst','csecond']);
 for(const key of started.filter(key=>key!=='csecond'))jobs.get(key)();await flush();assert.equal(started.length,6);
 jobs.get('csecond')();await flush();assert.deepEqual(started.slice(6).sort(),['atail','btail','ctail']);
 for(const key of started.slice(6))jobs.get(key)();await flush();for(const {cache}of entries)cache.clear();
});
test('exhausted failures, storage limits and period changes release priority waiters',async()=>{
 const cache={preloaded:new Set(),canPreload:()=>true,canRetry:()=>true},entry={cache,urls:['slow']},gate=new ForecastPeriodPriority(()=>[entry]);
 let released=false;const controller=new AbortController(),wait=gate.wait(controller.signal).then(()=>released=true);
 await flush();assert.equal(released,false);cache.canRetry=()=>false;gate.progress();await wait;assert.equal(released,true);
 cache.canRetry=()=>true;cache.canPreload=()=>false;assert.equal(gate.pending(),false);
 cache.canPreload=()=>true;const obsolete=gate.wait(controller.signal);assert.equal(gate.waiters.size,1);controller.abort();await obsolete;assert.equal(gate.waiters.size,0);
 entry.urls=[];assert.equal(gate.pending(),false);
});
test('changing priority retains completed frames and in-flight downloads while reordering queued hours',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),jobs=new Map(),started=[],cache=new ForecastFrames(map,'a',{preloadConcurrency:1,prefetch:(url,controller)=>new Promise(resolve=>{started.push(url);jobs.set(url,{resolve,controller});})});
 cache.show(await loaded(cache,map,'now'),1,'linear');cache.preloaded.add('saved');
 cache.warm({keep:new Set(['now']),upcoming:[],all:['old','tail','first'],delay:0});t.mock.timers.tick(0);await flush();
 const source=cache.current.id;
 cache.warm({keep:new Set(['now']),upcoming:[],priority:['first','saved'],all:['old','tail','first','saved'],delay:0});t.mock.timers.tick(0);await flush();
 assert.equal(jobs.get('old').controller.signal.aborted,false);jobs.get('old').resolve();await flush();assert.deepEqual(started,['old','first']);
 jobs.get('first').resolve();await flush();assert.deepEqual(started,['old','first','tail']);jobs.get('tail').resolve();await flush();
 assert.equal(cache.current.id,source);assert.ok(cache.preloaded.has('saved'));cache.clear();
});
