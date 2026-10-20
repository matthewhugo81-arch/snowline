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

test('field-specific arrivals refresh a run even within its unchanged overall horizon',()=>{
 const t=hour=>new Date(Date.UTC(2026,9,20,hour)).toISOString();
 const first={domain:'ecmwf_ifs',reference_time:t(0),completed:false,variables:['temperature_2m','pressure_msl'],valid_times:[0,3,6].map(t),variable_valid_times:{temperature_2m:[0,3,6].map(t),pressure_msl:[0,3].map(t)}};
 // Only pressure coverage changes; the run's overall times and fields stay fixed.
 const arrived={...first,variable_valid_times:{...first.variable_valid_times,pressure_msl:[t(6)]}};
 const retained=retainRunProgress(first,arrived);
 assert.deepEqual(retained.valid_times,first.valid_times);
 assert.deepEqual(retained.variables,first.variables);
 assert.deepEqual(retained.sources[0].variable_valid_times.pressure_msl,[0,3,6].map(t));
 assert.notEqual(runSignature(first),runSignature(retained),'A newly supplied field time must trigger the panel refresh');
 assert.equal(runSignature(retained),runSignature(retainRunProgress(retained,first)),'A stale response cannot remove newly supplied field times');
 const newer={...first,reference_time:t(12),valid_times:[12,15].map(t),variable_valid_times:{temperature_2m:[12,15].map(t),pressure_msl:[t(12)]}};
 assert.equal(retainRunProgress(retained,newer),newer,'A new initialization never inherits old-cycle field times');
 assert.equal(retainRunProgress(newer,retained),newer,'An older initialization cannot replace the new run');
});

test('field reporting-period metadata also participates in live run refreshes',()=>{
 const time='2026-10-20T06:00:00Z';
 const first={domain:'ensemble',reference_time:'2026-10-20T00:00:00Z',completed:false,variables:['precipitation'],valid_times:[time],variable_valid_times:{precipitation:[time]}};
 const arrived={...first,variable_intervals:{precipitation:{[time]:6}}};
 const retained=retainRunProgress(first,arrived);
 assert.deepEqual(retained.valid_times,first.valid_times);
 assert.deepEqual(retained.sources[0].variable_intervals,arrived.variable_intervals);
 assert.notEqual(runSignature(first),runSignature(retained));
 assert.equal(runSignature(retained),runSignature(retainRunProgress(retained,first)),'Known period metadata survives a stale response');
});
