import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {VERTICAL_MOTION,VERTICAL_DOMAINS,HEIGHT_700_CONTOURS,verticalMotionInputs,verticalMotionField,omegaMicrobars,verticalMotionRules,installVerticalMotion,verticalMotionOverlayURLs} from '../map-vertical-motion.js';
import {sourceVariable,extendCatalogue,availableFields} from '../map-catalogue.js';
import {combineSources,fieldSource,hasFieldTime,fieldDataURL} from '../map-sources.js';
import {overlayGroups} from '../map-overlay-specs.js';
import {briefingPresets,briefingTimes} from '../map-briefing-data.js';
import {previousRunPresets,previousRunTimes} from '../map-previous-run-data.js';
import {chartScales} from '../map-image-export.js';
const time='2026-10-15T21:00Z',reference='2026-10-15T12:00:00Z';
const meta=domain=>({domain,variables:verticalMotionInputs(domain),reference_time:reference,valid_times:[time],completed:true});

test('hydrostatic conversion gives the reference sign and microbar scale; JMA is already pressure velocity',()=>{
 // Independent ideal-gas calculation: density at 700 hPa and 0 C is
 // 0.8927444942160978 kg/m3, so 0.1 m/s ascent is -8.754832794204296 microbar/s.
 assert.ok(Math.abs(omegaMicrobars(.1,0)-(-8.754832794204296))<1e-10);
 assert.ok(Math.abs(omegaMicrobars(-.1,0)-8.754832794204296)<1e-10);
 assert.equal(omegaMicrobars(-.875,0,true),-8.75);
 assert.equal(omegaMicrobars(.875,0,true),8.75);
 for(const native of [false,true])for(const pair of [[NaN,0],[0,NaN],[Infinity,0],[1,-273.15]])assert.ok(Number.isNaN(omegaMicrobars(...pair,native)));
 assert.equal(omegaMicrobars(0,10),0);
});

test('derived arrays preserve missing cells and shared buffers without modifying inputs',()=>{
 for(const rule of verticalMotionRules){
  const v=new Float32Array(new SharedArrayBuffer(12));v.set([.1,-.1,NaN]);
  const t=new Float32Array([0,0,0]),result=rule.process(v,t);
  assert.ok(result.values.buffer instanceof SharedArrayBuffer);
  assert.equal(result.values.length,3);assert.ok(Number.isNaN(result.values[2]));
  assert.equal(v[0],Math.fround(.1));assert.equal(t[0],0);assert.equal(result.directions,undefined);
  assert.throws(()=>rule.process(v,new Float32Array(2)),/grids do not match/);
 }
 const settings={...OM.defaultOmProtocolSettings};installVerticalMotion(OM,settings);installVerticalMotion(OM,settings);
 const rules=OM.getProtocolInstance(settings).omFileReader.allDerivationRules;
 for(const rule of verticalMotionRules)assert.equal(rules.filter(r=>String(r.pattern)===String(rule.pattern)).length,1);
});

test('only the six verified deterministic feeds with a complete same-source chart are offered',()=>{
 for(const domain of VERTICAL_DOMAINS){
  const m=meta(domain);assert.equal(sourceVariable(m,VERTICAL_MOTION),domain==='jma_gsm'?'omega_700hPa_from_pressure':'omega_700hPa_from_w');
  for(const key of m.variables)assert.equal(sourceVariable({...m,variables:m.variables.filter(v=>v!==key)},VERTICAL_MOTION),null,domain+' missing '+key);
  const fields=[],settings={colorScales:{}};extendCatalogue(fields,[m],OM,settings);
  assert.ok(availableFields(fields,[m]).some(f=>f.key===VERTICAL_MOTION));
  assert.ok(settings.colorScales[sourceVariable(m,VERTICAL_MOTION)]);
  const preset=briefingPresets(m,fields).find(p=>p.field===VERTICAL_MOTION);assert.ok(preset);
  assert.deepEqual(briefingTimes(m,preset,{},'native'),[time]);
 }
 for(const domain of ['ukmo_uk_deterministic_2km','ecmwf_ifs','ncep_hgefs025_ensemble_mean','cmc_gem_gdps_15km','dwd_icon_eu'])
  assert.equal(sourceVariable({...meta('ncep_gfs025'),domain},VERTICAL_MOTION),null);
 const complete=meta('ncep_gfs025'),split=combineSources({...complete,variables:complete.variables.slice(0,2)},[{...complete,variables:complete.variables.slice(2)}]);
 assert.equal(sourceVariable(split,VERTICAL_MOTION),null,'Do not assemble inputs across independent source grids');
});

test('GFS chart uses its same-cycle 0.25-degree companion and never substitutes time or run',()=>{
 const companion=meta('ncep_gfs025'),primary={...meta('ncep_gfs025'),domain:'ncep_gfs013',variables:['precipitation']};
 const combined=combineSources(primary,[companion]);assert.equal(fieldSource(combined,VERTICAL_MOTION,time).domain,'ncep_gfs025');
 assert.match(fieldDataURL(combined,VERTICAL_MOTION,time),/ncep_gfs025\/2026\/10\/15\/1200Z\/2026-10-15T2100.om$/);
 assert.equal(hasFieldTime(combined,VERTICAL_MOTION,'2026-10-15T22:00Z'),false);
 assert.equal(hasFieldTime(combineSources(primary,[{...companion,reference_time:'2026-10-15T06:00:00Z'}]),VERTICAL_MOTION,time),false);
});

