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

// Each displayed rate represents the preceding hour, including the first point.
// Start afresh for the displayed window and stop at an unknown hourly mean;
// restarting after a gap would present an incomplete amount as a cumulative total.
export function cumulativePrecipitation(values){
 let sum=0,complete=true;
 const cumulative=Array.from(values,value=>{
  if(typeof value!=='number'||!Number.isFinite(value))complete=false;
  if(!complete)return null;
  sum+=value;return sum;
 });
 return {values:cumulative,total:values.length&&complete?sum:null};
}

// Keep the footer and curve on the same inclusive hourly accumulation.
export function precipitationTotal(values){return cumulativePrecipitation(values).total;}
