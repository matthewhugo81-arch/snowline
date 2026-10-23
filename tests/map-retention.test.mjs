import test from 'node:test';
import assert from 'node:assert/strict';
import {ForecastRetention} from '../map-retention.js';
const url='https://weather.example/model/2026/10/23/0000Z/2026-10-24T1200.om';
const meta={eTag:'"first"',lastModified:'Fri, 23 Oct 2026 01:00:00 GMT',fileSize:100};
const store=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const response=(etag='"first"')=>new Response(null,{headers:{etag,'content-length':'100','last-modified':meta.lastModified}});

test('unchanged loaded source survives two hours and restart; new run has separate identity',async()=>{
 let now=1000,calls=0;const storage=store();
 const retention=new ForecastRetention({store:storage,now:()=>now,fetch:async(_url,options)=>{calls++;assert.equal(options.method,'HEAD');assert.equal(options.cache,'no-cache');return response();}});
 await retention.initialize();const revision=retention.revision;
 assert.equal(await retention.observe(url,meta),true);
 now+=2*3600000;await retention.check();assert.equal(calls,1);assert.equal(retention.revision,revision);assert.equal(retention.changed,false);
 const next=url.replace('/23/','/24/');assert.equal(await retention.observe(next,{...meta,eTag:'"new-run"'}),true);assert.equal(retention.revision,revision);assert.notEqual(retention.physicalURL(url),retention.physicalURL(next));
 const reopened=new ForecastRetention({store:storage,now:()=>now});await reopened.initialize();assert.equal(reopened.revision,revision);assert.equal(reopened.sources.size,2);
});

test('a correction changes the rendered namespace and physical data URL exactly once',async()=>{
 const changes=[],retention=new ForecastRetention({store:store(),fetch:async()=>response('"corrected"'),onChange:message=>changes.push(message)});
 await retention.initialize();await retention.observe(url,meta);const revision=retention.revision,physical=retention.physicalURL(url);
 await retention.check({force:true});assert.notEqual(retention.revision,revision);assert.notEqual(retention.physicalURL(url),physical);assert.equal(retention.changed,true);assert.equal(changes.length,1);
 await retention.check({force:true});assert.equal(changes.length,1);
});

test('a changed Last-Modified detects corrections when CORS does not expose ETag',async()=>{
 const retention=new ForecastRetention({store:null,fetch:async()=>new Response(null,{headers:{'content-length':'100','last-modified':'Fri, 23 Oct 2026 02:00:00 GMT'}})});
 await retention.observe(url,{...meta,eTag:null});await retention.check({force:true});assert.equal(retention.changed,true);
});

test('failed checks retain imagery, remain due, and recover without pretending success',async()=>{
 let online=false,now=1000;const statuses=[];
 const retention=new ForecastRetention({store:store(),now:()=>now,fetch:async()=>{if(!online)throw Error('Offline');return response();},onStatus:message=>statuses.push(message)});
 await retention.initialize();await retention.observe(url,meta);const revision=retention.revision;now+=3600000;
 await retention.check();assert.equal(retention.sources.get(url).checked,1000);assert.equal(retention.revision,revision);assert.match(statuses.at(-1),/incomplete/);
 online=true;await retention.check();assert.equal(retention.sources.get(url).checked,now);assert.match(statuses.at(-1),/checked for corrections/);
});

test('startup detects correction before selecting the cache without requesting a second reload',async()=>{
 let now=1000;const storage=store(),first=new ForecastRetention({store:storage,now:()=>now});await first.initialize();await first.observe(url,meta);
 now+=3600000;let reloads=0;const next=new ForecastRetention({store:storage,now:()=>now,fetch:async()=>response('"corrected"'),onChange:()=>reloads++});
 await next.initialize();assert.notEqual(next.revision,first.revision);assert.equal(next.changed,false);assert.equal(reloads,0);
});

