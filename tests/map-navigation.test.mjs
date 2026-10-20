import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastNavigation} from '../map-navigation.js';

test('cold arrow bursts keep their latest target and prepare it only once',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let index=1;const selected=[];
 const navigation=new ForecastNavigation({select:()=>{selected.push(index);return true;}});
 const first=navigation.request();t.mock.timers.tick(40);
 index=2;const second=navigation.request();assert.equal(await first,false);
 t.mock.timers.tick(40);index=3;const third=navigation.request();assert.equal(await second,false);
 t.mock.timers.tick(69);assert.deepEqual(selected,[]);
 t.mock.timers.tick(1);assert.equal(await third,true);assert.deepEqual(selected,[3]);
 t.mock.timers.tick(1000);assert.deepEqual(selected,[3]);
});

test('a ready frame dispatches immediately and replaces an older cold target',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let index=1;const selected=[];
 const navigation=new ForecastNavigation({select:()=>{selected.push(index);return true;}});
 const cold=navigation.request();index=2;const ready=navigation.request({ready:true});
 assert.deepEqual(selected,[2]);assert.equal(await cold,false);assert.equal(await ready,true);
 index=3;const next=navigation.request({ready:true});assert.deepEqual(selected,[2,3]);
 assert.equal(await next,true);t.mock.timers.tick(1000);assert.deepEqual(selected,[2,3]);
});

test('cancel prevents a stale dispatch without stopping an already running selection',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let finish,calls=0;
 const navigation=new ForecastNavigation({select:()=>{calls++;return new Promise(resolve=>finish=resolve);}});
 const stale=navigation.request();navigation.cancel();assert.equal(await stale,false);
 t.mock.timers.tick(1000);assert.equal(calls,0);
 const running=navigation.request({ready:true});assert.equal(calls,1);
 navigation.cancel();finish(true);assert.equal(await running,true);
});

test('flush dispatches once, returns the same promise and detaches before selection',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0;
 const navigation=new ForecastNavigation({select:()=>{calls++;navigation.cancel();return true;}});
 const pending=navigation.request();assert.equal(navigation.flush(),pending);
 assert.equal(await pending,true);assert.equal(calls,1);assert.equal(navigation.flush(),null);
 t.mock.timers.tick(1000);assert.equal(calls,1);
});

test('synchronous and asynchronous selection failures propagate without unhandled rejections',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const asyncFailure of [false,true]){
  const failure=new Error(asyncFailure?'Async load failed':'Sync load failed');
  const navigation=new ForecastNavigation({select:()=>{if(asyncFailure)return Promise.reject(failure);throw failure;}});
  const pending=navigation.request();t.mock.timers.tick(70);
  // Give the rejection a turn before adding the caller's observer. The helper
  // handles event-listener use but preserves the original rejection for await.
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(pending,error=>error===failure);
  assert.equal(navigation.pending,null);
 }
});
