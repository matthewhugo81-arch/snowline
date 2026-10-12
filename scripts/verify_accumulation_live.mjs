// Independent numeric sum and rolling reuse on a small native UKV grid window.
// No pixel sampling; tests use actual OM precipitation arrays from one run.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import * as OM from '../vendor/index.mjs';
import {loadSpatialModel,fieldDataURL} from '../map-sources.js';
import {accumulationKey,accumulationPlan} from '../map-accumulation.js';
import {installAccumulations,accumulationFiles} from '../map-accumulation-reader.js';
const network=globalThis.fetch;
globalThis.fetch=(url,options)=>String(url).startsWith('file:')?readFile(new URL(url)).then(data=>new Response(data,{headers:{'Content-Type':'application/wasm'}})):network(url,{...options,signal:options?.signal??AbortSignal.timeout(20000)});
const cache=new Map(),load=url=>{if(!cache.has(url))cache.set(url,fetch(url).then(async r=>{if(!r.ok)throw Object.assign(Error('HTTP '+r.status),{status:r.status});return r.json();}));return cache.get(url);};
const meta=await loadSpatialModel('ukmo_uk_deterministic_2km',load),settings={...OM.defaultOmProtocolSettings,fileReaderConfig:{...OM.defaultOmProtocolSettings.fileReaderConfig,useSAB:false}};
const reader=OM.getProtocolInstance(settings).omFileReader,original=reader.readVariable.bind(reader),totals=installAccumulations(OM,settings);
const reports=[],ranges=[{start:420,end:452},{start:500,end:532}];
for(const h of [6,24]){
 const key=accumulationKey(h),end=meta.valid_times.find(t=>accumulationPlan(meta,key,t));
 if(!end){reports.push({hours:h,status:'not yet available in selected current run',reference_time:meta.reference_time});continue;}
 const url=fieldDataURL(meta,key,end),files=accumulationFiles(url,key),signal=AbortSignal.timeout(120000),start=performance.now(),aggregate=await reader.readVariable(url,key,ranges,signal);
 const sum=new Float64Array(aggregate.values.length),missing=new Uint8Array(sum.length);let n=0;
 for(const source of files.urls){const data=await original(source,'precipitation',ranges,signal);assert.equal(data.values.length,sum.length);for(let i=0;i<sum.length;i++){const value=data.values[i];if(!Number.isFinite(value)||value<0)missing[i]=1;else sum[i]+=value;}n++;}
 let maxError=0,finite=0,missingCells=0;
 for(let i=0;i<sum.length;i++){if(missing[i]){assert.ok(Number.isNaN(aggregate.values[i]));missingCells++;}else{finite++;maxError=Math.max(maxError,Math.abs(aggregate.values[i]-sum[i]));}}
 assert.ok(finite>0,'At least some actual UKV cells must be available');assert.ok(maxError<1e-4);
 const firstReads=totals.inputs.stats.reads,next=new Date(Date.parse(end)+3600000).toISOString();let nextResult;
 if(accumulationPlan(meta,key,next)){
  const t=performance.now(),result=await reader.readVariable(fieldDataURL(meta,key,next),key,ranges,signal);assert.equal(result.values.length,sum.length);
  nextResult={ms:Math.round(performance.now()-t),additionalNativeReads:totals.inputs.stats.reads-firstReads};assert.ok(nextResult.additionalNativeReads<=2,'Rolling ahead must not reread the entire window');
 }
 reports.push({hours:h,reference_time:meta.reference_time,endingAt:end,intervals:n,cells:sum.length,finite,missingCells,maxError,firstCalculationAndIndependentCheckMs:Math.round(performance.now()-start),nextResult});
}
assert.ok(reports.some(r=>r.finite),'No verifiable current-run accumulation');
await mkdir('review-output',{recursive:true});await writeFile('review-output/live-numeric-check.json',JSON.stringify({checkedAt:new Date().toISOString(),ranges,reports,readStats:totals.inputs.stats},null,2));console.log(JSON.stringify(reports,null,2));totals.clear();
