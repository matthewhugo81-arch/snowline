import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {WEATHER_COMPOSITE as KEY,COMPOSITE_FIELDS,compositeField,compositeSettings,compositeURL,isCompositeURL,compositeUnderlay} from '../map-weather-composite.js';
import {sourceVariable,availableFields,extendCatalogue,PRECIPITATION_SCALE,CLOUD_COVER_SCALE,variableGroup} from '../map-catalogue.js';
import {fieldSource,hasFieldTime,fieldDataURL,fieldIntervalHours,combineSources} from '../map-sources.js';
import {panelForecastTimes} from '../map-panels.js';
import {ForecastFrames} from '../map-frames.js';
import {createFramePrefetch} from '../map-prefetch.js';
import {FakeMap,loaded} from './frame-fake.mjs';
const time=h=>new Date(Date.UTC(2026,9,12,h)).toISOString();
const meta=(domain,variables=COMPOSITE_FIELDS,times=[0,1,2,3],run=0)=>({domain,variables:[...variables],reference_time:time(run),valid_times:times.map(time)});
const fields=[compositeField(PRECIPITATION_SCALE)];

test('composite requires cloud and TOTAL precipitation, with optional matching MSLP',()=>{
 const complete=meta('ukmo_uk_deterministic_2km');
 assert.equal(sourceVariable(complete,KEY),'precipitation');
 assert.equal(variableGroup(KEY),'Combined weather');
 assert.equal(availableFields(fields,[complete]).length,1);
 for(const missing of ['cloud_cover','precipitation']){const partial=meta('ukmo_uk_deterministic_2km',COMPOSITE_FIELDS.filter(f=>f!==missing));assert.equal(sourceVariable(partial,KEY),null);assert.equal(availableFields(fields,[partial]).length,0);}
 assert.equal(sourceVariable(meta('ukmo_uk_deterministic_2km',['cloud_cover','rain','pressure_msl']),KEY),null);
 assert.equal(sourceVariable(meta('knmi_harmonie_arome_europe',['cloud_cover','precipitation']),KEY),'precipitation');
 assert.equal(sourceVariable(null,KEY),null);
});

test('composite supports same-run companion grids but rejects a different-cycle component',()=>{
 const surface=meta('ncep_gfs013',['cloud_cover','precipitation']);
 const pressure=meta('ncep_gfs025',['pressure_msl']);
 const complete=combineSources(surface,[pressure]);
 assert.equal(sourceVariable(complete,KEY),'precipitation');
 assert.equal(fieldSource(complete,KEY,time(1)).domain,'ncep_gfs013');
 const mixed={...complete,sources:[surface,{...pressure,reference_time:time(6)}]};
 assert.equal(sourceVariable(mixed,KEY),'precipitation');
 assert.equal(hasFieldTime(mixed,KEY,time(1)),true);
 const wrongCloud={...complete,sources:[{...surface,reference_time:time(6)},pressure]};
 assert.equal(sourceVariable(wrongCloud,KEY),null);
 assert.equal(hasFieldTime(wrongCloud,KEY,time(1)),false);
});

test('pressure gaps preserve cloud and rain at all valid precipitation hours',()=>{
 const surface=meta('ncep_gfs013',['cloud_cover','precipitation','temperature_2m']);
 const pressure=meta('ncep_gfs025',['pressure_msl'],[0,2,3]);
 const complete=combineSources(surface,[pressure]);
 assert.equal(hasFieldTime(complete,KEY,time(0)),false);
 assert.equal(hasFieldTime(complete,KEY,time(1)),true);
 assert.equal(hasFieldTime(complete,KEY,time(2)),true);
 const state={model:'gfs',field:KEY,modelB:'ukv',fieldB:'temperature_2m',compare:true,metas:{gfs:complete,ukv:meta('ukmo_uk_deterministic_2km',['temperature_2m'],[1,2])}};
 assert.deepEqual(panelForecastTimes(state),[time(1),time(2),time(3)]);
 assert.match(fieldDataURL(complete,KEY,time(2)),/ncep_gfs013\/2026\/10\/12\/0000Z\/2026-10-12T0200\.om$/);
 assert.ok(fieldDataURL(complete,KEY,time(1)));
 assert.equal(hasFieldTime(complete,'pressure_msl',time(1)),false);
 assert.equal(fieldIntervalHours(complete,KEY,time(2)),1,'Pressure gaps do not lengthen precipitation accumulation');
 assert.equal(fieldIntervalHours(meta('ecmwf_ifs',COMPOSITE_FIELDS,[0,3,6]),KEY,time(6)),1,'Sparse publication does not change the verified native interval');
});

