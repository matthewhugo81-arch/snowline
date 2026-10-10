import test from 'node:test';
import assert from 'node:assert/strict';
import {displayUnit,displayValue,displayStops} from '../map-wind-units.js';
import {gridValueLabel} from '../map-grid.js';
test('wind speeds and gusts are shown in mph while native thresholds remain intact',()=>{
 for(const key of ['wind_speed_10m','wind_speed_300hPa','wind_gusts_10m']){
  const f={key,unit:'m/s',stops:[0,5,10]};
  assert.equal(displayUnit(f),'mph');
  assert.ok(Math.abs(displayValue(10,f)-22.36936)<0.0001);
  assert.deepEqual(displayStops(f),[0,11.2,22.4]);
  assert.equal(gridValueLabel(10,f),'22');
  assert.deepEqual(f.stops,[0,5,10]);
 }
 assert.equal(displayValue(10,{key:'temperature_2m',unit:'°C'}),10);
});
