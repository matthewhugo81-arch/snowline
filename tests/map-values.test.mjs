import test from 'node:test';
import assert from 'node:assert/strict';
import {createValueReader} from '../map-values.js';

test('cached imagery still yields point values after its decoded grid is evicted',async()=>{
 let loaded=false,calls=0;
 const OM={getValueFromLatLong:async()=>{if(!loaded)throw Error('State not found');return{value:-3.5};},omProtocol:async(params)=>{assert.match(params.url,/\/4\/7\/5$/);calls++;await Promise.resolve();loaded=true;return{data:new ArrayBuffer(0)};}};
 const read=createValueReader(OM,{}),url='om://https://example.com/file.om?variable=temperature_850hPa_mean';
 assert.deepEqual(await Promise.all([read(55,-3,url,4.2),read(55,-3,url,4.2)]),[{value:-3.5},{value:-3.5}]);
 assert.equal(calls,1,'Concurrent readouts share the restored grid');
 assert.deepEqual(await read(55,-3,url,4.2),{value:-3.5});assert.equal(calls,1);
});

test('zero spread is a valid readout and is never treated as missing',async()=>{
 const read=createValueReader({getValueFromLatLong:async()=>({value:0}),omProtocol:()=>{throw Error('Unexpected reload');}},{});
 assert.deepEqual(await read(55,-3,'om://zero',4),{value:0});
});