test('combined palette matches the briefing while preserving ordinary cloud and precipitation colours',()=>{
 const rgba=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),1];
 const settings={colorScales:{cloud_cover:{breakpoints:CLOUD_COVER_SCALE.stops,colors:CLOUD_COVER_SCALE.colors.map(rgba)},precipitation:{type:'breakpoint',breakpoints:PRECIPITATION_SCALE.stops,colors:PRECIPITATION_SCALE.colors.map(rgba)}}};
 const before=JSON.stringify(settings),styled=compositeSettings(settings);
 assert.equal(JSON.stringify(settings),before);
 assert.deepEqual(styled.colorScales.cloud_cover.colors[0],[65,65,65,1]);
 assert.deepEqual(styled.colorScales.cloud_cover.colors.at(-1),[230,230,230,1]);
 assert.equal(styled.colorScales.precipitation.colors[0][3],0);
 assert.equal(OM.getColor(styled.colorScales.precipitation,.499,false)[3],0);
 assert.equal(OM.getColor(styled.colorScales.precipitation,.5,false)[3],1);
 assert.deepEqual(styled.colorScales.precipitation.colors.slice(1),settings.colorScales.precipitation.colors.slice(1));
 // Extending the catalogue must not overwrite cloud's scale with the composite numeric (precipitation) scale.
 const catalogue=[...fields,{key:'cloud_cover',name:'Total cloud cover',unit:'%',...CLOUD_COVER_SCALE}];
 extendCatalogue(catalogue,[meta('ukmo_uk_deterministic_2km')],OM,settings);
 assert.equal(settings.colorScales.cloud_cover.unit,'%');
});

test('composite URLs retain a distinct style key across metadata, tiles, cache and readouts',()=>{
 const original='om://https://example.test/model/2026-10-12T0300.om?variable=precipitation';
 const combined=compositeURL(original);
 assert.notEqual(combined,original);
 assert.equal(isCompositeURL(original),false);
 assert.equal(isCompositeURL(combined),true);
 assert.equal(isCompositeURL(combined+'/4/7/5'),true);
 assert.equal(isCompositeURL(combined.replace('=1','=10')),false);
 assert.equal(new URL(combined.slice(5)).searchParams.get('variable'),'precipitation');
});

test('cloud, precipitation and pressure load atomically; cloud remains underneath rain and map lines after stepping',async()=>{
 const map=new FakeMap();map.addLayer({id:'coast',type:'line'});map.addLayer({id:'places',type:'symbol'});
 const decorate=()=>[compositeUnderlay('om://cloud'),{id:'mslp',source:{type:'vector',url:'om://pressure'},layers:[{id:'mslp-lines',type:'line'}]}];
 const cache=new ForecastFrames(map,'combo',{decorate,rasterBefore:'coast',overlayBefore:'places'});
 try{
  const first=cache.prepare('om://precip-1');
  map.sources.get(first.id).loaded=true;map.sources.get(first.id+'-mslp').loaded=true;
  assert.equal(cache.sourcesReady(first),false,'Precipitation and pressure alone cannot commit');
  map.load(first);await first.ready;cache.show(first,.8,'nearest');
  const position=id=>map.layers.findIndex(layer=>layer.id===id);
  assert.ok(position(first.id+'-cloud-image')<position(first.layer));
  assert.ok(position(first.layer)<position('coast'));
  assert.ok(position('coast')<position(first.id+'-mslp-lines'));
  assert.equal(map.getLayer(first.id+'-cloud-image').paint['raster-opacity'],.8);
  const second=await loaded(cache,map,'om://precip-2');cache.show(second,.4,'nearest');
  assert.ok(position(first.layer)<position('background'),'Old composite is hidden as a complete frame');
  assert.ok(position(second.id+'-cloud-image')<position(second.layer));
  assert.equal(map.getLayer(second.id+'-cloud-image').paint['raster-opacity'],.4);
  cache.show(first,.6,'nearest');assert.ok(position(first.id+'-cloud-image')<position(first.layer));
 }finally{cache.clear();}
 assert.equal(map.sources.size,0,'All component sources are released');
});

test('prefetch prepares all three component sources and propagates failures, without extra live maps',async()=>{
 const requests=[];
 const map={coveringTiles:()=>[{canonical:{z:4,x:7,y:5}}]};
 const cache={protocol:async({url})=>({data:{tiles:[url+'/{z}/{x}/{y}']}}),prefetch:async p=>{requests.push(p);}};
 const decorate=()=>[compositeUnderlay('om://cloud'),{source:{type:'vector',url:'om://pressure'}}];
 await createFramePrefetch(map,cache,decorate)('om://precip',new AbortController());
 assert.deepEqual(requests.map(p=>p.type),['image','image','arrayBuffer']);
 cache.prefetch=async p=>{if(p.url.includes('cloud'))throw Error('Missing cloud');};
 await assert.rejects(createFramePrefetch(map,cache,decorate)('om://precip',new AbortController()),/Missing cloud/);
});
