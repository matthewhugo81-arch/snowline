import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PRODUCT_FIELDS,PRODUCT_DOMAINS,productChoices,verifyProduct,loadProducts,PRODUCT_BASE,productPath} from '../map-ensemble-products.js';
import {variableGroup,sourceVariable,describeVariable,availableFields,compareFields} from '../map-catalogue.js';
import {forecastValidity} from '../map-validity.js';
const reference='2026-10-21T12:00:00Z',time='2026-10-22T00:00:00Z',key='ens_gust_gt50kt_12h';
const meta=()=>({format_version:1,domain:'snowline_mogreps_uk_products',reference_time:reference,member_count:18,source_cycles:Array.from({length:6},(_,i)=>new Date(Date.parse(reference)-i*3600000).toISOString()),variables:[key],valid_times:[time],variable_valid_times:{[key]:[time]},variable_intervals:{[key]:{[time]:{hours:12,start:reference,end:time}}}});
test('two headers, anomalies exclusively MOGREPS-UK and ECMWF ENS, distinct rain/snow semantics',()=>{
 for(const model of ['snowline_gefs_ensemble','snowline_mogreps_global'])assert.ok(productChoices(model).every(f=>f.group!=='Temperature anomalies'));
 for(const model of ['ukmo_uk_ensemble_2km','snowline_ecmwf_ensemble'])assert.equal(productChoices(model).filter(f=>f.group==='Temperature anomalies').length,2);
 for(const f of PRODUCT_FIELDS){assert.equal(variableGroup(f.key),f.group);assert.deepEqual(describeVariable(f.key,{}),f);}
 assert.ok(productChoices('snowline_gefs_ensemble').some(f=>f.key==='ens_snow_occurrence_12h'));
 assert.ok(!productChoices('snowline_gefs_ensemble').some(f=>f.key==='ens_snow_ge1mm_12h'));
});
test('three-member, wrong-run and incomplete-cycle products cannot pass',()=>{
 assert.equal(verifyProduct(meta(),'ukmo_uk_ensemble_2km'),true);
 assert.equal(verifyProduct({...meta(),member_count:3},'ukmo_uk_ensemble_2km'),false);
 assert.equal(verifyProduct({...meta(),source_cycles:[]},'ukmo_uk_ensemble_2km'),false);
 assert.equal(verifyProduct(meta(),'ukmo_uk_ensemble_2km','2026-10-21T06:00:00Z'),false);
});
test('only selected products load; data URLs pin the snapshot, not the moving branch',async()=>{
 const calls=[],revision='a'.repeat(40);
 const m=await loadProducts('ukmo_uk_ensemble_2km',async url=>{calls.push(url);return calls.length===1?{revision}:meta();});
 assert.equal(calls.length,2);assert.equal(calls[0],PRODUCT_BASE+'publication.json');assert.ok(calls[1].includes('/'+revision+'/'));
 assert.ok(productPath(m.baseURL+m.domain+'/file.om'));assert.equal(productPath(m.baseURL.replace(revision,'main')+m.domain+'/file.om'),null);
 assert.equal(sourceVariable(m,key),key);
});
test('native grids and interval labels remain defined',()=>{
 assert.equal(PRODUCT_DOMAINS.length,4);assert.match(forecastValidity(key,time),/12:00 to Thu 22 Oct 00:00 UTC/);
});
test('ordinary model loading and publication do not import or run new processing',async()=>{
 const sources=await readFile(new URL('../map-sources.js',import.meta.url),'utf8');assert.ok(!sources.includes('loadProducts'));
 const core=await readFile(new URL('../.github/workflows/publish-maps.yml',import.meta.url),'utf8');assert.ok(!core.includes('build_ensemble_products'));
});

test('cold thresholds are UK-only inclusive air-temperature probabilities with complete periods',()=>{
 const keys=['0','m2','m5','m10'].map(t=>`ens_temperature_le${t}c_24h`);
 const fields=productChoices('ukmo_uk_ensemble_2km').filter(f=>keys.includes(f.key));
 assert.equal(fields.length,4);
 for(const f of fields){assert.equal(f.unit,'%');assert.equal(f.group,'Ensemble probabilities');assert.equal(f.periodHours,24);assert.match(f.name,/≤/);}
 for(const model of ['snowline_ecmwf_ensemble','snowline_gefs_ensemble','snowline_mogreps_global'])assert.ok(productChoices(model).every(f=>!keys.includes(f.key)));
 const end='2026-10-23T09:00:00Z',start='2026-10-22T09:00:00Z';
 const m={...meta(),variables:keys,valid_times:[end],variable_valid_times:Object.fromEntries(keys.map(k=>[k,[end]])),variable_intervals:Object.fromEntries(keys.map(k=>[k,{[end]:{hours:24,start,end}}]))};
 assert.equal(verifyProduct(m,'ukmo_uk_ensemble_2km'),true,'No climatology required');
 m.variable_intervals[keys[0]][end].hours=12;
 assert.equal(verifyProduct(m,'ukmo_uk_ensemble_2km'),false);
});
test('ECMWF retains exact 09 UTC windows and accepts declared calendar days through Day 15',()=>{
 const k='ens_temperature_min_anomaly';
 for(const [t,expected] of [['2026-10-27T09:00:00Z',true],['2026-10-28T09:00:00Z',false],['2026-10-28T00:00:00Z',true],['2026-11-05T00:00:00Z',true],['2026-11-06T00:00:00Z',false],['2026-10-22T00:00:00Z',false]]){
  const m={...meta(),domain:'snowline_ecmwf_products',member_count:51,variables:[k],valid_times:[t],variable_valid_times:{[k]:[t]},variable_intervals:{[k]:{[t]:{hours:24,start:new Date(Date.parse(t)-86400000).toISOString(),end:t}}},anomaly_reference:{dataset:'HadUK-Grid',period:'1991-2020',window_policy:'09-to-00-utc-v1'}};
  assert.equal(verifyProduct(m,'snowline_ecmwf_ensemble'),expected);
  delete m.anomaly_reference.window_policy;
  if(t.endsWith('T00:00:00Z'))assert.equal(verifyProduct(m,'snowline_ecmwf_ensemble'),false,'Legacy metadata cannot silently change its daily window');
 }
});

