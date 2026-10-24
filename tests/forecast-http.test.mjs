import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {forecastRequest} from '../vendor/forecast-http.mjs';

async function server(t,handler){
 const instance=http.createServer(handler);
 await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));
 t.after(()=>{instance.closeAllConnections();return new Promise(resolve=>instance.close(resolve));});
 return `http://127.0.0.1:${instance.address().port}`;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('deadline cancels an actual request stalled before headers',async t=>{
 let closed=false;
 const url=await server(t,(req,res)=>res.on('close',()=>{closed=true;}));
 await assert.rejects(forecastRequest(url,{},100,1),{name:'TimeoutError'});
 await delay(30);assert.equal(closed,true);
});
test('deadline includes body consumption and closes the stalled connection',async t=>{
 let closed=false;
 const url=await server(t,(req,res)=>{res.on('close',()=>{closed=true;});res.writeHead(200);res.write('partial');});
 await assert.rejects(forecastRequest(url,{},100,1,undefined,r=>r.arrayBuffer()),{name:'TimeoutError'});
 await delay(30);assert.equal(closed,true);
});
test('retry starts after the timed out body request has closed; successful bytes are unchanged',async t=>{
 let calls=0,closed=false;
 const bytes=Buffer.from([0,1,127,128,255]);
 const url=await server(t,(req,res)=>{
  if(++calls===1){res.on('close',()=>{closed=true;});res.writeHead(200);res.write('partial');}
  else {assert.equal(closed,true);res.end(bytes);}
 });
 const result=await forecastRequest(url,{},100,2,undefined,r=>r.arrayBuffer());
 assert.deepEqual(Buffer.from(result),bytes);assert.equal(calls,2);
});
test('permanent HTTP errors retain status and are not retried',async t=>{
 let calls=0;const url=await server(t,(req,res)=>{calls++;res.writeHead(404);res.end();});
 await assert.rejects(forecastRequest(url,{},500,3),e=>e.status===404&&e.statusCode===404);
 assert.equal(calls,1);
});
test('transient HTTP failures retry',async t=>{
 let calls=0;const url=await server(t,(req,res)=>{res.writeHead(++calls===1?503:200);res.end('ok');});
 assert.equal(await forecastRequest(url,{},500,2,undefined,r=>r.text()),'ok');assert.equal(calls,2);
});
test('caller cancellation during a body read closes the request without retrying',async t=>{
 let calls=0,closed=false;const controller=new AbortController();
 const url=await server(t,(req,res)=>{calls++;res.on('close',()=>{closed=true;});res.writeHead(200);res.write('partial');setTimeout(()=>controller.abort(),20);});
 await assert.rejects(forecastRequest(url,{},500,3,controller.signal,r=>r.arrayBuffer()),{name:'AbortError'});
 await delay(30);assert.equal(closed,true);assert.equal(calls,1);
});
test('caller cancellation interrupts retry backoff',async t=>{
 let calls=0;const controller=new AbortController();
 const url=await server(t,(req,res)=>{calls++;res.writeHead(503);res.end();setTimeout(()=>controller.abort(),30);});
 const start=performance.now();
 await assert.rejects(forecastRequest(url,{},500,3,controller.signal),{name:'AbortError'});
 assert.ok(performance.now()-start<400);assert.equal(calls,1);
});
test('already cancelled calls never fetch; successful calls remove their timeout',async t=>{
 const original=globalThis.fetch;let calls=0,signal;
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(url,init)=>{calls++;signal=init.signal;return new Response('ok');};
 const controller=new AbortController();controller.abort();
 await assert.rejects(forecastRequest('unused',{},20,3,controller.signal),{name:'AbortError'});
 assert.equal(calls,0);
 assert.equal(await forecastRequest('unused',{},20,1,undefined,r=>r.text()),'ok');
 await delay(40);assert.equal(signal.aborted,false);
});
test('bundled native range reader uses the full body deadline and preserves range bytes',async t=>{
 const source=await readFile(new URL('../vendor/index.mjs',import.meta.url),'utf8');
 const backendSource=source.slice(source.indexOf('fe=class')+3,source.indexOf(',pe=class'));
 const Backend=vm.runInNewContext('('+backendSource+')',{ee:forecastRequest,de:Error,Uint8Array});
 let stall=true;
 const url=await server(t,(req,res)=>{
  if(req.method==='HEAD'){res.writeHead(200,{'Content-Length':'4'});res.end();return;}
  assert.equal(req.headers.range,'bytes=1-2');
  res.writeHead(206);res.write(Buffer.from([20]));if(!stall)res.end(Buffer.from([30]));
 });
 const reader=new Backend({url,timeoutMs:100,retries:1});
 await assert.rejects(reader.getBytes(1,2),{name:'TimeoutError'});
 stall=false;assert.deepEqual([...await reader.getBytes(1,2)],[20,30]);
});
