import {hasFieldTime} from './map-sources.js?v=20261009-white-rain';

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
export function panelForecastTimes(state){
 const times=panelSelections(state).flatMap(({model,field})=>{
  const meta=state.metas[model];
  return (meta?.valid_times??[]).filter(time=>hasFieldTime(meta,field,time));
 });
 return [...new Set(times)].sort((a,b)=>Date.parse(a)-Date.parse(b));
}
