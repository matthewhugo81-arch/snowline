import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createValueReader} from '../map-values.js';
import {gridValueLabel,gridLabelDensity} from '../map-grid.js';
const source=readFileSync(new URL('../maps.js',import.meta.url),'utf8');
const draw=source.slice(source.indexOf('async function drawGridValues('),source.indexOf('\nfunction concreteURL('));
test('zoomed grid labels restore every visible tile, including lower rows',async()=>{
 for(const zoom of [5,8,10]){
  const points=[{id:1,lat:57,lon:-4},{id:2,lat:54,lon:-4},{id:3,lat:51,lon:-4}];
  const tile=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**zoom);
  const loaded=new Set(),calls=[];
  const OM={GridFactory:{create:()=>({})},getValueFromLatLong:async lat=>({value:loaded.has(tile(lat))?60:NaN}),omProtocol:async({url})=>{calls.push(url);loaded.add(Number(url.split('/').at(-1)));return{data:new ArrayBuffer(0)};}};
  let data;const note={};
  const map={getCanvas:()=>({clientWidth:620,clientHeight:716}),getZoom:()=>zoom,getSource:()=>({setData:value=>{data=value;}}),getLayer:()=>true,moveLayer:()=>{}};
  const panel={key:'a',map,loaded:true,displayedTime:'time',displayedField:'gust',displayedModel:'ukv',url:'om://forecast?interpolation=linear'};
  const context=vm.createContext({briefingActive:false,playing:false,state:{overlays:{a:{grid:true}},times:['time'],index:0,metas:{ukv:{}}},panelSelection:()=>({model:'ukv',field:'gust'}),fieldSource:()=>({domain:'ukv'}),settings:{domainOptions:[{value:'ukv',grid:{}}]},$:()=>note,OM,fields:[{key:'gust',unit:'mph'}],visibleGridPoints:()=>points,readMapValue:createValueReader(OM,{}),gridValueLabel,gridLabelDensity,displayUnit:()=> 'mph',WEATHER_COMPOSITE:'weather',console});
  vm.runInContext(draw+';globalThis.draw=drawGridValues;',context);
  await context.draw(panel);
  assert.equal(data.features.length,3,'Top, middle and bottom rows survive zoom '+zoom);
  assert.equal(calls.length,new Set(points.map(p=>tile(p.lat))).size);
 }
});

