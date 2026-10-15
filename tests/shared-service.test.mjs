import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastCache,parsePoint} from '../worker/cache-service.mjs';
import {loadPointForecasts} from '../point-forecasts.js';
import {MODELS} from '../data.js';
function fixture(budget=1000){
 let now=Date.now(),calls=0;const values=new Map();
 const db={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>{values.set(k,structuredClone(v));},delete:async keys=>{for(const k of [].concat(keys))values.delete(k);},list:async({prefix})=>new Map([...values].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))};
 let provider=async()=>Response.json({latitude:53,longitude:-2,elevation:150,hourly:{time:[new Date(now).toISOString(),new Date(now+86400000*3).toISOString()],temperature_2m:[5,6]},hourly_units:{temperature_2m:'°C'}});
 const options={dailyBudget:budget,now:()=>now,fetcher:async url=>{calls++;assert.match(url,/forecast_days=8/);assert.match(url,/wind_speed_unit=mph/);return provider(url);}};
 return {restart:()=>new ForecastCache(db,options),get now(){return now;},advance:n=>now+=n,setProvider:p=>provider=p,get calls(){return calls;},point:(lat=53,model=MODELS[0].id)=>parsePoint('https://cache.test/forecast?'+new URLSearchParams({latitude:lat,longitude:-2,model}))};
}
test('ten simultaneous clients share one fetch; persistent fresh cache and hourly expiry',async()=>{
 const f=fixture(),cache=f.restart();const results=await Promise.all(Array.from({length:10},()=>cache.get(f.point())));
 assert.equal(f.calls,1);assert.ok(results.every(v=>v._retrievedAt===f.now));assert.equal((await cache.stats()).joined,9);
 const restarted=f.restart();await restarted.get(f.point());assert.equal(f.calls,1);f.advance(3600001);await restarted.get(f.point());assert.equal(f.calls,2);
});
test('coordinate/model isolation and strict input validation',async()=>{
 const f=fixture(),cache=f.restart();await cache.get(f.point());await cache.get(f.point(54));await cache.get(f.point(53,MODELS[1].id));assert.equal(f.calls,3);
 for(const query of ['latitude=&longitude=0&model=ecmwf_ifs','latitude=91&longitude=0&model=ecmwf_ifs','latitude=NaN&longitude=0&model=ecmwf_ifs','latitude=1&longitude=0&model=other','latitude=1&latitude=2&longitude=0&model=ecmwf_ifs','latitude=1&longitude=0&model=ecmwf_ifs&url=https://evil.test'])assert.throws(()=>parsePoint('https://cache.test/?'+query));
 assert.equal(f.point(53.123456).location.latitude,53.1235);
});
test('global persistent 429 cooldown and stale data retains age; expired data refused',async()=>{
 const f=fixture(),cache=f.restart(),original=await cache.get(f.point());f.advance(3600001);
 f.setProvider(async()=>Response.json({error:true,reason:'Hourly limit'},{status:429,headers:{'Retry-After':'120'}}));
 const stale=await cache.get(f.point());assert.equal(stale._stale,true);assert.equal(stale._retrievedAt,original._retrievedAt);assert.equal(stale._retryAt,f.now+120000);
 const restarted=f.restart();await assert.rejects(restarted.get(f.point(54)),{status:429});assert.equal(f.calls,2);
 f.advance(86400000);await assert.rejects(restarted.get(f.point()),{status:429});assert.equal(f.calls,3);
});
test('offline stale fallback, per-key backoff and 400 never masquerades as success',async()=>{
 const f=fixture(),cache=f.restart(),first=await cache.get(f.point());f.advance(3600001);
 f.setProvider(async()=>{throw Error('offline');});assert.equal((await cache.get(f.point()))._retrievedAt,first._retrievedAt);await cache.get(f.point());assert.equal(f.calls,2);
 f.advance(60001);f.setProvider(async()=>Response.json({reason:'Bad model'},{status:400}));await assert.rejects(cache.get(f.point()),{status:400});await assert.rejects(cache.get(f.point()),{status:400});assert.equal(f.calls,3);
});
test('daily HTTP budget survives restart, permits fresh hits and resets at UTC day change',async()=>{
 const f=fixture(1),cache=f.restart();await cache.get(f.point());await assert.rejects(cache.get(f.point(54)),{status:429});
 const restarted=f.restart();await assert.rejects(restarted.get(f.point(55)),{status:429});await restarted.get(f.point());assert.equal(f.calls,1);
 f.advance(86400000);await restarted.get(f.point(54));assert.equal(f.calls,2);
});
test('configured client uses service for all models without direct API fallback',async()=>{
 const urls=[],errors=[];await loadPointForecasts({latitude:52,longitude:1},{service:'https://cache.test',load:async(url,signal,options)=>{urls.push(url);assert.equal(options.preserveRetrievedAt,true);assert.equal(options.forceMinAge,3600000);throw Object.assign(Error('Unavailable'),{status:503});},onError:(m,e)=>errors.push(e)});
 assert.equal(urls.length,15);assert.equal(errors.length,15);assert.ok(urls.every(url=>url.startsWith('https://cache.test/forecast?')));
});
test('upstream concurrency stays at three and concurrent reservations cannot exceed daily budget',async()=>{
 const f=fixture(4),cache=f.restart();let active=0,peak=0;
 f.setProvider(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return Response.json({hourly:{time:[new Date(f.now).toISOString()],temperature_2m:[1]}});});
 const results=await Promise.allSettled(Array.from({length:15},(_,i)=>cache.get(f.point(i))));
 assert.equal(peak,3);assert.equal(f.calls,4);assert.equal(results.filter(r=>r.status==='fulfilled').length,4);
});
test('service results normalise into all model charts with original timestamps and missing values',async()=>{
 const f=fixture(),cache=f.restart(),models=[];
 await loadPointForecasts({latitude:52,longitude:1},{service:'https://cache.test',load:async url=>cache.get(parsePoint(url)),onModel:model=>models.push(model)});
 assert.equal(models.length,15);assert.ok(models.every(m=>m.source==='shared cache'&&m.fetchedAt===f.now&&m.values.temperature_2m[0]===5&&m.values.snowfall[0]===null));
 assert.equal(f.calls,15);
});
test('bounded persistent cache evicts old entries and refuses provider data without future values',async()=>{
 const f=fixture(),cache=f.restart();
 for(let i=0;i<258;i++)await cache.get(f.point(i/10));
 assert.equal((await cache.stats()).entries,256);
 await cache.get(f.point(0));assert.equal(f.calls,259);
 const restarted=f.restart();await restarted.get(f.point(25.7));assert.equal(f.calls,259);
 f.setProvider(async()=>Response.json({hourly:{time:['2020-01-01T00:00'],temperature_2m:[1]}}));
 await assert.rejects(restarted.get(f.point(80)),{status:502});
});
