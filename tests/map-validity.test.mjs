import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastValidity} from '../map-validity.js';
import {MAP_AREAS} from '../map-areas.js';
import {BRIEFING_AREAS} from '../map-briefing-data.js';

test('HadUK maxima belong to the starting day and minima to the ending day',()=>{
 for(const [end,startDay,endDay] of [['2026-10-23T09:00:00Z','Thu, 22 Oct 2026','Fri, 23 Oct 2026'],['2026-11-01T09:00:00Z','Sat, 31 Oct 2026','Sun, 1 Nov 2026'],['2027-01-01T09:00:00Z','Thu, 31 Dec 2026','Fri, 1 Jan 2027']]){
  assert.ok(forecastValidity('ens_temperature_max_anomaly',end).startsWith('Attributed to '+startDay+' · VALID '));
  assert.ok(forecastValidity('ens_temperature_min_anomaly',end).startsWith('Attributed to '+endDay+' · VALID '));
  assert.match(forecastValidity('ens_temperature_max_anomaly',end),/09:00 to .*09:00 UTC$/);
 }
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
