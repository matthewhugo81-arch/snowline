import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMapSafely,waitForMapStyle,renderMapStartupFailure,runMapStartup} from '../map-startup.js';
import {injectMapTestHook,MAP_TEST_HOOK} from './map-test-hook.mjs';

function mapFixture(){
 const listeners=new Map();let timer,cleared=0;
 const map={isStyleLoaded:()=>false,on(type,fn){listeners.set(type,fn);},off(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
 return {map,listeners,options:{setTimer:fn=>(timer=fn,1),clearTimer:()=>cleared++},fire:type=>listeners.get(type)?.(),expire:()=>timer(),cleared:()=>cleared};
}
test('WebGL constructor errors reach a caught and identifiable startup failure',async()=>{
 const root={},gpu=new Error('WebGL context unavailable');let received;
 assert.equal(await runMapStartup(()=>createMapSafely(()=>{throw gpu;}),{root,onError:(r,e)=>{assert.equal(r,root);received=e;}}),false);
 assert.equal(received.code,'MAP_RENDERER_UNAVAILABLE');assert.equal(received.cause,gpu);
 const map={};assert.equal(createMapSafely(()=>map),map);
 assert.equal(await runMapStartup(async()=>{}, {root,onError:()=>assert.fail('Successful startup reported an error')}),true);
});
test('style readiness resolves and cleans listeners, while a missing style times out',async()=>{
 const f=mapFixture(),ready=waitForMapStyle(f.map,f.options);f.fire('style.load');await ready;
 assert.equal(f.listeners.size,0);assert.equal(f.cleared(),1);f.expire();
 const missing=mapFixture(),pending=waitForMapStyle(missing.map,missing.options);
 const rejected=assert.rejects(pending,{code:'MAP_STYLE_TIMEOUT'});missing.expire();await rejected;
 assert.equal(missing.listeners.size,0);assert.equal(missing.cleared(),1);
});
test('superseded style waits abort without a later false timeout; loaded styles return immediately',async()=>{
 const f=mapFixture(),controller=new AbortController();
 const pending=waitForMapStyle(f.map,{...f.options,signal:controller.signal});
 const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;f.expire();
 assert.equal(f.listeners.size,0);
 await waitForMapStyle({isStyleLoaded:()=>true},{setTimer:()=>assert.fail('Already loaded style scheduled a timeout')});
 const removed=mapFixture(),closing=waitForMapStyle(removed.map,removed.options);
 const closed=assert.rejects(closing,{code:'MAP_CLOSED'});removed.fire('remove');await closed;
});
test('startup failure replaces loading labels, exposes a recovery action and keeps charts navigation usable',()=>{
 const nodes=new Map();let reloads=0;
 const element=tag=>({tag,children:[],dataset:{},attrs:{},listeners:{},set id(v){this._id=v;nodes.set(v,this);},get id(){return this._id;},setAttribute(k,v){this.attrs[k]=v;},append(...children){this.children.push(...children);},prepend(child){this.children.unshift(child);},addEventListener(type,fn){this.listeners[type]=fn;}});
 const body=element('body'),main=element('main');
 for(const id of ['map-status','animation-status','preload-status','map-time-label','panel-label-a','play-map','map-time','map-model','nav-charts']){const node=element('control');node.id=id;node.textContent='Loading…';node.disabled=false;}
 const root={body,createElement:element,getElementById:id=>nodes.get(id),querySelector:()=>main,defaultView:{location:{reload:()=>reloads++}}};
 renderMapStartupFailure(root,{code:'MAP_RENDERER_UNAVAILABLE'});
 const panel=nodes.get('map-startup-error');assert.equal(panel.attrs.role,'alert');assert.equal(main.children[0],panel);
 assert.match(nodes.get('map-startup-message').textContent,/hardware acceleration and WebGL/);
 assert.equal(nodes.get('animation-status').textContent,'Map unavailable');assert.equal(nodes.get('play-map').disabled,true);assert.equal(nodes.get('nav-charts').disabled,false);
 const link=panel.children.find(c=>c.tag==='a');assert.equal(link.href,'./');
 panel.children.find(c=>c.tag==='button').listeners.click();assert.equal(reloads,1);
 renderMapStartupFailure(root,{code:'MAP_STYLE_TIMEOUT'});assert.equal(main.children.length,1);assert.match(nodes.get('map-status').textContent,/background did not finish/);
});
test('browser fixtures inject inside the caught startup scope without production globals',()=>{
 const source=readFileSync(new URL('../maps.js',import.meta.url),'utf8');
 const injected=injectMapTestHook(source,'window.testScope=panels;');
 assert.equal(source.split(MAP_TEST_HOOK).length,2);
 assert.ok(injected.indexOf('window.testScope=panels;')>injected.indexOf('const panels={}'));
 assert.ok(injected.indexOf('window.testScope=panels;')<injected.indexOf('await Promise.all(Object.values(panels).map(panel=>panel.ready))'));
 assert.doesNotMatch(source,/window\.(fixturePanel|testScope)/);
 assert.equal(injectMapTestHook('const panels={};','window.testScope=panels;'),'const panels={};\nwindow.testScope=panels;');
 assert.throws(()=>injectMapTestHook('await runMapStartup(async()=>{});','window.testScope=panels;'),/missing its browser test hook/);
});
