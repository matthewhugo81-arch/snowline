import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {THETA_W,DIAGNOSTIC_KEYS,diagnosticWindow,vorticityGeometry,relativeVorticity,thetaWCelsius,thetaWRule,installDiagnostics} from '../map-diagnostics.js';
import {sourceVariable,extendCatalogue,availableFields} from '../map-catalogue.js';
import {combineSources,fieldSource,hasFieldTime} from '../map-sources.js';
import {briefingPresets} from '../map-briefing-data.js';
const ukv=OM.domainOptions.find(d=>d.value==='ukmo_uk_deterministic_2km').grid;
const radians=Math.PI/180,R=6371229;
const close=(a,b,tolerance)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b} (tolerance ${tolerance})`);

test('theta-w agrees with independent MetPy 1.7.1 reference across cold, warm, dry and saturated air',()=>{
 // MetPy: wet_bulb_potential_temperature(850 hPa, T,
 // dewpoint_from_relative_humidity(T,RH)). Liquid-water RH. Small differences
 // reflect Bolton saturation vapour pressure vs MetPy 1.7 Ambaum formulation.
 const temperatures=[-40,-20,-10,0,10,20,30],humidity=[10,50,100,80,30,70,100];
 const expected=[-29.757017179943944,-11.069907307225776,-1.120776746046829,6.584245862370722,10.153197232819366,22.086196317097404,34.77191689588619];
 temperatures.forEach((t,i)=>close(thetaWCelsius(t,humidity[i]),expected[i],.08));
 close(thetaWCelsius(10,0),thetaWCelsius(10,1e-10),.001);
 close(thetaWCelsius(0,120),thetaWCelsius(0,100),1e-9);
 for(const pair of [[NaN,50],[5,NaN],[5,-1]])assert.ok(Number.isNaN(thetaWCelsius(...pair)));
 const temp=new Float32Array(new SharedArrayBuffer(12));temp.set([0,10,NaN]);
 const result=thetaWRule.process(temp,new Float32Array([80,30,50]));
 assert.ok(result.values.buffer instanceof SharedArrayBuffer);assert.ok(Number.isNaN(result.values[2]));assert.equal(result.directions,undefined);
});

// Analytic solid-body rotation about an arbitrary tilted axis on a sphere.
// Its curl is exactly 2 Omega dot position. This exercises the projection,
// wind-component signs AND the spherical metric independently of our stencil.
function rotation(config,window,axis=[4e-6,-6e-6,1.2e-5]){
 const grid=OM.GridFactory.create(config),u=[],v=[],expected=[];
 for(let y=window.y.start;y<window.y.end;y++)for(let x=window.x.start;x<window.x.end;x++){
  const column=window.period?((x%window.period)+window.period)%window.period:x;
  const [latitude,longitude]=config.type==='regular'?[config.latMin+y*config.dy,config.lonMin+column*config.dx]:grid.projection.reverse(grid.minX+column*grid.dx,grid.minY+y*grid.dy);
  const p=latitude*radians,l=longitude*radians,[a,b,c]=axis;
  u.push(R*(c*Math.cos(p)-Math.sin(p)*(a*Math.cos(l)+b*Math.sin(l))));
  v.push(R*(a*Math.sin(l)-b*Math.cos(l)));
  if(y>=window.target[0].start&&y<window.target[0].end&&x>=window.target[1].start&&x<window.target[1].end)expected.push(2*(a*Math.cos(p)*Math.cos(l)+b*Math.cos(p)*Math.sin(l)+c*Math.sin(p))*1e5);
 }
 return {u:new Float32Array(u),v:new Float32Array(v),expected};
}
test('relative vorticity recovers tilted solid-body rotation on UKV and spherical grids',()=>{
 for(const [config,ranges] of [[ukv,[{start:35,end:42},{start:980,end:987}]],[ukv,[{start:480,end:485},{start:500,end:505}]],[OM.domainOptions.find(d=>d.value==='ncep_gfs025').grid,[{start:530,end:540},{start:710,end:725}]]]){
  const window=diagnosticWindow(config,ranges),data=rotation(config,window),geometry=vorticityGeometry(OM,config,window);
  const actual=relativeVorticity(data.u,data.v,window,geometry);
  actual.forEach((value,i)=>close(value,data.expected[i],.004));
  const speed=Float32Array.from(data.u,(u,i)=>Math.hypot(u,data.v[i])),direction=Float32Array.from(data.u,(u,i)=>(Math.atan2(-u,-data.v[i])/radians+360)%360);
  relativeVorticity(speed,direction,window,geometry,true).forEach((value,i)=>close(value,data.expected[i],.004));
 }
});
test('global longitude wraps including ICON double-width closing interval; poles remain missing',()=>{
 for(const domain of ['ncep_gfs025','dwd_icon']){
  const config=OM.domainOptions.find(d=>d.value===domain).grid;
  for(const x of [0,config.nx-2]){
   const window=diagnosticWindow(config,[{start:Math.floor(config.ny*.7),end:Math.floor(config.ny*.7)+2},{start:x,end:x+2}]),data=rotation(config,window);
   relativeVorticity(data.u,data.v,window,vorticityGeometry(OM,config,window)).forEach((value,i)=>close(value,data.expected[i],.003));
   assert.equal(window.segments.length,2);
  }
  const window=diagnosticWindow(config,[{start:0,end:1},{start:20,end:21}]),data=rotation(config,window);
  assert.ok(Number.isNaN(relativeVorticity(data.u,data.v,window,vorticityGeometry(OM,config,window))[0]));
 }
});
test('halo makes adjacent cropped reads identical; missing source cells and real domain edges stay blank',()=>{
 const full=diagnosticWindow(ukv,[{start:400,end:408},{start:400,end:408}]),data=rotation(ukv,full);
 const all=relativeVorticity(data.u,data.v,full,vorticityGeometry(OM,ukv,full));
 const cropped=diagnosticWindow(ukv,[{start:403,end:405},{start:403,end:405}]),part=rotation(ukv,cropped);
 const subset=relativeVorticity(part.u,part.v,cropped,vorticityGeometry(OM,ukv,cropped));
 [27,28,35,36].forEach((index,i)=>assert.equal(subset[i],all[index]));
 part.u[cropped.width+1]=NaN;
 assert.ok(Number.isNaN(relativeVorticity(part.u,part.v,cropped,vorticityGeometry(OM,ukv,cropped))[0]));
 const edge=diagnosticWindow(ukv,[{start:0,end:2},{start:0,end:2}]),edgeData=rotation(ukv,edge);
 const result=relativeVorticity(edgeData.u,edgeData.v,edge,vorticityGeometry(OM,ukv,edge));
 assert.ok(Number.isNaN(result[0]));assert.ok(Number.isFinite(result[3]));
});
test('only complete supported sources expose diagnostics and briefing presets; GFS uses matching companion times',()=>{
 const vars=['temperature_850hPa','relative_humidity_850hPa',...[300,400].flatMap(l=>['wind_u_component_'+l+'hPa','wind_v_component_'+l+'hPa']),'pressure_msl'];
 const base={domain:'ncep_gfs025',reference_time:'2026-10-11T12:00:00Z',variables:vars,valid_times:['2026-10-11T12:00:00Z']};
 for(const key of DIAGNOSTIC_KEYS)assert.equal(sourceVariable(base,key),key+'_derived');
 const missing={...base,variables:vars.filter(v=>v!=='wind_v_component_400hPa')};
 assert.equal(sourceVariable(missing,'relative_vorticity_400hPa'),null);
 assert.equal(sourceVariable({...base,domain:'snowline_gefs_ensemble'},THETA_W),null);
 assert.equal(sourceVariable({...base,domain:'ncep_hgefs025_ensemble_mean'},THETA_W),null);
 const split={sources:[{...base,variables:['temperature_850hPa']},{...base,variables:['relative_humidity_850hPa']}]};
 assert.equal(sourceVariable(split,THETA_W),null);
 const combined=combineSources({...base,domain:'ncep_gfs013',variables:['temperature_2m'],valid_times:[...base.valid_times,'2026-10-11T13:00:00Z']},[base]);
 assert.equal(fieldSource(combined,THETA_W).domain,'ncep_gfs025');assert.equal(hasFieldTime(combined,THETA_W,combined.valid_times[1]),false);
 const fields=[],settings={colorScales:{}};extendCatalogue(fields,[combined],OM,settings);
 for(const key of DIAGNOSTIC_KEYS){assert.ok(availableFields(fields,[combined]).some(f=>f.key===key));assert.ok(settings.colorScales[key+'_derived']);}
 assert.deepEqual(briefingPresets(base).map(p=>p.id),['airmass','theta-w','vorticity-300','vorticity-400']);
 assert.ok(!briefingPresets(missing).some(p=>p.id==='vorticity-400'));
});
test('bundled reader reads raw wind components with halos, prefetches both inputs and honours cancellation',async()=>{
 const settings={...OM.defaultOmProtocolSettings,domainOptions:OM.domainOptions},reader=OM.getProtocolInstance(settings).omFileReader;
 installDiagnostics(OM,settings);installDiagnostics(OM,settings);
 const config=OM.domainOptions.find(d=>d.value==='ncep_gfs025').grid;
 const calls=[],prefetch=[],disposed=[];const controller=new AbortController();
 reader.withReader=async(url,callback)=>callback({getChildByName:async key=>({
  getDimensions:()=>[config.ny,config.nx],scaleFactor:()=>10,
  async read(options){calls.push({key,...options});const window=diagnosticWindow(config,options.ranges),data=rotation(config,window);const values=key.startsWith('wind_u_')?data.u:data.v,output=[];for(let y=options.ranges[0].start;y<options.ranges[0].end;y++)for(let x=options.ranges[1].start;x<options.ranges[1].end;x++)output.push(values[(y-window.y.start)*window.width+x-window.x.start]);return new Float32Array(output);},
  async readPrefetch(options){prefetch.push({key,...options});},dispose(){disposed.push(key);}
 })});
 const url='https://openmeteo.s3.amazonaws.com/data_spatial/ncep_gfs025/2026/10/11/1200Z/2026-10-11T1200.om',ranges=[{start:540,end:542},{start:700,end:703}];
 const result=await reader.readVariable(url,'relative_vorticity_300hPa_derived',ranges,controller.signal);
 const window=diagnosticWindow(config,ranges),data=rotation(config,window);
 result.values.forEach((v,i)=>close(v,data.expected[i],.003));assert.equal(result.directions,undefined);assert.equal(result.scaleFactor,100);
 assert.equal(calls.length,2);assert.deepEqual(calls[0].ranges,window.segments[0].ranges);assert.equal(calls[0].signal,controller.signal);
 await reader.prefetchVariable(url,'relative_vorticity_300hPa_derived',ranges,controller.signal);
 assert.deepEqual(prefetch.map(c=>c.key).sort(),['wind_u_component_300hPa','wind_v_component_300hPa']);assert.equal(disposed.length,4);
 // A dateline window needs two disjoint byte-range reads per component. The
 // stitched halo must return the same analytic field, not shifted columns.
 const seamRanges=[{start:540,end:542},{start:0,end:2}],seam=diagnosticWindow(config,seamRanges),seamData=rotation(config,seam);
 const seamResult=await reader.readVariable(url,'relative_vorticity_400hPa_derived',seamRanges,controller.signal);
 seamResult.values.forEach((value,i)=>close(value,seamData.expected[i],.003));
 assert.equal(calls.length,6);assert.equal(disposed.length,6);
 controller.abort();await assert.rejects(reader.readVariable(url,'relative_vorticity_300hPa_derived',ranges,controller.signal),{name:'AbortError'});
 assert.equal(disposed.length,8);
});
