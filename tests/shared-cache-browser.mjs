import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{try{const path=resolve('.'+new URL(req.url,'http://local').pathname);const data=await readFile(path);res.writeHead(200,{'Content-Type':extname(path)==='.js'?'text/javascript':'text/html'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext(),pages=await Promise.all(Array.from({length:4},()=>context.newPage())),errors=[];
 for(const [i,page] of pages.entries()){
  page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/map-credits.html');
  await page.evaluate(async i=>{
   const {ForecastTileCache}=await import('/map-tile-cache.js');
   window.calls=0;
   window.cache=new ForecastTileCache(async()=>{calls++;return {data:new Uint8Array(4).buffer};},{persistent:true,coordinate:true,cacheVersion:'four-windows',diskBytes:24,diskEntries:6,memoryBytes:4});
   cache.setContext('tiles');cache.setSequence(['om://active-'+i,'om://near-'+i]);cache.setProtected(['om://active-'+i]);
   window.read=async url=>{const r=await cache.protocol({url,type:'image'},new AbortController());await Promise.all([...cache.writes.values()].map(w=>w.promise));return r.data.byteLength;};
   await read('om://active-'+i);
  },i);
 }
 assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate(()=>calls))),[1,1,1,1]);
 // Every window can fill spare capacity concurrently without four independent
 // copies of the accounting or deleting another window's selected chart.
 await Promise.all(pages.map((p,i)=>p.evaluate(async i=>{for(let j=0;j<4;j++)await read('om://distant-'+i+'-'+j);},i)));
 const actual=await pages[0].evaluate(async()=>{
  const store=await cache.disk,keys=await store.keys();let bytes=0;const urls=[];
  for(const key of keys){const r=await store.match(key);bytes+=Number(r.headers.get('x-snowline-bytes'));urls.push(JSON.parse(new URL(key.url).searchParams.get('key'))[1]);}
  return {bytes,urls,stats:cache.storageStatus(),background:cache.backgroundConcurrency};
 });
 assert.ok(actual.bytes<=24);assert.ok(actual.urls.length<=6);
 for(let i=0;i<4;i++)assert.ok(actual.urls.includes('om://active-'+i));
 assert.equal(actual.stats.windows,4);assert.equal(actual.background,1);
 assert.equal(actual.stats.bytes,actual.bytes);
 // A frame from another window is a real disk hit, even after hot-memory eviction.
 const before=await pages[3].evaluate(()=>calls);
 await pages[3].evaluate(()=>read('om://active-0'));
 assert.equal(await pages[3].evaluate(()=>calls),before);
 // Moving forward releases old protection, retains a rolling buffer, and
 // still returns selected imagery when all remaining capacity is protected.
 await pages[0].evaluate(async()=>{cache.setProtected(['om://new-active','om://near-0']);await read('om://new-active');await read('om://near-0');});
 await pages[0].evaluate(async()=>{cache.setProtected(['om://new-active','om://near-0','om://next']);await read('om://next');});
 assert.equal(await pages[1].evaluate(async()=>{cache.setProtected(['om://active-1','om://extra']);return read('om://extra');}),4);
 assert.equal(await pages[1].evaluate(()=>cache.limitReason),'budget');
 // Closing a window releases its protection immediately; crashes have expiring leases.
 await pages[2].evaluate(()=>cache.release());
 await pages[1].evaluate(()=>read('om://extra'));
 const abandoned=await pages[3].evaluate(()=>cache.contexts.get('tiles').shared.id);
 await pages[1].evaluate(async id=>{
  const shared=cache.contexts.get('tiles').shared,db=await shared.db;
  await new Promise((resolve,reject)=>{const tx=db.transaction('clients','readwrite'),s=tx.objectStore('clients'),r=s.get(id);r.onsuccess=()=>s.put({...r.result,expires:0});tx.oncomplete=resolve;tx.onerror=reject;});
  await read('om://extra-after-expiry');
 },abandoned);
 assert.equal(await pages[1].evaluate(()=>cache.storageStatus().windows),2);
 // Slow shared disk operations cannot delay the foreground renderer's result.
 const fast=await pages[0].evaluate(async()=>{
  const {ForecastTileCache}=await import('/map-tile-cache.js');
  const c=new ForecastTileCache(async()=>({data:new Uint8Array(4).buffer}),{persistent:true,coordinate:true,cacheVersion:'slow-disk',diskBytes:32});c.setContext('tiles');
  const shared=c.contexts.get('tiles').shared;let unblock;
  const original=shared.put.bind(shared);shared.put=(...args)=>new Promise(resolve=>{unblock=()=>resolve(original(...args));});
  const selected=await Promise.race([c.protocol({type:'image',url:'om://selected'},new AbortController()).then(()=>true),new Promise(r=>setTimeout(()=>r(false),1000))]);
  await new Promise(r=>setTimeout(r,20));unblock();await Promise.all([...c.writes.values()].map(w=>w.promise));c.release();return selected;
 });assert.equal(fast,true);
 const denied=await pages[0].evaluate(async()=>{
  const {ForecastTileCache}=await import('/map-tile-cache.js');
  const c=new ForecastTileCache(async()=>({data:new Uint8Array(4).buffer}),{persistent:true,coordinate:true,cacheVersion:'denied-disk',diskBytes:32});c.setContext('tiles');
  const shared=c.contexts.get('tiles').shared;shared.store=Promise.resolve({put:async()=>{throw new DOMException('Full','QuotaExceededError');}});
  const result=await c.protocol({type:'image',url:'om://selected'},new AbortController());await Promise.all([...c.writes.values()].map(w=>w.promise));
  const state={bytes:result.data.byteLength,reason:c.limitReason,stored:c.storageStatus().bytes};c.release();return state;
 });assert.deepEqual(denied,{bytes:4,reason:'browser-quota',stored:0});
 for(const page of pages)await page.evaluate(()=>cache.release());
 await context.close();assert.deepEqual(errors,[]);
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),phone=await mobile.newPage();await phone.goto(origin+'/map-credits.html');
 const budget=await phone.evaluate(async()=>{
  const {ForecastTileCache}=await import('/map-tile-cache.js');
  const c=new ForecastTileCache(async()=>({data:new Uint8Array(4).buffer}),{persistent:true,coordinate:true,adaptive:true,cacheVersion:'phone'});c.setContext('tiles');await c.budgetReady;
  const budget={disk:c.diskBytes,memory:c.memoryBytes};c.release();return budget;
 });assert.ok(budget.disk<=256*1024*1024);assert.equal(budget.memory,32*1024*1024);await mobile.close();
 console.log('Four-window shared capacity, active-frame protection, cross-window reuse, rolling selection and responsive foreground passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
