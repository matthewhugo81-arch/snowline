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

test('playback buffers first, repeats every native time across loops, and keeps its cadence',async()=>{
 let index=0,now=0;const shown=[],prepared=[],states=[],sleeps=[];
 const clock=new ForecastPlayback({length:()=>5,index:()=>index,prepare:async i=>{prepared.push(i);return true;},show:async i=>{shown.push(i);index=i;if(shown.length===10)clock.pause();return true;},onState:s=>states.push(s),interval:700,buffer:3,now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;}});
 await clock.start();assert.deepEqual(prepared.slice(0,3),[1,2,3]);assert.deepEqual(shown,[1,2,3,4,0,1,2,3,4,0]);assert.deepEqual(sleeps,Array(10).fill(700));assert.equal(clock.playing,false);assert.equal(states.at(-1),'paused');assert.ok(!states.includes('ended'));
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

test('failed restart at the final frame resets the play button',async()=>{
 const states=[];const clock=new ForecastPlayback({length:()=>3,index:()=>2,prepare:async()=>true,show:async()=>false,onState:s=>states.push(s),sleep:async()=>{}});
 await clock.start();assert.equal(clock.playing,false);assert.equal(states.at(-1),'failed');
});

test('starting near the end buffers the beginning of the next loop before playback',async()=>{
 let index=3;const prepared=[],shown=[];
 const clock=new ForecastPlayback({length:()=>5,index:()=>index,buffer:2,prepare:async i=>{prepared.push(i);return true;},show:async i=>{if(!shown.length)assert.deepEqual(prepared.slice(0,2),[4,0]);shown.push(i);index=i;if(shown.length===3)clock.pause();return true;},sleep:async()=>{}});
 await clock.start();assert.deepEqual(shown,[4,0,1]);
});

test('pausing while the loop start is loading cannot display a late first frame',async()=>{
 let index=1,finish;const shown=[];
 const clock=new ForecastPlayback({length:()=>3,index:()=>index,buffer:1,prepare:i=>i===0?new Promise(resolve=>finish=resolve):Promise.resolve(true),show:async i=>{shown.push(i);index=i;return true;},sleep:async()=>{}});
 const pending=clock.start();await flush();assert.equal(index,2);assert.equal(typeof finish,'function');
 clock.pause();finish(true);await pending;assert.deepEqual(shown,[2]);assert.equal(index,2);
});

test('an unavailable first frame stops on the final valid forecast instead of skipping it',async()=>{
 let index=0;const shown=[],states=[];
 const clock=new ForecastPlayback({length:()=>3,index:()=>index,prepare:async i=>i!==0,show:async i=>{shown.push(i);index=i;return true;},onState:s=>states.push(s),sleep:async()=>{}});
 await clock.start();assert.deepEqual(shown,[1,2]);assert.equal(index,2);assert.equal(states.at(-1),'failed');assert.equal(clock.playing,false);
});

test('empty and single-frame forecasts do not create a repeating load loop',async()=>{
 for(const length of [0,1]){
  const clock=new ForecastPlayback({length:()=>length,index:()=>0,prepare:()=>assert.fail('No extra frame to load'),show:()=>assert.fail('No new time to display'),sleep:()=>assert.fail('No animation needed')});
  await clock.start();assert.equal(clock.playing,false);
 }
});

test('loop buffers stay bounded, wrap forward and backward, and do not duplicate short timelines',()=>{
 const urls=Array.from({length:55},(_,i)=>'t'+i);
 assert.deepEqual(frameWindow(urls,54,{ahead:2,behind:1,loop:true}),{keep:new Set(['t53','t54','t0','t1']),upcoming:['t0','t1']});
 assert.deepEqual(frameWindow(urls,0,{ahead:2,behind:1,loop:true}),{keep:new Set(['t54','t0','t1','t2']),upcoming:['t1','t2']});
 for(let index=0;index<urls.length;index++)assert.equal(frameWindow(urls,index,{ahead:2,behind:1,loop:true}).keep.size,4);
 assert.deepEqual(frameWindow(['t0','t1'],1,{ahead:4,behind:2,loop:true}),{keep:new Set(['t0','t1']),upcoming:['t0']});
 assert.deepEqual(frameWindow(['t0'],0,{loop:true}),{keep:new Set(['t0']),upcoming:[]});
 assert.deepEqual(frameWindow([],0,{loop:true}),{keep:new Set(),upcoming:[]});
});

test('foreground selection retains useful in-flight work and immediate warming reuses it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),cache=new ForecastFrames(map,'a',{delay:120});
 cache.show(await loaded(cache,map,'t4'),.8,'linear');
 const window=frameWindow(['t0','t1','t2','t3','t4'],4,{ahead:2,behind:1,loop:true});
 cache.warm({...window,delay:0});t.mock.timers.tick(0);
 const first=cache.frames.get('t0');assert.ok(first?.pending);assert.equal(cache.frames.has('t1'),false);
 cache.warm({...window,upcoming:[]});t.mock.timers.tick(1000);
 assert.equal(cache.prepare('t0'),first);assert.equal(map.sourceAdds,2);
 map.load(first);await first.ready;await flush();assert.equal(cache.frames.has('t1'),false);
 cache.warm({...window,delay:0});t.mock.timers.tick(0);await flush();
 assert.equal(cache.frames.get('t0'),first);assert.ok(cache.frames.get('t1')?.pending);assert.equal(map.sourceAdds,3);
 cache.clear();
});
