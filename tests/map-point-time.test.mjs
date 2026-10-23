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

test('period products show compact 6, 12 and 24 hour ranges in labels and headings',()=>{
 for(const [field,time,stamp] of [
  ['ens_gust_gt60kt_6h','2026-10-23T18:00:00Z','Fri 23 Oct 1200-1800'],
  ['ens_rain_ge25mm_6h','2026-10-23T18:00:00Z','Fri 23 Oct 1200-1800'],
  ['ens_rain_ge50mm_12h','2026-10-23T18:00:00Z','Fri 23 Oct 0600-1800'],
  ['ens_gust_gt60kt_24h','2026-10-24T18:00:00Z','Fri 23 Oct 1800-Sat 24 Oct 1800'],
  ['precipitation_total_6h','2026-10-23T18:00:00Z','Fri 23 Oct 1200-1800'],
  ['precipitation_total_24h','2027-01-01T00:00:00Z','Thu 31 Dec 2026 0000-Fri 1 Jan 2027 0000']
 ]){
  assert.equal(forecastPointTimeLabel(field,time),stamp);
  assert.equal(forecastPointChartTitle(field,'Chart',time),'Chart · VALID '+stamp+' UTC');
 }
});

test('explicit metadata bounds take precedence and unrelated fields remain single-time',()=>{
 const field='ens_rain_ge25mm_6h',end='2026-10-23T18:00:00Z',start='2026-10-23T15:00:00Z';
 const meta={variables:[field],variable_valid_times:{[field]:[end]},variable_intervals:{[field]:{[end]:{start,end,hours:3}}}};
 assert.equal(forecastPointTimeLabel(field,end,{sources:[meta]}),'Fri 23 Oct 1500-1800');
 for(const key of ['temperature_2m','wind_speed_10m','geopotential_height_500hPa','precipitation']){
  assert.equal(forecastPointTimeLabel(key,end,meta),'Fri 23 Oct 1800');
 }
});

test('anomaly annotations retain their attributed day and complete UTC period',()=>{
 assert.equal(forecastPointChartTitle('ens_temperature_max_anomaly','Anomaly','2026-10-24T09:00:00Z'),
  '24 hr Maximum Temperature Anomaly for Fri 23rd - VALID Fri 23 Oct 0900-Sat 24 Oct 0900 UTC');
 assert.equal(forecastPointTimeLabel('ens_gust_gt60kt_24h','2026-10-25T03:00:00Z'),
  'Sat 24 Oct 0300-Sun 25 Oct 0300');
});
