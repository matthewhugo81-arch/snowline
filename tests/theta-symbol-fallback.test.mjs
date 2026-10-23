import test from 'node:test';
import assert from 'node:assert/strict';
import {precipitationSymbols,precipitationSymbolProtocol,symbolURL} from '../map-precipitation-symbols.js';
import {drawPrecipitationSymbols} from '../map-precipitation-glyphs.js';
test('theta fallback boundaries, missing data and native phase precedence',()=>{
 for(const [theta_w,kind] of [[-1,'snow'],[0,'snow'],[.01,'mixed'],[1.99,'mixed'],[2,'rain'],[NaN,'other']]){
  assert.equal(precipitationSymbols({precipitation:1,theta_w},1,'unresolved')[0].kind,kind);
  assert.equal(precipitationSymbols({precipitation:1,precipitation_type:NaN,theta_w},1,'native')[0].kind,kind);
 }
 for(const [precipitation_type,kind] of [[1,'rain'],[3,'freezing'],[5,'snow'],[7,'mixed'],[8,'ice']])assert.equal(precipitationSymbols({precipitation:1,precipitation_type,theta_w:3},1,'native')[0].kind,kind);
 assert.equal(precipitationSymbols({precipitation:1,snowfall_water_equivalent:1,theta_w:4},1,'estimated')[0].kind,'snow');
 assert.equal(precipitationSymbols({rain:1,showers:1,snowfall_water_equivalent:1,theta_w:-2},1,'icon')[1].kind,'showers');
 assert.deepEqual(precipitationSymbols({precipitation:.09,theta_w:-2},1,'unresolved'),[]);
 const parts=precipitationSymbols({precipitation:3,showers:1,theta_w:-2},1,'partitioned');
 assert.deepEqual(parts.map(g=>g.kind),['snow','snow']);assert.equal(parts.reduce((n,g)=>n+g.amount,0),3);
 const snowSizes=[.1,.5,2,8].map(rate=>precipitationSymbols({precipitation:rate,showers:rate,theta_w:-1},1,'partitioned')[0].radius);assert.ok(snowSizes.every((r,i)=>!i||r>snowSizes[i-1]));
 let arcs=0,lines=0;const ctx={setLineDash(){},beginPath(){},arc(){arcs++;},moveTo(){},lineTo(){lines++;},stroke(){}};
 drawPrecipitationSymbols(ctx,parts,20,20);assert.equal(arcs,0);assert.equal(lines,8);
});
test('fallback samples separate GFS upper-air grid and rejects mismatched valid time',async()=>{
 const old=globalThis.OffscreenCanvas,reads=[];let lines=0;
 globalThis.OffscreenCanvas=class {getContext(){return {setLineDash(){},beginPath(){},arc(){},moveTo(){},lineTo(){lines++;},stroke(){}};}async convertToBlob(){return new Blob(['tile']);}};
 try{
 const grid={getBounds:()=>[-180,-85,180,85],getInterpolatedValue:a=>a[0]};
 const OM={GridFactory:{create:()=>grid},getRanges:()=>[],getProtocolInstance:()=>({omFileReader:{readVariable:async(file,key)=>{reads.push([file,key]);return {values:[key==='precipitation'?1:key==='showers'?0:-1]};}}})};
 const settings={domainOptions:['ncep_gfs013','ncep_gfs025'].map(value=>({value,grid:{}}))};
 const base='https://test.invalid/data_spatial/ncep_gfs013/2026/10/23/0000Z/2026-10-23T0300.om';
 const upper=base.replace('gfs013','gfs025');
 const make=(u)=>symbolURL('om://'+base+'?variable=precipitation',{domain:'ncep_gfs013',variables:['precipitation','showers']},'om://'+u+'?variable=wet_bulb_potential_temperature_850hPa_derived')+'/4/7/5';
 await precipitationSymbolProtocol({url:make(upper),type:'image'},new AbortController(),OM,settings);
 assert.equal(reads[2][0],upper);assert.equal(reads[2][1],'wet_bulb_potential_temperature_850hPa_derived');assert.ok(lines>0);
 await assert.rejects(()=>precipitationSymbolProtocol({url:make(upper.replace('T0300','T0600')),type:'image'},new AbortController(),OM,settings),/match precipitation/);
 }finally{globalThis.OffscreenCanvas=old;}
});
