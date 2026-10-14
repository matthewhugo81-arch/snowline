import {nativeCategory,estimatedCategory,rateBand,precipitationFileInfo} from './map-precipitation-type.js?v=20261014-winter-intensity';
import {symbolRecipe} from './map-winter.js?v=20261014-winter-intensity';
export const isSymbolURL=url=>/[?&]precip_symbols=/.test(url);
export const symbolURL=(url,source)=>url+'&precip_symbols='+symbolRecipe(source)+'&symbols_style=20261014-intensity1';
export function symbolOverlay(url){return {id:'precip-symbols',source:{type:'raster',url,tileSize:512,maxzoom:10},layers:[{id:'precip-symbols-image',type:'raster',paint:{'raster-opacity':1,'raster-fade-duration':0,'raster-resampling':'linear'}}]};}
export const SYMBOL_COLORS={rain:'#175cce',showers:'#175cce',mixed:'#11833b',snow:'#db2387',freezing:'#8c34b8',ice:'#b77505',other:'#586575'};
const categoryKind={1:'rain',2:'mixed',3:'snow',4:'other',5:'freezing',6:'ice'};
export function symbolRadius(rate){return [1.8,2.8,4,5.5][rateBand(rate)]??0;}
export function symbolInputs(recipe){return recipe==='icon'?['rain','showers','snowfall_water_equivalent']:recipe==='native'?['precipitation','precipitation_type']:recipe==='estimated'?['precipitation','snowfall_water_equivalent']:['precipitation'];}
export function precipitationSymbols(values,hours,recipe){
 const glyph=(kind,amount)=>({kind,amount,rate:amount/hours,radius:symbolRadius(amount/hours)});
 if(!(hours>0))return [];
 if(recipe==='icon')return [glyph('rain',values.rain),glyph('showers',values.showers),glyph('snow',values.snowfall_water_equivalent)].filter(g=>Number.isFinite(g.rate)&&g.rate>=.1);
 const amount=values.precipitation;if(!Number.isFinite(amount)||amount/hours<.1)return [];
 const category=recipe==='native'?nativeCategory(values.precipitation_type):recipe==='estimated'?estimatedCategory(amount,values.snowfall_water_equivalent):4;
 return Number.isFinite(category)?[glyph(categoryKind[category]??'other',amount)]:[];
}
function glyphPath(ctx,kind,x,y,r){
 ctx.beginPath();
 if(kind==='rain'||kind==='other'||kind==='mixed')ctx.arc(x,y,r,0,Math.PI*2);
 if(kind==='showers'){ctx.moveTo(x-r,y-r*.65);ctx.lineTo(x+r,y-r*.65);ctx.lineTo(x,y+r);ctx.closePath();}
 if(kind==='snow'||kind==='mixed')for(let i=0;i<3;i++){const a=i*Math.PI/3,dx=Math.cos(a)*r,dy=Math.sin(a)*r;ctx.moveTo(x-dx,y-dy);ctx.lineTo(x+dx,y+dy);}
 if(kind==='freezing'||kind==='ice'){ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();}
}
export function drawPrecipitationSymbols(ctx,glyphs,x,y){
 glyphs.forEach((g,i)=>{const offset=(i-(glyphs.length-1)/2)*10;glyphPath(ctx,g.kind,x+offset,y,g.radius);ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=2.1;ctx.stroke();ctx.strokeStyle=SYMBOL_COLORS[g.kind];ctx.lineWidth=1.15;ctx.stroke();});
}
const latAt=(pixel,world)=>Math.atan(Math.sinh(Math.PI*(1-2*pixel/world)))*180/Math.PI;
// A global 32 px lattice samples nearest native cells, not averaged colours.
// The one-cell halo repeats the same neighbouring glyphs across tile boundaries.
export async function precipitationSymbolProtocol(params,controller,OM,settings){
 if(params.type==='json')return OM.omProtocol(params,controller,settings);
 if(params.type!=='image')throw Error('Precipitation symbols require a raster tile.');
 const match=params.url.match(/^(.*)\/(\d+)\/(\d+)\/(\d+)$/);if(!match)throw Error('Missing symbol tile coordinates.');
 const [,base,zs,xs,ys]=match,z=Number(zs),tx=Number(xs),ty=Number(ys),world=512*2**z;
 const plain=base.replace(/^(?:om|briefing):\/\//,''),file=plain.split('?')[0],query=new URLSearchParams(plain.split('?')[1]);
 const recipe=query.get('precip_symbols');if(!['native','estimated','icon','unresolved'].includes(recipe))throw Error('Unsupported precipitation symbol recipe.');
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
  for(let y=-16;y<544;y+=32)for(let x=-16;x<544;x+=32){
   const lon=(left+x)/world*360-180,lat=latAt(top+y,world);
   if(lon<clip[0]||lon>clip[2]||lat<clip[1]||lat>clip[3])continue;
   const values=Object.fromEntries(keys.map(key=>[key,grid.getInterpolatedValue(arrays[key],lat,lon,'nearest')]));
   drawPrecipitationSymbols(ctx,precipitationSymbols(values,hours,recipe),x,y);
  }
 }
 controller.signal.throwIfAborted();return {data:await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()};
}
