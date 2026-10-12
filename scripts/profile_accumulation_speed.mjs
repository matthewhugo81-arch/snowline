import {readFile,writeFile} from 'node:fs/promises';
import * as OM from '../vendor/index.mjs';
import {installAccumulations,RollingAccumulations} from '../map-accumulation-reader.js';
const mode=process.argv[2]??'baseline',network=globalThis.fetch,stats={requests:0,bytes:0,methods:{},peak:0,active:0};
globalThis.fetch=async(url,options={})=>{
 if(String(url).startsWith('file:'))return new Response(await readFile(new URL(url)),{headers:{'Content-Type':'application/wasm'}});
 stats.requests++;const method=options.method??'GET';stats.methods[method]=(stats.methods[method]??0)+1;stats.peak=Math.max(stats.peak,++stats.active);
 try{const r=await network(url,{...options,signal:options.signal??AbortSignal.timeout(20000)});stats.bytes+=Number(r.headers.get('content-length'))||0;return r;}finally{stats.active--;}
};
const settings={...OM.defaultOmProtocolSettings,fileReaderConfig:{...OM.defaultOmProtocolSettings.fileReaderConfig,useSAB:false}},reader=OM.getProtocolInstance(settings).omFileReader,original=reader.readVariable.bind(reader);
const grid=OM.domainOptions.find(d=>d.value==='ecmwf_ifs').grid,ranges=OM.getRanges(grid,[-12,48,5,61.5]);
const url='https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/10/12/1200Z/2026-10-15T1300.om';
let totals;
if(mode==='baseline')totals=installAccumulations(OM,settings);
else totals=new RollingAccumulations(async(url,ranges,signal)=>reader.withReader(url,async file=>{
 const child=await file.getChildByName('precipitation');if(!child)throw Error('Missing precipitation');
 try{await child.readPrefetch({prefetchConcurrency:4,ranges,signal});return (await reader.readSimpleVariable(file,'precipitation',ranges,signal)).values;}finally{child.dispose();}
}),{useSAB:false,concurrency:6});
const started=performance.now(),signal=AbortSignal.timeout(240000);let result;
try{
 const data=await totals.read(url,'precipitation_total_72h',ranges,signal);let sum=0,finite=0;for(const v of data.values)if(Number.isFinite(v)){sum+=v;finite++;}
 result={mode,milliseconds:Math.round(performance.now()-started),cells:data.values.length,finite,sum,stats:{...stats},inputs:{...totals.inputs.stats},snapshots:totals.snapshotBytes,ranges};console.log(JSON.stringify(result));
 const prior=stats.requests,t=performance.now();await totals.read(url,'precipitation_total_72h',ranges,signal);result.repeat={milliseconds:Math.round(performance.now()-t),requests:stats.requests-prior};
 await writeFile('review-output/'+mode+'.json',JSON.stringify(result,null,2));
}catch(error){await writeFile('review-output/'+mode+'.json',JSON.stringify({mode,error:error.message,milliseconds:Math.round(performance.now()-started),stats,inputs:totals.inputs.stats},null,2));throw error;}finally{totals.clear();}
