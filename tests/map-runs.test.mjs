import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseRun,runCycleUTC,runLabel} from '../map-runs.js';
test('run dates and cycles use UTC',()=>{
 assert.equal(runCycleUTC('2026-10-10T06:00:00Z'),'0600Z');
 assert.equal(runCycleUTC('2026-10-10T00:00:00Z'),'0000Z');
 assert.match(runLabel({reference_time:'2026-10-10T06:00:00Z'}),/10 Oct · 0600Z/);
});
test('reject incomplete newest metadata rather than silently using older runs',async()=>{
 const meta={reference_time:'2026-10-10T06:00:00Z',completed:true,variables:['temperature_2m'],valid_times:['2026-10-10T07:00Z']};
 assert.equal(await chooseRun(meta),meta);
 await assert.rejects(chooseRun({...meta,completed:false}),/incomplete/);
 await assert.rejects(chooseRun({...meta,valid_times:[]}),/incomplete/);
});
