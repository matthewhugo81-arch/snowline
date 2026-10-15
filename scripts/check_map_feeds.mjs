// Metadata and tiny byte-range checks only: no image generation or point API calls.
// Run with node scripts/check_map_feeds.mjs [output.json].
import {writeFile,mkdir,appendFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {MAP_MODELS} from '../map-models.js';
import {loadSpatialModel,loadSpatialRun,fieldDataURL} from '../map-sources.js';
import {UKV} from '../ukv-run-selection.js';
import {ACCUMULATION_HOURS,accumulationKey,accumulationSource} from '../map-accumulation.js';
import {ENSEMBLE_DOMAINS} from '../map-ensemble.js';
import {discoverPreviousRuns} from '../map-previous-run-data.js';
const timings=[],cache=new Map(),output=process.argv[2]??'map-feed-health.json';
const deployed=url=>url.startsWith('file:')&&url.includes('/ensemble-data/')?'https://matthewhugo81-arch.github.io/snowline/ensemble-data/'+url.split('/ensemble-data/')[1]:url;
async function get(url){
 url=deployed(url);
 const start=performance.now();const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 timings.push({url,status:response.status,ms:Math.round(performance.now()-start)});
 if(!response.ok)throw Object.assign(Error('HTTP '+response.status),{status:response.status});return response.json();
}
const load=url=>{if(!cache.has(url))cache.set(url,get(url));return cache.get(url);};
// Statistical files are site-generated, not native precipitation amount feeds.
const models=MAP_MODELS,results=[];let index=0;
async function sample(meta,requested){
 const field=requested??['pressure_msl_mean','precipitation','precipitation_probability'].find(key=>meta.variables.includes(key));
 const end=meta.valid_times.find(t=>Date.parse(t)>Date.parse(meta.reference_time)&&fieldDataURL(meta,field,t)),raw=fieldDataURL(meta,field,end);if(!raw)throw Error('No sample frame for '+field);const url=deployed(raw)+(raw.includes('/ensemble-data/')?'.png':'');
 const start=performance.now(),response=await fetch(url,{headers:{Range:'bytes=0-63'},signal:AbortSignal.timeout(15000)});
 const range=response.headers.get('content-range');
 if(response.status!==206){await response.body?.cancel();throw Error('Expected a byte-range response; received '+response.status);}
 const size=(await response.arrayBuffer()).byteLength;return {url,status:206,range,bytes:size,ms:Math.round(performance.now()-start)};
}
async function worker(){while(index<models.length){
 const model=models[index++],start=performance.now();
 try{
  const meta=await loadSpatialModel(model.id,load),elapsed=Math.round(performance.now()-start),ageHours=(Date.now()-Date.parse(meta.reference_time))/3600000;
  const horizon=Math.max(...meta.valid_times.map(t=>(Date.parse(t)-Date.parse(meta.reference_time))/3600000));
  const record={model:model.id,name:model.name,reference_time:meta.reference_time,completed:meta.completed!==false,horizonHours:horizon,ageHours:Number(ageHours.toFixed(2)),metadataMs:elapsed,warnings:[...(meta.sourceWarnings??[])],accumulations:ACCUMULATION_HOURS.filter(h=>accumulationSource(meta,accumulationKey(h)))};
  if(ageHours<-.1)record.warnings.push('Initialization is in the future.');
  // Conservative review thresholds, not promises of upstream publication times.
  const threshold=model.id===UKV||model.id===UKV+'_nowcast'?6:model.regional?12:24;
  if(ageHours>threshold)record.warnings.push('Initialization age exceeds the '+threshold+' h review threshold.');
  if(elapsed>10000)record.warnings.push('Metadata check took over 10 seconds.');
  if(['precipitation','pressure_msl_mean','precipitation_probability'].some(key=>meta.variables.includes(key))){try{record.sample=await sample(meta);if(record.sample?.ms>10000)record.warnings.push('Forecast byte-range check took over 10 seconds.');}catch(e){record.warnings.push('Forecast byte-range check failed: '+e.message);}}
  if(meta.variables.includes('snowfall_probability')){try{record.snowSample=await sample(meta,'snowfall_probability');}catch(e){record.warnings.push('Forecast byte-range check failed: snowfall: '+e.message);}}
  if(model.id===UKV){record.history=[];for(const back of [3,6]){const reference=new Date(Date.parse(meta.reference_time)-back*3600000).toISOString();try{const prior=await loadSpatialRun(model.id,reference,load);record.history.push({reference_time:prior.reference_time,available:true});}catch(e){record.history.push({reference_time:reference,available:false,error:e.message});record.warnings.push('An immediately previous UKV main cycle is unavailable: '+reference);}}}
  if(ENSEMBLE_DOMAINS.some(domain=>domain.value===model.id)){
   const archive=await discoverPreviousRuns({model:model.id,latest:meta,load});record.history=[];
   if(archive.runs.length<3)record.warnings.push('Ensemble comparison has fewer than three verified runs.');
   for(const error of archive.errors)record.warnings.push('Ensemble archive check failed: '+error.message);
   for(const prior of archive.runs.slice(1)){
    try{record.history.push({reference_time:prior.reference_time,available:true,sample:await sample(prior)});}
    catch(e){record.history.push({reference_time:prior.reference_time,available:false,error:e.message});record.warnings.push('Forecast byte-range check failed: ensemble archive '+prior.reference_time+': '+e.message);}
   }
  }
  results.push(record);
 }catch(e){results.push({model:model.id,name:model.name,error:e.message});}
}}
await Promise.all([worker(),worker(),worker()]);
const report={checkedAt:new Date().toISOString(),scope:'Published metadata and a 64-byte forecast sample; not a full image latency guarantee.',results,timings};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
const lines=['## Snowline map feed health',report.checkedAt,'',report.scope,'','| Model | Initialization UTC | Horizon | Metadata | Review |','|---|---|---:|---:|---|'];
for(const result of results){const problems=result.error??result.warnings?.join(' ')??'';lines.push(`| ${result.name} | ${result.reference_time??'unverified'} | ${result.horizonHours??'—'} h | ${result.metadataMs??'—'} ms | ${problems||'OK'} |`);if(problems)console.warn('::warning title=Map feed review::'+result.name+': '+problems);}
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log(lines.join('\n'));
// Source publication age and expected missing hours remain review warnings.
// Only fail this transport job on unverified model metadata, impossible
// initialization timestamps, or a genuinely unreadable forecast byte range.
// Official ensemble run/horizon freshness is checked separately in Python.
const isCritical=r=>r.error||r.warnings?.some(w=>w==='Initialization is in the future.'||w.startsWith('Forecast byte-range check failed:'));
if(results.some(isCritical))process.exitCode=1;
