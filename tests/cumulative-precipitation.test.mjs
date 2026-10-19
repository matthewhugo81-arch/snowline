import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {averageSeries,cumulativePrecipitation,precipitationTotal} from '../average.js';
import {chartWindow,indexAtX} from '../chart-window.js';
import {VARIABLES,finite,normalise,valueAt,agreement} from '../data.js';
import {nativeSeriesPath,mogrepsLabel} from '../mogreps-point.js';
import {valueAttributes,variableLegend,formatValue} from '../export.js';

const HOUR=3600000,first=Date.UTC(2026,9,19,1);
const hours=n=>Array.from({length:n},(_,i)=>new Date(first+i*HOUR).toISOString().replace('.000Z','Z'));
const rain=VARIABLES.find(v=>v.key==='precipitation');

test('inclusive cumulative values end at the existing displayed-hour total',()=>{
 const values=[1,2,3],original=[...values];
 assert.deepEqual(cumulativePrecipitation(values),{values:[1,3,6],total:6});
 assert.equal(cumulativePrecipitation(values).total,precipitationTotal(values));
 assert.deepEqual(cumulativePrecipitation(values.slice(1)),{values:[2,5],total:5});
 assert.deepEqual(values,original);
 assert.deepEqual(cumulativePrecipitation([0,0]),{values:[0,0],total:0});
 assert.deepEqual(cumulativePrecipitation([]),{values:[],total:null});
});

test('an unknown hour stops the prefix permanently, while a new window can recover',()=>{
 for(const missing of [null,undefined,NaN,Infinity,'2']){
  assert.deepEqual(cumulativePrecipitation([1,missing,3]),{values:[1,null,null],total:null});
  assert.deepEqual(cumulativePrecipitation([missing,2,3]),{values:[null,null,null],total:null});
 }
 assert.deepEqual(cumulativePrecipitation([1,,3]),{values:[1,null,null],total:null});
 const values=[1,null,3,4];
 assert.deepEqual(cumulativePrecipitation(values.slice(2)),{values:[3,7],total:7});
});

test('accumulation uses each available-model mean, even when model horizons differ',()=>{
 const series=[{values:[2,4,null]},{values:[4,null,6]}];
 const mean=averageSeries(series,3);
 assert.deepEqual(mean,{values:[3,4,6],counts:[2,1,1]});
 assert.deepEqual(cumulativePrecipitation(mean.values),{values:[3,7,13],total:13});
 const selected=averageSeries(series.slice(0,1),3);
 assert.deepEqual(cumulativePrecipitation(selected.values),{values:[2,6,null],total:null});
 const outlier=averageSeries(Array.from({length:10},(_,i)=>({values:[0,i===0?50:0,2]})),3);
 assert.deepEqual(cumulativePrecipitation(outlier.values),{values:[0,5,7],total:7});
});

test('MOGREPS native period mean rates conserve their amount without multiplying twice',()=>{
 const times=hours(3),model={intervalHours:3,index:new Map([[times[2],0]]),values:{precipitation:[2]}};
 const values=times.map(time=>valueAt(model,'precipitation',time));
 assert.deepEqual(values,[2,2,2]);
 assert.deepEqual(cumulativePrecipitation(values),{values:[2,4,6],total:6});
 assert.deepEqual(cumulativePrecipitation(values.slice(1)),{values:[2,4],total:4});
});

// Run the real chart/render/inspection functions against a small DOM stand-in.
// This catches a right-axis series accidentally entering the hourly domain or
// inheriting the hourly cursor projection, without a browser/network dependency.
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const rendering=app.slice(app.indexOf('function plot('),app.indexOf('let searchController='));
const imageInfo=app.slice(app.indexOf('const chartImages='),app.indexOf('const chartZoom='));
const modelColour=app.slice(app.indexOf('const modelColour ='),app.indexOf('function populate('));

