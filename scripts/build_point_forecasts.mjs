// Shared exact-location responses: one refresh per hour, independent of visitor count.
// No API keys, proxy rotation, alternate API hosts or retries after a quota response.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MODELS,forecastURL,normalise} from '../data.js';
import {retryTime} from '../cache.js';
import {POINT_LOCATIONS,POINT_TTL,pointKey,usableForecast,snapshotFor} from '../point-snapshots.js';

async function read(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
async function write(path,value){await writeFile(path+'.tmp',JSON.stringify(value));await rename(path+'.tmp',path);}
export async function buildPointForecasts(directory,{fetcher=fetch,now=Date.now(),locations=POINT_LOCATIONS,models=MODELS}={}){
 await mkdir(directory,{recursive:true});
 let limit=await read(join(directory,'status.json'));
 let requests=0,next=0;
 const snapshots=await Promise.all(locations.map(async location=>{
  const previous=snapshotFor(await read(join(directory,pointKey(location)+'.json')),location);
  return {version:1,location,models:Object.fromEntries(Object.entries(previous?.models??{}).filter(([,value])=>usableForecast(value,now))),errors:previous?.errors??{}};
 }));
 const jobs=snapshots.flatMap(snapshot=>models.map(model=>({snapshot,model})));
 async function worker(){while(next<jobs.length){
  const {snapshot,model}=jobs[next++],prior=snapshot.models[model.id],failure=snapshot.errors[model.id];
  if(prior&&now-prior._retrievedAt<POINT_TTL||failure&&now-failure.checkedAt<POINT_TTL||limit?.retryAt>now)continue;
  try{
   requests++;
   const response=await fetcher(forecastURL(snapshot.location,model),{signal:AbortSignal.timeout(25000)});
   const value=await response.json();
   if(!response.ok||value.error){
    const message=value.reason??'HTTP '+response.status;
    if(response.status===429)limit={message,retryAt:retryTime(response,message,now)};
    throw Error(message);
   }
   value._retrievedAt=now;
   if(!usableForecast(value,now))throw Error('No current forecast values returned.');
   normalise(value,model); // Reject malformed timestamps before publishing.
   snapshot.models[model.id]=value;delete snapshot.errors[model.id];
  }catch(error){snapshot.errors[model.id]={message:error.message,checkedAt:now};}
 }}
 await Promise.all([worker(),worker(),worker()]);
 for(const snapshot of snapshots)await write(join(directory,pointKey(snapshot.location)+'.json'),snapshot);
 await write(join(directory,'status.json'),limit?.retryAt>now?limit:{});
 const report={checkedAt:new Date(now).toISOString(),requests,limited:limit?.retryAt>now,locations:snapshots.map(s=>({name:s.location.name,models:Object.keys(s.models).length,errors:s.errors}))};
 console.log(JSON.stringify(report,null,2));
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildPointForecasts(resolve(process.argv[2]??'point-data'));
