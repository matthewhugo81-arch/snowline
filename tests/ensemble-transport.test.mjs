import test from 'node:test';
import assert from 'node:assert/strict';
import {installEnsembleTransport} from '../map-ensemble-transport.js';

test('only own binary transport paths change; callbacks, settings and other feeds survive',async()=>{
 const urls=[],settings={domainOptions:[]},callback=()=>42;
 const reader={withReader(url,fn){assert.equal(this,reader);urls.push(url);assert.equal(fn,callback);return fn();}};
 installEnsembleTransport({getProtocolInstance(s){assert.equal(s,settings);return{omFileReader:reader};}},settings,'https://site.test/ensemble-data/');
 const own='https://site.test/ensemble-data/model/2026/10/11/0000Z/2026-10-11T0000.om';
 assert.equal(await reader.withReader(own,callback),42);
 await reader.withReader('https://openmeteo.s3.amazonaws.com/data_spatial/model/frame.om',callback);
 await reader.withReader('https://site.test/ensemble-data/model/latest.json',callback);
 assert.deepEqual(urls,[own+'.png','https://openmeteo.s3.amazonaws.com/data_spatial/model/frame.om','https://site.test/ensemble-data/model/latest.json']);
});

test('EC ensemble scalar wind reads preserve ranges and cancellation without a fabricated direction',async()=>{
 const calls=[],file={},signal=new AbortController().signal,ranges=[[0,2],[0,3]],values=new Float32Array([4,7]);
 const reader={
  withReader(url,fn){calls.push(['file',url]);return fn(file);},
  readSimpleVariable(f,key,r,s){assert.equal(f,file);assert.equal(r,ranges);assert.equal(s,signal);calls.push(['scalar',key]);return{values,directions:undefined};},
  readVariable(url,key,r,s){assert.equal(this,reader);assert.equal(r,ranges);assert.equal(s,signal);calls.push(['normal',url,key]);return 'normal';}
 };
 const OM={getProtocolInstance(){return{omFileReader:reader};}},base='https://site.test/ensemble-data/';
 installEnsembleTransport(OM,{},base);installEnsembleTransport(OM,{},base);
 const url=base+'snowline_ecmwf_extra_v2/run/frame.om';
 for(const key of ['wind_speed_10m_mean','wind_speed_250hPa_mean','wind_speed_850hPa_spread']){
  assert.deepEqual(await reader.readVariable(url,key,ranges,signal),{values,directions:undefined});
  assert.deepEqual(calls.splice(0),[['file',url+'.png'],['scalar',key]]);
 }
 const archived='https://matthewhugo81-arch.github.io/snowline-ensembles/ensemble-data/snowline_ecmwf_extra_v2/run/frame.om';
 assert.deepEqual(await reader.readVariable(archived,'wind_speed_850hPa_mean',ranges,signal),{values,directions:undefined});
 assert.deepEqual(calls.splice(0),[['file',archived+'.png'],['scalar','wind_speed_850hPa_mean']]);
 for(const [source,key] of [[url,'wind_speed_10m'],[url,'temperature_2m_mean'],[base+'other/run/frame.om','wind_speed_10m_mean'],['https://other.test/snowline_ecmwf_extra_v2/run/frame.om','wind_speed_10m_mean']]){
  assert.equal(await reader.readVariable(source,key,ranges,signal),'normal');
  assert.deepEqual(calls.splice(0),[['normal',source,key]]);
 }
});

test('companion MOGREPS winds remain scalar and use the binary-safe transport suffix',async()=>{
 const calls=[],reader={
  withReader(url,fn){calls.push(url);return fn({});},
  readSimpleVariable(file,key){return {key,directions:undefined};},
  readVariable(){throw Error('Must not request a fabricated direction field');}
 };
 const base='https://site.test/ensemble-data/';
 installEnsembleTransport({getProtocolInstance:()=>({omFileReader:reader})},{},base);
 for(const root of [base,'https://matthewhugo81-arch.github.io/snowline-ensembles/ensemble-data/'])for(const run of ['2026/10/20/0000Z','2026/10/19/1800Z']){
 const url=root+'snowline_mogreps_global/'+run+'/frame.om';
 for(const key of ['wind_speed_300hPa_mean','wind_speed_200hPa_spread']){
  assert.deepEqual(await reader.readVariable(url,key),{key,directions:undefined});
  assert.equal(calls.pop(),url+'.png');
 }
 }
});

