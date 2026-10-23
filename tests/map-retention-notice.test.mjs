import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ForecastRetention} from '../map-retention.js';
const url='https://weather.example/run/frame.om',meta={eTag:'"original"',fileSize:100};
const store=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};

test('a correction keeps both open tabs on their current readers and only changes the next page load',async()=>{
 const storage=store(),changes=[0,0];
 const a=new ForecastRetention({store:storage,deferChanges:true,onChange:()=>changes[0]++});await a.initialize();await a.observe(url,meta);
 const b=new ForecastRetention({store:storage,deferChanges:true,onChange:()=>changes[1]++});await b.initialize();
 const revision=a.revision,physical=a.physicalURL(url);
 a.invalidate('Source updated');b.sync();b.sync();a.sync();
 assert.deepEqual(changes,[1,1]);assert.equal(a.revision,revision);assert.equal(b.revision,revision);assert.equal(a.physicalURL(url),physical);
 assert.equal(await a.observe(url,meta),true);assert.equal(await b.observe(url,meta),true);
 const nextRun=url.replace('/run/','/next-run/');assert.equal(await b.observe(nextRun,meta),true,'New dated runs can still load');
 assert.equal(await b.observe(url,{...meta,eTag:'"revised"'}),false,'Changed files cannot mix old and new values');
 const reopened=new ForecastRetention({store:storage,deferChanges:true});await reopened.initialize();assert.notEqual(reopened.revision,revision);assert.equal(reopened.changed,false);
 assert.equal(await reopened.observe(url,{...meta,eTag:'"revised"'}),true);
});

test('deferred source changes do not strand unchanged, archived or new-run native reads',async()=>{
 const retention=new ForecastRetention({store:store(),deferChanges:true});await retention.initialize();
 let current={...meta};const pool={backend:()=>current,withReader:async(url,cache,callback)=>callback({})};retention.install(pool);
 assert.equal(await pool.withReader(url,{},()=>42),42);retention.invalidate('Source updated');
 assert.equal(await pool.withReader(url,{},()=>43),43);
 const archived='https://raw.githubusercontent.com/owner/repo/'+'a'.repeat(40)+'/frame.om';assert.equal(await pool.withReader(archived,{},()=>44),44);
 current={...meta,eTag:'"changed"'};await assert.rejects(pool.withReader(url,{},()=>45),/Weather source changed/);
 assert.equal(await pool.withReader(url.replace('/run/','/new-run/'),{},()=>46),46);
});

test('interactive maps neither reload automatically nor add a source reload button',async()=>{
 const source=await readFile(new URL('../maps.js',import.meta.url),'utf8');
 assert.match(source,/new ForecastRetention\(\{deferChanges:true/);
 assert.doesNotMatch(source,/location\.reload\s*\(/);
 assert.doesNotMatch(source,/reload-updated-charts/);
 const handler=source.split('retention.onChange=message=>{')[1].split('\n};')[0];
 assert.doesNotMatch(handler,/pauseAnimation|\.stop\(|\.abort\(|timeGeneration/);
});
