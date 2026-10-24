import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const server=createServer(async(req,res)=>{try{const path=resolve('.'+new URL(req.url,'http://local').pathname);res.writeHead(200,{'Content-Type':extname(path)==='.js'?'text/javascript':'text/html'});res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext(),page=await context.newPage();
 async function initialise(page){
  await page.goto(origin+'/map-credits.html');
  return page.evaluate(async()=>{
   const {ForecastTileCache}=await import('./map-tile-cache.js');
   window.c=new ForecastTileCache(async()=>({data:new Uint8Array(4).buffer}),{persistent:true,coordinate:true,concurrency:16,backgroundConcurrency:12,cacheVersion:'reload-test'});
   c.setContext('tiles');c.setProtected(['om://selected']);
   await c.protocol({url:'om://selected',type:'image'},new AbortController());
   await Promise.all([...c.writes.values()].map(w=>w.promise));
   await c.contexts.get(c.context).shared.lease();return c.storageStatus();
  });
 }
 // Deliberately omit pagehide/release: browser destruction must be sufficient.
 for(let n=0;n<4;n++){
  const stats=await initialise(page);assert.equal(stats.windows,1);assert.equal(stats.activeWindows,1);
  assert.equal(await page.evaluate(()=>c.backgroundConcurrency),12);
 }
 const other=await context.newPage();assert.equal((await initialise(other)).windows,2);
 await page.waitForFunction(()=>c.storageStatus().windows===2);
 // Frozen documents can miss lease heartbeats. Their held lock still protects
 // selected charts, while a destroyed document's lock is no longer present.
 await other.evaluate(async()=>{const s=c.contexts.get(c.context).shared,db=await s.db;await new Promise(r=>{const tx=db.transaction('clients','readwrite'),store=tx.objectStore('clients'),q=store.get(s.id);q.onsuccess=()=>store.put({...q.result,expires:Date.now()-1});tx.oncomplete=r;});});
 assert.equal(await page.evaluate(async()=>{await c.contexts.get(c.context).shared.refreshActivity();return c.storageStatus().windows;}),2);
 const third=await context.newPage();await initialise(third);
 await page.evaluate(async()=>{c.setContext('different-charts');await c.contexts.get(c.context).shared.lease();});
 await page.waitForFunction(()=>c.backgroundConcurrency===12);
 await page.evaluate(()=>c.contexts.get('tiles').shared.refreshActivity());
 assert.equal(await page.evaluate(()=>c.backgroundConcurrency),12,'Inactive retained cache cannot change the current queue budget');
 assert.equal(await page.evaluate(()=>c.contexts.get('tiles').shared.activeWindows),2,'Only the other two windows actively use the old context');
 await page.evaluate(async()=>{c.setContext('tiles');await c.contexts.get(c.context).shared.lease();});
 await page.waitForFunction(()=>c.backgroundConcurrency===4);
 await third.close();
 await other.close();
 // Browser page-close acknowledgement can precede release of its Web Locks.
 // Refresh after native cleanup instead of assuming the same event turn.
 await page.waitForFunction(async()=>{await c.contexts.get(c.context).shared.refreshActivity();return c.storageStatus().windows===1;},null,{timeout:5000});
 const stats=await page.evaluate(async()=>{await c.contexts.get(c.context).shared.refreshActivity();return c.storageStatus();});
 assert.equal(stats.windows,1);assert.equal(stats.activeWindows,1);assert.equal(await page.evaluate(()=>c.backgroundConcurrency),12);
 const rows=await page.evaluate(async()=>{const db=await c.contexts.get(c.context).shared.db;return new Promise(r=>{const q=db.transaction('clients').objectStore('clients').getAll();q.onsuccess=()=>r(q.result.length);});});
 assert.ok(rows>1,'Test retains abandoned disk leases, proving counts use document liveness');
 await page.evaluate(()=>c.release());await context.close();
 console.log(JSON.stringify({reloads:3,remainingDiskRows:rows,windowsAfterReload:1,windowsAfterUncleanClose:1,backgroundSlots:12,frozenDocumentProtected:true,inactiveContextDoesNotThrottle:true}));
}finally{await browser.close();server.close();}
