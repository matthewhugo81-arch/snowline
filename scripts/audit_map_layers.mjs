// Read-only audit of every map model against its current published metadata.
// Run: node scripts/audit_map_layers.mjs > layer-audit.json
import {readFile} from 'node:fs/promises';
import {MAP_MODELS} from '../map-models.js';
import {loadSpatialModel} from '../map-sources.js';
import {availableFields,extendCatalogue,canonicalVariable} from '../map-catalogue.js';
import * as OM from '../vendor/index.mjs';
const site='https://matthewhugo81-arch.github.io/snowline/';
const source=await readFile(new URL('../maps.js',import.meta.url),'utf8');
const baseKeys=[...source.slice(source.indexOf('const fields=['),source.indexOf('const rgba=')).matchAll(/key:'([^']+)'/g)].map(m=>m[1]);
const load=async url=>{
 const remote=url.startsWith('file:')?site+'ensemble-data/'+url.split('/ensemble-data/')[1]:url;
 const response=await fetch(remote,{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error(`${response.status}: ${remote}`);
 return response.json();
};
const models=[];
for(const model of MAP_MODELS){
 try{
  const meta=await loadSpatialModel(model.id,load);
  // Existing base descriptions are represented only for coverage counting.
  const fields=baseKeys.map(key=>({key,name:key,overlayOnly:key==='pressure_msl',unit:'',stops:[0,1],colors:['#000000','#ffffff']}));
  const undescribed=extendCatalogue(fields,[meta],OM,{colorScales:{}});
  const offered=availableFields(fields,[meta]).map(f=>f.key);
  models.push({model:model.id,reference_time:meta.reference_time,source_fields:meta.variables.length,
   comparison_layers:offered.length,layers:offered,undescribed,
   unavailable_inputs:[...new Set(meta.variables.map(canonicalVariable))].filter(k=>!offered.includes(k)&&!undescribed.includes(k)&&k!=='pressure_msl'),
   notices:meta.sourceWarnings});
 }catch(error){models.push({model:model.id,error:error.message});}
}
console.log(JSON.stringify({checked_at:new Date().toISOString(),models},null,2));