test('physical reader sees versioned URLs; corrected metadata cannot return stale decoded values',async()=>{
 const retention=new ForecastRetention({store:store()});await retention.initialize();
 let metadata={...meta},called=0;const urls=[];
 const pool={backend:()=>metadata,withReader:async(url,_cache,callback)=>{urls.push(url);return callback({});}};
 assert.equal(retention.install(pool),true);
 assert.equal(await pool.withReader(url,{},()=>++called),1);assert.match(urls[0],/snowline_revision=/);
 metadata={...meta,eTag:'"corrected"'};await assert.rejects(pool.withReader(url,{},()=>++called),{name:'AbortError'});assert.equal(called,1);assert.equal(retention.changed,true);
});

test('immutable commit files skip mutable probes and preserve their exact URL',async()=>{
 const retention=new ForecastRetention({store:store(),fetch:()=>{throw Error('No check expected');}});await retention.initialize();
 const immutable='https://raw.githubusercontent.com/owner/repo/'+'a'.repeat(40)+'/ensemble-data/source.om.png';
 await retention.observe(immutable,meta);assert.equal(retention.physicalURL(immutable),immutable);assert.equal(retention.sources.size,0);await retention.check({force:true});
});

test('another tab observes a correction and adopts the new namespace',async()=>{
 const storage=store(),a=new ForecastRetention({store:storage});await a.initialize();await a.observe(url,meta);
 let reloads=0;const b=new ForecastRetention({store:storage,onChange:()=>reloads++});await b.initialize();
 a.invalidate('Correction');b.sync();assert.equal(reloads,1);assert.equal(b.revision,a.revision);assert.equal(b.changed,true);
});

test('default source checks preserve the native browser fetch receiver',async()=>{
 const original=globalThis.fetch;let called=0;
 globalThis.fetch=function(){assert.equal(this,globalThis);called++;return Promise.resolve(response());};
 try{const retention=new ForecastRetention({store:null});await retention.observe(url,meta);await retention.check({force:true});assert.equal(called,1);assert.equal(retention.changed,false);}
 finally{globalThis.fetch=original;}
});

test('unavailable persistent storage falls back to private retention without reload loops',async()=>{
 const retention=new ForecastRetention({store:{getItem:()=>null,setItem:()=>{throw Error('Quota');}}});await retention.initialize();
 assert.equal(retention.persistent,false);assert.equal(await retention.observe(url,meta),true);assert.equal(retention.changed,false);
});

test('slow startup checks stop at a shared deadline and leave every unverified file due',async()=>{
 let now=1000;const storage=store(),first=new ForecastRetention({store:storage,now:()=>now});await first.initialize();
 for(let i=0;i<20;i++)await first.observe(url+'?frame='+i,meta);
 now+=3600000;let calls=0;const statuses=[];
 const next=new ForecastRetention({store:storage,now:()=>now,startupBudget:10,onStatus:message=>statuses.push(message),fetch:async(_url,{signal})=>{
  calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 }});
 await next.initialize();assert.equal(calls,2);assert.equal(next.revision,first.revision);assert.equal(next.changed,false);
 assert.ok([...next.sources.values()].every(entry=>entry.checked===1000));assert.match(statuses.at(-1),/incomplete/);
 next.fetch=async()=>response();await next.check();assert.ok([...next.sources.values()].every(entry=>entry.checked===now));
});

test('a correction still invalidates after a timed-out startup check is retried',async()=>{
 let now=1000;const storage=store(),first=new ForecastRetention({store:storage,now:()=>now});await first.initialize();await first.observe(url,meta);now+=3600000;
 let changes=0;const next=new ForecastRetention({store:storage,now:()=>now,startupBudget:5,onChange:()=>changes++,fetch:async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
 await next.initialize();assert.equal(changes,0);assert.equal(next.revision,first.revision);
 next.fetch=async()=>response('"corrected"');await next.check();assert.equal(changes,1);assert.notEqual(next.revision,first.revision);
});
