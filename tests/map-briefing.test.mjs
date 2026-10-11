import test from 'node:test';
import assert from 'node:assert/strict';
import {briefingPresets,briefingTimes,briefingPage,briefingCaption,briefingKey,BriefingImages,BRIEFING_PRESETS} from '../map-briefing-data.js';
import {briefingSettings} from '../map-briefing-renderer.js';
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
test('rain captions retain the source accumulation period rather than the display interval',()=>{
 assert.equal(briefingCaption(meta,BRIEFING_PRESETS[0],time(6)),'T+006 · 1 h precipitation ending at this time');
 assert.equal(briefingCaption({...meta,valid_times:[time(0),time(3),time(6)]},BRIEFING_PRESETS[0],time(6)),'T+006 · 3 h precipitation ending at this time');
 assert.equal(briefingCaption(meta,BRIEFING_PRESETS[1],time(12)),'T+012');
});
test('chart cache separates model, run, area, preset and time and releases old images',()=>{
 const a=briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(3));
 assert.notEqual(a,briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(3),[960,960]),'Different chart shapes cannot reuse the same image');
 for(const key of [briefingKey('icon',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(3)),briefingKey('gfs',{...meta,reference_time:time(6)},BRIEFING_PRESETS[0],[0,0,1,1],time(3)),briefingKey('gfs',meta,BRIEFING_PRESETS[1],[0,0,1,1],time(3)),briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,2,2],time(3)),briefingKey('gfs',meta,BRIEFING_PRESETS[0],[0,0,1,1],time(6))])assert.notEqual(a,key);
 const released=[],cache=new BriefingImages(2,url=>released.push(url));
 cache.set('a','blob:a');cache.set('b','blob:b');assert.equal(cache.get('a'),'blob:a');cache.set('c','blob:c');
 assert.equal(cache.get('b'),undefined);assert.deepEqual(released,['blob:b']);
 cache.clear();assert.deepEqual(released,['blob:b','blob:a','blob:c']);assert.equal(cache.items.size,0);
});
