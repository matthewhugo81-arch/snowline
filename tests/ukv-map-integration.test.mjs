import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP_MODELS} from '../map-models.js';
import {MODELS,forecastURL} from '../data.js';
import {UKV,UKV_NOWCAST,ukvRunPath} from '../ukv-run-selection.js';
import {loadSpatialModel,fieldDataURL,SPATIAL_BASE} from '../map-sources.js';
import {panelForecastTimes,panelModelIds} from '../map-panels.js';
import {ukvCoverageText} from '../ukv-run-info.js';
import {cachedJSON} from '../cache.js';
const reference=(hour)=>`2026-10-10T${String(hour).padStart(2,'0')}:00:00Z`;
const make=(hour,hours)=>({reference_time:reference(hour),completed:true,variables:['precipitation','temperature_2m'],valid_times:Array.from({length:hours+1},(_,i)=>new Date(Date.parse(reference(hour))+i*3600000).toISOString())});
test('two map UKV choices do not duplicate location-chart model averages or invent point API IDs',()=>{
 assert.equal(MAP_MODELS.length,MODELS.length+1);
 assert.equal(MAP_MODELS.find(m=>m.id===UKV).name,'UKV — latest main run');
 assert.equal(MAP_MODELS.find(m=>m.id===UKV_NOWCAST).name,'UKV — latest hourly nowcast');
 assert.equal(MODELS.filter(m=>m.id.startsWith(UKV)).length,1);
 assert.ok(!forecastURL({latitude:54,longitude:-2},MODELS.find(m=>m.id===UKV)).includes('_nowcast'));
});
test('both UKV choices use real domain/cycle URLs and compare matching valid times',async()=>{
 const main=make(0,54),latest=make(2,12),base=SPATIAL_BASE+UKV+'/';
 const load=async url=>{if(url===base+'latest.json')return latest;if(url===base+ukvRunPath(main.reference_time)+'meta.json')return main;throw Object.assign(Error('Absent'),{status:404});};
 const a=await loadSpatialModel(UKV,load),b=await loadSpatialModel(UKV_NOWCAST,load);
 assert.equal(a.reference_time,main.reference_time);assert.equal(b.reference_time,latest.reference_time);
 assert.equal(a.domain,UKV);assert.equal(b.domain,UKV);
 const time='2026-10-10T14:00Z';
 assert.equal(fieldDataURL(a,'precipitation',time),base+'2026/10/10/0000Z/2026-10-10T1400.om');
 assert.equal(fieldDataURL(b,'precipitation',time),base+'2026/10/10/0200Z/2026-10-10T1400.om');
 assert.equal(fieldDataURL(b,'precipitation','2026-10-10T15:00Z'),null);
 const state={model:UKV,modelB:UKV_NOWCAST,field:'precipitation',fieldB:'temperature_2m',compare:true,metas:{[UKV]:a,[UKV_NOWCAST]:b}};
 assert.deepEqual(panelModelIds(state),[UKV,UKV_NOWCAST]);assert.equal(panelForecastTimes(state).length,13);
 state.compare=false;assert.equal(panelForecastTimes(state).length,55);
 assert.match(ukvCoverageText(a,'main'),/main cycle/);assert.match(ukvCoverageText(b,'nowcast'),/nowcast cycle/);
});
test('XML 404 errors keep their HTTP status; metadata fetches revalidate caches',async t=>{
 let options;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{options=opts;return new Response('<Error>NoSuchKey</Error>',{status:404});});
 await assert.rejects(cachedJSON('https://test.invalid/missing-ukv-meta',{kind:'metadata'}),error=>error.status===404);
 assert.equal(options.cache,'no-cache');
});
test('XML server errors cannot be mistaken for a missing published cycle',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('Service unavailable',{status:503}));
 await assert.rejects(cachedJSON('https://test.invalid/failed-ukv-meta',{kind:'metadata'}),error=>error.status===503);
});
