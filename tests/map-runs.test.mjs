import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseRun,runCycleUTC,runLabel,runAvailability,retainRunProgress,runSignature} from '../map-runs.js';
test('run dates and cycles use UTC',()=>{
 assert.equal(runCycleUTC('2026-10-10T06:00:00Z'),'0600Z');
 assert.equal(runCycleUTC('2026-10-10T00:00:00Z'),'0000Z');
 assert.match(runLabel({reference_time:'2026-10-10T06:00:00Z'}),/10 Oct · 0600Z/);
});
test('publish new forecast hours immediately, without requiring a complete run',async()=>{
 const meta={reference_time:'2026-10-10T06:00:00Z',completed:true,variables:['temperature_2m'],valid_times:['2026-10-10T07:00Z']};
 assert.equal(await chooseRun(meta),meta);
 assert.equal((await chooseRun({...meta,completed:false})).completed,false);
 await assert.rejects(chooseRun({...meta,valid_times:[]}),/No published/);
 const newer={...meta,reference_time:'2026-10-10T12:00:00Z',completed:false,valid_times:['2026-10-10T13:00Z']};
 assert.equal(await chooseRun(meta,newer),newer);
 assert.equal(await chooseRun(newer,meta),newer,'A stale in-progress pointer cannot roll back a completed newer run');
 assert.equal(await chooseRun(meta,{...newer,valid_times:[]}),meta,'A run with no files yet does not displace usable data');
 assert.match(runAvailability(newer),/Updating · to T\+1 h/);
});
test('same-cycle refresh keeps available hours and never splices cycles',()=>{
 const first={domain:'gfs',reference_time:'2026-10-10T06:00Z',completed:false,variables:['temperature_2m'],valid_times:['2026-10-10T06:00Z','2026-10-10T07:00Z']};
 const more={...first,valid_times:[...first.valid_times,'2026-10-10T08:00Z']};
 assert.deepEqual(retainRunProgress(more,first).valid_times,more.valid_times);
 assert.notEqual(runSignature(first),runSignature(more));
 const fresh={...first,reference_time:'2026-10-10T12:00Z',valid_times:['2026-10-10T12:00Z']};
 assert.equal(retainRunProgress(more,fresh),fresh);
 assert.equal(retainRunProgress(fresh,more),fresh);
 assert.equal(retainRunProgress({...first,completed:true},first).completed,true);
});
