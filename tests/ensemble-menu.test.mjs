import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../maps.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function resolvePanelRun('),source.indexOf('async function configure('));
for(const cached of [false,true])test(`probability menu loads native MOGREPS comparison fields with cached=${cached}`,async()=>{
 const model='snowline_mogreps_global',field='ens_rain_ge25mm_6h';
 const native={domain:model,reference_time:'2026-10-22T18:00:00Z',variables:['geopotential_height_500hPa_anomaly_mean','pressure_msl_mean']};
 const product={domain:'snowline_mogreps_g_products',reference_time:'2026-10-22T12:00:00Z',variables:[field],productOnly:true};
 let extended,loaded;
 const context={requestedRun:()=>({}),sourceModel:x=>x,productField:()=>true,productChoices:()=>[{key:field}],loadProducts:async()=>product,loadSpatialModel:async id=>{loaded=id;return native;},followLatest:{c:true},state:{metas:cached?{[model]:{...product,normalMenuMeta:{variables:['temperature_850hPa_mean']}}}:{}},extendCatalogue:(_,metas)=>extended=metas,fields:[],OM:{},settings:{},selectedRunKey:()=>model};
 const resolve=vm.runInNewContext(body+';resolvePanelRun',context),result=await resolve({key:'c',model,field},()=>{});
 assert.equal(loaded,model);assert.equal(result.meta.normalMenuMeta,native);assert.equal(extended[0],native);
 assert.equal(result.meta.reference_time,product.reference_time);assert.deepEqual(result.meta.variables,[field]);assert.equal(result.meta.sources,undefined);
});
