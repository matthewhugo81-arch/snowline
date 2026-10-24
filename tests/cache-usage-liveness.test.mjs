import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedForecastStorage} from '../map-cache-storage.js';

test('a late disk write cannot resurrect closed tabs in shared cache statistics',()=>{
 const storage=Object.create(SharedForecastStorage.prototype),messages=[];
 Object.assign(storage,{name:'test',stats:{windows:1,bytes:4},activeWindows:1,onChange(){},onEvict(){},channel:{postMessage:m=>messages.push(m)}});
 storage.notify([],{windows:3,bytes:8,entries:2,budget:32});
 assert.equal(storage.stats.windows,1);assert.equal(storage.stats.activeWindows,1);
 assert.equal(storage.stats.bytes,8);assert.equal(storage.stats.entries,2);
 storage.applyUsage(messages[0].stats);
 assert.equal(storage.stats.windows,1);assert.equal(storage.stats.bytes,8);
});
