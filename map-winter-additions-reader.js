import {RollingAccumulations,SharedGridReads} from './map-accumulation-reader.js?v=20261014-interaction-audit';
import {winterHours,winterSlots,reduceSkin,wetBulbValues} from './map-winter-additions.js?v=20261024-winter-panel-controls';
const installed=new WeakSet();
export function installWinterAdditions(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader;if(installed.has(reader))return;installed.add(reader);
 const read=reader.readVariable.bind(reader),prefetch=reader.prefetchVariable?.bind(reader),shapes=new Map();
 async function native(url,key,ranges,signal){
  signal?.throwIfAborted();
  if(reader.withReader&&reader.readSimpleVariable)return reader.withReader(url,async file=>{
   const child=await file.getChildByName(key);if(!child)throw Error('Missing winter diagnostic input: '+key);
   try{
    const signature=JSON.stringify(child.getDimensions()),id=url.slice(0,url.lastIndexOf('/'))+'|'+key;
    if(shapes.has(id)&&shapes.get(id)!==signature)throw Error('Native grid changed within this forecast run.');
    if(shapes.size>32)shapes.delete(shapes.keys().next().value);shapes.set(id,signature);
    const data=await reader.readSimpleVariable(file,key,ranges,signal);signal?.throwIfAborted();return data.values;
   }finally{child.dispose();}
  });
  return (await read(url,key,ranges,signal)).values;
 }
 for(const [suffix,humidity]of [['rh','relative_humidity_2m'],['dew','dew_point_2m']]){
  reader.allDerivationRules=[...(reader.allDerivationRules??[]),{
   pattern:new RegExp('^winter_wet_bulb_'+suffix+'$'),provides:{directions:false,barbs:false},scaleFactor:100,
   getSourceVars:()=>['temperature_2m',humidity],
   process:(t,h)=>({values:wetBulbValues(t,h,suffix==='dew'),directions:undefined})
  }];
 }
 const snow=new RollingAccumulations((url,ranges,signal)=>native(url,'snowfall_water_equivalent',ranges,signal),{useSAB:reader.config?.useSAB??false});
 const skin=new SharedGridReads((url,ranges,signal)=>native(url,'surface_temperature',ranges,signal),{concurrency:4});
 const periods=new SharedGridReads(async(request,ranges,signal)=>{
  const [url,key]=JSON.parse(request),match=new URL(url).pathname.match(/\/data_spatial\/([^/]+)\/(\d{4}\/\d{2}\/\d{2})\/(\d{2})(\d{2})Z\/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})\.om$/);
  if(!match)throw Error('Unsupported skin-temperature source.');
  const [,domain,date,h,m,day,hh,mm]=match,reference=date.replaceAll('/','-')+'T'+h+':'+m+':00Z',end=day+'T'+hh+':'+mm+':00Z';
  const slots=winterSlots(domain,reference,end,key);if(!slots)throw Error('Incomplete skin-temperature window.');
  const base=url.slice(0,url.lastIndexOf('/')+1);
  const arrays=await Promise.all(slots.map(t=>skin.get(base+t.slice(0,16).replace(':','')+'.om',ranges,signal)));
  signal?.throwIfAborted();return reduceSkin(arrays,key);
 },{concurrency:1,maxBytes:16*1024*1024});
 async function derived(url,key,ranges,signal){
  if(key.startsWith('snowfall_total_'))return snow.read(url,'precipitation_total_'+winterHours(key)+'h',ranges,signal);
  const data=await periods.get(JSON.stringify([url,key]),ranges,signal);
  const values=new Float32Array(new (reader.config?.useSAB?SharedArrayBuffer:ArrayBuffer)(data.byteLength));values.set(data);
  return {values,directions:undefined,scaleFactor:100};
 }
 reader.readVariable=async(url,key,ranges=null,signal)=>{
  if(winterHours(key))return derived(url,key,ranges,signal);
  const data=await read(url,key,ranges,signal);
  if(key==='categorical_freezing_rain')return {...data,values:Float32Array.from(data.values,v=>v===0||v===1?v:NaN)};
  return data;
 };
 reader.prefetchVariable=(url,key,ranges=null,signal)=>winterHours(key)?derived(url,key,ranges,signal).then(()=>{}):prefetch?.(url,key,ranges,signal);
}
