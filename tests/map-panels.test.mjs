import test from 'node:test';
import assert from 'node:assert/strict';
import {panelSelection,panelSelections,panelModelIds,panelForecastTimes} from '../map-panels.js';
import {combineSources,hasFieldTime,fieldDataURL} from '../map-sources.js';
import {WEATHER_COMPOSITE,COMPOSITE_FIELDS} from '../map-weather-composite.js';
import {UKV} from '../ukv-run-selection.js';
import {UKV_PREVIOUS} from '../map-ukv-runs.js';

const t=hour=>`2026-10-09T${String(hour).padStart(2,'0')}:00:00Z`;
const ukv={reference_time:t(6),variables:['temperature_2m','precipitation'],valid_times:[t(6),t(7),t(8)]};
const comparison=()=>({model:'ukv',modelB:'ukv',field:'temperature_2m',fieldB:'precipitation',compare:true,metas:{ukv}});

test('latest/previous UKV comparisons preserve the entire completed horizon in either panel',()=>{
 const previous={...ukv,valid_times:Array.from({length:55},(_,h)=>new Date(Date.parse(t(6))+h*3600000).toISOString())};
 const latest={...ukv,reference_time:t(9),completed:false,valid_times:[t(9),t(10),t(11)]};
 const state={model:UKV_PREVIOUS,modelB:UKV,field:'temperature_2m',fieldB:'temperature_2m',compare:true,metas:{[UKV_PREVIOUS]:previous,[UKV]:latest}};
 assert.equal(panelForecastTimes(state).length,55);assert.equal(panelForecastTimes(state).at(-1),'2026-10-11T12:00:00.000Z');
 [state.model,state.modelB]=[state.modelB,state.model];assert.equal(panelForecastTimes(state).length,55);
 state.field=state.fieldB='precipitation';assert.equal(panelForecastTimes(state).length,54);assert.equal(Date.parse(panelForecastTimes(state)[0]),Date.parse(t(7)));
 // When the latest grows beyond the fallback, its additional hours also survive.
 latest.valid_times.push('2026-10-11T13:00:00Z');assert.equal(panelForecastTimes(state).length,55);
 state.compare=false;assert.equal(panelForecastTimes(state).length,3);
});

test('same-model comparison preserves two separate weather fields and loads one model run',()=>{
 const state=comparison();
 assert.deepEqual(panelSelections(state),[{key:'a',model:'ukv',field:'temperature_2m'},{key:'b',model:'ukv',field:'precipitation'}]);
 assert.deepEqual(panelModelIds(state),['ukv']);
 assert.deepEqual(panelForecastTimes(state),[t(6),t(7),t(8)]);
 assert.equal(hasFieldTime(ukv,'precipitation',t(6)),false,'The temperature analysis does not fabricate a precipitation interval');
 state.fieldB='cloud_cover';
 assert.equal(panelSelection(state,'a').field,'temperature_2m');
 assert.equal(panelSelection(state,'b').field,'cloud_cover');
});

test('different models retain independent fields and every supplied valid time',()=>{
 const state=comparison();state.modelB='icon';
 state.metas.icon={variables:['precipitation'],valid_times:[t(12),t(9),t(6)]};
 assert.deepEqual(panelModelIds(state),['ukv','icon']);
 assert.deepEqual(panelForecastTimes(state),[t(6),t(7),t(8),t(9),t(12)]);
 assert.equal(panelSelection(state,'a').model,'ukv');
});

test('hiding panel two excludes its times without losing its selections',()=>{
 const state=comparison();state.modelB='icon';state.metas.icon={variables:['precipitation'],valid_times:[t(18)]};
 state.compare=false;
 assert.deepEqual(panelForecastTimes(state),ukv.valid_times);
 assert.deepEqual(panelModelIds(state),['ukv']);
 state.compare=true;
 assert.equal(panelSelection(state,'b').field,'precipitation');
 assert.deepEqual(panelForecastTimes(state),[t(6),t(7),t(8),t(18)]);
});

test('split-grid model timelines follow each selected field, excluding unrelated companion times',()=>{
 const surface={reference_time:t(6),variables:['temperature_2m','precipitation'],valid_times:[t(6),t(7),t(8)]};
 const upper={reference_time:t(6),variables:['temperature_850hPa','pressure_msl'],valid_times:[t(6),t(9),t(12)]};
 const state=comparison();state.metas.ukv=combineSources(surface,[upper]);
 assert.deepEqual(panelForecastTimes(state),[t(6),t(7),t(8)]);
 state.fieldB='temperature_850hPa';
 assert.deepEqual(panelForecastTimes(state),[t(6),t(7),t(8),t(9),t(12)]);
 state.field='unknown';state.fieldB='unknown';
 assert.deepEqual(panelForecastTimes(state),[]);
});

