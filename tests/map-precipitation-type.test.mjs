import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {PRECIPITATION_TYPE as key,PRECIPITATION_TYPE_SOURCE as source,NATIVE_PRECIPITATION_TYPE as native,NATIVE_TYPE_SOURCE,typeMethod,estimatedCategory,nativeCategory,intensityCode,precipitationTypeValues,precipitationTypeField,precipitationFileInfo,installPrecipitationType,TYPE_PALETTES} from '../map-precipitation-type.js';
import {sourceVariable,availableFields,extendCatalogue} from '../map-catalogue.js';
import {fieldSource,hasFieldTime,fieldIntervalHours,combineSources} from '../map-sources.js';
import {briefingPresets,briefingCaption} from '../map-briefing-data.js';
import {previousRunPresets} from '../map-previous-run-data.js';
import {gridValueLabel} from '../map-grid.js';
import {chartScales} from '../map-image-export.js';
import {overlayGroups} from '../map-overlay-specs.js';
import {THETA_SYMBOLS,thetaSymbolsField,symbolRecipe} from '../map-winter.js';
import {precipitationSymbols,symbolRadius,symbolURL,isSymbolURL} from '../map-precipitation-symbols.js';
const time=h=>new Date(Date.UTC(2026,9,14,h)).toISOString();
const vars=['precipitation','snowfall_water_equivalent','pressure_msl','temperature_850hPa','relative_humidity_850hPa'];
const meta=(domain='ukmo_uk_deterministic_2km',init=0,variables=vars)=>({domain,reference_time:time(init),valid_times:Array.from({length:12},(_,i)=>time(init+i)),variables:[...variables]});
test('phase and intensity preserve thresholds, unknowns, missing inputs and native hazardous types',()=>{
 for(const [total,snow,phase]of [[0,0,0],[1,0,1],[1,.1,1],[1,.101,2],[1,.899,2],[1,.9,3],[1,1,3],[1,2,4]])assert.equal(estimatedCategory(total,snow),phase);
 for(const pair of [[NaN,0],[0,NaN],[-1,0],[1,-1]])assert.ok(Number.isNaN(estimatedCategory(...pair)));
 assert.deepEqual([0,1,3,5,6,7,8,12,99].map(nativeCategory),[4,1,5,3,3,2,6,5,4]);
 assert.ok(Number.isNaN(nativeCategory(NaN)));
 assert.deepEqual([.09,.1,.499,.5,1.99,2,4.99,5].map(n=>intensityCode(3,n,1)),[0,9,9,10,10,11,11,12]);
 assert.equal(intensityCode(3,3,3),intensityCode(3,1,1));assert.equal(intensityCode(1,.2,3),0);
 const amounts=new Float32Array(new SharedArrayBuffer(12));amounts.set([1,3,NaN]);
 const result=precipitationTypeValues(amounts,new Float32Array([1,0,0]),1);
 assert.ok(result.values.buffer instanceof SharedArrayBuffer);assert.deepEqual([...result.values],[10,3,NaN]);
 assert.throws(()=>precipitationTypeValues(amounts,new Float32Array(1),1),/grids/);
});
test('all supported single-source feeds gain the same type chart in main, briefing and history',()=>{
 for(const domain of ['ecmwf_ifs','ecmwf_aifs025_single','dwd_icon','dwd_icon_eu','cmc_gem_gdps_15km','ncep_gfs013','ukmo_uk_deterministic_2km','knmi_harmonie_arome_europe','meteofrance_arpege_europe','meteofrance_arome_france0025']){
  const runs=[meta(domain,6),meta(domain,3),meta(domain)],fields=[],settings={colorScales:{}};extendCatalogue(fields,runs,OM,settings);
  assert.equal(sourceVariable(runs[0],key),source,domain);assert.ok(availableFields(fields,[runs[0]]).some(f=>f.key===key));assert.ok(briefingPresets(runs[0],fields).some(p=>p.field===key));assert.ok(previousRunPresets(runs,3,fields).some(p=>p.field===key));assert.equal(settings.colorScales[source].colors[0][3],0);
 }
 const ifs=meta('ecmwf_ifs025',0,[...vars,'precipitation_type']);assert.equal(sourceVariable(ifs,native),NATIVE_TYPE_SOURCE);assert.equal(sourceVariable(ifs,key),null);
 for(const domain of ['ukmo_global_deterministic_10km','ncep_hgefs025_ensemble_mean','unknown'])assert.equal(typeMethod(meta(domain)),null);
 assert.equal(sourceVariable(meta('ecmwf_ifs',0,['precipitation']),key),null);
 const split=combineSources(meta('ncep_gfs013',0,['precipitation']),[meta('ncep_gfs025',0,['snowfall_water_equivalent'])]);assert.equal(fieldSource(split,key),null);
});
test('intensity cadence comes from native model intervals, never missing metadata or playback',()=>{
 const prefix='https://openmeteo.s3.amazonaws.com/data_spatial/';
 assert.equal(precipitationFileInfo(prefix+'ecmwf_ifs025/2026/10/14/0000Z/2026-10-14T0300.om').hours,3);
 assert.equal(precipitationFileInfo(prefix+'ecmwf_ifs025/2026/10/14/0000Z/2026-10-20T0600.om').hours,6);
 assert.throws(()=>precipitationFileInfo(prefix+'ecmwf_ifs025/2026/10/14/0000Z/2026-10-14T0100.om'),/interval/);
 assert.equal(hasFieldTime(meta(),key,time(0)),false);
 assert.equal(fieldIntervalHours({...meta(),valid_times:[time(0),time(3)]},key,time(3)),1);
 assert.match(briefingCaption(meta(),{field:key,id:key},time(3)),/1 h precipitation-type/);
});
test('readouts and exported legends retain type, rate and colours; category contours disabled',()=>{
 const f=precipitationTypeField();assert.match(gridValueLabel(10,f),/Snow.*0.5–<2 mm\/h water/);assert.equal(gridValueLabel(1.5,f),null);
 assert.deepEqual(chartScales(f).map(s=>s.colors),TYPE_PALETTES.slice(0,4));assert.equal(chartScales(precipitationTypeField(native)).length,6);
 assert.deepEqual(overlayGroups({field:f,url:'type',pressureURL:'pressure',contours:true,isobars:true}).map(o=>o.id),['mslp']);
});
test('reader uses matching native arrays, full same file/ranges and cancels without substituted fields',async()=>{
 const calls=[],url='https://example.test/data_spatial/ukmo_uk_deterministic_2km/2026/10/14/0000Z/2026-10-14T0100.om',ranges=[{start:3,end:5},{start:5,end:6}];
 const reader={readVariable:async(u,k,r,s)=>{calls.push([u,k,r,s]);return {values:new Float32Array(k==='precipitation'?[1,1]:[0,.6])};},prefetchVariable:async(...args)=>calls.push(args)};
 const fake={getProtocolInstance:()=>({omFileReader:reader})};installPrecipitationType(fake,{});const installed=reader.readVariable;installPrecipitationType(fake,{});assert.equal(installed,reader.readVariable);
 assert.deepEqual([...(await reader.readVariable(url,source,ranges)).values],[2,6]);assert.deepEqual(calls.map(c=>c[1]),['precipitation','snowfall_water_equivalent']);assert.ok(calls.every(c=>c[0]===url&&c[2]===ranges));
 calls.length=0;await reader.prefetchVariable(url,source,ranges);assert.deepEqual(calls.map(c=>c[1]),['precipitation','snowfall_water_equivalent']);
 await assert.rejects(reader.readVariable(url.replace('ukmo_uk_deterministic_2km','unknown'),source,ranges));
 const abort=new AbortController();abort.abort();calls.length=0;await assert.rejects(reader.readVariable(url,source,ranges,abort.signal),{name:'AbortError'});assert.equal(calls.length,0);
});
test('theta combination gates all fields/times, permits matching GFS grids and forbids cycle mixing',()=>{
 assert.ok(sourceVariable(meta(),THETA_SYMBOLS));assert.equal(hasFieldTime(meta(),THETA_SYMBOLS,time(0)),false);
 assert.equal(sourceVariable(meta('ecmwf_ifs'),THETA_SYMBOLS),null);
 const surface=meta('ncep_gfs013',0,['precipitation','snowfall_water_equivalent']),upper=meta('ncep_gfs025',0,['temperature_850hPa','relative_humidity_850hPa','pressure_msl']);
 const merged=combineSources(surface,[upper]);assert.ok(sourceVariable(merged,THETA_SYMBOLS));assert.equal(fieldSource(merged,THETA_SYMBOLS,time(3)).domain,'ncep_gfs025');
 assert.equal(sourceVariable({...merged,sources:[surface,{...upper,reference_time:time(6)}]},THETA_SYMBOLS),null);
 assert.equal(hasFieldTime({...merged,sources:[surface,{...upper,valid_times:[time(6)]}]},THETA_SYMBOLS,time(3)),false);
 const fields=[thetaSymbolsField()];assert.ok(briefingPresets(meta(),fields).some(p=>p.field===THETA_SYMBOLS));
});
test('symbols retain independent native ICON rain, convection and snow amounts; no invented fronts or snow showers',()=>{
 assert.equal(symbolRecipe(meta('dwd_icon',0,[...vars,'rain','showers'])),'icon');
 const gs=precipitationSymbols({rain:1,showers:4,snowfall_water_equivalent:2},1,'icon');assert.deepEqual(gs.map(g=>[g.kind,g.rate]),[['rain',1],['showers',4],['snow',2]]);
 assert.deepEqual(precipitationSymbols({precipitation:3,precipitation_type:3},3,'native').map(g=>[g.kind,g.rate]),[['freezing',1]]);
 assert.equal(precipitationSymbols({precipitation:1,snowfall_water_equivalent:NaN},1,'estimated').length,0);
 assert.equal(precipitationSymbols({precipitation:1},1,'unresolved')[0].kind,'other');
 assert.ok(symbolRadius(5)>symbolRadius(.1));assert.equal(symbolRadius(.09),0);
 assert.ok(isSymbolURL(symbolURL('om://file?variable=precipitation',meta())));
});

