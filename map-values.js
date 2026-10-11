// Prepared imagery can outlive the renderer's bounded decoded-grid cache.
// Restore the grid on demand for a point/grid readout without discarding images
// or retaining hundreds of decoded global grids in browser memory.
export function createValueReader(OM,settings){
 const pending=new Map();
 return async function read(latitude,longitude,url,zoom){
  try{const result=await OM.getValueFromLatLong(latitude,longitude,url,zoom);if(Number.isFinite(result?.value))return result;}catch{}
  const z=Math.max(0,Math.floor(zoom)),n=2**z,lat=Math.max(-85.0511,Math.min(85.0511,latitude))*Math.PI/180;
  const x=((Math.floor((longitude+180)/360*n)%n)+n)%n,y=Math.max(0,Math.min(n-1,Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*n)));
  const tile=url+'/'+z+'/'+x+'/'+y;
  if(!pending.has(tile))pending.set(tile,Promise.resolve().then(()=>OM.omProtocol({url:tile,type:'image'},new AbortController(),settings)).finally(()=>pending.delete(tile)));
  await pending.get(tile);
  return OM.getValueFromLatLong(latitude,longitude,url,zoom);
 };
}
