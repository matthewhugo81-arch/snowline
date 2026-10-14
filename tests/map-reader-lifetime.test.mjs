import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';

const reader=OM.getProtocolInstance(OM.defaultOmProtocolSettings).omFileReader;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('a cancelled paired read retains both native readers until both operations settle',async()=>{
 const first=deferred(),second=deferred(),disposed=[];
 const children=[first,second].map((job,i)=>({getDimensions:()=>[2,2],read:()=>job.promise,scaleFactor:()=>1,dispose:()=>disposed.push(i)}));
 const file={getChildByName:async key=>children[key==='temperature'?0:1]};
 const rule={getSourceVars:()=>['temperature','humidity'],scaleFactor:'primary',process:()=>{throw Error('Cancelled data must not be processed');}};
 const result=reader.readWithDerivationRule(file,'theta',rule,null,new AbortController().signal);
 const rejected=assert.rejects(result,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));first.reject(new DOMException('Aborted','AbortError'));
 await new Promise(resolve=>setImmediate(resolve));
 const premature=[...disposed];second.resolve(new Float32Array(4));await rejected;
 assert.deepEqual(premature,[],'An outstanding native read must not use a disposed WASM reader');
 assert.deepEqual(disposed,[0,1]);
});

test('prefetch failure keeps the parent file alive until sibling reads settle',async()=>{
 const first=deferred(),second=deferred();let parentClosed=false;
 const children=[first,second].map(job=>({getDimensions:()=>[2,2],readPrefetch:()=>job.promise,dispose(){}}));
 const fixture=Object.create(reader);
 fixture.allDerivationRules=[{pattern:'paired',getSourceVars:()=>['a','b']}];
 fixture.withReader=async(url,callback)=>{try{return await callback({getChildByName:async key=>children[key==='a'?0:1]});}finally{parentClosed=true;}};
 const result=fixture.prefetchVariable('fixture','paired'),rejected=assert.rejects(result,/temporary failure/);
 await new Promise(resolve=>setImmediate(resolve));first.reject(Error('temporary failure'));
 await new Promise(resolve=>setImmediate(resolve));const premature=parentClosed;
 second.resolve();await rejected;assert.equal(premature,false);assert.equal(parentClosed,true);
});
