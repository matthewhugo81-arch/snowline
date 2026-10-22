import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {MOGREPS_MODELS,MOGREPS_SNOW_DOMAINS,verifiedSnowMetadata} from '../map-mogreps.js';
import {loadSpatialModel,loadSpatialRun,fieldDataURL,fieldIntervalHours,fieldSource} from '../map-sources.js';
import {describeVariable,availableFields,extendCatalogue} from '../map-catalogue.js';
import {briefingCaption,briefingTimes} from '../map-briefing-data.js';
import {createRunCatalogue} from '../map-run-selection.js';

const t=h=>new Date(Date.UTC(2026,9,14,h)).toISOString(),model=MOGREPS_MODELS[0];
const native={reference_time:t(0),completed:true,variables:['precipitation_probability'],valid_times:[0,1,2,3,63].map(t)};
const snow={format_version:1,reference_time:t(0),completed:false,variables:['snowfall_probability'],valid_times:[1,3,63].map(t),intervals:Object.fromEntries([1,3,63].map(h=>[t(h),1])),member_count:3,threshold_mm_per_hour:.1};
const loader=(url)=>Promise.resolve(url.includes(model.snowDomain)?snow:native);

test('snow probability follows precipitation in Rain & snow with its actual periods',async()=>{
 const meta=await loadSpatialModel(model.id,loader),fields=[],settings={colorScales:{}};
 assert.equal(fieldSource(meta,'snowfall_probability',t(63)).domain,model.snowDomain);
 assert.match(fieldDataURL(meta,'snowfall_probability',t(63)),/ensemble-data\/snowline_mogreps_uk\/2026\/10\/14\/0000Z\//);
 assert.match(fieldDataURL(meta,'precipitation_probability',t(63)),/^https:\/\/openmeteo/);
 assert.equal(fieldDataURL(meta,'snowfall_probability',t(2)),null);
 assert.equal(fieldIntervalHours(meta,'snowfall_probability',t(63)),1,'A missing frame is not a 60-hour accumulation');
 extendCatalogue(fields,[meta],OM,settings);
 assert.deepEqual(availableFields(fields,[meta]).map(f=>f.key),['precipitation_probability','snowfall_probability']);
 const field=describeVariable('snowfall_probability',OM);
 assert.equal(field.group,'Rain & snow');assert.equal(field.unit,'%');
 assert.match(field.note,/falling snow/);assert.match(field.note,/not a calibrated probability/);
 const preset={id:field.key,field:field.key,required:[field.key]};
 assert.deepEqual(briefingTimes(meta,preset,model,'native'),snow.valid_times);
 assert.match(briefingCaption(meta,preset,t(63)),/1 h snow probability \(≥0.1 mm water\)/);
});

test('incoming rain is selectable without rewinding to an older snow run',async()=>{
 const calls=[],later={...native,reference_time:t(3),valid_times:[3,4,5,6].map(t)};
 const meta=await loadSpatialModel(model.id,async url=>{calls.push(url);return url.includes(model.snowDomain)?snow:url.endsWith('/meta.json')?native:later;});
 assert.equal(meta.reference_time,t(3));assert.ok(meta.sources.every(s=>s.reference_time===t(3)));
 assert.ok(calls.some(url=>url.includes('/0300Z/meta.json')));
 assert.equal(meta.completed,false,'Missing snow must not make the combined run Complete');
 assert.ok(fieldDataURL(meta,'precipitation_probability',t(4)));
 assert.equal(fieldDataURL(meta,'snowfall_probability',t(3)),null);
 assert.ok(meta.sourceWarnings.some(w=>w.includes('being prepared')));
 const unavailable=await loadSpatialModel(model.id,async url=>url.includes(model.snowDomain)?snow:later);
 assert.equal(unavailable.reference_time,t(3));assert.equal(fieldDataURL(unavailable,'snowfall_probability',t(3)),null);
});

test('archive lookup never substitutes another snow cycle and invalid products are rejected',async()=>{
 const archive=await loadSpatialRun(model.id,t(0),loader);
 assert.ok(fieldDataURL(archive,'snowfall_probability',t(3)));
 const missing=await loadSpatialRun(model.id,t(0),async url=>url.includes(model.snowDomain)?{...snow,reference_time:t(-1)}:native);
 assert.equal(fieldDataURL(missing,'snowfall_probability',t(3)),null);
 assert.equal(missing.completed,false);
 for(const change of [{member_count:18},{threshold_mm_per_hour:1},{intervals:{}},{format_version:0}])assert.equal(verifiedSnowMetadata({...snow,...change},model),false);
});

test('the complete rain/snow predecessor remains default while new rain arrives',async()=>{
 const completeSnow={...snow,completed:true},later={...native,reference_time:t(3),valid_times:[3,4,5,6].map(t)};
 const catalogue=createRunCatalogue();
 const load=async url=>{
  if(url.includes(model.snowDomain)){
   if(url.includes('/0000Z/'))return completeSnow;
   throw Object.assign(Error('Snow not prepared'),{status:404});
  }
  if(url.endsWith('/latest.json'))return native;
  if(url.endsWith('/in-progress.json'))return later;
  if(url.includes('/0000Z/meta.json'))return native;
  throw Object.assign(Error('Not published'),{status:404});
 };
 const selected=await catalogue.select(model.id,load);
 assert.equal(selected.meta.reference_time,t(0));
 assert.equal(selected.latest.reference_time,t(3));
 assert.equal(selected.previous.completed,true);
 const incoming=await catalogue.select(model.id+'@'+t(3),load);
 assert.ok(fieldDataURL(incoming.meta,'precipitation_probability',t(4)));
 assert.equal(fieldDataURL(incoming.meta,'snowfall_probability',t(3)),null);
});

test('snowfall uses only the reprojected UK 2 km grid',()=>{
 assert.equal(MOGREPS_SNOW_DOMAINS.length,1);
 const uk=MOGREPS_SNOW_DOMAINS[0].grid;
 assert.equal(OM.GridFactory.create(uk).nx,1042);assert.equal(OM.GridFactory.create(uk).ny,970);
});
