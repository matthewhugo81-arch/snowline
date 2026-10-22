import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheDiskBudget} from '../map-cache-storage.js';
const MiB=1024*1024;
test('adaptive disk capacity stays conservative on phones and low-memory devices',()=>{
 assert.equal(cacheDiskBudget({quota:20*1024*MiB}),1024*MiB);
 assert.equal(cacheDiskBudget({quota:20*1024*MiB,mobile:true}),256*MiB);
 assert.equal(cacheDiskBudget({quota:20*1024*MiB,deviceMemory:2}),256*MiB);
 assert.equal(cacheDiskBudget({}),256*MiB);
 assert.equal(cacheDiskBudget({quota:500*MiB,usage:480*MiB}),10*MiB);
 assert.equal(cacheDiskBudget({quota:500*MiB,usage:600*MiB}),0);
});
