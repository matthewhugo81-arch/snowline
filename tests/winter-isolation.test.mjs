import test from 'node:test';
import assert from 'node:assert/strict';
import {WINTER_ADDITION_KEYS,winterHours} from '../map-winter-registry.js';
import {extendCatalogue,availableFields} from '../map-catalogue.js';
test('ordinary map catalogue does not activate or calculate winter-only diagnostics',()=>{
 assert.deepEqual(WINTER_ADDITION_KEYS,[]);
 assert.equal(winterHours('surface_temperature_min_24h'),null);
 const fields=[],meta={domain:'ukmo_uk_deterministic_2km',variables:['hail','surface_temperature','temperature_2m','relative_humidity_2m'],reference_time:'2026-10-24T00:00:00Z',valid_times:['2026-10-25T00:00:00Z']};
 extendCatalogue(fields,[meta],{defaultOmProtocolSettings:{colorScales:{}}},{colorScales:{}});
 assert.ok(!availableFields(fields,[meta]).some(f=>['hail','wet_bulb_temperature_2m','surface_temperature_min_24h'].includes(f.key)));
});
