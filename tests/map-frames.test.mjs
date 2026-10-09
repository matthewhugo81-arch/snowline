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
