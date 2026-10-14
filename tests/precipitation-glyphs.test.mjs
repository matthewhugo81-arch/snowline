import test from 'node:test';
import assert from 'node:assert/strict';
import {symbolRadius,SYMBOL_RATE_POINTS,SYMBOL_DIAMETERS,SYMBOL_SPACING,SYMBOL_HALO,
 MAX_CLUSTER_EXTENT,makeSymbolSample,layoutSymbolGlyphs,symbolSamplesOverlap,
 thinSymbolSamples,drawPrecipitationSymbols} from '../map-precipitation-glyphs.js';
const glyph=(rate,mechanism='dynamic')=>({kind:mechanism==='convective'?'showers':'rain',mechanism,rate,radius:symbolRadius(rate,mechanism==='convective')});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('six circle-size anchors, threshold and cap',()=>{
 for(let i=0;i<SYMBOL_RATE_POINTS.length;i++)close(2*symbolRadius(SYMBOL_RATE_POINTS[i]),SYMBOL_DIAMETERS[i]);
 for(const value of [NaN,Infinity,-Infinity,-1,0,.0999])assert.equal(symbolRadius(value),0);
 assert.equal(symbolRadius(1000),7.5);
 assert.ok(symbolRadius(2,true)<symbolRadius(2));
});
test('size is monotonic and continuous at every anchor',()=>{
 let previous=0;
 for(let rate=.1;rate<100;rate*=1.005){const radius=symbolRadius(rate);assert.ok(radius>=previous);previous=radius;}
 for(const rate of SYMBOL_RATE_POINTS.slice(1))assert.ok(Math.abs(symbolRadius(rate*(1-1e-8))-symbolRadius(rate*(1+1e-8)))<1e-6);
});
test('packing keeps all one, two and three supplied components separate',()=>{
 for(const rates of [[.1],[8],[.1,8],[8,.1],[8,8],[.1,.5,8],[8,8,8],[8,.1,.2]]){
  const glyphs=rates.map((r,i)=>glyph(r,['dynamic','convective','snow'][i]));
  const placed=layoutSymbolGlyphs(glyphs);assert.equal(placed.length,rates.length);
  const sample=makeSymbolSample(0,0,glyphs);assert.ok(sample.extent<=MAX_CLUSTER_EXTENT);
  for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++){
   assert.ok(Math.hypot(placed[i].dx-placed[j].dx,placed[i].dy-placed[j].dy)>=placed[i].radius+placed[j].radius+3.19);
  }
 }
 assert.deepEqual(layoutSymbolGlyphs([]),[]);
 assert.throws(()=>layoutSymbolGlyphs([glyph(0)]),/radius/);
});
function field(left,right,top,bottom,uniform=false){
 const samples=[];
 for(let row=top;row<bottom;row++)for(let column=left;column<right;column++){
  const rate=uniform?8:.1+Math.abs(Math.sin(column*.11)*Math.cos(row*.13))*12;
  const glyphs=[glyph(rate)];
  if((column+row)%3!==0)glyphs.push(glyph(rate*.7,'convective'));
  if((column+row)%5===0)glyphs.push(glyph(rate*.3,'snow'));
  samples.push(makeSymbolSample(column,row,glyphs.filter(g=>g.rate>=.1)));
 }
 return samples;
}
const ids=samples=>samples.map(s=>s.column+','+s.row).sort();
test('light precipitation retains the original 16-pixel coverage',()=>{
 const samples=[];for(let row=0;row<20;row++)for(let col=0;col<20;col++)samples.push(makeSymbolSample(col,row,[glyph(.2)]));
 assert.equal(thinSymbolSamples(samples).length,samples.length);
});
test('collision thinning is deterministic and leaves no intersecting clusters',()=>{
 const samples=field(-5,26,-5,26),visible=thinSymbolSamples(samples);
 assert.deepEqual(ids(visible),ids(thinSymbolSamples([...samples].reverse())));
 assert.ok(visible.length>samples.length/10);assert.ok(visible.length<samples.length);
 for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++)assert.equal(symbolSamplesOverlap(visible[i],visible[j]),false);
});
test('uniform heavy precipitation remains distributed across the map',()=>{
 const visible=thinSymbolSamples(field(-10,42,-10,42,true));
 for(let y=0;y<32;y+=8)for(let x=0;x<32;x+=8){
  assert.ok(visible.some(s=>s.column>=x&&s.column<x+8&&s.row>=y&&s.row<y+8),`empty block ${x},${y}`);
 }
});
test('tile halos reproduce one global decision on all four edges',()=>{
 const all=field(-12,80,-12,80),global=thinSymbolSamples(all);
 for(const [tx,ty] of [[0,0],[1,0],[0,1],[1,1]]){
  const left=tx*512,top=ty*512;
  const local=thinSymbolSamples(all.filter(s=>s.x>=left-SYMBOL_HALO&&s.x<left+512+SYMBOL_HALO&&s.y>=top-SYMBOL_HALO&&s.y<top+512+SYMBOL_HALO));
  const paintable=s=>s.x>=left-MAX_CLUSTER_EXTENT&&s.x<=left+512+MAX_CLUSTER_EXTENT&&s.y>=top-MAX_CLUSTER_EXTENT&&s.y<=top+512+MAX_CLUSTER_EXTENT;
  assert.deepEqual(ids(local.filter(paintable)),ids(global.filter(paintable)));
 }
 assert.equal(512%SYMBOL_SPACING,0);
 assert.ok(SYMBOL_HALO>=3*MAX_CLUSTER_EXTENT);
});
test('round, open-V, triangle and snow paths remain distinct and hollow',()=>{
 const paths=[];let current;
 const ctx={setLineDash(){},beginPath(){current=[];paths.push(current);},arc(...a){current.push(['arc',...a]);},moveTo(...a){current.push(['move',...a]);},lineTo(...a){current.push(['line',...a]);},closePath(){current.push(['close']);},stroke(){}};
 for(const g of [glyph(2),glyph(.2,'convective'),glyph(2,'snow')])drawPrecipitationSymbols(ctx,[g],20,20);
 // Add a closed convective path separately to check both convection shapes.
 drawPrecipitationSymbols(ctx,[glyph(2,'convective')],20,20);
 assert.ok(paths[0].some(p=>p[0]==='arc'));
 assert.ok(!paths[1].some(p=>p[0]==='close'));
 assert.equal(paths[2].filter(p=>p[0]==='line').length,3);
 assert.ok(paths[3].some(p=>p[0]==='close'));
});
