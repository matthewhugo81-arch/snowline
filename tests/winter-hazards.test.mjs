import test from 'node:test';
import assert from 'node:assert/strict';
import {isWinterField,WINTER_DEFAULTS} from '../map-winter-hazards.js';
import {PRODUCT_FIELDS} from '../map-ensemble-products.js';
import {panelSelections} from '../map-panels.js';
test('winter workspace opens three distinct supported winter subjects',()=>{
 const panels=panelSelections(WINTER_DEFAULTS);
 assert.equal(panels.length,3);
 assert.deepEqual(panels.map(p=>p.field),['surface_temperature','snowfall_water_equivalent','ens_temperature_le0c_24h']);
 assert.ok(panels.every(p=>isWinterField(p.field)));
 assert.ok(PRODUCT_FIELDS.some(f=>f.key===panels[2].field&&f.models.includes('mogreps_uk')));
});
test('only snow and cold ensemble products enter the winter menu',()=>{
 const kept=PRODUCT_FIELDS.filter(isWinterField);
 assert.ok(kept.length>0);
 assert.ok(kept.every(f=>/^(ens_snow_|ens_temperature_le)/.test(f.key)));
 for(const key of ['cloud_cover','wind_speed_10m','precipitation_total_24h','ens_gust_gt50kt_24h','ens_rain_ge1mm_6h','ens_temperature_max_anomaly','future_unreviewed_field'])assert.equal(isWinterField(key),false,key);
});
