export function averageSeries(series,length){
 const values=[],counts=[];
 for(let i=0;i<length;i++){const valid=series.map(s=>s.values[i]).filter(v=>typeof v==='number'&&Number.isFinite(v));counts.push(valid.length);values.push(valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null);}
 return {values,counts};
}

// Circular means keep 350° and 10° close to north; opposing winds have no mean.
export function directionMean(values){
 const valid=values.filter(v=>typeof v==='number'&&Number.isFinite(v));
 if(!valid.length)return null;
 const x=valid.reduce((sum,v)=>sum+Math.cos(v*Math.PI/180),0),y=valid.reduce((sum,v)=>sum+Math.sin(v*Math.PI/180),0);
 return Math.hypot(x,y)/valid.length<1e-8?null:((Math.atan2(y,x)*180/Math.PI+360)%360);
}
export function directionLabel(value){return ['N','NE','E','SE','S','SW','W','NW'][Math.round(((value%360)+360)%360/45)%8];}
export function circularAverageSeries(series,length){
 const values=[],counts=[];
 for(let i=0;i<length;i++){const valid=series.map(s=>s.values[i]).filter(v=>typeof v==='number'&&Number.isFinite(v));counts.push(valid.length);values.push(directionMean(valid));}
 return {values,counts};
}
