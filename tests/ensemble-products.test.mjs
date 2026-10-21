import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PRODUCT_FIELDS,PRODUCT_DOMAINS,productChoices,verifyProduct,loadProducts,PRODUCT_BASE,productPath} from '../map-ensemble-products.js';
import {variableGroup,sourceVariable,describeVariable} from '../map-catalogue.js';
import {forecastValidity} from '../map-validity.js';
const reference='2026-10-21T12:00:00Z',time='2026-10-22T00:00:00Z',key='ens_gust_gt50kt_12h';
const meta=()=>({format_version:1,domain:'snowline_mogreps_uk_products',reference_time:reference,member_count:18,source_cycles:Array.from({length:6},(_,i)=>new Date(Date.parse(reference)-i*3600000).toISOString()),variables:[key],valid_times:[time],variable_valid_times:{[key]:[time]},variable_intervals:{[key]:{[time]:{hours:12,start:reference,end:time}}}});
test('two headers, anomalies exclusively MOGREPS-UK, distinct rain/snow semantics',()=>{
 for(const model of ['snowline_ecmwf_ensemble','snowline_gefs_ensemble','snowline_mogreps_global'])assert.ok(productChoices(model).every(f=>f.group!=='Temperature anomalies'));
 assert.equal(productChoices('ukmo_uk_ensemble_2km').filter(f=>f.group==='Temperature anomalies').length,2);
 for(const f of PRODUCT_FIELDS){assert.equal(variableGroup(f.key),f.group);assert.equal(describeVariable(f.key,{}),f);}
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
 assert.equal(PRODUCT_DOMAINS.length,4);assert.match(forecastValidity(key,time),/12:00 to 22 Oct 00:00 UTC/);
});
test('ordinary model loading and publication do not import or run new processing',async()=>{
 const sources=await readFile(new URL('../map-sources.js',import.meta.url),'utf8');assert.ok(!sources.includes('loadProducts'));
 const core=await readFile(new URL('../.github/workflows/publish-maps.yml',import.meta.url),'utf8');assert.ok(!core.includes('build_ensemble_products'));
});
