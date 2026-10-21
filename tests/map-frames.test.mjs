import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastFrames,frameWindow} from '../map-frames.js';

class FakeMap{
 layers=[{id:'background'}];sources=new Map();events=new Map();sourceAdds=0;
 on(type,callback){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(callback);}
 off(type,callback){this.events.get(type)?.delete(callback);}
 emit(type,event={}){for(const callback of [...(this.events.get(type)??[])])callback(event);}
 getStyle(){return {layers:this.layers};}
 addSource(id,source){this.sources.set(id,{...source,loaded:false});this.sourceAdds++;}
 getSource(id){return this.sources.get(id);}
 removeSource(id){this.sources.delete(id);}
 isSourceLoaded(id){return !!this.sources.get(id)?.loaded;}
 addLayer(layer,before){this.layers.splice(before?this.layers.findIndex(item=>item.id===before):this.layers.length,0,layer);}
 getLayer(id){return this.layers.find(layer=>layer.id===id);}
 removeLayer(id){this.layers=this.layers.filter(layer=>layer.id!==id);}
 moveLayer(id,before){const layer=this.getLayer(id);this.removeLayer(id);this.addLayer(layer,before);}
 setLayoutProperty(id,key,value){const layer=this.getLayer(id);layer.layout??={};layer.layout[key]=value;}
 setPaintProperty(id,key,value){this.getLayer(id).paint[key]=value;}
 triggerRepaint(){queueMicrotask(()=>this.emit('render'));}
 load(frame){this.sources.get(frame.id).loaded=true;this.emit('sourcedata',{sourceId:frame.id});}
}
const loaded=async(cache,map,url)=>{const frame=cache.prepare(url);map.load(frame);assert.equal(await frame.ready,true);return frame;};

test('pan retains source identities and cached frames; only new tile coverage changes readiness',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');cache.setView('tiles-1');
 const current=await loaded(cache,map,'hour1'),next=await loaded(cache,map,'hour2');cache.show(current,.8,'linear');
 cache.moveStart();assert.equal(cache.setView('tiles-1'),false);
 assert.deepEqual([...cache.preloaded],['hour1','hour2']);assert.equal(cache.current,current);assert.equal(map.sourceAdds,2);
 assert.equal(map.getLayer(current.layer).layout.visibility,'visible');
 assert.equal(map.getLayer(next.layer).layout.visibility,'none');
 assert.equal(cache.setView('tiles-2'),true);assert.equal(cache.preloaded.size,0);
 assert.equal(cache.current,current);assert.equal(cache.frames.get('hour2'),next);
 assert.equal(cache.prepare('hour1'),current);map.load(current);assert.equal(await current.ready,true);
 assert.equal(map.sourceAdds,2,'MapLibre adds tiles to existing sources instead of rebuilding frames');cache.clear();
});

test('returning to a prepared zoom restores all frames, including a smaller covered extent',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'zoom');
 const wide=JSON.stringify([['4/7/5','4/8/5'],['4/7/5','4/8/5']]),close=JSON.stringify([['5/15/10'],['5/15/10']]);
 cache.setView(wide);
 for(const url of ['now','next','later'])await loaded(cache,map,url);
 const current=cache.frames.get('now');cache.show(current,.8,'linear');
 cache.moveStart();cache.setView(close);
 assert.equal(cache.preloaded.size,0,'New detail is not prematurely reported ready');
 assert.equal(cache.cachedFrames().size,3,'Completed charts remain cached at their original zoom');
 await loaded(cache,map,'now');
 cache.setView(wide);assert.equal(cache.preloaded.size,3,'The full prepared sequence returns immediately');
 assert.equal(cache.isReady('now'),false,'Restoring progress does not bypass the selected image render');
 assert.equal(cache.current,current);
 cache.setView(JSON.stringify([['4/7/5'],['4/7/5']]));assert.equal(cache.preloaded.size,3,'A subset of prepared tiles needs no downloads');
 cache.retain(new Set(['now']));assert.deepEqual([...cache.cachedFrames()],['now']);
 cache.setView(close);assert.deepEqual([...cache.preloaded],['now'],'Retired URLs cannot return from zoom history');cache.clear();
});

