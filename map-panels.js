import {hasFieldTime} from './map-sources.js?v=20261014-synoptic-symbols';
import {UKV} from './ukv-run-selection.js?v=20261011-live-runs';
import {UKV_PREVIOUS} from './map-ukv-runs.js?v=20261014-synoptic-symbols';

export function createPanelOverlays(){
 return Object.fromEntries(['a','b'].map(key=>[key,{contours:false,isobars:true,grid:false}]));
}

export function panelSelection(state,key){
 return key==='b'?{key,model:state.modelB,field:state.fieldB}:{key:'a',model:state.model,field:state.field};
}
export function panelSelections(state){
 return (state.compare?['a','b']:['a']).map(key=>panelSelection(state,key));
}
export function panelModelIds(state){
 return [...new Set(panelSelections(state).map(({model})=>model))];
}
export function fullUKVComparison(state){
 return state.compare&&state.model!==state.modelB&&[state.model,state.modelB].every(id=>id===UKV||id===UKV_PREVIOUS);
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