test('a field supplied by multiple grids keeps the valid times from either grid',()=>{
 const state=comparison();state.compare=false;
 state.metas.ukv=combineSources(ukv,[{...ukv,valid_times:[t(9),t(12)]}]);
 assert.deepEqual(panelForecastTimes(state),[t(6),t(7),t(8),t(9),t(12)]);
});

test('a selected short-range field never inherits unrelated long-range times',()=>{
 const state=comparison();state.compare=false;
 state.metas.ukv=combineSources(
  {reference_time:t(6),variables:['precipitation'],valid_times:[t(6),t(7)]},
  [{reference_time:t(6),variables:['temperature_850hPa'],valid_times:[t(6),t(7),t(8),t(12)]}]
 );
 state.field='precipitation';
 assert.deepEqual(panelForecastTimes(state),[t(7)]);
});

test('IFS comparison keeps the Sunday horizon when the UKMO panel ends on Thursday',()=>{
 const reference='2026-10-19T18:00:00Z';
 const time=lead=>new Date(Date.parse(reference)+lead*3600000).toISOString();
 const meta=(domain,horizon)=>({domain,reference_time:reference,completed:true,variables:[...COMPOSITE_FIELDS],valid_times:Array.from({length:horizon/3+1},(_,i)=>time(i*3))});
 const state={compare:true,comparisonCount:3,model:'ecmwf_ifs025',modelB:'ecmwf_ifs',modelC:'ukmo_global_deterministic_10km',field:WEATHER_COMPOSITE,fieldB:WEATHER_COMPOSITE,fieldC:WEATHER_COMPOSITE,metas:{
  ecmwf_ifs025:meta('ecmwf_ifs025',144),ecmwf_ifs:meta('ecmwf_ifs',144),ukmo_global_deterministic_10km:meta('ukmo_global_deterministic_10km',60)
 }};
 const times=panelForecastTimes(state);
 assert.equal(times.length,48);
 assert.equal(times.at(-1),'2026-10-25T18:00:00.000Z');
 assert.equal(state.metas[state.modelC].valid_times.at(-1),'2026-10-22T06:00:00.000Z');
 assert.equal(hasFieldTime(state.metas[state.modelC],WEATHER_COMPOSITE,time(63)),false);
 assert.equal(fieldDataURL(state.metas[state.modelC],WEATHER_COMPOSITE,time(144)),null,'The shorter run must not borrow a later chart');
 for(const id of [state.model,state.modelB]){
  assert.ok(fieldDataURL(state.metas[id],WEATHER_COMPOSITE,time(144)));
  assert.equal(state.metas[id].reference_time,reference);
 }
 state.compare=false;assert.deepEqual(panelForecastTimes(state),times,'Leaving panel mode does not reveal additional IFS times');
 state.compare=true;assert.deepEqual(panelForecastTimes(state),times);
});

test('disjoint panel timelines remain selectable without inventing intermediate frames',()=>{
 const state=comparison();state.fieldB='temperature_2m';state.modelB='other';
 state.metas.other={...ukv,valid_times:[t(12),t(18)]};
 assert.deepEqual(panelForecastTimes(state),[t(6),t(7),t(8),t(12),t(18)]);
 assert.equal(hasFieldTime(ukv,'temperature_2m',t(12)),false);
 assert.equal(hasFieldTime(state.metas.other,'temperature_2m',t(7)),false);
 state.metas.other.variables=[];
 assert.deepEqual(panelForecastTimes(state),ukv.valid_times,'An unavailable companion field cannot hide the remaining panel');
});

test('combined timeline sorts and deduplicates equivalent timestamps',()=>{
 const state=comparison();state.fieldB='temperature_2m';state.modelB='other';
 state.metas.ukv={...ukv,valid_times:[t(9),t(6),'invalid',t(9)]};
 state.metas.other={...ukv,valid_times:[t(12),new Date(t(6)).toISOString(),t(7)]};
 assert.deepEqual(panelForecastTimes(state).map(Date.parse),[6,7,9,12].map(h=>Date.parse(t(h))));
});
