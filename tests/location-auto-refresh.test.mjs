import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function loadLocation('),source.indexOf('\nfunction finishStatus('));
test('automatic location checks replace data without clearing charts, zoom or selected hour',async()=>{
 const original={id:'old',fetchedAt:1},state={models:new Map([['old',original]]),errors:new Map(),index:3,zoom:{start:2,end:5},times:['a','b','c','d'],generation:0};
 const elements=new Map();let rendered=0;
 const ctx=vm.createContext({state,AbortController,Date,Number,Math,URLSearchParams,finite:Number.isFinite,$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},datasetDialog:{close:()=>assert.fail('Should not close')},chartZoom:{cancel:()=>assert.fail('Should not cancel zoom')},setStatus:()=>{},render:()=>rendered++,finishStatus:()=>{},loadPointForecasts:async(_,options)=>{assert.equal(state.models.get('old'),original);options.onModel({id:'new',fetchedAt:2});options.onError({id:'old'},new Error('Offline'));}});
 vm.runInContext(fn+';globalThis.load=loadLocation;',ctx);
 await ctx.load({name:'Place',latitude:54,longitude:-2,elevation:100},false,{background:true});
 assert.equal(state.index,3);assert.deepEqual(state.zoom,{start:2,end:5});assert.deepEqual(state.times,['a','b','c','d']);assert.equal(state.models.get('old'),original);assert.equal(state.models.get('new').fetchedAt,2);assert.equal(state.loading,false);assert.equal(rendered,1);
});
