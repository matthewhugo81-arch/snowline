import test from 'node:test';
import assert from 'node:assert/strict';
import {dewPointCelsius,dewPointRule,installDewPoint,DERIVED_DEW_POINT} from '../map-dew-point.js';
import {sourceVariable,extendCatalogue,availableFields} from '../map-catalogue.js';
import {combineSources,fieldSource,hasFieldTime,fieldDataURL} from '../map-sources.js';
import * as OM from '../vendor/index.mjs';
const time='2026-10-11T1200';
const meta={domain:'ukmo_uk_deterministic_2km',reference_time:'2026-10-11T12:00Z',valid_times:['2026-10-11T12:00Z','2026-10-11T13:00Z'],variables:['temperature_2m','relative_humidity_2m']};

test('dew point has verified warm/cold values, preserves missing cells and never exceeds air temperature',()=>{
 assert.ok(Math.abs(dewPointCelsius(20,50)-9.2611)<.001);
 assert.ok(Math.abs(dewPointCelsius(-5,80)-(-7.9))<.05);
 for(const t of [-30,-5,0,10,30]){assert.equal(dewPointCelsius(t,100),t);assert.equal(dewPointCelsius(t,101),t);assert.ok(dewPointCelsius(t,50)<t);}
 for(const [t,rh] of [[NaN,50],[10,NaN],[10,0],[10,-1],[Infinity,50]])assert.ok(Number.isNaN(dewPointCelsius(t,rh)));
 const t=Float32Array.from([20,-5,NaN]),rh=Float32Array.from([50,80,60]);
 const result=dewPointRule.process(t,rh);
 assert.equal(result.directions,undefined);assert.ok(Number.isNaN(result.values[2]));assert.equal(t[0],20);assert.equal(rh[0],50);
 assert.throws(()=>dewPointRule.process(t,rh.subarray(0,2)),/do not match/);
});
test('UKMO dew point uses one complete source and native dew point takes precedence',()=>{
 assert.equal(sourceVariable(meta,'dew_point_2m'),DERIVED_DEW_POINT);
 assert.equal(sourceVariable({...meta,domain:'ukmo_global_deterministic_10km'},'dew_point_2m'),DERIVED_DEW_POINT);
 assert.equal(sourceVariable({...meta,variables:[...meta.variables,'dew_point_2m']},'dew_point_2m'),'dew_point_2m');
 assert.equal(sourceVariable({...meta,variables:['temperature_2m']},'dew_point_2m'),null);
 assert.equal(sourceVariable({...meta,domain:'unverified'},'dew_point_2m'),null);
 const split=combineSources({...meta,variables:['temperature_2m']},[{...meta,variables:['relative_humidity_2m']}]);
 assert.equal(sourceVariable(split,'dew_point_2m'),null);
 assert.equal(fieldSource(meta,'dew_point_2m',meta.valid_times[0]),meta);
 assert.equal(hasFieldTime(meta,'dew_point_2m','2026-10-11T14:00Z'),false);
 assert.ok(fieldDataURL(meta,'dew_point_2m',meta.valid_times[0]).endsWith('/1200Z/'+time+'.om'));
});
test('calculated dew point is selectable and registers its own Celsius scale without recolouring temperature',()=>{
 const field={key:'dew_point_2m',name:'2 m dew point',unit:'°C',stops:[-10,0,10],colors:['#0000ff','#ffffff','#ff0000']};
 const fields=[field],settings={colorScales:{temperature_2m:{unit:'°C',breakpoints:[1]}}};
 extendCatalogue(fields,[meta],OM,settings);
 assert.deepEqual(availableFields(fields,[meta]).map(f=>f.key),['dew_point_2m','relative_humidity_2m']);
 assert.deepEqual(settings.colorScales[DERIVED_DEW_POINT].breakpoints,field.stops);
 assert.deepEqual(settings.colorScales.temperature_2m.breakpoints,[1]);
 assert.deepEqual(availableFields(fields,[{...meta,variables:['temperature_2m']}]),[]);
});
test('bundled reader derives the selected clipped grid, preserves buffers and prefetches both inputs',async()=>{
 const reader=OM.getProtocolInstance(OM.defaultOmProtocolSettings).omFileReader;
 installDewPoint(OM,OM.defaultOmProtocolSettings);installDewPoint(OM,OM.defaultOmProtocolSettings);
 assert.equal(reader.allDerivationRules.filter(r=>r.pattern.toString()===dewPointRule.pattern.toString()).length,1);
 const ranges=[{start:2,end:3},{start:4,end:6}],reads=[],disposed=[],prefetched=[],old=reader.withReader;
 reader.withReader=async(url,callback)=>callback({getChildByName:async key=>({
  getDimensions:()=>[10,10],scaleFactor:()=>20,
  read:async options=>{reads.push({key,options});return Float32Array.from(key==='temperature_2m'?[20,NaN]:[50,80]);},
  readPrefetch:async options=>prefetched.push({key,options}),dispose:()=>disposed.push(key)
 })});
 try{
  const controller=new AbortController();
  const result=await reader.readVariable('run.om',DERIVED_DEW_POINT,ranges,controller.signal);
  assert.ok(Math.abs(result.values[0]-9.2611)<.001);assert.ok(Number.isNaN(result.values[1]));assert.equal(result.scaleFactor,20);
  assert.deepEqual(reads.map(r=>r.key),['temperature_2m','relative_humidity_2m']);
  assert.ok(reads.every(r=>r.options.ranges===ranges&&r.options.signal===controller.signal));
  assert.equal(disposed.length,2);
  await reader.prefetchVariable('run.om',DERIVED_DEW_POINT,ranges,controller.signal);
  assert.deepEqual(prefetched.map(r=>r.key),['temperature_2m','relative_humidity_2m']);
  assert.equal(disposed.length,4);
 }finally{reader.withReader=old;}
});