test('symbol raster transport reads native same-file cells and produces a cached PNG, respecting abort',async()=>{
 const {precipitationSymbolProtocol}=await import('../map-precipitation-symbols.js');
 const calls=[],paths=[],context={beginPath(){},arc(){paths.push('circle');},moveTo(){},lineTo(){},closePath(){},stroke(){}};
 const original=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=class{getContext(){return context;}async convertToBlob(){return new Blob(['png-fixture']);}};
 try{
  const grid={getBounds:()=>[-180,-85,180,85],getInterpolatedValue:(values)=>values[0]};
  const fake={currentBounds:[-30,40,10,70],GridFactory:{create:()=>grid},getRanges:()=>[{start:1,end:2},{start:2,end:3}],getProtocolInstance:()=>({omFileReader:{readVariable:async(url,key,ranges,signal)=>{calls.push({url,key,ranges});signal.throwIfAborted();return {values:new Float32Array([key==='precipitation'?2:0])};}}})};
  const file='https://test.invalid/data_spatial/ukmo_uk_deterministic_2km/2026/10/14/0000Z/2026-10-14T0100.om',params={type:'image',url:'om://'+file+'?variable=precipitation&precip_symbols=estimated/4/7/5'},settings={domainOptions:[{value:'ukmo_uk_deterministic_2km',grid:{}}]};
  const result=await precipitationSymbolProtocol(params,new AbortController(),fake,settings);assert.ok(result.data instanceof ArrayBuffer);assert.ok(paths.length>0);assert.deepEqual(calls.map(c=>c.key),['precipitation','snowfall_water_equivalent']);assert.ok(calls.every(c=>c.url===file&&c.ranges[0].start===1));
  const controller=new AbortController();controller.abort();await assert.rejects(precipitationSymbolProtocol(params,controller,fake,settings),{name:'AbortError'});
 }finally{globalThis.OffscreenCanvas=original;}
});
