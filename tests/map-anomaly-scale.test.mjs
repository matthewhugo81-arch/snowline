import test from 'node:test';
import assert from 'node:assert/strict';
import * as OM from '../vendor/index.mjs';
import {ANOMALY_SCALE,anomalyLegend} from '../map-anomaly-scale.js';
import {productChoices} from '../map-ensemble-products.js';
import {rasterResampling} from '../map-appearance.js';
import {chartScales,composeChartImage} from '../map-image-export.js';
const rgba=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16),1];
const scale={type:'breakpoint',breakpoints:ANOMALY_SCALE.stops,colors:ANOMALY_SCALE.colors.map(rgba)};
const color=value=>OM.getColor(scale,value,false);
test('both extrema for MOGREPS-UK and EC ENS use the approved one-degree bands',()=>{
 for(const model of ['ukmo_uk_ensemble_2km','snowline_ecmwf_ensemble']){
  const fields=productChoices(model).filter(f=>f.group==='Temperature anomalies');
  assert.deepEqual(fields.map(f=>f.key).sort(),['ens_temperature_max_anomaly','ens_temperature_min_anomaly']);
  for(const f of fields){assert.equal(f.anomalyBands,1);assert.deepEqual(f.stops,ANOMALY_SCALE.stops);assert.deepEqual(f.colors,ANOMALY_SCALE.colors);assert.equal(rasterResampling(f),'nearest');assert.equal(f.periodHours,24);}
  for(const f of productChoices(model).filter(f=>f.group!=='Temperature anomalies'))assert.equal(f.anomalyBands,undefined);
 }
});
test('renderer bins change exactly at integer degrees and preserve the endpoint caps',()=>{
 for(let low=-10;low<10;low++){
  assert.deepEqual(color(low),color(low+.99999));
  assert.notDeepEqual(color(low-.00001),color(low));
 }
 assert.deepEqual(color(-100),rgba('#174879'));assert.deepEqual(color(100),rgba('#990b0d'));
 for(const [v,c] of [[-1.5,'#d6ebf4'],[-.5,'#edf6fb'],[.5,'#fff3f0'],[1.5,'#fce4de'],[2.5,'#fbdad2'],[3.5,'#fbd2ca']])assert.deepEqual(color(v),rgba(c));
 const luminance=v=>{const c=color(v);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 for(let v=.5;v<9;v++)assert.ok(luminance(v)>luminance(v+1),'warm colours progressively darken');
 for(let v=-9.5;v<-.5;v++)assert.ok(luminance(v)<luminance(v+1),'cold colours get paler towards zero');
});
test('on-screen and exported legends agree with the twenty actual interior bands',async()=>{
 const f=productChoices('snowline_ecmwf_ensemble').find(f=>f.key==='ens_temperature_max_anomaly'),legend=anomalyLegend(f),[exported]=chartScales(f,'24 h');
 assert.equal(legend.min,-10);assert.equal(legend.max,10);assert.equal(legend.colors.length,20);
 assert.deepEqual(exported.colors,legend.colors);assert.deepEqual(exported.endColors,legend.endColors);assert.equal(exported.discrete,true);assert.equal(exported.bands,false);
 assert.equal(exported.labels[0],'-10');assert.equal(exported.labels.at(-1),'+10');assert.match(exported.note,/1°C colour bands/);
 for(let i=0;i<20;i++)assert.deepEqual(rgba(legend.colors[i]),color(i-9.5));
 const fills=[],ctx={fillStyle:'',measureText:t=>({width:t.length*5}),drawImage(){},fillText(){},fillRect(...args){fills.push({color:this.fillStyle,args});},strokeRect(){},scale(){},createLinearGradient(){throw Error('Discrete export must not blend colours');}};
 const root={createElement:()=>({getContext:()=>ctx,toBlob:done=>done(new Blob(['PNG']))})};
 await composeChartImage({image:{width:800,height:600},width:800,title:'EC ENS maximum anomaly',scales:[exported]},{root});
 assert.deepEqual(fills.filter(x=>x.args[3]===12).map(x=>x.color),[...legend.colors,...legend.endColors]);
});
