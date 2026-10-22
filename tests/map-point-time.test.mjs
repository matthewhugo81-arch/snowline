import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastPointTimeLabel,forecastPointChartTitle} from '../map-validity.js';
test('main map headings and time controls show one UTC valid time across midnight',()=>{
 const meta={domain:'ukmo_uk_deterministic_2km'};
 for(const [time,stamp] of [['2026-10-23T11:00:00Z','Fri 23 Oct 1100'],['2026-10-24T00:00:00Z','Sat 24 Oct 0000']]){
  assert.equal(forecastPointTimeLabel('precipitation',time,meta),stamp);
  assert.equal(forecastPointChartTitle('precipitation','Rain',time,meta),'Rain · VALID '+stamp+' UTC');
 }
 assert.equal(forecastPointTimeLabel('precipitation','invalid',meta),'');
});
