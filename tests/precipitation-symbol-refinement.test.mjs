import test from 'node:test';
import assert from 'node:assert/strict';
import {precipitationSymbols,symbolInputs,symbolURL,precipitationSymbolProtocol} from '../map-precipitation-symbols.js';
import {symbolRecipe,thetaSymbolsField} from '../map-winter.js';
import {precipitationFileInfo} from '../map-precipitation-type.js';
import {SYMBOL_STYLE} from '../map-precipitation-glyphs.js';

test('one, three and six-hour amounts produce the same symbol for the same rate',()=>{
 const reference=precipitationSymbols({precipitation:2,snowfall_water_equivalent:0},1,'estimated');
 for(const hours of [3,6]){
  const actual=precipitationSymbols({precipitation:2*hours,snowfall_water_equivalent:0},hours,'estimated');
  assert.equal(actual[0].rate,reference[0].rate);assert.equal(actual[0].radius,reference[0].radius);
 }
 for(const hours of [0,-1,NaN,Infinity])assert.deepEqual(precipitationSymbols({precipitation:2},hours,'unresolved'),[]);
});
test('native file cadence, not playback interval, supplies mm/h conversion',()=>{
 const reference=Date.parse('2026-10-14T00:00:00Z');
 for(const [domain,lead,hours] of [['ukmo_uk_deterministic_2km',3,1],['ecmwf_ifs025',3,3],['ecmwf_ifs025',150,6],['ecmwf_aifs025_single',6,6],['dwd_icon',81,3]]){
  const valid=new Date(reference+lead*3600000).toISOString().slice(0,16).replace(':','');
  const url=`https://openmeteo.s3.amazonaws.com/data_spatial/${domain}/2026/10/14/0000Z/${valid}.om`;
  assert.equal(precipitationFileInfo(url).hours,hours);
 }
});
test('all current recipes preserve mechanism and phase semantics',()=>{
 for(const domain of ['ukmo_uk_deterministic_2km','ecmwf_ifs','cmc_gem_gdps_15km','knmi_harmonie_arome_europe','meteofrance_arpege_europe','meteofrance_arome_france0025']){
  const source={domain,variables:['precipitation','snowfall_water_equivalent']};
  assert.equal(symbolRecipe(source),'estimated');
  assert.ok(precipitationSymbols({precipitation:2,snowfall_water_equivalent:1},1,symbolRecipe(source)).every(g=>g.mechanism==='unseparated'&&g.kind==='mixed'));
 }
 for(const domain of ['ncep_gfs013','ecmwf_aifs025_single'])assert.equal(symbolRecipe({domain,variables:['precipitation','showers']}),'partitioned');
 for(const domain of ['dwd_icon','dwd_icon_eu'])assert.equal(symbolRecipe({domain,variables:['rain','showers','snowfall_water_equivalent']}),'icon');
 assert.equal(symbolRecipe({domain:'ecmwf_ifs025',variables:['precipitation','precipitation_type']}),'native');
 assert.equal(precipitationSymbols({precipitation:2,precipitation_type:3},1,'native')[0].kind,'freezing');
 assert.equal(precipitationSymbols({precipitation:2},1,'unresolved')[0].kind,'other');
});
test('dynamic and convective components survive together without double-counting snow',()=>{
 const values={precipitation:18,showers:6,snowfall_water_equivalent:12};
 const glyphs=precipitationSymbols(values,6,'partitioned');
 assert.equal(glyphs.length,2);assert.equal(glyphs.reduce((a,g)=>a+g.amount,0),18);
 assert.deepEqual(glyphs.map(g=>[g.mechanism,g.rate]),[['dynamic',2],['convective',1]]);
 assert.deepEqual(symbolInputs('partitioned'),['precipitation','showers']);
 for(const showers of [NaN,-1,20])assert.deepEqual(precipitationSymbols({...values,showers},6,'partitioned').map(g=>g.mechanism),['unseparated']);
 assert.deepEqual(precipitationSymbols({rain:1,showers:2,snowfall_water_equivalent:3},1,'icon').map(g=>g.mechanism),['dynamic','convective','snow']);
});
test('legend and prepared-tile URL use the new presentation version',()=>{
 assert.ok(symbolURL('om://source?variable=precipitation',{domain:'none',variables:['precipitation']}).includes('symbols_style='+SYMBOL_STYLE));
 assert.equal(thetaSymbolsField().legendNote,'');
 assert.match(thetaSymbolsField().note,/Symbol density is not a measure of intensity/);
});
test('actual tile protocol reads native fields and generates finite glyph geometry',async()=>{
 const original=globalThis.OffscreenCanvas;
 const methods=[];
 globalThis.OffscreenCanvas=class{
  constructor(w,h){assert.equal(w,512);assert.equal(h,512);}
  getContext(){return {setLineDash(){},beginPath(){},arc(...p){assert.ok(p.every(Number.isFinite));methods.push('circle');},moveTo(...p){assert.ok(p.every(Number.isFinite));},lineTo(...p){assert.ok(p.every(Number.isFinite));methods.push('line');},closePath(){methods.push('triangle');},stroke(){}};}
  async convertToBlob(){return new Blob(['test-tile']);}
 };
 try{
  const read=[],values={precipitation:6,showers:2};
  const grid={getBounds:()=>[-180,-85,180,85],getInterpolatedValue:(a,lat,lon,method)=>{assert.equal(method,'nearest');return a[0];}};
  const OM={currentBounds:[-22,50,1,75],GridFactory:{create:()=>grid},getRanges:()=>[],
   getProtocolInstance:()=>({omFileReader:{readVariable:async(file,key)=>{read.push(key);return {values:new Float32Array([values[key]])};}}})};
  const settings={domainOptions:[{value:'ecmwf_aifs025_single',grid:{}}]};
  const url='om://https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_aifs025_single/2026/10/14/0000Z/2026-10-14T0600.om?variable=precipitation&precip_symbols=partitioned/4/7/5';
  const result=await precipitationSymbolProtocol({url,type:'image'},new AbortController(),OM,settings);
  assert.ok(result.data instanceof ArrayBuffer);assert.deepEqual(read,['precipitation','showers']);
  assert.ok(methods.includes('circle'));assert.ok(methods.includes('line'));
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>precipitationSymbolProtocol({url,type:'image'},controller,OM,settings),{name:'AbortError'});
 }finally{if(original===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=original;}
});
