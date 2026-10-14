import {nativeCategory,estimatedCategory,rateBand,precipitationFileInfo} from './map-precipitation-type.js?v=20261014-round-symbols';
import {symbolRecipe} from './map-winter.js?v=20261014-round-symbols';
export const isSymbolURL=url=>/[?&]precip_symbols=/.test(url);
export const symbolURL=(url,source)=>url+'&precip_symbols='+symbolRecipe(source)+'&symbols_style=20261014-round3';
export function symbolOverlay(url){return {id:'precip-symbols',source:{type:'raster',url,tileSize:512,maxzoom:10},layers:[{id:'precip-symbols-image',type:'raster',paint:{'raster-opacity':1,'raster-fade-duration':0,'raster-resampling':'linear'}}]};}
export const SYMBOL_COLORS={rain:'#1535d8',precipitation:'#1535d8',showers:'#1535d8',mixed:'#11833b',snow:'#db2387',freezing:'#8c34b8',ice:'#b77505',other:'#586575'};
const categoryKind={1:'rain',2:'mixed',3:'snow',4:'other',5:'freezing',6:'ice'};
export const SYMBOL_SPACING=16;
export function symbolRadius(rate,convective=false){return (convective?[2,2.6,3.4,4.2]:[1,2.5,4.5,6.5])[rateBand(rate)]??0;}
export function symbolInputs(recipe){return recipe==='icon'?['rain','showers','snowfall_water_equivalent']:recipe==='partitioned'?['precipitation','showers']:recipe==='native'?['precipitation','precipitation_type']:recipe==='estimated'?['precipitation','snowfall_water_equivalent']:['precipitation'];}
export function precipitationSymbols(values,hours,recipe){
 const glyph=(kind,amount,mechanism='unseparated')=>({kind,mechanism,amount,rate:amount/hours,radius:symbolRadius(amount/hours,mechanism==='convective')});
 const wet=g=>Number.isFinite(g.rate)&&g.rate>=.1;
 if(!(hours>0))return [];
 if(recipe==='icon')return [glyph('rain',values.rain,'dynamic'),glyph('showers',values.showers,'convective'),glyph('snow',values.snowfall_water_equivalent,'snow')].filter(wet);
 const amount=values.precipitation;if(!Number.isFinite(amount)||amount/hours<.1)return [];
 if(recipe==='partitioned'){
  // ECMWF cp and GFS CPRAT include both rain and snow. Subtract once from
  // total precipitation; never subtract total snowfall again or assign its
  // phase to each mechanism. Invalid partitions fall back to unsplit total.
  const convection=values.showers;
  if(!Number.isFinite(convection)||convection<0||convection>amount+.11)return [glyph('precipitation',amount)];
  const convective=Math.min(amount,convection);
  return [glyph('precipitation',amount-convective,'dynamic'),glyph('showers',convective,'convective')].filter(wet);
 }
 const category=recipe==='native'?nativeCategory(values.precipitation_type):recipe==='estimated'?estimatedCategory(amount,values.snowfall_water_equivalent):4;
 return Number.isFinite(category)?[glyph(categoryKind[category]??'other',amount)]:[];
}
function glyphPath(ctx,g,x,y){
 const r=g.radius;
 ctx.beginPath();
 if(g.mechanism==='dynamic')ctx.arc(x,y,r,0,Math.PI*2);
 else if(g.mechanism==='convective'){
  ctx.moveTo(x-r,y-r*.7);ctx.lineTo(x,y+r);ctx.lineTo(x+r,y-r*.7);
  // Light showers use an open V; stronger showers a small inverted triangle.
  if(g.rate>=.5)ctx.closePath();
 }else if(g.mechanism==='snow'){
  for(let i=0;i<3;i++){const a=i*Math.PI/3,dx=Math.cos(a)*r,dy=Math.sin(a)*r;ctx.moveTo(x-dx,y-dy);ctx.lineTo(x+dx,y+dy);}
 }else{
  // Round symbols retain the familiar intensity scale when no split exists.
  ctx.arc(x,y,r,0,Math.PI*2);
 }
}
export function drawPrecipitationSymbols(ctx,glyphs,x,y){
 // Keep concurrent components within one lattice cell, with no dominant-only
 // filtering: frontal rain and embedded showers must both remain visible.
 const offsets=glyphs.length===3?[[-4,-3],[4,-3],[0,5]]:glyphs.length===2?[[-4,-2],[4,2]]:[[0,0]];
 glyphs.forEach((g,i)=>{const [dx,dy]=offsets[i];glyphPath(ctx,g,x+dx,y+dy);ctx.setLineDash(g.mechanism==='unseparated'?[1.8,1.2]:[]);ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=1.8;ctx.stroke();ctx.strokeStyle=SYMBOL_COLORS[g.kind];ctx.lineWidth=g.rate<.5?1.25:1;ctx.stroke();});
 ctx.setLineDash([]);
}
const latAt=(pixel,world)=>Math.atan(Math.sinh(Math.PI*(1-2*pixel/world)))*180/Math.PI;
// A global 16 px lattice gives four times the coverage of the old 32 px grid.
// It samples nearest native cells, not averaged colours or invented detail.
// The one-cell halo repeats the same neighbouring glyphs across tile boundaries.
export async function precipitationSymbolProtocol(params,controller,OM,settings){
 if(params.type==='json')return OM.omProtocol(params,controller,settings);
 if(params.type!=='image')throw Error('Precipitation symbols require a raster tile.');
 const match=params.url.match(/^(.*)\/(\d+)\/(\d+)\/(\d+)$/);if(!match)throw Error('Missing symbol tile coordinates.');
 const [,base,zs,xs,ys]=match,z=Number(zs),tx=Number(xs),ty=Number(ys),world=512*2**z;
 const plain=base.replace(/^(?:om|briefing):\/\//,''),file=plain.split('?')[0],query=new URLSearchParams(plain.split('?')[1]);
 const recipe=query.get('precip_symbols');if(!['native','estimated','icon','partitioned','unresolved'].includes(recipe))throw Error('Unsupported precipitation symbol recipe.');
 const {domain,hours}=precipitationFileInfo(file),config=settings.domainOptions.find(d=>d.value===domain)?.grid;if(!config)throw Error('Unknown symbol grid.');
 const left=tx*512,top=ty*512;
 const bounds=[(left-32)/world*360-180,latAt(top+544,world),(left+544)/world*360-180,latAt(top-32,world)];
 // Clip the data read to the model and visible viewport; sampling outside it is missing.
 const native=OM.GridFactory.create(config).getBounds(),view=OM.currentBounds??bounds;
 const clip=[Math.max(bounds[0],native[0],view[0]-.5),Math.max(bounds[1],native[1],view[1]-.5),Math.min(bounds[2],native[2],view[2]+.5),Math.min(bounds[3],native[3],view[3]+.5)];
 const canvas=new OffscreenCanvas(512,512),ctx=canvas.getContext('2d');
 if(clip[0]<clip[2]&&clip[1]<clip[3]){
  const ranges=OM.getRanges(config,clip),grid=OM.GridFactory.create(config,ranges),reader=OM.getProtocolInstance(settings).omFileReader,arrays={};
  for(const key of symbolInputs(recipe)){controller.signal.throwIfAborted();arrays[key]=(await reader.readVariable(file,key,ranges,controller.signal)).values;}
  const keys=Object.keys(arrays);
  for(let y=-8;y<528;y+=SYMBOL_SPACING)for(let x=-8;x<528;x+=SYMBOL_SPACING){
   const lon=(left+x)/world*360-180,lat=latAt(top+y,world);
   if(lon<clip[0]||lon>clip[2]||lat<clip[1]||lat>clip[3])continue;
   const values=Object.fromEntries(keys.map(key=>[key,grid.getInterpolatedValue(arrays[key],lat,lon,'nearest')]));
   drawPrecipitationSymbols(ctx,precipitationSymbols(values,hours,recipe),x,y);
  }
 }
 controller.signal.throwIfAborted();return {data:await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()};
}
