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
