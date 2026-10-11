import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastWorkerPool} from '../vendor/forecast-worker-pool.mjs';
class Worker{
 messages=[];
 postMessage(message){this.messages.push(message);}
 reply(message){this.onmessage({data:message});}
}
test('late cancellation and tile replies cannot settle a replacement request',async()=>{
 for(const type of ['cancelled','returnImage']){
  const worker=new Worker(),pool=new ForecastWorkerPool([worker]),old=new AbortController();
  const cancelled=pool.requestTile({type:'getImage',key:'same model/time/area/tile',signal:old.signal});
  const oldKey=worker.messages[0].key;old.abort();assert.deepEqual(await cancelled,{cancelled:true});
  let settled=false;
  const next=pool.requestTile({type:'getImage',key:'same model/time/area/tile'}).then(value=>{settled=true;return value;});
  const nextKey=worker.messages.at(-1).key;assert.notEqual(nextKey,oldKey);
  worker.reply({type,key:oldKey,tile:new Uint8Array([1]).buffer});await Promise.resolve();
  assert.equal(settled,false,'The new selection must wait for its own result');
  worker.reply({type:'returnImage',key:nextKey,tile:new Uint8Array([2]).buffer});
  assert.deepEqual(new Uint8Array((await next).data),new Uint8Array([2]));
  assert.equal(pool.pendingRequests.size,0);assert.equal(pool.dispatches.size,0);
 }
});
test('panels share live work but cancel independently and receive owned buffers',async()=>{
 const worker=new Worker(),pool=new ForecastWorkerPool([worker]),first=new AbortController();
 const a=pool.requestTile({type:'getArrayBuffer',key:'pressure',signal:first.signal});
 const b=pool.requestTile({type:'getArrayBuffer',key:'pressure'});
 const c=pool.requestTile({type:'getArrayBuffer',key:'pressure'});
 first.abort();assert.equal((await a).cancelled,true);assert.equal(worker.messages.length,1);
 worker.reply({type:'returnArrayBuffer',key:worker.messages[0].key,tile:new Uint8Array([7]).buffer});
 const [second,third]=await Promise.all([b,c]);assert.notEqual(second.data,third.data);
 assert.deepEqual(new Uint8Array(third.data),new Uint8Array([7]));
});
test('a worker crash rejects only its active jobs and the next request can retry',async()=>{
 const a=new Worker(),b=new Worker(),pool=new ForecastWorkerPool([a,b]);
 const failed=pool.requestTile({type:'getImage',key:'a'}),other=pool.requestTile({type:'getImage',key:'b'});
 const rejected=assert.rejects(failed,/Worker error.*a/);a.onerror({message:'test crash'});await rejected;
 b.reply({type:'returnImage',key:b.messages[0].key,tile:new ArrayBuffer(1)});assert.equal((await other).cancelled,false);
 const retry=pool.requestTile({type:'getImage',key:'a'});a.reply({type:'returnImage',key:a.messages.at(-1).key,tile:new ArrayBuffer(1)});
 assert.equal((await retry).cancelled,false);
});
