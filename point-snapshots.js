// Public town coordinates, also used by the scheduled shared-cache publisher.
// Match the requested point to 4 decimals; never substitute a neighbouring town.
export const POINT_LOCATIONS=[
 {name:'Starting location',latitude:53.9239,longitude:-2.1949},
 {name:'Barnoldswick',latitude:53.91711,longitude:-2.18705},
 {name:'Thornton-in-Craven',latitude:53.93136,longitude:-2.14611},
 {name:'Colne',latitude:53.85713,longitude:-2.16851},
 {name:'Rawtenstall',latitude:53.70076,longitude:-2.28442},
 {name:'Love Clough',latitude:53.741,longitude:-2.287}
];
export const POINT_TTL=3600000,POINT_MAX_AGE=86400000;
export const pointKey=location=>`${Number(location.latitude).toFixed(4)},${Number(location.longitude).toFixed(4)}`;
export function usableForecast(json,now=Date.now()){
 const at=json?._retrievedAt;
 if(!Number.isFinite(at)||at>now+60000||now-at>=POINT_MAX_AGE||!Array.isArray(json.hourly?.time))return false;
 const hour=Math.floor(now/3600000)*3600000;
 return json.hourly.time.some((t,i)=>Date.parse(/Z$/.test(t)?t:t+'Z')>=hour&&Object.entries(json.hourly).some(([key,values])=>key!=='time'&&typeof values?.[i]==='number'&&Number.isFinite(values[i])));
}
export function snapshotFor(json,location){
 if(json?.version!==1||!json.location||pointKey(json.location)!==pointKey(location)||!json.models||typeof json.models!=='object')return null;
 return json;
}
