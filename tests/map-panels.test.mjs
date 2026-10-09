import test from 'node:test';
import assert from 'node:assert/strict';
import {panelSelection,panelSelections,panelModelIds,panelForecastTimes} from '../map-panels.js';
import {combineSources} from '../map-sources.js';

const t=hour=>`2026-10-09T${String(hour).padStart(2,'0')}:00:00Z`;
const ukv={reference_time:t(6),variables:['temperature_2m','precipitation'],valid_times:[t(6),t(7),t(8)]};
const comparison=()=>({model:'ukv',modelB:'ukv',field:'temperature_2m',fieldB:'precipitation',compare:true,metas:{ukv}});

test('same-model comparison preserves two separate weather fields and loads one model run',()=>{
 const state=comparison();
 assert.deepEqual(panelSelections(state),[{key:'a',model:'ukv',field:'temperature_2m'},{key:'b',model:'ukv',field:'precipitation'}]);
 assert.deepEqual(panelModelIds(state),['ukv']);
 assert.deepEqual(panelForecastTimes(state),ukv.valid_times);
 state.fieldB='cloud_cover';
 assert.equal(panelSelection(state,'a').field,'temperature_2m');
 assert.equal(panelSelection(state,'b').field,'cloud_cover');
});

test('different models retain independent fields and a shared chronological timeline',()=>{
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
 assert.equal(panelForecastTimes(state).at(-1),t(18));
});

test('split-grid model timelines follow each selected field, excluding unrelated companion times',()=>{
 const surface={reference_time:t(6),variables:['temperature_2m','precipitation'],valid_times:[t(6),t(7),t(8)]};
 const upper={reference_time:t(6),variables:['temperature_850hPa','pressure_msl'],valid_times:[t(6),t(9),t(12)]};
 const state=comparison();state.metas.ukv=combineSources(surface,[upper]);
 assert.deepEqual(panelForecastTimes(state),surface.valid_times);
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