test('UK and Ireland references load without changing palette, periods or older archives',()=>{
 const k='ens_temperature_max_anomaly',t='2026-10-23T09:00:00Z';
 const m={...meta(),domain:'snowline_ecmwf_products',member_count:51,variables:[k],valid_times:[t],variable_valid_times:{[k]:[t]},variable_intervals:{[k]:{[t]:{hours:24,start:'2026-10-22T09:00:00Z',end:t}}}};
 for(const dataset of ['HadUK-Grid','HadUK-Grid + Met Eireann']){
  m.anomaly_reference={dataset,period:'1991-2020'};
  assert.equal(verifyProduct(m,'snowline_ecmwf_ensemble'),true);
 }
 m.anomaly_reference.period='1981-2010';assert.equal(verifyProduct(m,'snowline_ecmwf_ensemble'),false);
 m.anomaly_reference={dataset:'unknown',period:'1991-2020'};assert.equal(verifyProduct(m,'snowline_ecmwf_ensemble'),false);
 for(const f of PRODUCT_FIELDS.filter(f=>f.group==='Temperature anomalies')){
  assert.equal(f.stops[1],-10);assert.equal(f.stops.at(-1),10);assert.equal(f.anomalyBands,1);assert.equal(f.periodHours,24);
  assert.match(f.note,/Met Éireann/);assert.match(f.note,/border discontinuity/);
 }
});

test('probability menus sort all periods together, including native EC probabilities',async()=>{
 const {briefingPresets}=await import('../map-briefing-data.js');
 const native={key:'precipitation_probability_10mm_24h',name:'24 h precipitation ≥ 10 mm · probability',periodHours:24,group:'Ensemble probabilities'};
 for(const model of ['ukmo_uk_ensemble_2km','snowline_mogreps_global','snowline_ecmwf_ensemble','snowline_gefs_ensemble']){
  const fields=productChoices(model).filter(f=>f.group==='Ensemble probabilities');
  assert.equal(fields.filter(f=>f.periodHours===6).length,model==='snowline_gefs_ensemble'?0:11);
  const mixed=[native,...fields].reverse(),meta={domain:'snowline_ecmwf_extra_v2',variables:mixed.map(f=>f.key)};
  const expected=mixed.map(f=>f.periodHours).sort((a,b)=>a-b);
  assert.deepEqual(availableFields(mixed,[meta]).map(f=>f.periodHours),expected);
  assert.deepEqual([...mixed].sort(compareFields).map(f=>f.periodHours),expected);
  const byKey=new Map(mixed.map(f=>[f.key,f]));
  assert.deepEqual(briefingPresets(meta,mixed).map(p=>byKey.get(p.key).periodHours),expected);
 }
 assert.match(forecastValidity('ens_rain_ge10mm_6h','2026-10-22T00:00:00Z'),/Wed 21 Oct 18:00 to Thu 22 Oct 00:00 UTC/);
});

test('briefing offers optional products before any product metadata has loaded',async()=>{
 const {briefingPresets}=await import('../map-briefing-data.js');
 const ordinary={variables:['precipitation_probability'],reference_time:reference,valid_times:[time]};
 const choices=briefingPresets(ordinary,PRODUCT_FIELDS,'ukmo_uk_ensemble_2km');
 for(const key of ['ens_gust_gt50kt_6h','ens_rain_ge10mm_12h','ens_snow_ge1mm_24h','ens_temperature_le0c_24h','ens_temperature_min_anomaly','ens_temperature_max_anomaly'])assert.ok(choices.some(p=>p.key===key));
 assert.equal(briefingPresets(ordinary,PRODUCT_FIELDS,'snowline_ecmwf_ensemble').filter(p=>p.key.startsWith('ens_temperature_le')).length,0);
 assert.equal(briefingPresets(ordinary,PRODUCT_FIELDS,'snowline_gefs_ensemble').filter(p=>p.group==='Temperature anomalies').length,0);
});

test('probabilities lead the menus, cold thresholds descend from zero, and snow risk belongs with rain and snow',async()=>{
 const {briefingPresets}=await import('../map-briefing-data.js');
 const snow=describeVariable('snowfall_probability',{});
 assert.equal(snow.group,'Rain & snow');assert.equal(variableGroup(snow.key),'Rain & snow');
 const expected=['0','m2','m5','m10'].map(t=>'ens_temperature_le'+t+'c_24h');
 const mixed=[snow,...productChoices('ukmo_uk_ensemble_2km')].reverse();
 const meta={variables:mixed.map(f=>f.key)};
 for(const choices of [availableFields(mixed,[meta]),briefingPresets(meta,mixed)]){
  assert.equal(choices[0].group,'Ensemble probabilities');
  assert.deepEqual(choices.filter(f=>f.key.startsWith('ens_temperature_le')).map(f=>f.key),expected);
  assert.equal(choices.at(-1).key,'snowfall_probability');
 }
});
