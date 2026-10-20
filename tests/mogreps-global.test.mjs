import test from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,valueAt,agreement,forecastURL} from '../data.js';
import {mogrepsMean,nativeSeriesPath} from '../mogreps-point.js';
import {loadPointForecasts} from '../point-forecasts.js';
import {createMogrepsRaw,applyMogrepsStep} from '../mogreps-client.js';
import {MAP_MODELS} from '../map-models.js';
import {MOGREPS_GLOBAL,MOGREPS_GLOBAL_DOMAIN,MOGREPS_GLOBAL_FIELDS,MOGREPS_GLOBAL_PERIOD_FIELDS,verifiedMogrepsGlobal} from '../map-mogreps-global.js';
import {loadSpatialModel,loadSpatialRun,fieldDataURL,fieldIntervalHours} from '../map-sources.js';
import {sourceVariable,extendCatalogue,availableFields} from '../map-catalogue.js';
import {retainRunProgress} from '../map-runs.js';
import {buildDataset,datasetCSV,datasetCoverage} from '../export.js';
import * as OM from '../vendor/index.mjs';
const model=MODELS.find(m=>m.api==='mogreps');
const run=Date.UTC(2026,9,19,6)/1000;
const time=h=>new Date((run+h*3600)*1000).toISOString().replace('.000Z','Z');
const manifest={schema:1,run,runId:'20261019T0600Z',intervalHours:3,members:[0,...Array.from({length:17},(_,i)=>18+i)],leads:Array.from({length:83},(_,i)=>3*i)};
function rawPoint(){
 const raw=createMogrepsRaw(manifest);
 for(const lead of [0,3,9])applyMogrepsStep(raw,manifest,{schema:1,run,time:run+lead*3600,intervalHours:3,members:manifest.members,latitude:53.90625,longitude:-2.109375,
  values:{temperature_850hPa:Array.from({length:18},(_,i)=>i-9),temperature_500hPa:Array.from({length:18},(_,i)=>i-30),precipitation:Array(18).fill(lead?6:null),snowfall:Array(18).fill(lead?.6:null)}},lead);
 return raw;
}
function metadata(){
 const valid=[0,3,6].map(time);
 return {format_version:2,domain:MOGREPS_GLOBAL,reference_time:time(0),completed:true,grid:MOGREPS_GLOBAL_DOMAIN.grid,member_count:18,member_ids:manifest.members,threshold_mm_per_hour:.1,
  anomaly_reference:{period:'1991-2020',level_hPa:500,units:'m'},variables:MOGREPS_GLOBAL_FIELDS,valid_times:valid,
  variable_valid_times:Object.fromEntries(MOGREPS_GLOBAL_FIELDS.map(k=>[k,MOGREPS_GLOBAL_PERIOD_FIELDS.includes(k)?valid.slice(1):valid])),
  variable_intervals:Object.fromEntries(MOGREPS_GLOBAL_PERIOD_FIELDS.map(k=>[k,Object.fromEntries([3,6].map(h=>[time(h),{start:time(h-3),end:time(h),hours:3}]))]))};
}
test('native point means keep 18 members, period amounts, masks and deterministic agreement separate',()=>{
 const raw=rawPoint(),point=mogrepsMean(raw,model);
 assert.equal(valueAt(point,'temperature_850hPa',time(3)),-.5);
 assert.equal(valueAt(point,'temperature_500hPa',time(3)),-21.5);
 assert.equal(valueAt(point,'temperature_850hPa',time(1)),null);
 assert.equal([1,2,3].reduce((s,h)=>s+valueAt(point,'precipitation',time(h)),0),6);
 assert.ok(Math.abs([1,2,3].reduce((s,h)=>s+valueAt(point,'snowfall',time(h)),0)-.6)<1e-12);
 assert.equal(valueAt(point,'precipitation',time(0)),null);
 assert.equal(valueAt(point,'precipitation',time(4)),null);
 assert.deepEqual(agreement([point],time(3)),{valid:0,snow:0,percent:null});
 raw.hourly.temperature_850hPa_member0[1]=null;
 assert.equal(valueAt(mogrepsMean(raw,model),'temperature_850hPa',time(3)),null);
 assert.equal(point.values.temperature_2m.every(v=>v===null),true);
 assert.throws(()=>forecastURL({latitude:54,longitude:-2},model),/native Met Office/);
});
test('3-hour temperature line joins actual samples and breaks at a missing native sample',()=>{
 const point=mogrepsMean(rawPoint(),model),times=Array.from({length:10},(_,h)=>time(h));
 const series={...point,values:times.map(t=>valueAt(point,'temperature_850hPa',t))};
 const d=nativeSeriesPath(series,times,'temperature_850hPa',i=>i,v=>v);
 assert.equal(d,'M0.0,-0.5 L3.0,-0.5 M9.0,-0.5 ');
});
test('point loader dispatches MOGREPS independently and cancellation emits nothing stale',async()=>{
 const loaded=[],location={latitude:52,longitude:1};let calls=0;
 await loadPointForecasts(location,{models:[model],load:()=>{throw Error('Must not use Open-Meteo');},loadMogreps:async(l,m)=>{assert.deepEqual(l,location);calls++;return mogrepsMean(rawPoint(),m);},onModel:m=>loaded.push(m)});
 assert.equal(calls,1);assert.equal(loaded.length,1);
 const controller=new AbortController();
 await assert.rejects(loadPointForecasts(location,{models:[model],signal:controller.signal,loadMogreps:async()=>{controller.abort();return loaded[0];},onModel:()=>assert.fail('Stale model')}),{name:'AbortError'});
});
test('map native crop, metadata, all published fields, and exact periods load without pressure substitution',async()=>{
 const fixture=metadata();assert.ok(verifiedMogrepsGlobal(fixture));
 assert.equal(MAP_MODELS.filter(m=>m.id===MOGREPS_GLOBAL).length,1);
 assert.ok(!MAP_MODELS.some(m=>m.id===model.id));
 assert.equal(OM.GridFactory.create(MOGREPS_GLOBAL_DOMAIN.grid).nx,365);
 const meta=await loadSpatialModel(MOGREPS_GLOBAL,async url=>url.endsWith('health.json')?{checked_at:new Date().toISOString(),models:[{model:MOGREPS_GLOBAL,status:'current',source_reference:time(0)}]}:fixture);
 const fields=[],settings={colorScales:{}};
 assert.deepEqual(extendCatalogue(fields,[meta],OM,settings),[]);
 assert.equal(availableFields(fields,[meta]).length,MOGREPS_GLOBAL_FIELDS.length);
 for(const key of MOGREPS_GLOBAL_FIELDS){
  assert.equal(sourceVariable(meta,key),key);
  assert.ok(fieldDataURL(meta,key,time(3)).endsWith('/2026/10/19/0600Z/2026-10-19T0900.om'));
  assert.equal(fieldDataURL(meta,key,time(4)),null);
 }
 assert.equal(fieldDataURL(meta,'precipitation_mean',time(0)),null);
 assert.equal(fieldIntervalHours(meta,'snowfall_probability',time(3)),3);
 assert.equal(sourceVariable(meta,'pressure_msl'),'pressure_msl_mean');
 assert.ok(fieldDataURL(meta,'pressure_msl',time(3)),'Pressure overlay follows the published ensemble-mean field times');
 assert.equal(fieldDataURL(meta,'pressure_msl',time(4)),null);
 assert.equal(settings.colorScales.temperature_500hPa_mean.unit,'°C');
 assert.equal(settings.colorScales.precipitation_mean.unit,'mm/h');
 await assert.rejects(loadSpatialRun(MOGREPS_GLOBAL,time(0),async()=>({...fixture,member_count:17})),/Unverified/);
 const bad=structuredClone(fixture);bad.variable_intervals.precipitation_mean[time(3)].hours=1;
 assert.equal(verifiedMogrepsGlobal(bad),false);
 const older=structuredClone(fixture);older.valid_times=older.valid_times.slice(0,2);
 for(const key of older.variables){older.variable_valid_times[key]=older.variable_valid_times[key].filter(t=>t!==time(6));delete older.variable_intervals[key]?.[time(6)];}
 const retained=retainRunProgress(meta,older);
 assert.ok(fieldDataURL(retained,'precipitation_mean',time(6)));
 assert.equal(fieldIntervalHours(retained,'precipitation_mean',time(6)),3);
});
test('downloads state native periods, initialization and Met Office attribution',()=>{
 const data=mogrepsMean(rawPoint(),model),variable={key:'precipitation',title:'Total precipitation',unit:'mm / hour'};
 const dataset=buildDataset({variable,modelDefinitions:[model],models:new Map([[model.id,data]]),times:[1,2,3].map(time),location:{name:'Test',latitude:54,longitude:-2},errors:[]});
 assert.equal(dataset.rows.reduce((sum,r)=>sum+r.values[0],0),6);
 assert.match(datasetCSV(dataset),/native 3 h; period-average rate; run 2026-10-19T06:00:00.000Z; Met Office CC BY-SA 4.0/);
 assert.match(datasetCoverage(dataset),/preceding 3 h average/);
});

test('a missing companion publication retains a verified local run and retries the companion later',async()=>{
 const fixture=metadata();
 const fallback=await loadSpatialModel(MOGREPS_GLOBAL,async url=>{
  if(url.startsWith('https://matthewhugo81-arch.github.io/snowline-ensembles/'))throw Error('Not published yet');
  return url.endsWith('health.json')?{}:fixture;
 });
 assert.ok(fallback.sourceWarnings.some(w=>w.includes('retained MOGREPS-G')));
 assert.ok(fieldDataURL(fallback,'temperature_850hPa_mean',time(3)).startsWith('file:'));
 const recovered=await loadSpatialModel(MOGREPS_GLOBAL,async url=>url.endsWith('health.json')?{}:fixture);
 assert.ok(fieldDataURL(recovered,'temperature_850hPa_mean',time(3)).startsWith('https://matthewhugo81-arch.github.io/snowline-ensembles/'));
 assert.equal(recovered.reference_time,fixture.reference_time);
});
