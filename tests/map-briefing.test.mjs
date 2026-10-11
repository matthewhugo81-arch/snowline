import test from 'node:test';
import assert from 'node:assert/strict';
import {briefingPresets,briefingTimes,briefingPage,briefingCaption,briefingKey,BriefingImages,BRIEFING_PRESETS} from '../map-briefing-data.js';
import {briefingSettings} from '../map-briefing-renderer.js';
import {briefingValueLabels} from '../map-briefing-values.js';
import * as OM from '../vendor/index.mjs';
const time=hour=>new Date(Date.UTC(2026,9,11,hour)).toISOString();
const meta={reference_time:time(0),domain:'ncep_gfs013',variables:['cloud_cover','precipitation','pressure_msl','temperature_850hPa','geopotential_height_500hPa'],valid_times:Array.from({length:49},(_,i)=>time(i))};
test('composite makes dry precipitation transparent and 100% cloud white without changing interactive scales',()=>{
 const settings={colorScales:{cloud_cover:{breakpoints:[0,50,100],colors:[[1,2,3,1],[4,5,6,1],[7,8,9,1]]},precipitation:{breakpoints:[0,.5,1],colors:[[255,255,255,1],[0,0,255,1],[0,255,0,1]]}}};
 const original=structuredClone(settings),composite=briefingSettings(settings);
 assert.deepEqual(composite.colorScales.cloud_cover.colors,[[65,65,65,1],[160,160,160,1],[255,255,255,1]]);
 assert.equal(composite.colorScales.precipitation.colors[0][3],0);assert.equal(composite.colorScales.precipitation.colors[1][3],1);
 assert.deepEqual(settings,original);
});
test('briefing presets require all component fields, never silently substitute another chart',()=>{
 assert.equal(briefingPresets(meta).length,3);
 assert.deepEqual(briefingPresets({...meta,variables:['cloud_cover','precipitation']}),[]);
 assert.deepEqual(briefingPresets({...meta,variables:['temperature_850hPa','pressure_msl']}).map(p=>p.id),['airmass']);
});
test('briefing sequences use common native times, honour cadence and retain regional hourly detail',()=>{
 const preset=BRIEFING_PRESETS[0];
 const global=briefingTimes(meta,preset,{regional:false});
 assert.equal(global.length,16);assert.deepEqual(briefingPage(global,0),[3,6,9,12,15,18].map(time));
 assert.deepEqual(briefingPage(global,15),[time(48)]);
 assert.equal(briefingTimes(meta,preset,{regional:true},'6').length,48);
 assert.equal(briefingTimes(meta,preset,{regional:false},'6').length,8);
 assert.equal(briefingTimes(meta,preset,{regional:false},'native').length,48);
 const split={...meta,sources:[meta,{...meta,variables:['temperature_850hPa'],valid_times:[time(3),time(9)]}]};
 split.sources[0]={...meta,variables:['pressure_msl']};
 assert.deepEqual(briefingTimes(split,BRIEFING_PRESETS[1],{}),[time(3),time(9)]);
});

test('jet briefing requires paired winds and MSLP from the selected run',()=>{
 const jet=BRIEFING_PRESETS.find(p=>p.id==='jet');
 for(const pair of [['wind_u_component_300hPa','wind_v_component_300hPa'],['wind_speed_300hPa','wind_direction_300hPa']]){
  const complete={...meta,variables:['pressure_msl',...pair]};
  assert.ok(briefingPresets(complete).includes(jet));
  assert.ok(!briefingPresets({...complete,variables:['pressure_msl',pair[0]]}).includes(jet));
  assert.ok(!briefingPresets({...complete,variables:pair}).includes(jet));
  assert.equal(briefingTimes(complete,jet,{regional:true}).length,49);
 }
});
test('rain captions retain the source accumulation period rather than the display interval',()=>{
 assert.equal(briefingCaption(meta,BRIEFING_PRESETS[0],time(6)),'T+006 · 1 h precipitation ending at this time');
 assert.equal(briefingCaption({...meta,valid_times:[time(0),time(3),time(6)]},BRIEFING_PRESETS[0],time(6)),'T+006 · 3 h precipitation ending at this time');
 assert.equal(briefingCaption(meta,BRIEFING_PRESETS[1],time(12)),'T+012');
});
test('chart cache separates model, run, area, preset and time and releases old images',()=>{
 const a=briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(3));
 for(const overlays of [{contours:true},{grid:true},{contours:true,grid:true}])assert.notEqual(a,briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(3),[960,660],overlays),'Overlay variants must never reuse plain images');
 assert.equal(a,briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(3),[960,660],{contours:false,grid:false}));
 assert.notEqual(a,briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(3),[960,960]),'Different chart shapes cannot reuse the same image');
 for(const key of [briefingKey('icon',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(3)),briefingKey('gfs',{...meta,reference_time:time(6)},BRIEFING_PRESETS[0],[0,0,1,1],time(3)),briefingKey('gfs',meta,BRIEFING_PRESETS[1],[0,0,1,1],time(3)),briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,2,2],time(3)),briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(6))])assert.notEqual(a,key);
 const released=[],cache=new BriefingImages(2,url=>released.push(url));
 cache.set('a','blob:a');cache.set('b','blob:b');assert.equal(cache.get('a'),'blob:a');cache.set('c','blob:c');
 assert.equal(cache.get('b'),undefined);assert.deepEqual(released,['blob:b']);
 cache.clear();assert.deepEqual(released,['blob:b','blob:a','blob:c']);assert.equal(cache.items.size,0);
});

