import test from 'node:test';
import assert from 'node:assert/strict';
import {arrowFrameWindow,ForecastFrames,fullSequence} from '../map-frames.js';
import {ForecastTileCache} from '../map-tile-cache.js';
import {FakeMap,loaded} from './frame-fake.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('both arrows warm before distant hours, without dropping hourly coverage',()=>{
 const urls=['0','1','2','3','4','5'];
 assert.deepEqual(arrowFrameWindow(urls,2,{ahead:2,behind:1,loop:true}).upcoming,['3','1','4']);
 assert.deepEqual(arrowFrameWindow(urls,2,{ahead:2,behind:1,loop:true,direction:-1}).upcoming,['1','3','0']);
 assert.deepEqual(arrowFrameWindow(urls,0,{ahead:1,behind:1,loop:false}).upcoming,['1']);
 assert.deepEqual(arrowFrameWindow(['0',null,'2'],0,{ahead:2,behind:1,loop:true}).upcoming,['2']);
 assert.equal(fullSequence(urls,2).length,6);
});

test('three panels prepare both neighbours before starting distant preloads',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const panels=[];
 for(const key of ['a','b','c']){
  const map=new FakeMap(),distant=[];
  const cache=new ForecastFrames(map,key,{prefetch:async url=>distant.push(url),preloadConcurrency:2});
  cache.show(await loaded(cache,map,'2'),.8,'linear');
  panels.push({map,cache,distant});
  cache.warm({...arrowFrameWindow(['0','1','2','3','4','5'],2,{ahead:2,behind:1,loop:true}),all:['3','4','5','0','1','2'],delay:0});
 }
 t.mock.timers.tick(0);
 for(const {map,cache,distant}of panels){
  assert.ok(cache.frames.get('3')?.pending);
  assert.ok(cache.frames.get('1')?.pending);
  assert.deepEqual(distant,[]);
  map.load(cache.frames.get('3'));map.load(cache.frames.get('1'));
 }
 await flush();
 for(const {map,cache}of panels){
  assert.ok(cache.isReady('1'));assert.ok(cache.isReady('3'));
  const adds=map.sourceAdds;assert.equal((await cache.acquire('1')).url,'1');
  assert.equal(map.sourceAdds,adds,'Reverse arrow reuses prepared sources');cache.clear();
 }
});

test('adjacent tiles from all panels bypass queued distant work, with selected tiles first',async()=>{
 const started=[],jobs=new Map();
 const cache=new ForecastTileCache(p=>new Promise(resolve=>{started.push(p.url);jobs.set(p.url,resolve);}),{storage:null,concurrency:2,backgroundConcurrency:1});
 cache.setContext('arrows');
 cache.setForeground(['om://selected'],['om://a-next','om://b-next','om://c-next']);
 const request=url=>cache.protocol({url,type:'arrayBuffer'},new AbortController());
 const work=[request('om://busy')];await flush();
 work.push(request('om://distant'),request('om://a-next/1/0/0'),request('om://b-next/1/0/0'),request('om://c-next/1/0/0'),request('om://selected/1/0/0'));
 await flush();assert.deepEqual(started,['om://busy','om://selected/1/0/0']);
 const finish=url=>jobs.get(url)({data:new Uint8Array([1]).buffer});
 finish('om://busy');await flush();assert.equal(started.at(-1),'om://a-next/1/0/0');
 finish('om://a-next/1/0/0');await flush();assert.equal(started.at(-1),'om://b-next/1/0/0');
 finish('om://b-next/1/0/0');await flush();assert.equal(started.at(-1),'om://c-next/1/0/0');
 finish('om://c-next/1/0/0');await flush();assert.equal(started.at(-1),'om://distant');
 finish('om://distant');finish('om://selected/1/0/0');await Promise.all(work);cache.release();
});