test('reference colours, neutral band, signed thresholds and exported legend agree',()=>{
 const field=verticalMotionField(),fields=[],settings={colorScales:{}};
 extendCatalogue(fields,[meta('jma_gsm')],OM,settings);const scale=settings.colorScales.omega_700hPa_from_pressure;
 assert.deepEqual(OM.getColor(scale,0,false),[255,255,255,1]);
 for(const value of [-100,-20,-2]){const [r,g,b]=OM.getColor(scale,value,false);assert.ok(r>b&&r>g);}
 for(const value of [2,20,100]){const [r,g,b]=OM.getColor(scale,value,false);assert.ok(b>r&&b>g);}
 assert.deepEqual(OM.getColor(scale,100,false),[0,0,153,1]);
 assert.deepEqual(field.stops,field.contourValues);assert.equal(field.colors.length,field.stops.length);
 const [legend]=chartScales(field);assert.match(legend.name,/0.1 Pa\/s/);assert.match(legend.note,/negative = ascent/);
});

test('height contours use metres for geometry and dam for labels; barbs use knots and include pennants',()=>{
 const field=verticalMotionField(),base='om://https://example/model/2026/10/15/1200Z/2026-10-15T2100.om';
 const urls=verticalMotionOverlayURLs(VERTICAL_MOTION,key=>base+'?variable='+key);
 const height=new URLSearchParams(urls.heightURL.split('?')[1]),wind=new URLSearchParams(urls.windURL.split('?')[1]);
 assert.equal(height.get('intervals'),HEIGHT_700_CONTOURS.join(','));assert.ok(HEIGHT_700_CONTOURS.every((v,i)=>!i||v-HEIGHT_700_CONTOURS[i-1]===40));
 assert.equal(wind.get('arrow_style'),'barb');assert.equal(wind.get('arrows'),'true');assert.equal(wind.get('contours'),'false');
 const groups=overlayGroups({field,url:base,pressureURL:'wrong-level',...urls,contours:true,isobars:true});
 assert.deepEqual(groups.map(g=>g.id),['omega','height700','wind700']);
 const labels=groups[1].layers.find(l=>l.type==='symbol');assert.deepEqual(labels.layout['text-field'],['to-string',['round',['/',['to-number',['get','value']],10]]]);
 assert.ok(groups[2].layers.some(l=>l['source-layer']==='wind-barb-pennants'&&l.type==='fill'));
 assert.ok(groups[2].layers.some(l=>l['source-layer']==='wind-arrows'));
 assert.deepEqual(overlayGroups({field,url:base,...urls,contours:false,isobars:false}).map(g=>g.id),['height700','wind700']);
 assert.deepEqual(verticalMotionOverlayURLs('precipitation',()=>{throw Error('must not call');}),{});
});


test('previous-run comparison identifies which distinct initializations supply the complete chart',()=>{
 const runs=[0,6,12].map(hour=>({...meta('ncep_gfs025'),reference_time:'2026-10-15T'+String(hour).padStart(2,'0')+':00:00Z'}));
 const fields=[],settings={colorScales:{}};extendCatalogue(fields,runs,OM,settings);
 const preset=previousRunPresets(runs,3,fields).find(p=>p.field===VERTICAL_MOTION);assert.ok(preset);
 assert.deepEqual(previousRunTimes(runs,preset,{},'native'),[time]);
 runs[1]={...runs[1],variables:runs[1].variables.filter(v=>v!=='vertical_velocity_700hPa')};
 assert.equal(previousRunPresets(runs,3,fields).find(p=>p.field===VERTICAL_MOTION).availableRunCount,2);
});


test('additional pressure levels use their own density and require paired same-source temperature',()=>{
 const m={domain:'ncep_gfs025',variables:['vertical_velocity_500hPa','temperature_500hPa'],reference_time:reference,valid_times:[time]};
 assert.equal(sourceVariable(m,'vertical_motion_500hPa'),'omega_500hPa_from_w');
 const rule=verticalMotionRules.find(r=>r.pattern.test('omega_500hPa_from_w'));
 assert.deepEqual(rule.getSourceVars(),m.variables);
 const result=rule.process(new Float32Array([.1,NaN]),new Float32Array([0,0]));
 assert.ok(Math.abs(result.values[0]-(-6.253451995860212))<1e-5);
 assert.ok(Number.isNaN(result.values[1]));
 assert.equal(sourceVariable({...m,variables:['vertical_velocity_500hPa']},'vertical_motion_500hPa'),null);
 assert.equal(sourceVariable({...m,domain:'unknown'},'vertical_motion_500hPa'),null);
 assert.equal(sourceVariable({...m,domain:'jma_gsm'},'vertical_motion_500hPa'),'omega_500hPa_from_pressure');
 const fields=[],settings={colorScales:{}};extendCatalogue(fields,[m],OM,settings);
 const field=fields.find(f=>f.key==='vertical_motion_500hPa');
 assert.ok(!availableFields(fields,[m]).includes(field),'The compact menu retains the established 700 hPa chart');
 assert.equal(field.unit,'0.1 Pa/s');assert.equal(field.name,'500 hPa vertical motion');
 assert.ok(!field.legendNote.includes('700'));
 assert.ok(settings.colorScales.omega_500hPa_from_w);
 const split=combineSources({...m,variables:['vertical_velocity_500hPa']},[{...m,variables:['temperature_500hPa']}]);
 assert.equal(sourceVariable(split,'vertical_motion_500hPa'),null);
});
