import {readFile,writeFile} from 'node:fs/promises';
import * as OM from '../vendor/index.mjs';
const fetchNetwork=globalThis.fetch;
globalThis.fetch=(url,options)=>String(url).startsWith('file:')?readFile(new URL(url)).then(data=>new Response(data,{headers:{'Content-Type':'application/wasm'}})):fetchNetwork(url,{...options,signal:options?.signal??AbortSignal.timeout(20000)});
const reader=OM.getProtocolInstance({...OM.defaultOmProtocolSettings,fileReaderConfig:{...OM.defaultOmProtocolSettings.fileReaderConfig,useSAB:false}}).omFileReader;
const report=[];
for(const domain of ['ecmwf_ifs','ecmwf_ifs025']){
 const base='https://openmeteo.s3.amazonaws.com/data_spatial/'+domain+'/';
 const meta=await (await fetch(base+'latest.json')).json();
 const ref=new Date(meta.reference_time).toISOString();
 const path=ref.slice(0,10).replaceAll('-','/')+'/'+ref.slice(11,16).replace(':','')+'Z/';
 const times=meta.valid_times.filter((time,index)=>index<8||[90,93,144,150,360].includes((Date.parse(time)-Date.parse(meta.reference_time))/3600000));
 for(const time of times){
  const url=base+path+time.slice(0,16).replace(':','')+'.om';
  try{
   const entry={domain,run:meta.reference_time,time,fields:{}};
   await reader.withReader(url,async root=>{
    for(const key of ['temperature_2m','temperature_2m_max','temperature_2m_min']){
     const child=await root.getChildByName(key);
     if(!child){entry.fields[key]=null;continue;}
     try{
      const attributes=[];
      for(let i=0;i<child.numberOfChildren();i++){const attribute=await child.getChild(i);if(attribute){attributes.push(attribute.getName());attribute.dispose();}}
      entry.fields[key]={dimensions:child.getDimensions(),scaleFactor:child.scaleFactor(),attributes};
     }finally{child.dispose();}
    }
   });
   console.log(JSON.stringify(entry));report.push(entry);
  }catch(error){const entry={domain,time,error:error.message,cause:error.cause?.message};console.log(JSON.stringify(entry));report.push(entry);}
 }
}
await writeFile('review-output/extrema-files.json',JSON.stringify(report,null,2));
