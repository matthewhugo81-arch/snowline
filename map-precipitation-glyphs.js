// Presentation only: rates and precipitation mechanisms are supplied by the model reader.
export const SYMBOL_STYLE='20261024-ifs-gem-showers1';
export const SYMBOL_SPACING=16;
export const SYMBOL_HALO=96;
export const MAX_CLUSTER_EXTENT=24;
export const SYMBOL_RATE_POINTS=Object.freeze([.1,.5,1,2,4,8]);
export const SYMBOL_DIAMETERS=Object.freeze([5,7,9,11,13,15]);
export const SYMBOL_SIZE_NOTE='Continuous size scale, anchored at 0.1 / 0.5 / 1 / 2 / 4 / 8 mm/h water equivalent; below 0.1 is unplotted and size is capped at 8 mm/h.';
export const SYMBOL_COLORS={rain:'#1535d8',precipitation:'#1535d8',showers:'#1535d8',mixed:'#11833b',snow:'#db2387',freezing:'#8c34b8',ice:'#b77505',other:'#586575'};
const PADDING=1.6;
const STROKE=1.7;
const HALO_STROKE=3.1;
// Spatial rather than rainfall priority avoids deleting an entire monotonic
// rainband in favour of its local maxima. Equal ranks are 64 px apart.
const PRIORITY=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const mod4=value=>((value%4)+4)%4;

export function symbolRadius(rate,convective=false){
 if(!Number.isFinite(rate)||rate<SYMBOL_RATE_POINTS[0])return 0;
 let diameter=SYMBOL_DIAMETERS.at(-1);
 for(let i=1;i<SYMBOL_RATE_POINTS.length;i++){
  if(rate<SYMBOL_RATE_POINTS[i]){
   const lower=SYMBOL_RATE_POINTS[i-1],upper=SYMBOL_RATE_POINTS[i];
   const fraction=Math.log(rate/lower)/Math.log(upper/lower);
   diameter=SYMBOL_DIAMETERS[i-1]+fraction*(SYMBOL_DIAMETERS[i]-SYMBOL_DIAMETERS[i-1]);
   break;
  }
 }
 return diameter/2*(convective?.86:1);
}

// Separate all supplied components, rather than keeping only a dominant one.
// Variable-radius packing replaces fixed offsets that let large rings collide.
export function layoutSymbolGlyphs(glyphs){
 if(!glyphs.length)return [];
 if(glyphs.length>3)throw Error('At most three precipitation components are supported.');
 if(glyphs.some(g=>!Number.isFinite(g.radius)||g.radius<=0||g.radius>7.5))throw Error('Invalid precipitation symbol radius.');
 const points=[[0,0]];
 if(glyphs.length>=2){
  const distance=glyphs[0].radius+glyphs[1].radius+2*PADDING;
  points.push([distance,0]);
  if(glyphs.length===3){
   const a=glyphs[0].radius+glyphs[2].radius+2*PADDING;
   const b=glyphs[1].radius+glyphs[2].radius+2*PADDING;
   const x=(a*a-b*b+distance*distance)/(2*distance);
   points.push([x,Math.sqrt(Math.max(0,a*a-x*x))]);
  }
 }
 const minX=Math.min(...points.map((p,i)=>p[0]-glyphs[i].radius));
 const maxX=Math.max(...points.map((p,i)=>p[0]+glyphs[i].radius));
 const minY=Math.min(...points.map((p,i)=>p[1]-glyphs[i].radius));
 const maxY=Math.max(...points.map((p,i)=>p[1]+glyphs[i].radius));
 return glyphs.map((g,i)=>({...g,dx:points[i][0]-(minX+maxX)/2,dy:points[i][1]-(minY+maxY)/2}));
}

