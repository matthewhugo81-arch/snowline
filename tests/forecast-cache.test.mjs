import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
const original={fetch:globalThis.fetch,now:Date.now,storage:globalThis.localStorage};
let now,cache,calls;
const url='https://api.open-meteo.com/v1/forecast?test=one';
const options={ttl:3600000,staleTtl:86400000,forceMinAge:60000};
beforeEach(async()=>{
 now=Date.UTC(2026,9,14,18);Date.now=()=>now;calls=0;
 const storage={};Object.defineProperties(storage,{getItem:{value:key=>storage[key]??null},setItem:{value:(key,value)=>{storage[key]=value;}},removeItem:{value:key=>{delete storage[key];}}});globalThis.localStorage=storage;
 cache=await import('../cache.js?test='+Math.random());
 globalThis.fetch=async()=>{calls++;return Response.json({elevation:161,hourly:{time:['2026-10-15T00:00'],temperature_2m:[5]}});};
});
afterEach(()=>{globalThis.fetch=original.fetch;Date.now=original.now;globalThis.localStorage=original.storage;});
test('fresh cache and rapid Refresh reuse success without additional API requests',async()=>{
 const first=await cache.cachedJSON(url,options);now+=30000;
 const second=await cache.cachedJSON(url,{...options,force:true});assert.equal(calls,1);assert.equal(second._retrievedAt,first._retrievedAt);
});
test('429 preserves dated forecast, blocks other model/elevation requests and survives reload',async()=>{
 const first=await cache.cachedJSON(url,options);now+=3600001;
 globalThis.fetch=async()=>{calls++;return Response.json({error:true,reason:'Daily API request limit exceeded. Please try again tomorrow.'},{status:429});};
 const stale=await cache.cachedJSON(url,{...options,force:true});assert.equal(stale._stale,true);assert.equal(stale._retrievedAt,first._retrievedAt);
 await assert.rejects(cache.cachedJSON(url+'2',options),{status:429});
 await assert.rejects(cache.cachedJSON('https://api.open-meteo.com/v1/elevation?test=1',options),{status:429});assert.equal(calls,2);
 const reloaded=await import('../cache.js?reload='+Math.random());assert.equal((await reloaded.cachedJSON(url,{...options,force:true}))._stale,true);assert.equal(calls,2);
 assert.equal(stale._retryAt,Date.UTC(2026,9,15,0,1));
 now=stale._retryAt+1;globalThis.fetch=async()=>{calls++;return Response.json({fresh:true});};
 assert.equal((await reloaded.cachedJSON(url,{...options,force:true})).fresh,true);assert.equal(calls,3);
});
test('offline and 503 retain last success; cancellation and 400 never become stale success',async()=>{
 await cache.cachedJSON(url,options);now+=3600001;
 globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};assert.equal((await cache.cachedJSON(url,options))._stale,true);
 globalThis.fetch=async()=>Response.json({reason:'Unavailable'},{status:503});assert.equal((await cache.cachedJSON(url,options))._stale,true);
 const controller=new AbortController();controller.abort();await assert.rejects(cache.cachedJSON(url,{...options,signal:controller.signal}),{name:'AbortError'});
 globalThis.fetch=async()=>Response.json({reason:'Bad model'},{status:400});await assert.rejects(cache.cachedJSON(url,options),{status:400});
 now+=86400000;globalThis.fetch=async()=>{throw Error('Offline');};await assert.rejects(cache.cachedJSON(url,options),/Offline/);
});
test('map metadata does not silently fall back to stale content',async()=>{
 await cache.cachedJSON(url,{kind:'metadata',ttl:60000});now+=60001;globalThis.fetch=async()=>{throw Error('Offline');};
 await assert.rejects(cache.cachedJSON(url,{kind:'metadata',ttl:60000}),/Offline/);
});
test('Retry-After seconds/date take precedence; short quota limits do not block a whole day',()=>{
 assert.equal(cache.retryTime(new Response('',{headers:{'Retry-After':'120'}}),'Daily limit',now),now+120000);
 assert.equal(cache.retryTime(new Response('',{headers:{'Retry-After':'Wed, 14 Oct 2026 19:00:00 GMT'}}),'Limit',now),now+3600000);
 assert.equal(cache.retryTime(new Response(''),'Minutely limit',now),now+60000);
});