class Element {
 constructor(id=''){this.id=id;this.clientWidth=320;this.attributes={};this.textContent='';this.hidden=false;this._html='';}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 get innerHTML(){return this._html;}
 set innerHTML(value){
  this._html=value;
  const elements=Array.from(value.matchAll(/<(?:line|circle)\b([^>]+)>/g),match=>{
   const node=new Element();
   for(const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g))node.setAttribute(attr[1],attr[2]);
   return node;
  });
  this.cursor=elements.find(node=>node.getAttribute('class')==='cursor-line');
  this.points=elements.filter(node=>node.getAttribute('class')==='cursor-point');
 }
 closest(){return null;}
 querySelector(selector){return selector==='.cursor-line'?this.cursor:null;}
 querySelectorAll(selector){return selector==='.cursor-point'?this.points:[];}
}

function charts({values=[[1,2,3]],width=320,times=hours(values[0].length)}={}){
 const definitions=values.map((_,i)=>({id:'model'+i,name:'Model '+i,color:'#98552a'}));
 const models=new Map(definitions.map((model,i)=>[model.id,normalise({hourly:{time:times,precipitation:values[i]},_retrievedAt:first},model)]));
 const state={location:{name:'Test',latitude:54,longitude:-2},selected:new Set(models.keys()),models,errors:new Map(),hours:times.length,index:0,zoom:null,times,loading:false};
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};
 const plots=[get('plot-precipitation'),get('agreement-chart')];plots.forEach(plot=>plot.clientWidth=width);
 get('place').textContent='Test';get('coordinates').textContent='54 N · 2 W';get('status').textContent='Forecasts ready';
 const context={state,$:get,chartLayouts:new Map(),plotWidths:new Map(),inspection:null,coverageCache:new WeakMap(),
  chartZoom:{active:false},datasetDialog:{render(){}},VARIABLES:[rain],MODELS:definitions,
  selectedModels:()=>definitions.filter(m=>state.selected.has(m.id)).map(m=>state.models.get(m.id)),
  finite,valueAt,agreement,averageSeries,cumulativePrecipitation,chartWindow,nativeSeriesPath,mogrepsLabel,valueAttributes,variableLegend,formatValue,
  fmt:(value,dec=1)=>finite(value)?value.toFixed(dec):'—',esc:value=>String(value),
  date:new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}),
  shortDate:new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}),
  clock:new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}),URLSearchParams,
  document:{querySelectorAll:selector=>selector==='.plot'?plots:[],querySelector:()=>({})},
  createChartImageMenu:options=>options
 };
 runInNewContext(modelColour+rendering+imageInfo+'\nglobalThis.exportInfo=chartImages.getInfo;',context);
 context.render();
 return {state,nodes,get,context,render:()=>context.render(),inspect:()=>context.renderInspection(),
  layout:()=>context.chartLayouts.get('plot-precipitation'),svg:()=>get('plot-precipitation').innerHTML};
}

test('real precipitation renderer keeps hourly scale independent and allocates a mobile right axis',()=>{
 const view=charts({values:[[1,2,3]],width:280}),initial=view.layout();
 const mean=initial.series.find(s=>s.average),cumulative=initial.series.find(s=>s.cumulative);
 assert.deepEqual(Array.from(cumulative.values),[1,3,6]);
 assert.match(view.svg(),/class="cumulative-line"[^>]+stroke="var\(--chart-cumulative, #1265dc\)"/);
 assert.match(view.svg(),/class="cumulative-axis"[^>]+>mm<\/text>/);
 assert.match(view.svg(),/Hourly precipitation uses the left mm\/h axis/);
 assert.equal(initial.seriesY[initial.series.indexOf(mean)](3.24),initial.top);
 const before=initial.y(2);
 cumulative.values=[1000,2000,3000];
 view.context.plot(view.get('plot-precipitation'),initial.series,rain,initial.times);
 const layout=view.layout();
 assert.equal(layout.y(2),before,'cumulative mm must not change the hourly y projection');
 assert.ok(layout.width-layout.left-layout.inner>=48,'reserve space for right ticks');
 assert.equal(indexAtX(layout.left+layout.inner,layout),2,'zoom endpoint follows reduced plot width');
 assert.ok(layout.seriesY.at(-1)(3000)>=layout.top&&layout.seriesY.at(-1)(3000)<layout.height-layout.bottom);
 assert.ok(!/NaN|Infinity/.test(view.svg()));
});

