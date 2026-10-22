import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastValidity,forecastChartTitle,forecastTimeLabel,forecastPeriod} from '../map-validity.js';
import {MAP_AREAS} from '../map-areas.js';
import {BRIEFING_AREAS} from '../map-briefing-data.js';

test('timeline shows the entire probability and accumulation period',()=>{
 const end='2026-10-24T00:00:00Z';
 for(const key of ['ens_gust_gt60kt_24h','precipitation_total_24h'])assert.equal(forecastTimeLabel(key,end),'Fri 23 Oct at 00:00 to Sat 24 Oct at 00:00');
 assert.equal(forecastTimeLabel('temperature_2m',end),'Sat 24 Oct at 00:00');
 assert.match(forecastTimeLabel('temperature_2m_max',end),/period end \(duration unspecified\)/);
});

test('native metadata bounds determine labels independently of playback cadence',()=>{
 const key='precipitation_mean',end='2026-10-24T00:00:00Z',start='2026-10-23T18:00:00Z';
 const meta={variables:[key],variable_valid_times:{[key]:[end]},variable_intervals:{[key]:{[end]:{start,end,hours:6}}}};
 assert.deepEqual(forecastPeriod(key,end,meta),{start,end});
 assert.equal(forecastTimeLabel(key,end,meta),'Fri 23 Oct at 18:00 to Sat 24 Oct at 00:00');
 assert.equal(forecastValidity(key,end,meta),'VALID 23 Oct 18:00 to 24 Oct 00:00 UTC');
});

test('HadUK maxima belong to the starting day and minima to the ending day',()=>{
 for(const [end,startDay,endDay] of [['2026-10-23T09:00:00Z','Thu 22nd','Fri 23rd'],['2026-11-01T09:00:00Z','Sat 31st','Sun 1st'],['2027-01-01T09:00:00Z','Thu 31st','Fri 1st']]){
  assert.ok(forecastValidity('ens_temperature_max_anomaly',end).startsWith('24 hr Maximum Temperature Anomaly for '+startDay+' - VALID '));
  assert.ok(forecastValidity('ens_temperature_min_anomaly',end).startsWith('24 hr Minimum Temperature Anomaly for '+endDay+' - VALID '));
  assert.match(forecastValidity('ens_temperature_max_anomaly',end),/09:00 to .*09:00 UTC$/);
 }
});

test('maximum headers advance with the selected period without a duplicate layer name',()=>{
 const field='ens_temperature_max_anomaly';
 assert.equal(forecastChartTitle(field,'Maximum temperature anomaly \u00b7 24 h','2026-10-23T09:00:00Z'),'24 hr Maximum Temperature Anomaly for Thu 22nd - VALID 22 Oct 09:00 to 23 Oct 09:00 UTC');
 assert.equal(forecastChartTitle(field,'Maximum temperature anomaly \u00b7 24 h','2026-10-24T09:00:00Z'),'24 hr Maximum Temperature Anomaly for Fri 23rd - VALID 23 Oct 09:00 to 24 Oct 09:00 UTC');
 for(const day of [11,12,13])assert.match(forecastValidity('ens_temperature_min_anomaly',`2026-10-${day}T09:00:00Z`),new RegExp('for [A-Za-z]+ '+day+'th - VALID'));
});

test('rainfall header states one valid period, without repeating the duration or ending time',()=>{
 assert.equal(forecastValidity('precipitation_total_24h','2026-10-14T03:00:00Z'),'VALID 13 Oct 03:00 to 14 Oct 03:00 UTC');
 assert.equal(forecastValidity('precipitation_total_6h','2026-10-14T06:00:00Z'),'VALID 14 Oct 00:00 to 14 Oct 06:00 UTC');
});
test('valid periods remain UTC across month, year and daylight-saving boundaries',()=>{
 assert.equal(forecastValidity('precipitation_total_24h','2026-11-01T03:00:00Z'),'VALID 31 Oct 03:00 to 1 Nov 03:00 UTC');
 assert.equal(forecastValidity('precipitation_total_24h','2027-01-01T03:00:00Z'),'VALID 31 Dec 2026 03:00 to 1 Jan 2027 03:00 UTC');
 assert.equal(forecastValidity('precipitation_total_24h','2026-10-25T03:00:00Z'),'VALID 24 Oct 03:00 to 25 Oct 03:00 UTC');
 assert.equal(forecastValidity('precipitation_total_24h','2026-10-14T04:00:00+01:00'),'VALID 13 Oct 03:00 to 14 Oct 03:00 UTC');
});
test('instantaneous charts keep their single valid time; invalid times are not printed',()=>{
 assert.equal(forecastValidity('temperature_2m','2026-10-14T03:00:00Z'),'Valid Wed 14 Oct, 03:00 UTC');
 assert.equal(forecastValidity('precipitation_total_24h','invalid'),'');
});
test('all map views share the NW Europe region around Iceland, Britain, France and southern Scandinavia',()=>{
 assert.deepEqual(BRIEFING_AREAS,MAP_AREAS);
 const area=MAP_AREAS.find(a=>a.id==='nw-europe');
 assert.deepEqual(area.size,[960,960]);
 for(const [lon,lat] of [[-22,65],[-8,53],[0,51],[2,47],[10,52],[10,60],[18,60]]){
  assert.ok(lon>area.bounds[0]&&lon<area.bounds[2]&&lat>area.bounds[1]&&lat<area.bounds[3]);
 }
 assert.ok(area.bounds[1]>=43&&area.bounds[3]<=69,'Keep the requested northern Europe crop');
});
