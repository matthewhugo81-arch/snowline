import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {BRIEFING_PRESETS,briefingPresets,briefingTimes,briefingCaption} from '../map-briefing-data.js';
import {BriefingRenderer,briefingSettings} from '../map-briefing-renderer.js';
import {sourceVariable} from '../map-catalogue.js';
import {combineSources,fieldDataURL} from '../map-sources.js';
import {DERIVED_DEW_POINT,dewPointRule} from '../map-dew-point.js';
import {coastlineController} from '../map-appearance.js';

const time=hour=>new Date(Date.UTC(2026,9,12,hour)).toISOString();
const ukv={domain:'ukmo_uk_deterministic_2km',reference_time:time(3),variables:['temperature_2m','relative_humidity_2m','pressure_msl'],valid_times:[3,4,5,6,7,8,9,10,11,12].map(time)};
const temperature=BRIEFING_PRESETS.find(p=>p.id==='temperature');
const dewPoint=BRIEFING_PRESETS.find(p=>p.id==='dew-point');

test('UKV main and hourly-nowcast briefings offer temperature and dew point, not invented extrema',()=>{
 for(const hour of [3,5]){
  const meta={...ukv,reference_time:time(hour),valid_times:ukv.valid_times.filter(t=>Date.parse(t)>=Date.parse(time(hour)))};
  assert.deepEqual(briefingPresets(meta).map(p=>p.id),['temperature','dew-point']);
  assert.equal(temperature.field,'temperature_2m');
  assert.equal(dewPoint.field,'dew_point_2m');
  assert.equal(sourceVariable(meta,dewPoint.field),DERIVED_DEW_POINT);
  for(const preset of [temperature,dewPoint]){
   assert.deepEqual(briefingTimes(meta,preset,{regional:true},'6'),meta.valid_times);
   assert.equal(briefingCaption(meta,preset,time(hour)),'T+000');
   assert.match(fieldDataURL(meta,preset.field,time(hour)),new RegExp('/'+String(hour).padStart(2,'0')+'00Z/'));
  }
 }
});

test('surface briefing availability requires pressure and complete same-grid dew-point inputs',()=>{
 assert.deepEqual(briefingPresets({...ukv,variables:['temperature_2m','pressure_msl']}).map(p=>p.id),['temperature']);
 assert.deepEqual(briefingPresets({...ukv,variables:['temperature_2m','relative_humidity_2m']}),[]);
 const split=combineSources({...ukv,variables:['temperature_2m','pressure_msl']},[{...ukv,variables:['relative_humidity_2m']}]);
 assert.ok(!briefingPresets(split).includes(dewPoint));
});

test('native dew point takes precedence and supported other models use the same surface presets',()=>{
 const native={...ukv,domain:'ecmwf_ifs',variables:['temperature_2m','dew_point_2m','pressure_msl']};
 assert.deepEqual(briefingPresets(native).map(p=>p.id),['temperature','dew-point']);
 assert.equal(sourceVariable(native,dewPoint.field),'dew_point_2m');
 assert.equal(sourceVariable({...ukv,variables:[...ukv.variables,'dew_point_2m']},dewPoint.field),'dew_point_2m');
});

test('surface briefings use matching field times and do not invent hours',()=>{
 const surface={...ukv,variables:['temperature_2m','relative_humidity_2m'],valid_times:[3,4,6].map(time)};
 const pressure={...ukv,variables:['pressure_msl'],valid_times:[4,5,6].map(time)};
 const combined=combineSources(surface,[pressure]);
 for(const preset of [temperature,dewPoint])assert.deepEqual(briefingTimes(combined,preset,{regional:true}),[4,6].map(time));
});

test('briefing keeps the existing temperature and dew-point Celsius colour scales unchanged',()=>{
 const scales={cloud_cover:{breakpoints:[0,100],colors:[[0,0,0,1],[255,255,255,1]]},precipitation:{breakpoints:[0,1],colors:[[255,255,255,1],[0,0,255,1]]},temperature_2m:{unit:'°C',breakpoints:[-10,0,10],colors:[[0,0,255,1],[255,255,255,1],[255,0,0,1]]},dew_point_2m_derived:{unit:'°C',breakpoints:[-15,0,15],colors:[[0,0,255,1],[255,255,255,1],[255,0,0,1]]}};
 const original=structuredClone(scales),result=briefingSettings({colorScales:scales});
 for(const key of ['temperature_2m',DERIVED_DEW_POINT])assert.deepEqual(result.colorScales[key],original[key]);
 assert.deepEqual(scales,original);
});

