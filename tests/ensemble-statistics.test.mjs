import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {ENSEMBLE_DOMAINS,ensembleField} from '../map-ensemble.js';
import {loadSpatialModel,fieldDataURL,hasFieldTime} from '../map-sources.js';
import {sourceVariable,extendCatalogue,availableFields} from '../map-catalogue.js';
import {overlayGroups} from '../map-overlay-specs.js';
import {panelForecastTimes} from '../map-panels.js';
const variables=['geopotential_height_500hPa','temperature_850hPa','pressure_msl'].flatMap(f=>[f+'_mean',f+'_spread']);
const time=h=>new Date(Date.UTC(2026,9,11,h)).toISOString();
const fixture={domain:'snowline_gefs_ensemble',completed:true,reference_time:time(0),variables,valid_times:[0,3,6,12,18,24].map(time)};

test('official statistics have six distinct, physically meaningful scales',()=>{
 const fields=[],settings={colorScales:{}};
 assert.deepEqual(extendCatalogue(fields,[fixture],OM,settings),[]);
 assert.equal(availableFields(fields,[fixture]).length,6);
 for(const key of variables){
  const f=ensembleField(key),scale=settings.colorScales[key];
  assert.equal(scale.unit,key.startsWith('temperature')?'°C':key.startsWith('pressure')?'hPa':'m');
  assert.equal(f.colors.length,f.stops.length);
  assert.ok(f.stops.every((n,i)=>i===0||n>f.stops[i-1]));
  assert.ok(f.contourValues.every(Number.isFinite));
  if(key.endsWith('_spread')){assert.equal(f.stops[0],0);assert.match(f.note,/Standard deviation/);assert.notDeepEqual(scale,settings.colorScales[key.replace('_spread','_mean')]);}
 }
 assert.equal(ensembleField('temperature_2m_spread'),null);
 assert.equal(sourceVariable({...fixture,domain:'unverified_provider'},variables[1]),null);
});

test('own native grids use cycle-specific local URLs with UTC and preserve initialization',async()=>{
 for(const domain of ENSEMBLE_DOMAINS.filter(d=>d.value!=='snowline_mogreps_global')){
  const grid=OM.GridFactory.create(domain.grid);
  assert.equal(grid.nx*domain.grid.dx,360);
  assert.equal((grid.ny-1)*domain.grid.dy,180);
  const meta=await loadSpatialModel(domain.value,async url=>{
   assert.ok(url.endsWith('/ensemble-data/'+domain.value+'/latest.json'));return fixture;
  });
  assert.ok(fieldDataURL(meta,variables[0],time(0)).endsWith('/'+domain.value+'/2026/10/11/0000Z/2026-10-11T0000.om'));
  assert.equal(hasFieldTime(meta,'pressure_msl',time(0)),true);
  assert.equal(sourceVariable(meta,'pressure_msl'),'pressure_msl_mean');
  assert.equal(fieldDataURL(meta,variables[0],time(1)),null);
 }
});

test('MSLP mean avoids duplicate isobars; spread retains actual mean-pressure overlay',()=>{
 const options={url:'om://mean',pressureURL:'om://pressure',contours:true,isobars:true};
 assert.equal(overlayGroups({...options,field:ensembleField('pressure_msl_mean')}).length,1);
 assert.equal(overlayGroups({...options,field:ensembleField('pressure_msl_spread')}).length,2);
});

test('statistics comparison retains every supplied hour without inventing or blending frames',()=>{
 const state={model:'gefs',modelB:'ec',field:variables[0],fieldB:variables[1],compare:true,metas:{gefs:fixture,ec:{...fixture,reference_time:time(12),valid_times:[12,18,24,30].map(time)}}};
 assert.deepEqual(panelForecastTimes(state),[0,3,6,12,18,24,30].map(time));
 assert.equal(fieldDataURL(state.metas.gefs,variables[0],time(30)),null);
 assert.equal(fieldDataURL(state.metas.ec,variables[1],time(3)),null);
});
