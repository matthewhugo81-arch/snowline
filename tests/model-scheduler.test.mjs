import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ModelSchedulerService,HEALTH_WORKFLOW} from '../scheduler/service.mjs';
const instant=Date.parse('2026-10-16T10:00:00Z');
function fixture({health=[],publish=[],postStatus=200,token='fixture-only'}={}){
 let now=instant;const values=new Map(),calls=[];
 const storage={get:async key=>values.get(key),put:async(key,value)=>{values.set(key,structuredClone(value));}};
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(options.method==='POST')return postStatus===204?new Response(null,{status:204}):Response.json({workflow_run_id:123},{status:postStatus});
  return Response.json({workflow_runs:url.includes(HEALTH_WORKFLOW)?health:publish});
 };
 return {calls,values,storage,fetcher,setNow:value=>{now=value;},service:new ModelSchedulerService(storage,{token,fetcher,now:()=>now})};
}
test('external tick dispatches only the fixed health workflow on main',async()=>{
 const f=fixture();const result=await f.service.tick();assert.equal(result.status,'dispatched');assert.equal(result.lastDispatchedRunId,123);
 const post=f.calls.find(x=>x.options.method==='POST');assert.match(post.url,/matthewhugo81-arch\/snowline\/actions\/workflows\/map-feed-health.yml\/dispatches$/);
 assert.deepEqual(JSON.parse(post.options.body),{ref:'main'});assert.equal(post.options.redirect,'manual');
 assert.equal((await f.service.status()).ok,true);assert.ok(!JSON.stringify(f.values.get('state')).includes('fixture-only'));
});
test('concurrent ticks and an isolate restart cannot duplicate a dispatch',async()=>{
 const f=fixture();await Promise.all([f.service.tick(),f.service.tick(),f.service.tick()]);
 const restarted=new ModelSchedulerService(f.storage,{token:'fixture-only',fetcher:f.fetcher,now:()=>instant+1000});await restarted.tick();
 assert.equal(f.calls.filter(x=>x.options.method==='POST').length,1);
 f.setNow(instant+180000);await f.service.tick();assert.equal(f.calls.filter(x=>x.options.method==='POST').length,2);
});
test('queued health and active publisher suppress duplicate work, stuck jobs are unhealthy',async()=>{
 for(const key of ['health','publish']){
  const f=fixture({[key]:[{id:55,status:'queued',created_at:new Date(instant-60000).toISOString()}]});
  assert.equal((await f.service.tick()).status,'busy');assert.equal(f.calls.length,2);
  f.setNow(instant+36*60000);assert.equal((await f.service.tick()).status,'stalled');assert.equal((await f.service.status()).ok,false);
 }
});
test('a native cron or manual check less than 150 seconds old counts as a check',async()=>{
 const f=fixture({health:[{id:9,status:'completed',conclusion:'success',created_at:new Date(instant-60000).toISOString(),updated_at:new Date(instant-30000).toISOString()}]});
 assert.equal((await f.service.tick()).status,'recent');assert.equal(f.calls.length,2);
});
test('dispatch failures stay visible and retry after the persistent lease expires',async()=>{
 const f=fixture({postStatus:503});await assert.rejects(f.service.tick(),/HTTP 503/);assert.equal((await f.service.status()).ok,false);
 await f.service.tick();assert.equal(f.calls.filter(x=>x.options.method==='POST').length,1);
 f.setNow(instant+180000);await assert.rejects(f.service.tick(),/HTTP 503/);assert.equal(f.calls.filter(x=>x.options.method==='POST').length,2);
});
test('missing credentials, stale ticks and HTTP read failures cannot report healthy',async()=>{
 const f=fixture({token:''});await assert.rejects(f.service.tick(),/not configured/);assert.equal(f.calls.length,0);assert.equal((await f.service.status()).ok,false);
 const g=fixture();await g.service.tick();g.setNow(instant+11*60000);assert.equal((await g.service.status()).ok,false);
 const h=fixture();h.service.fetcher=async()=>new Response(null,{status:401});await assert.rejects(h.service.tick(),/HTTP 401/);assert.equal((await h.service.status()).ok,false);
});
test('legacy empty dispatch response is accepted',async()=>{assert.equal((await fixture({postStatus:204}).service.tick()).status,'dispatched');});
test('public endpoint is read-only and scheduled handler awaits Durable Object dispatch',async()=>{
 const source=(await readFile(new URL('../scheduler/index.mjs',import.meta.url),'utf8'))
  .replace("import {DurableObject} from 'cloudflare:workers';",'class DurableObject {}')
  .replace("'./service.mjs'",JSON.stringify(new URL('../scheduler/service.mjs',import.meta.url).href));
 const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let ticks=0,reads=0;const env={MODEL_SCHEDULER:{idFromName:()=>1,get:()=>({tick:async()=>{ticks++;},status:async()=>{reads++;return {ok:true};}})}};
 for(const [method,path,status] of [['POST','/health',405],['GET','/dispatch',404],['GET','/health',200]]){
  assert.equal((await worker.fetch(new Request('https://scheduler.test'+path,{method}),env)).status,status);
 }
 assert.equal(ticks,0);assert.equal(reads,1);let pending;await worker.scheduled({},env,{waitUntil:p=>{pending=p;}});await pending;assert.equal(ticks,1);
});
