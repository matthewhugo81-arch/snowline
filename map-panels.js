import {hasFieldTime} from './map-sources.js?v=20261019-mogreps-g';
import {UKV} from './ukv-run-selection.js?v=20261011-live-runs';
import {UKV_PREVIOUS} from './map-ukv-runs.js?v=20261019-mogreps-g';

export function createPanelOverlays(){
 return Object.fromEntries(['a','b','c'].map(key=>[key,{contours:false,isobars:true,grid:false}]));
}

export function panelSelection(state,key){
 const suffix=key==='a'?'':key.toUpperCase();
 return {key,model:state['model'+suffix],field:state['field'+suffix]};
}
export function panelSelections(state){
 return (state.compare?(state.comparisonCount===3?['a','b','c']:['a','b']):['a']).map(key=>panelSelection(state,key));
}
export function panelModelIds(state){
 return [...new Set(panelSelections(state).map(({model})=>model))];
}
export function fullUKVComparison(state){
 const ids=panelModelIds(state);
 return state.compare&&ids.length>1&&ids.every(id=>id===UKV||id===UKV_PREVIOUS);
}
// The completed UKV fallback must remain usable while the latest arrives.
// Other comparisons retain their matching-time behaviour. Missing UKV slots
// are explicitly blanked by the renderer, never filled from another cycle.
export function panelForecastTimes(state){
 const choices=panelSelections(state);
 if(!choices.length)return [];
 const available=choices.map(({model,field})=>{
  const meta=state.metas[model];
  return (meta?.valid_times??[]).filter(time=>hasFieldTime(meta,field,time));
 });
 const common=available.slice(1).map(times=>new Set(times.map(time=>Date.parse(time))));
 const times=(fullUKVComparison(state)?available.flat():available[0].filter(time=>common.every(set=>set.has(Date.parse(time))))).filter(time=>Number.isFinite(Date.parse(time)));
 return [...new Map(times.map(time=>[Date.parse(time),time])).values()].sort((a,b)=>Date.parse(a)-Date.parse(b));
}
