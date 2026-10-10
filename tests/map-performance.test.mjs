import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastFrames,frameWindow} from '../map-frames.js';
import {ForecastPlayback} from '../map-playback.js';
import {overlayGroups} from '../map-overlay-specs.js';
import {FakeMap,loaded} from './frame-fake.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('advancing the buffer retains useful in-flight requests rather than restarting them',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 cache.show(await loaded(cache,map,'t0'),.8,'linear');
 cache.warm(frameWindow(['t0','t1','t2','t3'],0));t.mock.timers.tick(180);
 const pending=cache.frames.get('t1');assert.ok(pending?.pending);
 cache.warm(frameWindow(['t0','t1','t2','t3'],1));
 assert.equal(cache.prepare('t1'),pending);assert.equal(map.sourceAdds,2);
 map.load(pending);assert.equal(await pending.ready,true);cache.clear();
});

test('image and pressure/contour sources must all load before promotion',async()=>{
 const map=new FakeMap();map.layers.push({id:'roads',type:'line'},{id:'places',type:'symbol'});
 const cache=new ForecastFrames(map,'a',{rasterBefore:'roads',overlayBefore:'places',decorate:()=>[{id:'mslp',source:{type:'vector',url:'pressure'},layers:[{id:'line',type:'line',paint:{'line-width':1}},{id:'label',type:'symbol',layout:{},paint:{}}]}]});
 const frame=cache.prepare('rain');map.getSource(frame.id).loaded=true;
 map.emit('sourcedata',{sourceId:frame.id});await flush();assert.equal(frame.pending,true);
 assert.equal(cache.show(frame,.8,'linear'),false);
 map.load(frame);assert.equal(await frame.ready,true);
 assert.equal(cache.show(frame,.8,'linear'),true);
 assert.ok(map.layers.indexOf(map.getLayer(frame.layer))<map.layers.indexOf(map.getLayer('roads')));
 assert.ok(map.layers.indexOf(map.getLayer(frame.layers[1]))<map.layers.indexOf(map.getLayer('places')));
 assert.ok(!map.moves.includes('roads'));assert.ok(!map.moves.includes('places'));
 cache.clear();assert.equal(map.sources.size,0);assert.deepEqual(map.layers.map(l=>l.id),['background','roads','places']);
});

test('overlay failures never mark an incomplete frame as ready and can be retried',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{decorate:()=>[{id:'mslp',source:{type:'vector'},layers:[{id:'line',type:'line',paint:{}}]}]});
 const frame=cache.prepare('rain');map.emit('error',{sourceId:frame.resources[1]});
 assert.equal(await frame.ready,false);assert.equal(cache.show(frame,.8,'linear'),false);
 const retry=cache.prepare('rain');assert.notEqual(retry,frame);map.load(retry);assert.equal(await retry.ready,true);cache.clear();
});

test('bounded comparison buffers and source identities prevent cross-run reuse',async()=>{
 assert.deepEqual(frameWindow(['0','1','2','3','4','5','6','7'],3,{ahead:2,behind:1}).keep,new Set(['2','3','4','5']));
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const old=await loaded(cache,map,'0600Z/rain/t12'),newer=await loaded(cache,map,'1200Z/rain/t12');assert.notEqual(old.id,newer.id);
 cache.clear();
});

test('disabled scalar overlays create no vector sources; wind arrows and selected MSLP remain available',()=>{
 assert.deepEqual(overlayGroups({field:{key:'temperature_2m'},url:'temp',contours:false,isobars:false}),[]);
 const groups=overlayGroups({field:{key:'wind_speed_10m'},url:'wind',pressureURL:'pressure',contours:false,isobars:true});
 assert.equal(groups.length,2);assert.deepEqual(groups[0].layers.map(l=>l.id),['wind-halo','wind-arrows']);
 assert.equal(groups[1].source.url,'pressure');
});

test('playback buffers first, displays every native time in order, and uses the selected cadence',async()=>{
 let index=0,now=0;const shown=[],prepared=[],states=[],sleeps=[];
 const clock=new ForecastPlayback({length:()=>5,index:()=>index,prepare:async i=>{prepared.push(i);return true;},show:async i=>{shown.push(i);index=i;return true;},onState:s=>states.push(s),interval:700,buffer:3,now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;}});
 await clock.start();assert.deepEqual(prepared.slice(0,3),[1,2,3]);assert.deepEqual(shown,[1,2,3,4]);assert.deepEqual(sleeps,[700,700,700,700]);assert.equal(clock.playing,false);assert.equal(states.at(-1),'ended');
});

test('pausing while buffering cannot advance or change the displayed time',async()=>{
 let finish;const shown=[];
 const clock=new ForecastPlayback({length:()=>3,index:()=>0,prepare:()=>new Promise(r=>finish=r),show:async i=>{shown.push(i);return true;}});
 const work=clock.start();clock.pause();finish(true);await work;assert.deepEqual(shown,[]);assert.equal(clock.playing,false);
});

test('a failed buffered frame stops playback rather than skipping a forecast hour',async()=>{
 const shown=[],states=[];const clock=new ForecastPlayback({length:()=>4,index:()=>0,prepare:async i=>i!==2,show:async i=>{shown.push(i);return true;},onState:s=>states.push(s)});
 await clock.start();assert.deepEqual(shown,[]);assert.equal(states.at(-1),'failed');assert.equal(clock.playing,false);
});

test('a newly selected cycle invalidates the old playback without a late commit',async()=>{
 let resolve;const shown=[];const clock=new ForecastPlayback({length:()=>3,index:()=>0,prepare:()=>new Promise(r=>resolve=r),show:async i=>{shown.push(i);return true;}});
 const pending=clock.start();clock.pause();resolve(true);await pending;assert.deepEqual(shown,[]);
});
