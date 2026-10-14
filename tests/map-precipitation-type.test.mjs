import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {PRECIPITATION_TYPE as key,PRECIPITATION_TYPE_SOURCE as source,TYPE_INPUTS,precipitationCategory,precipitationTypeValues,precipitationTypeField,installPrecipitationType} from '../map-precipitation-type.js';
import {sourceVariable,availableFields,extendCatalogue,variableGroup} from '../map-catalogue.js';
import {fieldSource,hasFieldTime,fieldIntervalHours} from '../map-sources.js';
import {briefingPresets,briefingTimes,briefingCaption} from '../map-briefing-data.js';
import {previousRunPresets,previousRunTimes} from '../map-previous-run-data.js';
import {gridValueLabel} from '../map-grid.js';
import {chartScales} from '../map-image-export.js';
import {overlayGroups} from '../map-overlay-specs.js';
const time=h=>new Date(Date.UTC(2026,9,14,h)).toISOString();
const meta=(init=0)=>({domain:'ukmo_uk_deterministic_2km',reference_time:time(init),valid_times:Array.from({length:12},(_,i)=>time(init+i)),variables:[...TYPE_INPUTS,'pressure_msl']});
test('UKV type preserves dry, pure rain/snow, transition thresholds and missing values',()=>{
 for(const [total,rain,snow,code]of [[0,0,0,0],[.05,.05,0,0],[1,1,0,1],[1,0,1,3],[1,.9,.1,1],[1,.1,.9,3],[1,.899,.101,2],[1,.101,.899,2],[1,.5,.5,2],[1,0,0,4]])assert.equal(precipitationCategory(total,rain,snow),code);
 for(const values of [[NaN,0,0],[0,NaN,0],[0,0,NaN],[-1,0,0],[1,-.1,1]])assert.ok(Number.isNaN(precipitationCategory(...values)));
 const total=new Float32Array(new SharedArrayBuffer(12));total.set([1,1,NaN]);
 const result=precipitationTypeValues(total,new Float32Array([0,1,0]),new Float32Array([1,0,0]));
 assert.ok(result.values.buffer instanceof SharedArrayBuffer);assert.deepEqual([...result.values],[3,1,NaN]);
 assert.throws(()=>precipitationTypeValues(total,new Float32Array(1),total),/grids/);
});
test('only UKV with all three same-source fields gains Winter Analysis in every view',()=>{
 const runs=[meta(6),meta(3),meta(0)],settings={colorScales:{}},fields=[];
 extendCatalogue(fields,runs,OM,settings);assert.equal(sourceVariable(runs[0],key),source);assert.equal(variableGroup(key),'Winter Analysis');
 assert.ok(availableFields(fields,[runs[0]]).some(f=>f.key===key));
 assert.ok(briefingPresets(runs[0],fields).some(p=>p.field===key));assert.ok(previousRunPresets(runs,3,fields).some(p=>p.field===key));
 for(const domain of ['ecmwf_ifs025','dwd_icon_eu','ukmo_global_deterministic_10km'])assert.equal(sourceVariable({...runs[0],domain},key),null);
 for(const removed of TYPE_INPUTS)assert.equal(sourceVariable({...runs[0],variables:TYPE_INPUTS.filter(v=>v!==removed)},key),null);
 const split={...runs[0],sources:[{...runs[0],variables:['rain','precipitation']},{...runs[0],variables:['snowfall_water_equivalent']}]};assert.equal(fieldSource(split,key),null);
 assert.equal(settings.colorScales[source].colors[0][3],0);
});
test('type dates exclude initialization and previous runs must have equal native intervals',()=>{
 const m=meta(),p={id:key,field:key,required:[key]};
 assert.equal(hasFieldTime(m,key,time(0)),false);assert.equal(hasFieldTime(m,key,time(1)),true);
 assert.equal(fieldIntervalHours(m,key,time(3)),1);assert.match(briefingCaption(m,p,time(3)),/1 h precipitation-type estimate/);
 assert.equal(briefingTimes(m,p,m.domain,'native')[0],time(1));
 const runs=[meta(6),meta(3),meta(0)];assert.ok(previousRunTimes(runs,p,m.domain,'native').length);
 runs[1]={...runs[1],valid_times:[time(3),time(6),time(9),time(12)]};assert.deepEqual(previousRunTimes(runs,p,m.domain,'native'),[]);
});
test('category names are shared by grid labels and exports, without numerical contours',()=>{
 const f=precipitationTypeField();assert.equal(gridValueLabel(2,f),'Sleet / mix');assert.equal(gridValueLabel(NaN,f),null);assert.equal(gridValueLabel(1.5,f),null);
 assert.deepEqual(chartScales(f)[0].labels,f.categoryLabels);assert.equal(f.bands,true);assert.equal(f.categorical,true);
 const overlays=overlayGroups({field:f,url:'type',pressureURL:'pressure',contours:true,isobars:true});assert.deepEqual(overlays.map(o=>o.id),['mslp']);
});
test('reader and prefetch retain exact file/ranges, validate UKV and respect cancellation',async()=>{
 const calls=[],url='https://example.test/data_spatial/ukmo_uk_deterministic_2km/run/frame.om',ranges=[{start:3,end:5},{start:5,end:6}];
 const reader={readVariable:async(u,k,r,s)=>{calls.push([u,k,r,s]);return {values:new Float32Array(k==='rain'?[1,.4]:k==='precipitation'?[1,1]:[0,.6])};},prefetchVariable:async(...args)=>calls.push(args)};
 const fake={getProtocolInstance:()=>({omFileReader:reader})};installPrecipitationType(fake,{});const installed=reader.readVariable;installPrecipitationType(fake,{});assert.equal(installed,reader.readVariable);
 assert.deepEqual([...(await reader.readVariable(url,source,ranges)).values],[1,2]);assert.deepEqual(calls.map(c=>c[1]),TYPE_INPUTS);assert.ok(calls.every(c=>c[0]===url&&c[2]===ranges));
 calls.length=0;await reader.prefetchVariable(url,source,ranges);assert.deepEqual(calls.map(c=>c[1]),TYPE_INPUTS);
 await assert.rejects(reader.readVariable(url.replace('ukmo_uk_deterministic_2km','ecmwf_ifs025'),source,ranges),/only supported for UKV/);
 const abort=new AbortController();abort.abort();calls.length=0;await assert.rejects(reader.readVariable(url,source,ranges,abort.signal),{name:'AbortError'});assert.equal(calls.length,0);
});
