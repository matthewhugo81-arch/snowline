// Optional, exact-run diagnostics. Missing products never borrow another model/run.
export const SHOWER_VERSION=1;
const domains=new Set(['ukmo_global_deterministic_10km','ukmo_uk_deterministic_2km']);
const cache=new Map();
export function showerDiagnosticURL(file){
 const match=new URL(file).pathname.match(/\/data_spatial\/([^/]+)\/(\d{4}\/\d{2}\/\d{2}\/\d{4}Z)\/(\d{4}-\d{2}-\d{2}T\d{4})\.om$/);
 return match&&domains.has(match[1])?new URL('./shower-data/'+match[1]+'/'+match[2]+'/'+match[3]+'.json',import.meta.url).href:null;
}
export function validateShowerDiagnostic(data,file){
 const match=new URL(file).pathname.match(/\/data_spatial\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})(\d{2})Z\/(\d{4}-\d{2}-\d{2}T\d{2})(\d{2})\.om$/);
 if(!match)return null;
 const [,domain,y,m,d,h,min,t,tm]=match;
 const grid=data?.grid;
 if(grid&&Array.isArray(data.flags_rle)&&data.flags_rle.length<=1000000){
  let length=0;const parts=[];
  for(const row of data.flags_rle){
   if(!Array.isArray(row)||row.length!==2||![0,1,2].includes(row[0])||!Number.isInteger(row[1])||row[1]<1||(length+=row[1])>1000000)return null;
   parts.push(String(row[0]).repeat(row[1]));
  }
  data={...data,flags:parts.join('')};delete data.flags_rle;
 }
 if(data?.version!==SHOWER_VERSION||data.domain!==domain||Date.parse(data.reference_time)!==Date.parse(`${y}-${m}-${d}T${h}:${min}:00Z`)||Date.parse(data.valid_time)!==Date.parse(t+':'+tm+':00Z')||
 !['native-rate','estimated-texture'].includes(data.method)||data.method!==(domain==='ukmo_global_deterministic_10km'?'native-rate':'estimated-texture')||
 !grid||![grid.lonMin,grid.latMin,grid.dx,grid.dy].every(Number.isFinite)||grid.dx<=0||grid.dy<=0||!Number.isInteger(grid.nx)||!Number.isInteger(grid.ny)||grid.nx<1||grid.ny<1||grid.nx*grid.ny>1000000||typeof data.flags!=='string'||data.flags.length!==grid.nx*grid.ny||/[^012]/.test(data.flags))return null;
 return data;
}
export async function loadShowerDiagnostic(file){
 const url=showerDiagnosticURL(file);if(!url)return null;
 if(!cache.has(url)){
  if(cache.size>=80)cache.delete(cache.keys().next().value);
  const promise=fetch(url,{signal:AbortSignal.timeout(8000)}).then(r=>r.ok?r.json():null).then(d=>validateShowerDiagnostic(d,file)).catch(()=>null);
  cache.set(url,promise);
  // Failed/missing companions can arrive on a later publication.
  promise.then(data=>{if(!data){const timer=setTimeout(()=>{if(cache.get(url)===promise)cache.delete(url);},60000);timer.unref?.();}});
 }
 return cache.get(url);
}
export function showerAt(data,lat,lon){
 if(!data)return false;
 const g=data.grid,x=Math.round((lon-g.lonMin)/g.dx),y=Math.round((lat-g.latMin)/g.dy);
 return x>=0&&x<g.nx&&y>=0&&y<g.ny&&data.flags[y*g.nx+x]==='2';
}