export function makeSymbolSample(column,row,glyphs){
 const placed=layoutSymbolGlyphs(glyphs);
 const extent=Math.max(0,...placed.map(g=>Math.hypot(g.dx,g.dy)+g.radius+PADDING));
 if(extent>MAX_CLUSTER_EXTENT)throw Error('Precipitation symbol cluster exceeds its tile halo.');
 return {column,row,x:(column+.5)*SYMBOL_SPACING,y:(row+.5)*SYMBOL_SPACING,
  rank:PRIORITY[mod4(row)][mod4(column)],glyphs:placed,extent};
}

export function symbolSamplesOverlap(a,b){
 if(Math.hypot(a.x-b.x,a.y-b.y)>=a.extent+b.extent)return false;
 return a.glyphs.some(ga=>b.glyphs.some(gb=>
  Math.hypot(a.x+ga.dx-b.x-gb.dx,a.y+ga.dy-b.y-gb.dy)<ga.radius+gb.radius+2*PADDING));
}

// Local, order-independent exclusion makes adjacent tiles agree. A lower-rank
// colliding sample wins; all components of each accepted sample stay together.
// Checking *all* higher-priority neighbours (not a tile-local greedy pass) is
// deliberate: greedy decisions can propagate beyond the halo and create seams.
export function thinSymbolSamples(samples){
 const occupied=new Map(samples.map(s=>[s.column+','+s.row,s]));
 return samples.filter(sample=>{
  const reach=Math.ceil((sample.extent+MAX_CLUSTER_EXTENT)/SYMBOL_SPACING);
  for(let row=sample.row-reach;row<=sample.row+reach;row++){
   for(let column=sample.column-reach;column<=sample.column+reach;column++){
    const other=occupied.get(column+','+row);
    if(!other||other===sample)continue;
    const wins=other.rank<sample.rank||(other.rank===sample.rank&&(row<sample.row||(row===sample.row&&column<sample.column)));
    if(wins&&symbolSamplesOverlap(sample,other))return false;
   }
  }
  return true;
 });
}

function glyphPath(ctx,g,x,y){
 const r=g.radius;
 ctx.beginPath();
 if(g.kind==='snow'||g.mechanism==='snow'){
  // Fit both marks inside the collision radius: snowflake above shower V.
  const shower=g.mechanism==='convective',sr=shower?r*.55:r,sy=shower?y-r*.4:y;
  for(let i=0;i<3;i++){const a=i*Math.PI/3,dx=Math.cos(a)*sr,dy=Math.sin(a)*sr;ctx.moveTo(x-dx,sy-dy);ctx.lineTo(x+dx,sy+dy);}
  if(shower){ctx.moveTo(x-r*.65,y+r*.25);ctx.lineTo(x,y+r);ctx.lineTo(x+r*.65,y+r*.25);}
 }else if(g.mechanism==='convective'){
  ctx.moveTo(x-Math.sqrt(3)/2*r,y-r/2);ctx.lineTo(x,y+r);ctx.lineTo(x+Math.sqrt(3)/2*r,y-r/2);
  if(g.rate>=.5)ctx.closePath();
 }else ctx.arc(x,y,r,0,Math.PI*2);
}

export function drawPlacedPrecipitationSymbols(ctx,glyphs,x,y){
 ctx.setLineDash([]);ctx.lineCap='round';ctx.lineJoin='round';
 for(const g of glyphs){
  glyphPath(ctx,g,x+g.dx,y+g.dy);
  // Strong white halo improves contrast without filling the symbol or
  // masking the theta-w field. Phase colours retain their existing meaning.
  ctx.strokeStyle='rgba(255,255,255,0.95)';ctx.lineWidth=HALO_STROKE;ctx.stroke();
  ctx.strokeStyle=SYMBOL_COLORS[g.kind]??SYMBOL_COLORS.other;ctx.lineWidth=STROKE;ctx.stroke();
 }
}
export function drawPrecipitationSymbols(ctx,glyphs,x,y){
 drawPlacedPrecipitationSymbols(ctx,layoutSymbolGlyphs(glyphs),x,y);
}
