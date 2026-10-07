export function averageSeries(series,length){
 const values=[],counts=[];
 for(let i=0;i<length;i++){const valid=series.map(s=>s.values[i]).filter(v=>typeof v==='number'&&Number.isFinite(v));counts.push(valid.length);values.push(valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null);}
 return {values,counts};
}
