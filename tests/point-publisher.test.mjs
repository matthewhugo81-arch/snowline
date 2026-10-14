import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPointForecasts} from '../scripts/build_point_forecasts.mjs';
import {MODELS} from '../data.js';
import {POINT_LOCATIONS,pointKey} from '../point-snapshots.js';
test('publisher reuses hourly cache, retains successful data on failures and never relabels old retrieval times',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'snowline-point-')),now=Date.UTC(2026,9,14,18),locations=POINT_LOCATIONS.slice(0,1),models=MODELS.slice(0,3);
 const success=async()=>Response.json({hourly:{time:['2026-10-15T00:00'],temperature_2m:[4]},elevation:161});
 try{
  assert.equal((await buildPointForecasts(directory,{now,locations,models,fetcher:success})).requests,3);
  assert.equal((await buildPointForecasts(directory,{now:now+300000,locations,models,fetcher:success})).requests,0);
  const report=await buildPointForecasts(directory,{now:now+3600001,locations,models,fetcher:async()=>Response.json({reason:'Daily API request limit exceeded.'},{status:429})});
  assert.equal(report.limited,true);assert.equal(report.locations[0].models,3);
  const saved=JSON.parse(await readFile(join(directory,pointKey(locations[0])+'.json'),'utf8'));assert.equal(saved.models[models[0].id]._retrievedAt,now);
  assert.equal((await buildPointForecasts(directory,{now:now+7200000,locations,models,fetcher:success})).requests,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('cold-cache quota failure stops queued work at three in-flight calls and respects saved cooldown',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'snowline-point-')),now=Date.UTC(2026,9,14,18);
 try{
  const limited=async()=>Response.json({reason:'Daily API request limit exceeded.'},{status:429});
  const report=await buildPointForecasts(directory,{now,fetcher:limited});assert.ok(report.requests<=3);assert.ok(report.locations.every(l=>l.models===0));
  assert.equal((await buildPointForecasts(directory,{now:now+3600000,fetcher:limited})).requests,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
