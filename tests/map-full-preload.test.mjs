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
 assert.equal(cache.failures.has('bad'),true);assert.equal(cache.preloaded.has('bad'),false);assert.equal(cache.current.url,'now');
 cache.warm(work);t.mock.timers.tick(0);await flush();assert.equal(cache.frames.has('bad'),false);
 cache.suspend();assert.equal(cache.preloaded.size,0);assert.equal(cache.failures.size,0);cache.clear();
});
