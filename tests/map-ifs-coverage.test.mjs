import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {sourceVariable,canonicalVariable,extendCatalogue,availableFields} from '../map-catalogue.js';
import {combineSources,hasFieldTime} from '../map-sources.js';
import {humidityFromDewPoint,diffuseFromRadiation,installSurfaceDerived,surfaceDerivedRules} from '../map-surface-derived.js';
const meta={domain:'ecmwf_ifs',reference_time:'2026-10-20T00:00Z',valid_times:['2026-10-20T00:00Z','2026-10-20T01:00Z'],
 variables:['temperature_2m','dew_point_2m','shortwave_radiation','direct_radiation']};

test('IFS surface diagnostics require one source; native fields win and radiation has no initial period',()=>{
 assert.equal(sourceVariable(meta,'relative_humidity_2m'),'relative_humidity_2m_derived');
 assert.equal(sourceVariable(meta,'diffuse_radiation'),'diffuse_radiation_derived');
 assert.equal(sourceVariable({...meta,variables:[...meta.variables,'relative_humidity_2m']},'relative_humidity_2m'),'relative_humidity_2m');
 const split=combineSources({...meta,variables:['temperature_2m']},[{...meta,variables:['dew_point_2m']}]);
 assert.equal(sourceVariable(split,'relative_humidity_2m'),null);
 assert.equal(sourceVariable({...meta,domain:'unknown'},'relative_humidity_2m'),null);
 assert.equal(sourceVariable(meta,'wet_bulb_potential_temperature_850hPa'),null);
 assert.equal(hasFieldTime(meta,'relative_humidity_2m',meta.valid_times[0]),true);
 assert.equal(hasFieldTime(meta,'diffuse_radiation',meta.valid_times[0]),false);
 assert.equal(hasFieldTime(meta,'diffuse_radiation',meta.valid_times[1]),true);
});

test('surface calculations preserve missing and inconsistent cells; independent warm/cold humidity checks',()=>{
 assert.ok(Math.abs(humidityFromDewPoint(20,9.2611)-50)<.001);
 assert.ok(Math.abs(humidityFromDewPoint(-5,-7.9)-80)<.3);
 assert.equal(humidityFromDewPoint(10,10),100);
 assert.equal(humidityFromDewPoint(10,11),100);
 assert.ok(Number.isNaN(humidityFromDewPoint(NaN,10)));
 assert.equal(diffuseFromRadiation(415,343),72);
 assert.equal(diffuseFromRadiation(0,0),0);
 assert.equal(diffuseFromRadiation(100,101),0);
 for(const pair of [[100,103],[NaN,0],[0,NaN],[-1,0],[0,-1]])assert.ok(Number.isNaN(diffuseFromRadiation(...pair)));
 for(const rule of surfaceDerivedRules)assert.throws(()=>rule.process(new Float32Array(2),new Float32Array(1)),/do not match/);
});

test('native snow and marine arrays are all exposed with their verified units and paired currents',()=>{
 const native=['snow_density','ocean_u_current','ocean_v_current','sea_ice_thickness','sea_level_height_msl','sea_water_salinity'];
 const fields=[],settings={colorScales:{}},m={...meta,variables:native};
 assert.deepEqual(extendCatalogue(fields,[m],OM,settings),[]);
 const offered=availableFields(fields,[m]);
 assert.equal(offered.length,5);
 for(const key of native)assert.ok(offered.some(f=>f.key===canonicalVariable(key)));
 assert.deepEqual(Object.fromEntries(fields.map(f=>[f.key,f.unit])),{
  snow_density:'kg/m³',ocean_current_speed:'m/s',sea_ice_thickness:'m',sea_level_height_msl:'m',sea_water_salinity:'g/kg'
 });
 assert.equal(sourceVariable({...m,variables:['ocean_u_current']},'ocean_current_speed'),null);
 assert.ok(fields.every(f=>f.stops.length===f.colors.length&&f.stops.every((n,i)=>!i||n>f.stops[i-1])));
});

test('real bundled reader calculates clipped diagnostics and prefetches both arrays',async()=>{
 const reader=OM.getProtocolInstance(OM.defaultOmProtocolSettings).omFileReader,old=reader.withReader;
 installSurfaceDerived(OM,OM.defaultOmProtocolSettings);installSurfaceDerived(OM,OM.defaultOmProtocolSettings);
 for(const rule of surfaceDerivedRules)assert.equal(reader.allDerivationRules.filter(r=>String(r.pattern)===String(rule.pattern)).length,1);
 const ranges=[{start:0,end:1},{start:4,end:6}],prefetched=[],disposed=[];
 const arrays={temperature_2m:[20,NaN],dew_point_2m:[9.2611,8],shortwave_radiation:[415,NaN],direct_radiation:[343,0]};
 reader.withReader=async(url,fn)=>fn({getChildByName:async key=>({
  getDimensions:()=>[1,20],scaleFactor:()=>20,
  read:async options=>{assert.equal(options.ranges,ranges);return Float32Array.from(arrays[key]);},
  readPrefetch:async options=>{assert.equal(options.ranges,ranges);prefetched.push(key);},dispose:()=>disposed.push(key)
 })});
 try{
  const rh=await reader.readVariable('same-run.om','relative_humidity_2m_derived',ranges);
  assert.ok(Math.abs(rh.values[0]-50)<.001);assert.ok(Number.isNaN(rh.values[1]));
  const diffuse=await reader.readVariable('same-run.om','diffuse_radiation_derived',ranges);
  assert.equal(diffuse.values[0],72);assert.ok(Number.isNaN(diffuse.values[1]));
  await reader.prefetchVariable('same-run.om','relative_humidity_2m_derived',ranges);
  assert.deepEqual(prefetched,['temperature_2m','dew_point_2m']);assert.equal(disposed.length,6);
 }finally{reader.withReader=old;}
});
