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
 const url=base+'snowline_ecmwf_extra/run/frame.om';
 for(const key of ['wind_speed_10m_mean','wind_speed_250hPa_mean','wind_speed_850hPa_spread']){
  assert.deepEqual(await reader.readVariable(url,key,ranges,signal),{values,directions:undefined});
  assert.deepEqual(calls.splice(0),[['file',url+'.png'],['scalar',key]]);
 }
 for(const [source,key] of [[url,'wind_speed_10m'],[url,'temperature_2m_mean'],[base+'other/run/frame.om','wind_speed_10m_mean'],['https://other.test/snowline_ecmwf_extra/run/frame.om','wind_speed_10m_mean']]){
  assert.equal(await reader.readVariable(source,key,ranges,signal),'normal');
  assert.deepEqual(calls.splice(0),[['normal',source,key]]);
 }
});
