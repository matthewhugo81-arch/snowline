import test from 'node:test';
import assert from 'node:assert/strict';
import {PRECIP_SYMBOLS,canPrecipSymbols,precipitationSymbolsField} from '../map-winter.js';
import {sourceVariable,describeVariable} from '../map-catalogue.js';
import {fieldSource,fieldIntervalHours} from '../map-sources.js';
import {forecastPeriod} from '../map-validity.js';
import {chartScales} from '../map-image-export.js';

test('standalone symbols need native convection but no upper-air or pressure fields',()=>{
 for(const domain of ['ecmwf_ifs','ecmwf_ifs025','cmc_gem_gdps_15km']){
  const reference_time='2026-10-24T00:00:00Z',time='2026-10-24T03:00:00Z';
  const meta={domain,reference_time,variables:['precipitation','showers','snowfall_water_equivalent'],valid_times:[reference_time,time]};
  assert.ok(canPrecipSymbols(meta));assert.equal(sourceVariable(meta,PRECIP_SYMBOLS),'precipitation');
  assert.equal(fieldSource(meta,PRECIP_SYMBOLS,time),meta);
  assert.equal(fieldSource(meta,PRECIP_SYMBOLS,reference_time),null);
  const hours=fieldIntervalHours(meta,PRECIP_SYMBOLS,time);assert.ok(hours>0);
  assert.equal(Date.parse(forecastPeriod(PRECIP_SYMBOLS,time,meta).start),Date.parse(time)-hours*3600000);
  assert.equal(canPrecipSymbols({...meta,variables:['precipitation']}),false);
  assert.equal(fieldSource(meta,PRECIP_SYMBOLS,'2026-10-24T04:00:00Z'),null);
 }
 assert.equal(describeVariable(PRECIP_SYMBOLS,{}).name,'Precipitation symbols');
 const scales=chartScales(precipitationSymbolsField(),'3 h ending at valid time');
 assert.deepEqual(scales[0].colors,[]);assert.match(scales[0].note,/triangles/);
});
