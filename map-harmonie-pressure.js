export const HARMONIE='knmi_harmonie_arome_europe';
const grid={nx:676,ny:564,latMin:-13.6,lonMin:-13.5,dx:.05,dy:.05,southPoleLat:-35,southPoleLon:-8};
export function verifiedHarmoniePressure(meta,reference){
 const init=Date.parse(reference);
 return meta?.format_version===1&&meta.domain===HARMONIE&&typeof meta.completed==='boolean'&&
  Date.parse(meta.reference_time)===init&&meta.variables?.length===1&&meta.variables[0]==='pressure_msl'&&meta.units?.pressure_msl==='hPa'&&
  Object.entries(grid).every(([k,v])=>meta.grid?.[k]===v)&&Array.isArray(meta.valid_times)&&meta.valid_times.length>0&&meta.valid_times.length<=61&&
  (!meta.completed||meta.valid_times.length===61)&&new Set(meta.valid_times.map(Date.parse)).size===meta.valid_times.length&&meta.valid_times.every(t=>{const h=(Date.parse(t)-init)/3600000;return Number.isInteger(h)&&h>=0&&h<=60;});
}
export async function withHarmoniePressure(meta,load,baseURL=new URL('./ensemble-data/',import.meta.url).href){
 if(meta.domain!==HARMONIE)return meta;
 // The spatial export advertises pressure even when its entire grid is NaN.
 // Preserve gust-run completeness; pressure availability is checked separately.
 const sources=(meta.sources??[meta]).map(s=>({...s,variables:s.variables.filter(k=>k!=='pressure_msl')}));
 const warnings=[...(meta.sourceWarnings??[])];
 const stamp=new Date(meta.reference_time).toISOString(),path=stamp.slice(0,10).replaceAll('-','/')+'/'+stamp.slice(11,16).replace(':','')+'Z/';
 try{
  const pressure=await load(baseURL+HARMONIE+'/'+path+'meta.json');
  if(!verifiedHarmoniePressure(pressure,meta.reference_time))throw Error('Unverified HARMONIE pressure');
  sources.push({...pressure,baseURL,harmoniePressureSupplement:true});
  warnings.push('MSLP: KNMI HARMONIE native pressure, matched to this run and forecast time.');
 }catch{warnings.push('HARMONIE MSLP is unavailable for this run while the matching KNMI pressure feed is prepared.');}
 return {...meta,sources,variables:[...new Set(sources.flatMap(s=>s.variables))],sourceWarnings:warnings};
}