test('zoom history is bounded and expires without extending the age of copied coverage',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});
 const map=new FakeMap(),cache=new ForecastFrames(map,'zoom');cache.viewMaxAge=100;
 const wide=JSON.stringify([['a','b'],['a','b']]),narrow=JSON.stringify([['a'],['a']]);
 cache.setView(wide);await loaded(cache,map,'now');
 t.mock.timers.tick(80);cache.setView(narrow);assert.equal(cache.preloaded.size,1);
 t.mock.timers.tick(21);cache.setView(wide);assert.equal(cache.preloaded.size,0,'Subset reuse does not renew the underlying tiles');
 for(let i=0;i<30;i++)cache.setView('view-'+i);
 assert.equal(cache.views.size,8);cache.clear();
});

test('storage eviction prevents restoring optimistic zoom readiness',async()=>{
 let allowed=true;
 const map=new FakeMap(),cache=new ForecastFrames(map,'zoom',{canPreload:()=>allowed});
 cache.setView('wide');await loaded(cache,map,'now');cache.setView('close');allowed=false;
 cache.setView('wide');assert.equal(cache.preloaded.size,0);cache.clear();
});

test('an unpublished slot hides the previous image and can return to it without relabelling stale imagery',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const frame=await loaded(cache,map,'run09/hour11');cache.show(frame,.8,'linear');cache.hide();
 assert.equal(cache.current,null);assert.ok(map.layers.indexOf(map.getLayer(frame.layer))<map.layers.indexOf(map.getLayer('background')));
 assert.equal(cache.show(frame,.8,'linear'),true);assert.equal(cache.current,frame);
 cache.invalidateView();cache.hide();assert.equal(cache.retired.size,0);assert.equal(map.sources.size,0);cache.clear();
});

test('visited frames reuse their source and image layer without changing the displayed frame during loading',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const first=await loaded(cache,map,'run1/temp/hour1');cache.show(first,.8,'linear');
 const next=cache.prepare('run1/temp/hour2');
 assert.equal(cache.current,first);assert.ok(map.layers.indexOf(map.getLayer(next.layer))<map.layers.indexOf(map.getLayer('background')));
 map.load(next);await next.ready;cache.show(next,.8,'linear');
 assert.ok(map.layers.indexOf(map.getLayer(first.layer))<map.layers.indexOf(map.getLayer('background')));
 const again=cache.prepare(first.url);await again.ready;cache.show(again,.8,'linear');
 assert.equal(again,first);assert.equal(map.sourceAdds,2);assert.equal(cache.current,first);
 cache.clear();
});

test('returning to a cached frame waits for new viewport tiles after a pan',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const frame=await loaded(cache,map,'temp');cache.show(frame,.8,'linear');cache.suspend();
 map.getSource(frame.id).loaded=false;
 cache.prepare('temp');await Promise.resolve();
 assert.equal(frame.pending,true);
 map.load(frame);assert.equal(await frame.ready,true);cache.clear();
});

test('rapid selection changes cancel obsolete work but preserve the chosen in-flight frame',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const current=await loaded(cache,map,'hour1');cache.show(current,.8,'linear');
 const unwanted=cache.prepare('hour2'),selected=cache.prepare('hour3');
 cache.stop('hour3');
 assert.equal(await unwanted.ready,false);assert.equal(map.getSource(unwanted.id),undefined);
 assert.ok(map.getSource(selected.id));assert.equal(cache.current,current);
 map.load(selected);assert.equal(await selected.ready,true);cache.clear();
});

test('failed frames can be discarded and retried; clearing settles outstanding loads',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const failed=cache.prepare('hour1');map.emit('error',{sourceId:failed.id});assert.equal(await failed.ready,false);
 cache.discard(failed);const retry=await loaded(cache,map,'hour1');assert.notEqual(retry.id,failed.id);
 const pending=cache.prepare('hour2');cache.clear();assert.equal(await pending.ready,false);
 assert.equal(map.sources.size,0);assert.equal(cache.frames.size,0);
});

