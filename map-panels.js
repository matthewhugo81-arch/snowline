import {hasFieldTime} from './map-sources.js?v=20261020-run-selector';
import {intervalForecastTimes} from './map-interval.js?v=20261019-panel-interval';

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
function orderedTimes(times){
 const valid=times.filter(time=>Number.isFinite(Date.parse(time)));
 return [...new Map(valid.map(time=>[Date.parse(time),time])).values()].sort((a,b)=>Date.parse(a)-Date.parse(b));
}
// A shorter or coarser panel must not truncate forecasts in the other panels.
// Apply viewing intervals per selected field before merging, so coarse/off-cycle
// feeds keep their supplied times. The renderer blanks missing panel slots.
export function panelForecastTimes(state,hours=0){
 return orderedTimes(panelSelections(state).flatMap(({model,field})=>{
  const meta=state.metas[model];
  const available=orderedTimes((meta?.valid_times??[]).filter(time=>hasFieldTime(meta,field,time)));
  return intervalForecastTimes(available,hours);
 }));
}
