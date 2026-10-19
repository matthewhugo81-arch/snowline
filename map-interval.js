// Regional short-range guidance always keeps its native detail, including in
// comparisons. The other panel still has to supply each shared valid time.
export function forecastInterval(models,selection='3'){
 const shortRange=models.some(model=>model?.regional&&!model.ensemble);
 return {shortRange,hours:shortRange||selection==='native'?0:selection==='12'?12:selection==='6'?6:3};
}

// Subset actual available times, never interpolate or change accumulation
// periods. UTC alignment keeps different model cycles on the same 00/03/06…
// hours. Coarser feeds retain their native steps, including off-cycle feeds.
export function intervalForecastTimes(times,hours){
 if(!hours||times.length<2)return times;
 const step=hours*3600000,values=times.map(time=>Date.parse(time));
 if(values.every((value,index)=>index===0||value-values[index-1]>=step))return times;
 const aligned=times.filter((_,index)=>values[index]%step===0);
 if(aligned.length)return aligned;
 // A short/off-cycle horizon with no synoptic hour must remain usable.
 return times.filter((_,index)=>(values[index]-values[0])%step===0);
}
