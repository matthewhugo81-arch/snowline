import test from 'node:test';
import assert from 'node:assert/strict';
import {precipitationSymbols,symbolInputs,symbolRadius,drawPrecipitationSymbols,precipitationSymbolProtocol} from '../map-precipitation-symbols.js';
import {symbolRecipe,winterNote,THETA_SYMBOLS} from '../map-winter.js';

test('only verified native feeds supply a dynamic / convective partition',()=>{
 for(const domain of ['ncep_gfs013','ecmwf_aifs025_single']){
  assert.equal(symbolRecipe({domain,variables:['precipitation','showers']}),'partitioned');
  assert.notEqual(symbolRecipe({domain,variables:['precipitation']}),'partitioned');
 }
 const ukv={domain:'ukmo_uk_deterministic_2km',reference_time:'2026-10-14T00:00:00Z',variables:['precipitation','snowfall_water_equivalent','cape','showers']};
 assert.equal(symbolRecipe(ukv),'estimated');
 assert.match(winterNote(ukv,THETA_SYMBOLS),/experimental shower estimate/);
 assert.deepEqual(symbolInputs('partitioned'),['precipitation','showers']);
});

test('partitioned amounts conserve total water, preserve concurrent mechanisms and use the native interval',()=>{
 const values={precipitation:18,showers:6,snowfall_water_equivalent:9};
 const glyphs=precipitationSymbols(values,6,'partitioned');
 assert.deepEqual(glyphs.map(g=>[g.mechanism,g.amount,g.rate]),[['dynamic',12,2],['convective',6,1]]);
 assert.equal(glyphs.reduce((sum,g)=>sum+g.amount,0),18);
 assert.deepEqual(precipitationSymbols({...values,snowfall_water_equivalent:0},6,'partitioned'),glyphs);
 assert.equal(precipitationSymbols({precipitation:3,showers:3},3,'partitioned')[0].mechanism,'convective');
 assert.equal(precipitationSymbols({precipitation:3,showers:0},3,'partitioned')[0].mechanism,'dynamic');
 assert.deepEqual(precipitationSymbols({precipitation:0,showers:0},1,'partitioned'),[]);
 assert.deepEqual(precipitationSymbols(values,0,'partitioned'),[]);
});

test('missing and inconsistent convection never silently become dynamic rain',()=>{
 for(const showers of [NaN,undefined,-1,3]){
  const glyphs=precipitationSymbols({precipitation:2,showers},1,'partitioned');
  assert.equal(glyphs.length,1);assert.equal(glyphs[0].mechanism,'unseparated');assert.equal(glyphs[0].amount,2);
 }
 const rounded=precipitationSymbols({precipitation:2,showers:2.1},1,'partitioned');
 assert.equal(rounded.length,1);assert.equal(rounded[0].amount,2);assert.equal(rounded[0].mechanism,'convective');
 assert.deepEqual(precipitationSymbols({precipitation:NaN,showers:2},1,'partitioned'),[]);
});

test('sizes distinguish intensity and keep heavy convection smaller than dynamic rings',()=>{
 const rates=[.1,.5,1,2,4,8];
 for(const convective of [false,true]){
  const sizes=rates.map(r=>symbolRadius(r,convective));
  assert.ok(sizes.every((r,i)=>!i||r>sizes[i-1]));assert.equal(symbolRadius(.09,convective),0);
 }
 // The continuous display scale spans 5 to 15 px diameter, capped at 8 mm/h.
 assert.equal(symbolRadius(8),symbolRadius(.1)*3);
 assert.equal(symbolRadius(100),symbolRadius(8));
 for(const r of [2,5])assert.ok(symbolRadius(r,true)<symbolRadius(r));
 const render=(values,recipe='partitioned')=>{
  const paths=[];let current;
  const ctx={beginPath(){current=[];paths.push(current);},arc(){current.push('ring');},moveTo(){current.push('move');},lineTo(){current.push('line');},closePath(){current.push('closed');},setLineDash(){},stroke(){}};
  drawPrecipitationSymbols(ctx,precipitationSymbols(values,1,recipe),20,20);return paths;
 };
 assert.deepEqual(render({precipitation:2,showers:0})[0],['ring']);
 assert.deepEqual(render({precipitation:.2,showers:.2})[0],['move','line','line']);
 assert.deepEqual(render({precipitation:2,showers:2})[0],['move','line','line','closed']);
 assert.deepEqual(render({precipitation:2,showers:NaN})[0],['ring']);
});

test('dense tiles share identical boundary samples and read both amounts from the same native file',async()=>{
 const original=globalThis.OffscreenCanvas,contexts=[],reads=[];
 globalThis.OffscreenCanvas=class{
  constructor(){this.ctx={centres:[],beginPath(){},arc(x,y){this.centres.push([x,y]);},setLineDash(){},stroke(){}};contexts.push(this.ctx);}
  getContext(){return this.ctx;}async convertToBlob(){return new Blob(['test']);}
 };
 try{
  const grid={getBounds:()=>[-180,-85,180,85],getInterpolatedValue:values=>values[0]};
  const fake={GridFactory:{create:()=>grid},getRanges:()=>[{start:0,end:2}],getProtocolInstance:()=>({omFileReader:{readVariable:async(file,key,ranges)=>{reads.push({file,key,ranges});return {values:[key==='precipitation'?2:0]};}}})};
  const file='https://test.invalid/data_spatial/ncep_gfs013/2026/10/14/0000Z/2026-10-14T0100.om';
  const settings={domainOptions:[{value:'ncep_gfs013',grid:{}}]};
  for(const x of [7,8])await precipitationSymbolProtocol({type:'image',url:'om://'+file+'?precip_symbols=partitioned/4/'+x+'/5'},new AbortController(),fake,settings);
  const visible=contexts[0].centres.filter(([x,y])=>x>=0&&x<512&&y>=0&&y<512);
  assert.equal(visible.length,1024); // 4x the old 16-by-16 coverage.
  // Compare the same global strip on both sides of the seam. The larger halo
  // also paints extra off-tile roots which cannot affect the adjacent tile.
  const left=contexts[0].centres.filter(([x])=>x>=504&&x<=520).map(([x,y])=>[x-512,y]);
  const right=contexts[1].centres.filter(([x])=>x>=-8&&x<=8);
  assert.ok(left.length>0);assert.deepEqual(left,right);
  assert.deepEqual(reads.map(r=>r.key),['precipitation','showers','precipitation','showers']);assert.ok(reads.every(r=>r.file===file));
 }finally{globalThis.OffscreenCanvas=original;}
});