test('compact ENS reads retain exact file identity and share a bounded cache without changing other feeds',async()=>{
 const calls=[],caches=[],normalCache={name:'native-model-cache'},base='https://site.test/ensemble-data/';
 const companion='https://matthewhugo81-arch.github.io/snowline-ensembles/ensemble-data/';
 const reader={cache:normalCache,
  withReader(url,callback){calls.push({url,cache:this.cache});return callback(url);},
  backendPool:{withReader(url,cache,callback){calls.push({url,cache});return callback(url);}}
 };
 const OM={getProtocolInstance:()=>({omFileReader:reader}),LruBlockCache:class{constructor(size,count){this.size=size;this.count=count;caches.push(this);}}};
 installEnsembleTransport(OM,{},base);installEnsembleTransport(OM,{},base);
 assert.equal(caches.length,1);assert.equal(caches[0].size,65536);assert.ok(caches[0].size*caches[0].count<=16*1024*1024);
 for(const prefix of [base,companion])for(const domain of ['snowline_gefs_ensemble','snowline_ecmwf_ensemble','snowline_gefs_extra_v2','snowline_ecmwf_extra_v2','snowline_mogreps_global']){
  for(const run of ['0000Z','1200Z']){
   const url=prefix+domain+'/2026/10/20/'+run+'/2026-10-21T0000.om';
   assert.equal(await reader.withReader(url,value=>value),url+'.png');
   assert.deepEqual(calls.pop(),{url:url+'.png',cache:caches[0]});
  }
 }
 for(const [url,transport] of [
  [base+'snowline_mogreps_uk/run/frame.om',base+'snowline_mogreps_uk/run/frame.om.png'],
  [base+'snowline_gem_upper/run/frame.om',base+'snowline_gem_upper/run/frame.om.png'],
  [base+'snowline_gefs_ensemble_other/run/frame.om',base+'snowline_gefs_ensemble_other/run/frame.om.png'],
  [base+'snowline_gefs_ensemble/latest.json',base+'snowline_gefs_ensemble/latest.json'],
  ['https://other.test/snowline_gefs_ensemble/frame.om','https://other.test/snowline_gefs_ensemble/frame.om'],
  ['https://openmeteo.s3.amazonaws.com/data_spatial/ncep_gfs013/frame.om','https://openmeteo.s3.amazonaws.com/data_spatial/ncep_gfs013/frame.om']
 ]){
  assert.equal(await reader.withReader(url,value=>value),transport);
  assert.deepEqual(calls.pop(),{url:transport,cache:normalCache});
 }
 assert.equal(reader.cache,normalCache);
});

test('overlapping ENS and native reads keep their own caches and preserve scalar cancellation/errors',async()=>{
 const base='https://site.test/ensemble-data/',normalCache={},calls=[];let release;
 const normalFile={},ensFile={};
 const reader={cache:normalCache,
  withReader(url,callback){calls.push({url,cache:this.cache});return callback(normalFile);},
  backendPool:{withReader(url,cache,callback){calls.push({url,cache});return callback(ensFile);}},
  readSimpleVariable(file,key,ranges,signal){assert.equal(file,ensFile);return new Promise((resolve,reject)=>{
   release=()=>resolve({key,ranges});signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });},
  readVariable(){assert.fail('The ensemble scalar must not read a direction');}
 };
 const OM={getProtocolInstance:()=>({omFileReader:reader}),LruBlockCache:class{}};
 installEnsembleTransport(OM,{},base);
 const controller=new AbortController(),ranges=[{start:1,end:3},{start:2,end:4}];
 const pending=reader.readVariable(base+'snowline_ecmwf_extra_v2/run/frame.om','wind_speed_850hPa_mean',ranges,controller.signal);
 assert.equal(await reader.withReader('https://native.test/frame.om',file=>file),normalFile);
 assert.equal(calls[1].cache,normalCache);assert.notEqual(calls[0].cache,normalCache);assert.equal(reader.cache,normalCache);
 const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;release();
 await assert.rejects(reader.withReader(base+'snowline_gefs_ensemble/run/frame.om',async()=>{throw Error('Native read failed');}),/Native read failed/);
});
