import test from 'node:test';
import assert from 'node:assert/strict';
import {MODELS} from '../data.js';
import {ukvCoverageText} from '../ukv-run-info.js';
import {chooseRun} from '../map-runs.js';
const run=(reference_time,end)=>({reference_time,completed:true,variables:['precipitation'],valid_times:[reference_time,end]});
test('UKV is named explicitly while its API identifier stays unchanged',()=>{
 assert.equal(MODELS.find(m=>m.id==='ukmo_uk_deterministic_2km').name,'UKMO UKV 2 km');
});
test('0200Z nowcast explains the 1400Z endpoint and does not change selected data',async()=>{
 const meta=run('2026-10-10T02:00:00Z','2026-10-10T14:00Z');const before=structuredClone(meta);
 assert.match(ukvCoverageText(meta),/12-hour nowcast run/);
 assert.equal(await chooseRun(meta),meta);assert.deepEqual(meta,before);
});
test('longer UKV run families respect UTC and date rollover',()=>{
 assert.match(ukvCoverageText(run('2026-10-10T00:00Z','2026-10-12T06:00Z')),/54-hour short-range/);
 assert.match(ukvCoverageText(run('2026-10-10T03:00Z','2026-10-15T03:00Z')),/120-hour medium-range/);
 assert.match(ukvCoverageText(run('2026-10-10T15:00Z','2026-10-15T15:00Z')),/120-hour medium-range/);
});
test('partial or malformed feeds never claim the scheduled full length',()=>{
 assert.match(ukvCoverageText(run('2026-10-10T03:00Z','2026-10-10T14:00Z')),/T\+11 hours/);
 assert.match(ukvCoverageText(null),/unavailable/);
 assert.match(ukvCoverageText({reference_time:'bad',valid_times:[]}),/unavailable/);
});