test('inspection updates cumulative markers on the right scale and displays its own mm readout',()=>{
 const view=charts({values:[[1,2,3]]}),layout=view.layout();
 view.state.index=2;view.inspect();
 const cumulativeIndex=layout.series.findIndex(s=>s.cumulative),point=layout.points[cumulativeIndex];
 assert.equal(Number(point.getAttribute('cy')),layout.seriesY[cumulativeIndex](6));
 assert.notEqual(Number(point.getAttribute('cy')),layout.y(6));
 assert.equal(Number(point.getAttribute('cx')),layout.x(2));
 assert.match(view.get('values-precipitation').innerHTML,/Cumulative <b>6\.0 mm<\/b> <small>\(right axis\)<\/small>/);
 const broken=charts({values:[[1,null,3]]});broken.state.index=2;broken.inspect();
 assert.equal(broken.layout().points.at(-1).getAttribute('display'),'none');
 assert.match(broken.get('values-precipitation').innerHTML,/Cumulative <b>— mm/);
 assert.match(broken.get('precipitation-total').textContent,/Accumulated precipitation: — · Incomplete hourly data/);
 const path=broken.svg().match(/class="cumulative-line" d="([^"]*)"/)[1];
 assert.equal((path.match(/M/g)||[]).length,1);
 assert.equal((path.match(/L/g)||[]).length,0,'do not resume a line after a missing mean');
});

test('zoom, horizon and model changes recompute the line and retain inclusive footer coverage',()=>{
 const view=charts({values:[Array(168).fill(1),Array(168).fill(3)]});
 assert.equal(view.layout().series.at(-1).values.at(-1),336);
 assert.match(view.get('precipitation-total').textContent,/Accumulated precipitation: 336\.0 mm/);
 assert.match(view.get('precipitation-total').textContent,/Covers Mon 19 Oct, 00:00/);
 assert.match(view.get('precipitation-total').textContent,/MOGREPS-G: 3 h period means/);
 view.state.hours=24;view.render();
 assert.equal(view.layout().series.at(-1).values.at(-1),48);
 view.state.zoom={start:2,end:4};view.render();
 assert.deepEqual(Array.from(view.layout().series.at(-1).values),[2,4,6]);
 assert.match(view.get('precipitation-total').textContent,/Covers Mon 19 Oct, 02:00 – Mon 19 Oct, 05:00 UTC/);
 view.state.selected.delete('model1');view.render();
 assert.deepEqual(Array.from(view.layout().series.at(-1).values),[1,2,3]);
 view.state.zoom=null;view.render();
 assert.equal(view.layout().series.at(-1).values.at(-1),24);
});

test('all-dry charts retain a usable cumulative scale and selected-model means may have partial coverage',()=>{
 const dry=charts({values:[[0,0,0]]});
 assert.equal(dry.layout().series.at(-1).values.at(-1),0);
 assert.ok(!/NaN|Infinity/.test(dry.svg()));
 assert.match(dry.get('precipitation-total').textContent,/Accumulated precipitation: 0\.0 mm/);
 const partial=charts({values:[[2,4,null],[4,null,6]]});
 assert.deepEqual(Array.from(partial.layout().series.at(-1).values),[3,7,13]);
 assert.match(partial.get('precipitation-total').textContent,/Accumulated precipitation: 13\.0 mm/);
});

test('image export metadata includes the blue cumulative legend and the SVG retains right-axis labels',()=>{
 const view=charts(),info=view.context.exportInfo('plot-precipitation');
 const cumulative=info.legend.find(item=>item.name==='Cumulative average · mm (right)');
 assert.ok(cumulative);
 assert.equal(cumulative.color,'var(--chart-cumulative, #1265dc)');
 assert.equal(cumulative.average,true,'use the prominent mean-line swatch in images');
 assert.equal(cumulative.ensemble,false);
 assert.match(view.svg(),/class="cumulative-line"/);
 assert.match(view.get('precipitation-total').textContent,/Accumulated precipitation: 6\.0 mm/);
 assert.match(info.period,/Mon 19 Oct, 01:00 – Mon 19 Oct, 03:00 UTC/);
});
