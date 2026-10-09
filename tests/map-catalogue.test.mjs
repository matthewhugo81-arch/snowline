import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {sourceVariable,canonicalVariable,describeVariable,extendCatalogue,availableFields,PRECIPITATION_SCALE} from '../map-catalogue.js';

test('new layers use physical units and appropriate renderer scales',()=>{
 const expected={wind_gusts_10m:'m/s',visibility:'m',cloud_cover_low:'%',cape:'J/kg',convective_inhibition:'J/kg',surface_temperature:'°C',soil_moisture_0_to_7cm:'m³/m³',geopotential_height_500hPa:'m',temperature_500hPa:'°C',relative_humidity_700hPa:'%',wind_speed_300hPa:'m/s',shortwave_radiation:'W/m²',total_column_integrated_water_vapour:'kg/m²'};
 for(const [key,unit]of Object.entries(expected)){
  const field=describeVariable(key,OM);assert.equal(field.unit,unit,key);
  assert.equal(field.colors.length,field.stops.length,key);
  assert.ok(field.stops.every(Number.isFinite),key);
  assert.ok(field.stops.every((value,index)=>index===0||value>field.stops[index-1]),key);
 }
 assert.notDeepEqual(describeVariable('geopotential_height_850hPa',OM).stops,describeVariable('geopotential_height_500hPa',OM).stops);
});
test('unsupported, ambiguous and spread fields cannot inherit an unrelated scale',()=>{
 for(const key of ['unknown_field','precipitation_type','weather_code','vertical_velocity_500hPa','temperature_2m_spread','wind_u_component_10m_spread','geopotential_height_500hPa_spread','temperature_2m_max','sea_ice_thickness'])assert.equal(describeVariable(key,OM),null,key);
});
test('wind fields require both components from the same model',()=>{
 assert.equal(sourceVariable({variables:['wind_u_component_300hPa']},'wind_speed_300hPa'),null);
 assert.equal(sourceVariable({variables:['wind_speed_300hPa']},'wind_speed_300hPa'),null);
 assert.equal(sourceVariable({variables:['wind_u_component_300hPa','wind_v_component_300hPa']},'wind_speed_300hPa'),'wind_u_component_300hPa');
 assert.equal(sourceVariable({variables:['wind_speed_300hPa','wind_direction_300hPa']},'wind_speed_300hPa'),'wind_speed_300hPa');
 assert.equal(canonicalVariable('wind_direction_300hPa'),'wind_speed_300hPa');
});
test('catalogue deduplicates vector pairs, preserves palettes and registers both model representations',()=>{
 const existing={key:'temperature_850hPa',name:'850 hPa temperature',unit:'°C',stops:[-20,0,20],colors:['#0000ff','#ffffff','#ff0000']};
 const fields=[existing],settings={colorScales:{}};
 const metas=[{variables:['temperature_850hPa','wind_u_component_300hPa','wind_v_component_300hPa','visibility']},{variables:['wind_speed_300hPa','wind_direction_300hPa','cape']}];
 extendCatalogue(fields,metas,OM,settings);extendCatalogue(fields,metas,OM,settings);
 assert.equal(fields.filter(f=>f.key==='wind_speed_300hPa').length,1);
 assert.deepEqual(existing.stops,[-20,0,20]);
 assert.deepEqual(settings.colorScales.wind_speed_300hPa,settings.colorScales.wind_u_component_300hPa);
 assert.equal(settings.colorScales.visibility.unit,'m');
});
test('switching models hides stale fields; comparison offers the supported union',()=>{
 const fields=[],settings={colorScales:{}};
 const first={variables:['cape','visibility','wind_gusts_10m']},second={variables:['cloud_cover_low','temperature_500hPa']};
 extendCatalogue(fields,[first],OM,settings);extendCatalogue(fields,[second],OM,settings);
 assert.deepEqual(availableFields(fields,[second]).map(f=>f.key),['cloud_cover_low','temperature_500hPa']);
 assert.equal(availableFields(fields,[first,second]).length,5);
 assert.equal(availableFields(fields,[]).length,0);
});
test('upper-air levels have a consistent surface-to-stratosphere order',()=>{
 const meta={variables:['temperature_10hPa','temperature_500hPa','temperature_925hPa','temperature_300hPa']};
 const fields=[];extendCatalogue(fields,[meta],OM,{colorScales:{}});
 assert.deepEqual(availableFields(fields,[meta]).map(f=>f.key),['temperature_925hPa','temperature_500hPa','temperature_300hPa','temperature_10hPa']);
});

test('precipitation renderer preserves rain boundaries with an opaque white dry band',()=>{
 const expected=[[0,'#ffffff'],[.5,'#231496'],[1,'#1538c7'],[2,'#125c13'],[4,'#807e10'],[6,'#a1a13b'],[8,'#b08131'],[10,'#a35a35'],[15,'#993232'],[20,'#c43650'],[25,'#ba2388'],[30,'#dec4c4'],[40,'#c9bcbc'],[50,'#f0e7e7']];
 const rgba=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),1];
 const scale={type:'breakpoint',breakpoints:PRECIPITATION_SCALE.stops,colors:PRECIPITATION_SCALE.colors.map(rgba)};
 for(const [i,[threshold,color]]of expected.entries()){
  assert.deepEqual(OM.getColor(scale,threshold,false),rgba(color));
  if(i>0)assert.deepEqual(OM.getColor(scale,threshold-.00001,false),rgba(expected[i-1][1]));
 }
 assert.deepEqual(OM.getColor(scale,100,false),rgba('#f0e7e7'));
});
test('rain and showers share the precipitation map bands and remain discrete',()=>{
 for(const key of ['rain','showers']){
  const field=describeVariable(key,OM);
  assert.equal(field.bands,true);
  assert.deepEqual(field.stops,PRECIPITATION_SCALE.stops);
  assert.deepEqual(field.colors,PRECIPITATION_SCALE.colors);
  assert.equal(field.unit,'mm water');
 }
});
