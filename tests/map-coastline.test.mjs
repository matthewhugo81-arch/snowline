import test from 'node:test';
import assert from 'node:assert/strict';
import {coastlineController,createCoastlineDataLoader} from '../map-coastline.js';

const coastline={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-5,50],[-4,51],[-3,52]]}}]};
const response=(data=coastline)=>({ok:true,status:200,json:async()=>data});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

class Events{
 constructor(){this.events=new Map();}
 on(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);return this;}
 off(name,fn){this.events.get(name)?.delete(fn);return this;}
 fire(name,event={}){for(const fn of [...(this.events.get(name)??[])])fn(event);return this;}
}
class Source extends Events{
 constructor(spec){super();this.data=spec.data;this.loaded=false;this.updates=[];this.pending=[];}
 setData(data){this.data=data;this.loaded=false;this.updates.push(data);const done=deferred();this.pending.push(done);this.fire('dataloading');return done.promise;}
 complete(){this.loaded=true;this.fire('data',{sourceDataType:'content'});for(const done of this.pending.splice(0))done.resolve();}
 fail(error){this.loaded=true;this.fire('error',{error});for(const done of this.pending.splice(0))done.resolve();}
}
class MapFixture extends Events{
 constructor(){super();this.sources=new Map();this.layers=this.baseLayers();this.moves=0;this.repaintRequests=0;}
 baseLayers(){return[{id:'land',type:'fill'},{id:'roads',type:'line'},{id:'city-labels',type:'symbol'}];}
 getStyle(){return{layers:this.layers};}
 getSource(id){return this.sources.get(id);}
 addSource(id,spec){assert.ok(!this.sources.has(id));this.sources.set(id,new Source(spec));}
 removeSource(id){this.sources.delete(id);}
 getLayer(id){return this.layers.find(layer=>layer.id===id);}
 addLayer(layer,before){const at=this.layers.findIndex(item=>item.id===before);this.layers.splice(at<0?this.layers.length:at,0,layer);}
 removeLayer(id){this.layers=this.layers.filter(layer=>layer.id!==id);}
 moveLayer(id,before){this.moves++;const layer=this.getLayer(id);this.removeLayer(id);this.addLayer(layer,before);}
 isSourceLoaded(id){return this.getSource(id)?.loaded??false;}
 triggerRepaint(){this.repaintRequests++;}
 render(){this.fire('render');}
 beginStyle(){this.fire('styledataloading');this.sources.clear();this.layers=[];}
 finishStyle(){this.layers=this.baseLayers();this.fire('style.load');}
 remove(){this.fire('remove');this.sources.clear();}
}

test('concurrent maps share one request and reuse the complete original geometry',async()=>{
 const download=deferred();let calls=0;
 const loadData=createCoastlineDataLoader({fetcher:()=>{calls++;return download.promise;}});
 const first=loadData(),second=loadData();assert.equal(first,second);
 download.resolve(response());assert.equal(await first,coastline);assert.equal(await second,coastline);
 assert.equal(await loadData(),coastline);assert.equal(calls,1);
});

test('transient network and server failures retry with a bounded attempt count',async()=>{
 let calls=0;
 const loadData=createCoastlineDataLoader({retryDelay:0,fetcher:async()=>{
  calls++;if(calls===1)throw new TypeError('Network offline');
  return calls===2?{ok:false,status:503}:response();
 }});
 assert.equal(await loadData(),coastline);assert.equal(calls,3);
});

test('an expired request is aborted and cannot replace a recovered cached response',async()=>{
 const stale=deferred();let calls=0,firstSignal;
 const loadData=createCoastlineDataLoader({timeout:15,retryDelay:0,fetcher:async(_url,{signal})=>{
  calls++;if(calls===1){firstSignal=signal;return stale.promise;}return response();
 }});
 assert.equal(await loadData(),coastline);assert.equal(firstSignal.aborted,true);assert.equal(calls,2);
 stale.resolve(response({type:'FeatureCollection',features:[]}));await flush();
 assert.equal(await loadData(),coastline);
});

test('exhausted failures are cleared so a later manual retry can recover',async()=>{
 let failed=true,calls=0;
 const loadData=createCoastlineDataLoader({attempts:2,retryDelay:0,fetcher:async()=>{
  calls++;if(failed)throw new TypeError('Network offline');return response();
 }});
 await assert.rejects(loadData(),/Network offline/);assert.equal(calls,2);
 failed=false;assert.equal(await loadData(),coastline);assert.equal(calls,3);
});