test('frame window caps retention at five images and only preloads the next two available times',()=>{
 const urls=['t0','t1','t2','t3','t4','t5','t6'];
 assert.deepEqual(frameWindow(urls,3),{keep:new Set(['t1','t2','t3','t4','t5']),upcoming:['t4','t5']});
 assert.deepEqual(frameWindow(['t0',null,'t2'],0),{keep:new Set(['t0','t2']),upcoming:['t2']});
 assert.deepEqual(frameWindow(urls,6),{keep:new Set(['t4','t5','t6']),upcoming:[]});
});

test('completed frames outside the retained window are removed, without hiding the current image',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const old=await loaded(cache,map,'old'),current=await loaded(cache,map,'current');cache.show(current,.8,'linear');
 cache.warm({keep:new Set(['current']),upcoming:[]});
 assert.equal(map.getSource(old.id),undefined);assert.equal(cache.current,current);
 assert.equal(map.getLayer(current.layer).layout.visibility,'visible');cache.clear();
});

test('background warming waits, loads one future image at a time, and covers completed images',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const current=await loaded(cache,map,'now');cache.show(current,.8,'linear');
 cache.warm({keep:new Set(['now','next1','next2']),upcoming:['next1','next2']});
 assert.equal(map.sourceAdds,1);t.mock.timers.tick(180);
 const first=cache.frames.get('next1');assert.ok(first);assert.equal(cache.frames.has('next2'),false);
 map.load(first);await first.ready;await Promise.resolve();
 const second=cache.frames.get('next2');assert.ok(second);
 assert.ok(map.layers.indexOf(map.getLayer(first.layer))<map.layers.indexOf(map.getLayer('background')));assert.equal(cache.current,current);
 map.load(second);await second.ready;cache.clear();
});

test('panning suspends old images so they cannot compete for tiles in the new viewport',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const first=await loaded(cache,map,'first'),current=await loaded(cache,map,'current');cache.show(current,.8,'linear');
 cache.suspend(current.url);
 assert.equal(map.getLayer(first.layer).layout.visibility,'none');assert.equal(first.suspended,true);
 assert.equal(map.getLayer(current.layer).layout.visibility,'visible');cache.clear();
});

test('source readiness before the next render cannot prematurely complete a frame',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const frame=cache.prepare('forecast');await Promise.resolve();
 // Metadata can report loaded before the next render requests the new tiles.
 map.getSource(frame.id).loaded=true;map.emit('sourcedata',{sourceId:frame.id});
 assert.equal(frame.pending,true,'A source event is not a completed map render');
 map.getSource(frame.id).loaded=false;await Promise.resolve();assert.equal(frame.pending,true);
 map.load(frame);assert.equal(await frame.ready,true);cache.clear();
});

test('a new area rebuilds all resources while keeping the labelled old image until commit',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 const old=await loaded(cache,map,'same-hour');cache.show(old,.8,'linear');
 const pending=cache.prepare('future');cache.invalidateView();
 assert.equal(await pending.ready,false);assert.equal(cache.failures.size,0);
 assert.equal(cache.preloaded.size,0);assert.equal(cache.current,old);
 assert.ok(map.getLayer(old.layer));assert.equal(cache.isReady(old.url),false);
 const replacement=cache.prepare(old.url);assert.notEqual(replacement.id,old.id);
 assert.ok(map.getLayer(old.layer),'Keep the image visible while the new area loads');
 map.load(replacement);await replacement.ready;cache.show(replacement,.8,'linear');
 assert.equal(map.getSource(old.id),undefined);assert.equal(cache.frames.get(old.url),replacement);
 assert.equal(cache.retired.size,0);cache.clear();assert.equal(map.sources.size,0);
});

test('repeated map moves and model changes release retained fallback resources',async()=>{
 const map=new FakeMap(),cache=new ForecastFrames(map,'a');
 cache.show(await loaded(cache,map,'current'),.8,'linear');cache.invalidateView();
 const replacement=cache.prepare('current');cache.invalidateView();
 assert.equal(await replacement.ready,false);assert.equal(cache.retired.size,1);
 cache.clear();assert.equal(map.sources.size,0);assert.equal(cache.retired.size,0);
});