test('briefing values use one clipped regular, projected or Gaussian grid and the correct GFS companion',async()=>{
 const primary={...meta,variables:['cloud_cover','pressure_msl']},companion={...meta,domain:'ncep_gfs025',variables:['temperature_850hPa']};
 for(const source of [companion,{...companion,domain:'ukmo_uk_deterministic_2km'},{...companion,domain:'ecmwf_ifs'}]){
  const config=OM.domainOptions.find(d=>d.value===source.domain).grid,calls=[];
  const backend={...OM,getProtocolInstance:()=>({omFileReader:{readVariable:async(url,variable,ranges,signal)=>{
   calls.push({url,variable,ranges,signal});const values=[];
   for(let y=ranges[0].start;y<ranges[0].end;y++)for(let x=ranges[1].start;x<ranges[1].end;x++)values.push(y*config.nx+x);
   return {values:new Float32Array(values)};
  }}})};
  const controller=new AbortController();
  const labels=await briefingValueLabels({OM:backend,settings:{domainOptions:OM.domainOptions},meta:{...primary,sources:[primary,source]},field:{key:'temperature_850hPa',unit:'°C'},time:time(3),bounds:[-10,49,2,61],width:960,height:960,unproject:([x,y])=>({lng:-10+x/80,lat:61-y/80}),project:([lng,lat])=>({x:(lng+10)*80,y:(61-lat)*80}),signal:controller.signal});
  assert.equal(calls.length,1);assert.match(calls[0].url,new RegExp('/'+source.domain+'/'));assert.match(calls[0].url,/2026-10-11T0300.om$/);
  assert.equal(calls[0].variable,'temperature_850hPa');assert.equal(calls[0].signal,controller.signal);
  assert.ok(labels.length>40&&labels.length<=100);
  const native=OM.GridFactory.create(config),indexValues=new Proxy({},{get:(_,key)=>Number(key)});
  for(const label of labels){const index=native.getInterpolatedValue(indexValues,61-label.y/80,-10+label.x/80,'nearest');assert.equal(label.value,index);assert.equal(label.label,String(index));}
 }
});
test('briefing values preserve zero and missing data, and cancellation prevents stale labels',async()=>{
 let reads=0,value=0;const controller=new AbortController();
 const backend={...OM,getProtocolInstance:()=>({omFileReader:{readVariable:async()=>{reads++;return {values:new Proxy({},{get:()=>value})};}}})};
 const args={OM:backend,settings:{domainOptions:OM.domainOptions},meta,field:{key:'cloud_cover',unit:'%'},time:time(3),bounds:[-10,49,2,61],width:960,height:960,unproject:([x,y])=>({lng:-10+x/80,lat:61-y/80}),project:([lng,lat])=>({x:(lng+10)*80,y:(61-lat)*80}),signal:controller.signal};
 const zeros=await briefingValueLabels(args);assert.ok(zeros.length>0);assert.ok(zeros.every(v=>v.label==='0'));
 value=NaN;assert.deepEqual(await briefingValueLabels(args),[]);
 controller.abort();await assert.rejects(briefingValueLabels(args),{name:'AbortError'});assert.equal(reads,2);
});