test('permanent HTTP errors and invalid responses are not retried; valid empty fixtures are accepted',async()=>{
 for(const result of [{ok:false,status:404},response({type:'FeatureCollection',features:[{}]}),{ok:true,json:async()=>{throw new SyntaxError('HTML instead of JSON');}}]){
  let calls=0;const loadData=createCoastlineDataLoader({retryDelay:0,fetcher:async()=>{calls++;return result;}});
  await assert.rejects(loadData());assert.equal(calls,1);
 }
 const empty={type:'FeatureCollection',features:[]};
 assert.equal(await createCoastlineDataLoader({fetcher:async()=>response(empty)})(),empty);
});

test('a loaded placeholder cannot make delayed geography ready; successful data needs a completed render',async t=>{
 const download=deferred(),map=new MapFixture(),states=[];
 const coast=coastlineController(map,{loadData:()=>download.promise,onState:state=>states.push(state.status)});t.after(()=>coast.destroy());
 coast.ensure('city-labels');const source=map.getSource('coastline');
 assert.deepEqual(source.data,{type:'FeatureCollection',features:[]});
 assert.ok(map.layers.indexOf(map.getLayer('coast-line'))<map.layers.indexOf(map.getLayer('city-labels')));
 assert.equal(map.getLayer('coast-line').paint['line-color'],'#000000');
 let settled=false;const ready=coast.wait().then(()=>{settled=true;});
 source.complete();map.render();await flush();assert.equal(settled,false);assert.equal(coast.isReady(),false);
 download.resolve(coastline);await flush();assert.equal(source.updates[0],coastline);
 map.render();assert.equal(coast.isReady(),false,'the worker has not completed the real geometry');
 source.complete();await flush();assert.equal(coast.isReady(),false,'source completion alone is insufficient');
 map.addSource('future-weather',{data:{}});assert.equal(map.isSourceLoaded('future-weather'),false);
 map.render();await ready;assert.equal(coast.isReady(),true,'unrelated forecast preloads do not block geography');
 assert.deepEqual(states,['loading','ready']);
 const moves=map.moves;coast.ensure();await coast.wait();assert.equal(map.moves,moves,'ordinary frames do not reorder the coastline');
 assert.equal(source.updates.length,1);
});

test('a fresh visible-view waiter finishes even if source loading had no intervening render',async t=>{
 const map=new MapFixture(),coast=coastlineController(map,{loadData:async()=>coastline});t.after(()=>coast.destroy());
 await flush();const source=map.getSource('coastline');source.complete();await flush();map.render();await coast.wait();
 source.loaded=false;const ready=coast.wait();source.loaded=true;map.render();await ready;
 assert.equal(coast.isReady(),true);
});

test('viewport tile loads preserve successful GeoJSON content and wait for the new view to render',async t=>{
 const map=new MapFixture(),coast=coastlineController(map,{loadData:async()=>coastline,renderTimeout:100});t.after(()=>coast.destroy());
 await flush();const source=map.getSource('coastline');source.complete();await flush();
 // MapLibre fires these source events both while adding the first visible
 // tiles and when a later fitBounds/pan requests another coastline tile.
 // Tile completion has no sourceDataType: 'content' event.
 for(const tile of [{id:'initial-view'},{id:'changed-view'}]){
  source.loaded=false;source.fire('dataloading',{tile,coord:tile.id});
  const ready=assert.doesNotReject(coast.wait({timeout:500}));
  map.render();assert.equal(coast.isReady(),false);assert.equal(coast.state.status,'loading');
  source.loaded=true;source.fire('data',{tile,coord:tile.id});await flush();
  assert.equal(coast.isReady(),false,'a completed tile still needs a render');
  map.render();await ready;assert.equal(coast.isReady(),true);
 }
});

test('a source error is never counted ready even when MapLibre reports it loaded; retry replaces it',async t=>{
 const map=new MapFixture(),errors=[],coast=coastlineController(map,{loadData:async()=>coastline,onError:error=>errors.push(error)});t.after(()=>coast.destroy());
 await flush();const failedSource=map.getSource('coastline'),error=Error('Worker could not parse geometry');
 const rejected=assert.rejects(coast.wait(),/parse geometry/);failedSource.fail(error);await rejected;
 await flush();map.render();assert.equal(map.isSourceLoaded('coastline'),true);assert.equal(coast.isReady(),false);
 assert.equal(coast.state.status,'error');assert.deepEqual(errors,[error]);
 coast.retry();await flush();const source=map.getSource('coastline');assert.notEqual(source,failedSource);
 failedSource.fire('error',{error:Error('Late old-source error')});assert.equal(coast.state.status,'loading');
 const ready=coast.wait();source.complete();await flush();map.render();await ready;assert.equal(coast.isReady(),true);
});

test('a source that never finishes rendering reports an actionable failure',async t=>{
 const map=new MapFixture(),coast=coastlineController(map,{loadData:async()=>coastline,renderTimeout:15});t.after(()=>coast.destroy());
 await assert.rejects(coast.wait({timeout:200}),/could not finish rendering/);assert.equal(coast.state.status,'error');
});

