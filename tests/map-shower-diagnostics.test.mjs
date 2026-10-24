import test from 'node:test';
import assert from 'node:assert/strict';
import {validateShowerDiagnostic,showerAt,showerDiagnosticURL} from '../map-shower-diagnostics.js';
import {precipitationSymbols} from '../map-precipitation-symbols.js';
const file='https://openmeteo.s3.amazonaws.com/data_spatial/ukmo_uk_deterministic_2km/2026/10/24/0900Z/2026-10-24T1800.om';
const doc={version:1,domain:'ukmo_uk_deterministic_2km',reference_time:'2026-10-24T09:00:00Z',valid_time:'2026-10-24T18:00:00Z',method:'estimated-texture',grid:{nx:2,ny:2,lonMin:0,latMin:50,dx:1,dy:1},flags:'0121'};
test('diagnostics reject mismatched runs, times, methods and malformed grids',()=>{
 assert.ok(validateShowerDiagnostic(doc,file));
 for(const change of [{reference_time:'2026-10-24T06:00:00Z'},{valid_time:'2026-10-24T19:00:00Z'},{method:'native-rate'},{flags:'222'},{flags:'xxxx'},{grid:{...doc.grid,dx:0}}])assert.equal(validateShowerDiagnostic({...doc,...change},file),null);
 assert.equal(showerDiagnosticURL(file.replace('ukmo_uk_deterministic_2km','dwd_icon')),null);
});
test('categorical nearest-cell sampling does not extend beyond coverage',()=>{
 assert.equal(showerAt(doc,51,0),true);assert.equal(showerAt(doc,50,1),false);
 assert.equal(showerAt(doc,55,0),false);assert.equal(showerAt(null,51,0),false);
});
test('compact products decode exactly and malformed runs fail closed',()=>{
 const packed={...doc,flags:undefined,flags_rle:[[0,1],[1,1],[2,1],[1,1]]};
 assert.equal(validateShowerDiagnostic(packed,file).flags,doc.flags);
 for(const flags_rle of [[[2,1000001]],[[3,4]],[[2,-1]],[[2,3]],[[2,1.5]]])assert.equal(validateShowerDiagnostic({...packed,flags_rle},file),null);
});
test('shower guidance preserves total water, interval rate and native phase',()=>{
 const v={precipitation:6,snowfall_water_equivalent:6,theta_w:4};
 const before=precipitationSymbols(v,3,'estimated')[0];
 const after=precipitationSymbols({...v,shower_diagnostic:true},3,'estimated')[0];
 assert.equal(after.kind,'snow');assert.equal(after.amount,before.amount);assert.equal(after.rate,2);assert.equal(after.mechanism,'convective');
 assert.equal(before.mechanism,'unseparated');
 assert.deepEqual(precipitationSymbols({precipitation:0,shower_diagnostic:true},1,'unresolved'),[]);
});
