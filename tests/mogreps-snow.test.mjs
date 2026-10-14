import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {MOGREPS_MODELS,MOGREPS_SNOW_DOMAINS,verifiedSnowMetadata} from '../map-mogreps.js';
import {loadSpatialModel,loadSpatialRun,fieldDataURL,fieldIntervalHours,fieldSource} from '../map-sources.js';
import {describeVariable,availableFields,extendCatalogue} from '../map-catalogue.js';
import {briefingCaption,briefingTimes} from '../map-briefing-data.js';

const t=h=>new Date(Date.UTC(2026,9,14,2+h)).toISOString(),model=MOGREPS_MODELS[0];
const native={reference_time:t(0),completed:true,variables:['precipitation_probability'],valid_times:[0,1,2,3,63].map(t)};
const snow={format_version:1,reference_time:t(0),completed:false,variables:['snowfall_probability'],valid_times:[1,3,63].map(t),intervals:Object.fromEntries([1,3,63].map(h=>[t(h),1])),member_count:3,threshold_mm_per_hour:.1};
const loader=(url)=>Promise.resolve(url.includes(model.snowDomain)?snow:native);

test('snow probability is a separate Winter Analysis field with its actual periods',async()=>{
 const meta=await loadSpatialModel(model.id,loader),fields=[],settings={colorScales:{}};
 assert.equal(fieldSource(meta,'snowfall_probability',t(63)).domain,model.snowDomain);
 assert.match(fieldDataURL(meta,'snowfall_probability',t(63)),/ensemble-data\/snowline_mogreps_uk\/2026\/10\/14\/0200Z\//);
 assert.match(fieldDataURL(meta,'precipitation_probability',t(63)),/^https:\/\/openmeteo/);
 assert.equal(fieldDataURL(meta,'snowfall_probability',t(2)),null);
 assert.equal(fieldIntervalHours(meta,'snowfall_probability',t(63)),1,'A missing frame is not a 60-hour accumulation');
 extendCatalogue(fields,[meta],OM,settings);
 assert.equal(availableFields(fields,[meta])[0].key,'snowfall_probability');
 const field=describeVariable('snowfall_probability',OM);
 assert.equal(field.group,'Winter Analysis');assert.equal(field.unit,'%');
 assert.match(field.note,/falling snow/);assert.match(field.note,/not a calibrated probability/);
 const preset={id:field.key,field:field.key,required:[field.key]};
 assert.deepEqual(briefingTimes(meta,preset,model,'native'),snow.valid_times);
 assert.match(briefingCaption(meta,preset,t(63)),/1 h snow probability \(≥0.1 mm water\)/);
});

test('newer native runs cannot be mixed with older prepared snowfall',async()=>{
 const calls=[],later={...native,reference_time:t(1),valid_times:[1,2,3,4].map(t)};
 const meta=await loadSpatialModel(model.id,async url=>{calls.push(url);return url.includes(model.snowDomain)?snow:url.endsWith('/meta.json')?native:later;});
 assert.equal(meta.reference_time,t(0));assert.ok(meta.sources.every(s=>s.reference_time===t(0)));
 assert.ok(calls.some(url=>url.includes('/0200Z/meta.json')));
 assert.ok(meta.sourceWarnings.some(w=>w.includes('newer MOGREPS run')));
 const unavailable=await loadSpatialModel(model.id,async url=>url.includes(model.snowDomain)?snow:later);
 assert.equal(unavailable.reference_time,t(1));assert.equal(fieldDataURL(unavailable,'snowfall_probability',t(3)),null);
});

test('archive lookup never substitutes another snow cycle and invalid products are rejected',async()=>{
 const archive=await loadSpatialRun(model.id,t(0),loader);
 assert.ok(fieldDataURL(archive,'snowfall_probability',t(3)));
 const missing=await loadSpatialRun(model.id,t(0),async url=>url.includes(model.snowDomain)?{...snow,reference_time:t(-1)}:native);
 assert.equal(fieldDataURL(missing,'snowfall_probability',t(3)),null);
 for(const change of [{member_count:18},{threshold_mm_per_hour:1},{intervals:{}},{format_version:0}])assert.equal(verifiedSnowMetadata({...snow,...change},model),false);
});

test('snowfall uses only the reprojected UK 2 km grid',()=>{
 assert.equal(MOGREPS_SNOW_DOMAINS.length,1);
 const uk=MOGREPS_SNOW_DOMAINS[0].grid;
 assert.equal(OM.GridFactory.create(uk).nx,1042);assert.equal(OM.GridFactory.create(uk).ny,970);
});
