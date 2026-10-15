import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Exercise the real entry-point routing with only Cloudflare's base class replaced.
const source=(await readFile(new URL('../worker/index.mjs',import.meta.url),'utf8'))
 .replace("import {DurableObject} from 'cloudflare:workers';",'class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}')
 .replace("'./cache-service.mjs'",JSON.stringify(new URL('../worker/cache-service.mjs',import.meta.url).href));
const {default:worker,SharedForecasts}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function environment(){let calls=0;return {get calls(){return calls;},env:{ALLOWED_ORIGINS:'https://matthewhugo81-arch.github.io',STATS_TOKEN:'test-secret',SHARED_FORECASTS:{idFromName:name=>{assert.equal(name,'snowline-v1');return name;},get:()=>({fetch:async request=>{calls++;return Response.json({path:new URL(request.url).pathname},{headers:{'Retry-After':'60'}});}})}}};}
const endpoint='https://cache.test/forecast?latitude=53&longitude=-2&model=ecmwf_ifs';
test('origin policy and method checks precede Durable Object calls',async()=>{
 const f=environment();
 assert.equal((await worker.fetch(new Request(endpoint,{headers:{Origin:'https://evil.test'}}),f.env)).status,403);
 assert.equal((await worker.fetch(new Request(endpoint,{method:'POST'}),f.env)).status,405);
 const preflight=await worker.fetch(new Request(endpoint,{method:'OPTIONS',headers:{Origin:f.env.ALLOWED_ORIGINS}}),f.env);
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),f.env.ALLOWED_ORIGINS);assert.equal(f.calls,0);
});
test('health, unknown paths, malformed queries and protected counters make no unauthorised storage calls',async()=>{
 const f=environment();for(const [url,status] of [['https://cache.test/health',200],['https://cache.test/other',404],['https://cache.test/forecast?url=other',400],['https://cache.test/stats',401]])assert.equal((await worker.fetch(new Request(url),f.env)).status,status);
 assert.equal(f.calls,0);
 const stats=await worker.fetch(new Request('https://cache.test/stats',{headers:{Authorization:'Bearer test-secret'}}),f.env);assert.equal(stats.status,200);assert.equal(f.calls,1);
});
test('forecast responses expose Retry-After to allowed browsers and prohibit intermediary caching',async()=>{
 const f=environment(),response=await worker.fetch(new Request(endpoint,{headers:{Origin:f.env.ALLOWED_ORIGINS}}),f.env);
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Retry-After'),'60');assert.equal(response.headers.get('Access-Control-Expose-Headers'),'Retry-After');assert.equal(f.calls,1);
 f.env.SHARED_FORECASTS.get=()=>({fetch:async()=>{throw Error('storage failed');}});
 const failed=await worker.fetch(new Request(endpoint,{headers:{Origin:f.env.ALLOWED_ORIGINS}}),f.env);assert.equal(failed.status,503);assert.equal(failed.headers.get('Access-Control-Allow-Origin'),f.env.ALLOWED_ORIGINS);
});
test('Durable Object handler returns validated forecasts and retryable provider errors',async()=>{
 let ready;const ctx={storage:{list:async()=>new Map(),get:async()=>undefined,put:async()=>{},delete:async()=>{}},blockConcurrencyWhile:fn=>{ready=fn();}};
 const object=new SharedForecasts(ctx,{DAILY_HTTP_BUDGET:'1'});await ready;
 object.cache.fetcher=async()=>Response.json({hourly:{time:[new Date().toISOString()],temperature_2m:[3]}});
 const first=await object.fetch(new Request(endpoint));assert.equal(first.status,200);assert.equal((await first.json())._source,'shared cache');
 const blocked=await object.fetch(new Request(endpoint.replace('latitude=53','latitude=54')));assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('Retry-After'))>0);
});