test('briefing renderer installs UKV dew-point derivation for its own reader and reads matching temperature/RH grids',async t=>{
 const savedDocument=globalThis.document;
 let renderer;
 const documentEvents=new EventTarget();
 globalThis.document={hidden:false,addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents),createElement:()=>({setAttribute(){},remove(){}}),body:{append(){}}};
 t.after(()=>{renderer?.destroy();if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;});
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(url,'coastline.geojson');return {ok:true,json:async()=>({type:'FeatureCollection',features:[]})};});
 class Events{
  events=new Map();
  on(name,callback){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(callback);return this;}
  off(name,callback){this.events.get(name)?.delete(callback);return this;}
  emit(name,event={}){for(const callback of [...this.events.get(name)??[]])callback(event);}
  once(name,callback){const wrapped=event=>{this.off(name,wrapped);callback(event);};return this.on(name,wrapped);}
 }
 class MapStub extends Events{
  layers=[];sources=new Map();styleLoaded=false;removed=false;
  constructor(){super();queueMicrotask(()=>{this.styleLoaded=true;this.emit('style.load');this.emit('load');});}
  getStyle(){return this.styleLoaded?{layers:this.layers}:undefined;}
  isStyleLoaded(){return this.styleLoaded;}
  getSource(id){return this.sources.get(id);}
  getLayer(id){return this.layers.find(layer=>layer.id===id);}
  isSourceLoaded(id){return !!this.getSource(id)?.loaded;}
  addSource(id,options){
   const map=this,source=Object.assign(new Events(),options,{loaded:false,setData(data){
    this.data=data;this.loaded=false;this.emit('dataloading',{dataType:'source'});
    queueMicrotask(()=>{if(map.getSource(id)!==this||map.removed)return;this.loaded=true;this.emit('data',{dataType:'source',sourceDataType:'content'});map.triggerRepaint();});
    return this;
   }});
   this.sources.set(id,source);if(options.type==='geojson')source.setData(options.data);
  }
  removeSource(id){this.sources.delete(id);}
  addLayer(layer,before){const i=this.layers.findIndex(item=>item.id===before);this.layers.splice(i<0?this.layers.length:i,0,layer);}
  removeLayer(id){this.layers=this.layers.filter(layer=>layer.id!==id);}
  moveLayer(id,before){const layer=this.getLayer(id);this.removeLayer(id);this.addLayer(layer,before);}
  triggerRepaint(){queueMicrotask(()=>{if(!this.removed)this.emit('render');});}
  remove(){this.removed=true;this.emit('remove');}
 }
 const settings={...OM.defaultOmProtocolSettings,colorScales:{...OM.defaultOmProtocolSettings.colorScales,cloud_cover:{breakpoints:[0,100],colors:[[0,0,0,1],[255,255,255,1]]},precipitation:{breakpoints:[0,1],colors:[[255,255,255,1],[0,0,255,1]]}}};
 renderer=new BriefingRenderer({maplibre:{Map:MapStub,addProtocol(){},removeProtocol(){}},OM,settings,fields:[],createURL(){}});
 await renderer.ready;
 const coastline=coastlineController(renderer.map);await coastline.wait({timeout:1000});
 assert.equal(coastline.isReady(),true,'the briefing uses the same completed coastline controller');
 const reader=OM.getProtocolInstance(renderer.settings).omFileReader;
 assert.equal(reader.allDerivationRules.filter(r=>r.pattern.toString()===dewPointRule.pattern.toString()).length,1);
 const original=reader.withReader,reads=[],ranges=[{start:0,end:1},{start:0,end:3}],signal=new AbortController().signal;
 reader.withReader=async(url,callback)=>callback({getChildByName:async key=>({
  getDimensions:()=>[1,3],scaleFactor:()=>20,dispose(){},
  read:async options=>{reads.push({url,key,options});return Float32Array.from(key==='temperature_2m'?[20,-5,NaN]:[50,80,60]);}
 })});
 try{
  const url=fieldDataURL(ukv,dewPoint.field,time(6));
  const data=await reader.readVariable(url,DERIVED_DEW_POINT,ranges,signal);
  assert.ok(Math.abs(data.values[0]-9.2611)<.001);
  assert.ok(Math.abs(data.values[1]-(-7.9))<.05);
  assert.ok(Number.isNaN(data.values[2]));
  assert.deepEqual(reads.map(r=>r.key),['temperature_2m','relative_humidity_2m']);
  assert.ok(reads.every(r=>r.url===url&&r.options.ranges===ranges&&r.options.signal===signal));
 }finally{reader.withReader=original;}
});
