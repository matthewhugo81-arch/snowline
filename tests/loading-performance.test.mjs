import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastPlayback} from '../map-playback.js';
import {ForecastWorkQueue} from '../map-work-queue.js';
import {ForecastTileCache} from '../map-tile-cache.js';
import {ForecastFrames} from '../map-frames.js';
import {BriefingRenderer} from '../map-briefing-renderer.js';
import {FakeMap,loaded} from './frame-fake.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('ready display work consumes the interval instead of adding to the cadence',async()=>{
 let now=0,index=0;const shown=[];
 const clock=new ForecastPlayback({length:()=>5,index:()=>index,interval:700,now:()=>now,sleep:async ms=>{now+=ms;},prepare:async()=>true,
  show:async i=>{now+=200;index=i;shown.push(now);if(shown.length===5)clock.pause();return true;}});
 await clock.start();assert.deepEqual(shown,[900,1600,2300,3000,3700]);
});

test('next-frame preparation begins before the presentation wait and late frames never skip',async()=>{
 let index=0,playing=false,started=false;const shown=[];
 const clock=new ForecastPlayback({length:()=>4,index:()=>index,buffer:1,onState:phase=>{if(phase==='playing')playing=true;},
  prepare:async()=>{if(playing)started=true;return true;},sleep:async()=>{await Promise.resolve();assert.equal(started,true);started=false;},
  show:async i=>{index=i;shown.push(i);if(shown.length===5)clock.pause();return true;}});
 await clock.start();assert.deepEqual(shown,[1,2,3,0,1]);
});

test('briefing input queue bounds speculative reads and cancels queued requests',async()=>{
 const queue=new ForecastWorkQueue(),started=[];let finish;
 const first=queue.run(()=>{started.push('first');return new Promise(resolve=>finish=resolve);},new AbortController().signal);
 const controller=new AbortController(),second=queue.run(()=>started.push('cancelled'),controller.signal);
 const rejected=assert.rejects(second,{name:'AbortError'});controller.abort();await rejected;
 const third=queue.run(()=>started.push('third'),new AbortController().signal);
 assert.deepEqual(started,['first']);finish();await Promise.all([first,third]);await flush();
 assert.deepEqual(started,['first','third']);assert.equal(queue.active,0);assert.equal(queue.jobs.length,0);
});

test('returning to an exact recent view reuses disk tiles while other clips stay isolated and bounded',async()=>{
 const stores=new Map(),storage={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{
  if(!stores.has(key))stores.set(key,new Map());const entries=stores.get(key);
  return {match:async key=>entries.get(key)?.clone(),put:async(key,value)=>entries.set(key,value.clone())};
 }};
 let calls=0;const cache=new ForecastTileCache(async()=>({data:new Uint8Array([++calls]).buffer}),{storage,maxContexts:2});
 const read=async view=>{cache.setContext(view);return new Uint8Array((await cache.protocol({url:'om://same-tile',type:'image'},new AbortController())).data)[0];};
 assert.equal(await read('area-A'),1);await flush();assert.equal(await read('area-B'),2);await flush();
 assert.equal(await read('area-A'),1);assert.equal(calls,2);assert.equal(await read('area-C'),3);await flush();
 assert.equal(cache.contexts.size,2);assert.equal(await read('area-B'),4);cache.release();await flush();assert.equal(stores.size,0);
});

test('an extended timeline retains ready frames; changed companion data retires only its affected frame',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const current=await loaded(cache,map,'t0'),next=await loaded(cache,map,'t1');cache.show(current,.8,'linear');
 cache.retain(new Set(['t0','t1','t2']));assert.equal(cache.isReady('t0'),true);assert.equal(cache.isReady('t1'),true);assert.equal(cache.preloaded.size,2);
 cache.retain(new Set(['t1','t2']));assert.equal(cache.current,current);assert.equal(cache.frames.has('t0'),false);assert.equal(cache.preloaded.has('t0'),false);
 assert.equal(await cache.acquire('t1'),next);cache.show(next,.8,'linear');assert.equal(cache.retired.size,0);cache.clear();
});

test('selecting a pending nearby frame preserves useful adjacent preparation',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');cache.show(await loaded(cache,map,'t0'),.8,'linear');
 cache.keep=new Set(['t0','t1','t2']);const one=cache.prepare('t1'),two=cache.prepare('t2');const selected=cache.acquire('t1');
 assert.equal(two.pending,true);assert.equal(two.cancelled,undefined);map.load(one);map.load(two);assert.equal(await selected,one);assert.equal(await two.ready,true);cache.clear();
});

test('briefing prefetch reads matching-time native inputs sequentially and respects cancellation',async()=>{
 const renderer=Object.create(BriefingRenderer.prototype),reads=[],controller=new AbortController();
 renderer.settings={domainOptions:[{value:'ecmwf_ifs025',grid:{}}]};
 renderer.OM={getRanges:()=>['clipped'],getProtocolInstance:()=>({omFileReader:{readVariable:async(url,variable,ranges,signal)=>{signal.throwIfAborted();reads.push({url,variable,ranges});}}})};
 const time='2026-10-15T12:00:00Z',meta={domain:'ecmwf_ifs025',reference_time:'2026-10-15T00:00:00Z',valid_times:[time],variables:['temperature_2m','pressure_msl']};
 await renderer.prepareInputs({meta,preset:{field:'temperature_2m',required:['temperature_2m','pressure_msl']},time,clip:[-10,50,4,60],signal:controller.signal});
 assert.deepEqual(reads.map(r=>r.variable),['temperature_2m','pressure_msl']);assert.ok(reads.every(r=>r.url.includes('2026-10-15')&&r.ranges[0]==='clipped'));
 controller.abort();await assert.rejects(renderer.prepareInputs({meta,preset:{field:'temperature_2m',required:['temperature_2m']},time,clip:[],signal:controller.signal}),{name:'AbortError'});
});

test('briefing composite prefetch expands cloud/rain and only matching pressure',async()=>{
 const renderer=Object.create(BriefingRenderer.prototype),reads=[];
 renderer.settings={domainOptions:[{value:'ecmwf_ifs025',grid:{}}]};
 renderer.OM={getRanges:()=>[],getProtocolInstance:()=>({omFileReader:{readVariable:async(url,variable)=>reads.push(variable)}})};
 const time='2026-10-15T12:00:00Z',base={domain:'ecmwf_ifs025',reference_time:'2026-10-15T00:00:00Z',valid_times:[time],variables:['cloud_cover','precipitation']};
 const preset={field:'cloud_precipitation_mslp',required:['cloud_precipitation_mslp']};
 for(const pressure of ['absent','same','old']){
  reads.length=0;
  const meta=pressure==='absent'?base:{...base,sources:[base,{...base,variables:['pressure_msl'],reference_time:pressure==='old'?'2026-10-14T12:00:00Z':base.reference_time}]};
  await renderer.prepareInputs({meta,preset,time,clip:[],signal:new AbortController().signal});
  assert.deepEqual(reads,['cloud_cover','precipitation_hourly_rate',...(pressure==='same'?['pressure_msl']:[])]);
 }
});
