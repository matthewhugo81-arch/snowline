import test from 'node:test';
import assert from 'node:assert/strict';
import {panelSelection,panelSelections,panelForecastTimes,createPanelOverlays} from '../map-panels.js';
import {UKV} from '../ukv-run-selection.js';
import {UKV_PREVIOUS} from '../map-ukv-runs.js';
const t=h=>new Date(Date.UTC(2026,9,19,h)).toISOString();
const meta=hours=>({reference_time:t(0),variables:['temperature_2m','cloud_cover'],valid_times:hours.map(t)});
const state=()=>({compare:true,comparisonCount:3,model:'gfs',modelB:'ifs',modelC:'icon',field:'temperature_2m',fieldB:'temperature_2m',fieldC:'cloud_cover',metas:{gfs:meta([0,6,12,18,24]),ifs:meta([0,12,24]),icon:meta([0,6,12])}});
test('three models share only actual times available in all selected layers',()=>{
 const s=state();assert.equal(panelSelections(s).length,3);
 assert.deepEqual(panelForecastTimes(s),[0,12].map(t));
 assert.deepEqual(panelSelection(s,'c'),{key:'c',model:'icon',field:'cloud_cover'});
 s.metas.icon.variables=['temperature_2m'];assert.deepEqual(panelForecastTimes(s),[]);
});
test('reducing panel count excludes the hidden model without losing its selection',()=>{
 const s=state();s.comparisonCount=2;assert.deepEqual(panelForecastTimes(s),[0,12,24].map(t));
 assert.equal(panelSelection(s,'c').model,'icon');
 s.comparisonCount=3;assert.deepEqual(panelForecastTimes(s),[0,12].map(t));
 s.compare=false;assert.equal(panelSelections(s).length,1);assert.equal(panelForecastTimes(s).length,5);
});
test('a third non-UKV model requires common times even beside latest and previous UKV',()=>{
 const s=state();s.model=UKV;s.modelB=UKV_PREVIOUS;s.metas[UKV]=meta([0,6]);s.metas[UKV_PREVIOUS]=meta([0,6,12,18]);
 assert.deepEqual(panelForecastTimes(s),[0,6].map(t));
});
test('third-panel overlay preferences are independent',()=>{
 const overlays=createPanelOverlays();overlays.c.grid=true;overlays.c.isobars=false;
 assert.equal(overlays.a.grid,false);assert.equal(overlays.b.isobars,true);
});
