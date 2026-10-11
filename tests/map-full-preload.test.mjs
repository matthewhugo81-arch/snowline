import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastFrames,frameWindow,fullSequence} from '../map-frames.js';
import {FakeMap,loaded} from './frame-fake.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('full sequence includes every available time once, prioritising forward frames then wrapping',()=>{
 assert.deepEqual(fullSequence(['0','1',null,'3','4'],3),['4','0','1','3']);
 assert.deepEqual(fullSequence([],0),[]);
});

test('all distant frames preload while paused, without retaining all decoded map layers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),cache=new ForecastFrames(map,'a'),urls=Array.from({length:20},(_,i)=>'t'+i);
 cache.show(await loaded(cache,map,'t0'),.8,'linear');
 const window=frameWindow(urls,0,{ahead:2,behind:1,loop:true});
 cache.warm({...window,all:fullSequence(urls,0),delay:0});t.mock.timers.tick(0);
 for(let index=1;index<urls.length;index++){
  const frame=cache.frames.get(urls[index]);assert.ok(frame?.pending,urls[index]);
  assert.ok(cache.frames.size<=window.keep.size+1,'Only nearby frames and one background frame stay decoded');
  map.load(frame);await frame.ready;await flush();
 }
 assert.equal(cache.preloaded.size,20);assert.equal(cache.current.url,'t0');
 assert.ok(cache.frames.size<=window.keep.size);
 const before=map.sourceAdds;cache.warm({...window,all:fullSequence(urls,0),delay:0});t.mock.timers.tick(0);await flush();
 assert.equal(map.sourceAdds,before,'Completed distant frames are not repeatedly preloaded');cache.clear();
});

test('foreground changes interrupt distant warming, then resume unfinished frames',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),cache=new ForecastFrames(map,'a'),urls=['t0','t1','t2','t3','t4'];
 cache.show(await loaded(cache,map,'t0'),.8,'linear');
 cache.warm({keep:new Set(['t0']),upcoming:[],all:fullSequence(urls,0),delay:0});t.mock.timers.tick(0);
 const background=cache.frames.get('t1');assert.ok(background?.pending);
 cache.warm({keep:new Set(['t4']),upcoming:[]});assert.equal(await background.ready,false);
 assert.equal(cache.failures.size,0,'Cancellation is not reported as a missing forecast');
 cache.show(await loaded(cache,map,'t4'),.8,'linear');
 cache.warm({keep:new Set(['t4']),upcoming:[],all:fullSequence(urls,4),delay:0});t.mock.timers.tick(0);await flush();
 assert.ok(cache.frames.get('t1')?.pending);assert.equal(cache.current.url,'t4');cache.clear();
});

test('background failures are reported without hiding the current image or retrying forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');cache.show(await loaded(cache,map,'now'),.8,'linear');
 const work={keep:new Set(['now']),upcoming:[],all:['bad','later'],delay:0};cache.warm(work);t.mock.timers.tick(0);
 const bad=cache.frames.get('bad');map.emit('error',{sourceId:bad.id});await bad.ready;await flush();
 const later=cache.frames.get('later');map.load(later);await later.ready;await flush();
 for(let attempt=1;attempt<3;attempt++){
  const retry=cache.frames.get('bad');assert.ok(retry?.pending);assert.notEqual(retry,bad);
  map.emit('error',{sourceId:retry.id});await retry.ready;await flush();
 }
 assert.equal(cache.failures.has('bad'),true);assert.equal(cache.preloaded.has('bad'),false);assert.equal(cache.current.url,'now');
 cache.warm(work);t.mock.timers.tick(0);await flush();assert.equal(cache.frames.has('bad'),false);
 cache.suspend();assert.equal(cache.preloaded.size,0);assert.equal(cache.failures.size,0);cache.clear();
});

test('a timed-out background frame is retried after the rest and can complete the full sequence',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{timeout:100});cache.show(await loaded(cache,map,'now'),.8,'linear');
 cache.warm({keep:new Set(['now']),upcoming:[],all:['slow','later'],delay:0});t.mock.timers.tick(0);
 const slow=cache.frames.get('slow');t.mock.timers.tick(100);await slow.ready;await flush();
 assert.equal(cache.current.url,'now');assert.equal(cache.failureAttempts.get('slow'),1);
 const later=cache.frames.get('later');map.load(later);await later.ready;await flush();
 const retry=cache.frames.get('slow');assert.ok(retry?.pending);map.load(retry);await retry.ready;await flush();
 assert.equal(cache.preloaded.size,3);assert.equal(cache.failures.size,0);assert.equal(cache.failureAttempts.size,0);assert.equal(cache.current.url,'now');cache.clear();
});

test('automatic background retry limits survive queue restarts; a manual retry resets them',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{maxAttempts:2});
 const work={keep:new Set(),upcoming:[],all:['bad'],delay:0};
 cache.warm(work);t.mock.timers.tick(0);let frame=cache.frames.get('bad');map.emit('error',{sourceId:frame.id});await frame.ready;
 cache.warm(work);t.mock.timers.tick(0);await flush();frame=cache.frames.get('bad');map.emit('error',{sourceId:frame.id});await frame.ready;await flush();
 cache.warm(work);t.mock.timers.tick(0);await flush();assert.equal(cache.frames.size,0);assert.equal(cache.failureAttempts.get('bad'),2);
 cache.retryFailures();cache.warm(work);t.mock.timers.tick(0);frame=cache.frames.get('bad');map.load(frame);await frame.ready;
 assert.equal(cache.preloaded.has('bad'),true);assert.equal(cache.failures.size,0);cache.clear();
});

test('hidden-tab rendering pauses do not turn a valid background frame into an unavailable forecast',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let active=true;
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{timeout:100,isActive:()=>active});
 const frame=cache.prepare('next');t.mock.timers.tick(80);active=false;cache.pause();t.mock.timers.tick(1000);
 assert.equal(frame.pending,true);assert.equal(cache.failures.size,0);
 active=true;cache.resume();t.mock.timers.tick(80);map.load(frame);assert.equal(await frame.ready,true);
 assert.equal(cache.failureAttempts.size,0);cache.clear();
});

test('even a delayed visibility event cannot fire a frame timeout while the tab is hidden',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let active=true;
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{timeout:100,isActive:()=>active});
 const frame=cache.prepare('next');active=false;t.mock.timers.tick(101);assert.equal(frame.pending,true);assert.equal(cache.failures.size,0);
 cache.warm({keep:new Set(['next']),upcoming:[],all:['other'],delay:0});t.mock.timers.tick(0);assert.equal(cache.frames.has('other'),false);
 active=true;cache.resume();map.load(frame);assert.equal(await frame.ready,true);cache.clear();
});
