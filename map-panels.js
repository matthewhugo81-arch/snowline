import {hasFieldTime} from './map-sources.js?v=20261010-valid-frames';

export function createPanelOverlays(){
 return Object.fromEntries(['a','b'].map(key=>[key,{contours:true,isobars:true,grid:false}]));
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
// Only offer forecast hours available in every visible panel.
export function panelForecastTimes(state){
 const choices=panelSelections(state);
 if(!choices.length)return [];
 const available=choices.map(({model,field})=>{
  const meta=state.metas[model];
  return (meta?.valid_times??[]).filter(time=>hasFieldTime(meta,field,time));
 });
 const common=available.slice(1).map(times=>new Set(times.map(time=>Date.parse(time))));
 const times=available[0].filter(time=>Number.isFinite(Date.parse(time))&&common.every(set=>set.has(Date.parse(time))));
 return [...new Map(times.map(time=>[Date.parse(time),time])).values()].sort((a,b)=>Date.parse(a)-Date.parse(b));
}
