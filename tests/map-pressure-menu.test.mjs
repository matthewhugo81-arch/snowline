import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {availableFields,extendCatalogue,sourceVariable} from '../map-catalogue.js';
import {MAP_MODELS} from '../map-models.js';
const wanted={temperature:[1000,850,500,250],wind_speed:[1000,500,300,200],relative_humidity:[1000,700,300],geopotential_height:[500,300,200]};
const levels=[1000,975,950,925,850,800,700,600,500,400,300,250,200,150,100,70,50,30,20,10];
const keys=Object.keys(wanted).flatMap(kind=>levels.map(level=>`${kind}_${level}hPa`));
const fields=keys.map(key=>({key,name:key}));
const expected=Object.entries(wanted).flatMap(([kind,levels])=>levels.map(level=>`${kind}_${level}hPa`));
for(const model of MAP_MODELS){
 test(`${model.name}: compact upper-air menu`,()=>{
  for(const prefixes of [['wind_speed_','wind_direction_'],['wind_u_component_','wind_v_component_']]){
   const variables=keys.flatMap(key=>key.startsWith('wind_speed_')?prefixes.map(prefix=>key.replace('wind_speed_',prefix)):[key]);
   assert.deepEqual(availableFields(fields,[{domain:model.id,variables}]).map(f=>f.key),expected);
  }
 });
}
test('menu filtering preserves native diagnostic inputs and does not invent missing levels',()=>{
 const meta={domain:'ncep_gfs025',variables:['temperature_850hPa','relative_humidity_850hPa','relative_humidity_700hPa','wind_u_component_400hPa','wind_v_component_400hPa']};
 const catalogue=[];extendCatalogue(catalogue,[meta],OM,{colorScales:{}});
 const menu=availableFields(catalogue,[meta]).map(f=>f.key);
 assert.ok(!menu.includes('relative_humidity_850hPa'));
 assert.ok(!menu.includes('wind_speed_400hPa'));
 assert.ok(!menu.includes('temperature_1000hPa'));
 assert.ok(menu.includes('wet_bulb_potential_temperature_850hPa'));
 assert.ok(menu.includes('relative_vorticity_400hPa'));
 assert.equal(sourceVariable(meta,'relative_humidity_850hPa'),'relative_humidity_850hPa');
});
test('surface fields and ensemble mean/spread remain untouched',()=>{
 const keys=['temperature_2m','relative_humidity_2m','wind_speed_10m','temperature_850hPa_mean','temperature_850hPa_spread','geopotential_height_500hPa_mean','geopotential_height_500hPa_spread'];
 const meta={domain:'snowline_ecmwf_ensemble',variables:[...keys,'wind_direction_10m']};
 assert.deepEqual(new Set(availableFields(keys.map(key=>({key,name:key})),[meta]).map(f=>f.key)),new Set(keys));
});