test('retry preserves coastline position beneath existing forecast labels and retains the native restyle anchor',async t=>{
 const map=new MapFixture(),coast=coastlineController(map,{loadData:async()=>coastline});t.after(()=>coast.destroy());
 coast.ensure('city-labels');await flush();
 map.addLayer({id:'forecast-pressure-labels',type:'symbol'},'city-labels');
 const order=map.layers.map(layer=>layer.id);
 map.getSource('coastline').fail(Error('Transient worker failure'));
 coast.retry();assert.deepEqual(map.layers.map(layer=>layer.id),order);
 map.beginStyle();map.finishStyle();await flush();
 assert.deepEqual(map.layers.map(layer=>layer.id),['land','roads','coast-line','city-labels']);
 const ready=coast.wait();map.getSource('coastline').complete();await flush();map.render();await ready;
});

test('a hidden tab does not exhaust the source watchdog or a waiting briefing timeout',async t=>{
 let active=false,settled=false;
 const map=new MapFixture(),coast=coastlineController(map,{loadData:async()=>coastline,renderTimeout:15,isActive:()=>active});t.after(()=>coast.destroy());
 const ready=coast.wait({timeout:15});ready.then(()=>{settled=true;},()=>{settled=true;});
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(settled,false);assert.equal(coast.state.status,'loading');
 active=true;map.getSource('coastline').complete();await flush();map.render();await ready;
 assert.equal(coast.isReady(),true);
});

test('an early style subscription defers source installation without a permanent error',async t=>{
 const map=new MapFixture(),addSource=map.addSource.bind(map);let parsed=false,calls=0;
 map.layers=[];map.addSource=(...args)=>{if(!parsed)throw Error('Style is not done loading.');addSource(...args);};
 const coast=coastlineController(map,{loadData:async()=>{calls++;return coastline;}});t.after(()=>coast.destroy());
 const ready=coast.wait();assert.equal(coast.state.status,'loading');assert.equal(map.getSource('coastline'),undefined);
 parsed=true;map.finishStyle();await flush();assert.equal(calls,1);
 map.getSource('coastline').complete();await flush();map.render();await ready;assert.equal(coast.isReady(),true);
});

test('restyling discards stale completions and installs the shared geometry in the new style',async t=>{
 const download=deferred();let calls=0;
 const loadData=createCoastlineDataLoader({fetcher:async()=>{calls++;return download.promise;}});
 const map=new MapFixture(),coast=coastlineController(map,{loadData});t.after(()=>coast.destroy());
 const oldSource=map.getSource('coastline'),ready=coast.wait();await flush();
 map.beginStyle();download.resolve(response());await flush();
 assert.equal(oldSource.updates.length,0);assert.equal(map.getSource('coastline'),undefined);
 map.finishStyle();await flush();const source=map.getSource('coastline');assert.notEqual(source,oldSource);
 assert.equal(source.updates[0],coastline);assert.equal(calls,1);
 oldSource.complete();map.render();assert.equal(coast.isReady(),false);
 source.complete();await flush();map.render();await ready;assert.equal(coast.isReady(),true);
});

test('removing one map cancels its waiters without cancelling another map’s shared request',async t=>{
 const download=deferred();let calls=0;
 const loadData=createCoastlineDataLoader({fetcher:async()=>{calls++;return download.promise;}});
 const firstMap=new MapFixture(),secondMap=new MapFixture();
 const first=coastlineController(firstMap,{loadData}),second=coastlineController(secondMap,{loadData});t.after(()=>{first.destroy();second.destroy();});
 const original=firstMap.getSource('coastline'),cancelled=assert.rejects(first.wait(),{name:'AbortError'}),ready=second.wait();
 await flush();firstMap.remove();await cancelled;download.resolve(response());await flush();
 assert.equal(calls,1);assert.equal(original.updates.length,0);assert.equal(firstMap.getSource('coastline'),undefined);
 secondMap.getSource('coastline').complete();await flush();secondMap.render();await ready;
 assert.equal(second.isReady(),true);assert.equal(first.isReady(),false);
});

test('aborting one wait leaves the map and another waiter free to complete',async t=>{
 const map=new MapFixture(),coast=coastlineController(map,{loadData:async()=>coastline});t.after(()=>coast.destroy());
 const signal=new AbortController(),cancelled=assert.rejects(coast.wait({signal:signal.signal}),{name:'AbortError'}),ready=coast.wait();
 signal.abort();await cancelled;await flush();map.getSource('coastline').complete();await flush();map.render();await ready;
 assert.equal(coast.isReady(),true);
});
