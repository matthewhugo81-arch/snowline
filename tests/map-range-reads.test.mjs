import test from 'node:test';
import assert from 'node:assert/strict';
import {coalesceRangeReads,installRangeReads} from '../map-range-reads.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,8));
const data=Uint8Array.from({length:128},(_,i)=>i);

test('adjacent and overlapping native blocks share one transfer with exact independent slices',async()=>{
 const calls=[];
 const read=coalesceRangeReads(async(start,size)=>{calls.push([start,size]);return data.slice(start,start+size);});
 const [a,b,c]=await Promise.all([read(32,16),read(16,24),read(48,16)]);
 assert.deepEqual(calls,[[16,48]]);
 assert.deepEqual(a,data.slice(32,48));assert.deepEqual(b,data.slice(16,40));assert.deepEqual(c,data.slice(48,64));
 a[0]=255;assert.equal(b[16],32,'Each cache entry owns its bytes');
});

test('gaps and batch size boundaries do not download unrequested data',async()=>{
 const calls=[],read=coalesceRangeReads(async(start,size)=>{calls.push([start,size]);return data.slice(start,start+size);},{maxBytes:32});
 await Promise.all([read(0,16),read(16,16),read(32,16),read(64,16)]);
 assert.deepEqual(calls,[[0,32],[32,16],[64,16]]);
});

test('one cancelled subscriber cannot abort a shared in-flight block range',async()=>{
 let complete,signal;const read=coalesceRangeReads((start,size,s)=>{signal=s;return new Promise(resolve=>complete=()=>resolve(data.slice(start,start+size)));});
 const controller=new AbortController(),a=read(0,16,controller.signal),b=read(16,16);
 const rejected=assert.rejects(a,{name:'AbortError'});await tick();controller.abort();await rejected;
 assert.equal(signal.aborted,false);complete();assert.deepEqual(await b,data.slice(16,32));
});

test('cancelling every subscriber aborts transport and queued cancellation makes no request',async()=>{
 let calls=0,signal;const read=coalesceRangeReads((start,size,s)=>{calls++;signal=s;return new Promise((resolve,reject)=>s.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));});
 const queued=new AbortController(),q=read(64,16,queued.signal),qr=assert.rejects(q,{name:'AbortError'});queued.abort();await qr;await tick();assert.equal(calls,0);
 const a=new AbortController(),b=new AbortController();const ar=assert.rejects(read(0,16,a.signal),{name:'AbortError'}),br=assert.rejects(read(16,16,b.signal),{name:'AbortError'});
 await tick();assert.equal(calls,1);a.abort();b.abort();await Promise.all([ar,br]);assert.equal(signal.aborted,true);
});

test('short data and server failure reject every slice and allow a clean retry',async()=>{
 let attempt=0;const read=coalesceRangeReads(async(start,size)=>{attempt++;if(attempt===1)return data.slice(0,size-1);if(attempt===2)throw Error('HTTP 503');return data.slice(start,start+size);});
 for(const pattern of [/Incomplete forecast/,/HTTP 503/])await Promise.all([assert.rejects(read(0,16),pattern),assert.rejects(read(16,16),pattern)]);
 assert.deepEqual(await read(0,32),data.slice(0,32));assert.equal(attempt,3);
});

test('installation preserves separate files and runs and wraps each backend once',async()=>{
 const backends=new Map(),calls=[];
 const pool={backend(url){if(!backends.has(url))backends.set(url,{getBytes:async(start,size)=>{calls.push([url,start,size]);return data.slice(start,start+size);}});return backends.get(url);}};
 const OM={getProtocolInstance:()=>({omFileReader:{backendPool:pool}})};
 installRangeReads(OM,{});installRangeReads(OM,{});
 const first=pool.backend('run-a/t0'),fn=first.getBytes;
 assert.equal(pool.backend('run-a/t0').getBytes,fn);
 await Promise.all([first.getBytes(0,16),first.getBytes(16,16),pool.backend('run-b/t0').getBytes(0,16)]);
 assert.deepEqual(calls,[['run-a/t0',0,32],['run-b/t0',0,16]]);
});
