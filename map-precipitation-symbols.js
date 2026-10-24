import {nativeCategory,estimatedCategory,precipitationFileInfo} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {symbolRecipe} from './map-winter.js?v=20261024-ifs-gem-showers1';
import {loadShowerDiagnostic,showerAt} from './map-shower-diagnostics.js';
import {SYMBOL_STYLE,SYMBOL_SPACING,SYMBOL_HALO,MAX_CLUSTER_EXTENT,symbolRadius,makeSymbolSample,thinSymbolSamples,drawPlacedPrecipitationSymbols} from './map-precipitation-glyphs.js?v=20261024-ifs-gem-showers1';
export {SYMBOL_COLORS,SYMBOL_SPACING,symbolRadius,drawPrecipitationSymbols} from './map-precipitation-glyphs.js?v=20261024-ifs-gem-showers1';
export const isSymbolURL=url=>/[?&]precip_symbols=/.test(url);
const showerSession=Date.now();
export const symbolURL=(url,source,thetaURL)=>url+'&precip_symbols='+symbolRecipe(source)+'&symbols_style='+SYMBOL_STYLE+(['ukmo_global_deterministic_10km','ukmo_uk_deterministic_2km'].includes(source?.domain)?'&shower_session='+showerSession:'')+(thetaURL?'&theta_source='+encodeURIComponent(thetaURL):'');
export function symbolOverlay(url){return {id:'precip-symbols',source:{type:'raster',url,tileSize:512,maxzoom:10},layers:[{id:'precip-symbols-image',type:'raster',paint:{'raster-opacity':1,'raster-fade-duration':0,'raster-resampling':'linear'}}]};}
const categoryKind={1:'rain',2:'mixed',3:'snow',4:'other',5:'freezing',6:'ice'};
export function symbolInputs(recipe){return recipe==='partitioned_native'?['precipitation','showers','precipitation_type']:recipe==='partitioned_estimated'?['precipitation','showers','snowfall_water_equivalent']:recipe==='icon'?['rain','showers','snowfall_water_equivalent']:recipe==='partitioned'?['precipitation','showers']:recipe==='native'?['precipitation','precipitation_type']:recipe==='estimated'?['precipitation','snowfall_water_equivalent']:['precipitation'];}
export function thetaPhase(value){return Number.isFinite(value)?value<=0?'snow':value<2?'mixed':'rain':'other';}
export function precipitationSymbols(values,hours,recipe){
 const phase=recipe==='partitioned_native'?nativeCategory(values.precipitation_type):recipe==='partitioned_estimated'?estimatedCategory(values.precipitation,values.snowfall_water_equivalent):4;
 const fallback=phase!==4&&categoryKind[phase]?categoryKind[phase]:thetaPhase(values.theta_w);
 const resolve=kind=>recipe!=='icon'&&['other','precipitation','showers'].includes(kind)&&fallback!=='other'?fallback:kind;
 const glyph=(kind,amount,mechanism='unseparated')=>({kind:resolve(kind),mechanism,amount,rate:amount/hours,radius:resolve(kind)==='snow'&&mechanism==='convective'?2.25+symbolRadius(amount/hours,true)*(5.25/6.45):symbolRadius(amount/hours,mechanism==='convective')});
 const wet=g=>Number.isFinite(g.rate)&&g.rate>=.1;
 if(!Number.isFinite(hours)||!(hours>0))return [];
 if(recipe==='icon')return [glyph('rain',values.rain,'dynamic'),glyph('showers',values.showers,'convective'),glyph('snow',values.snowfall_water_equivalent,'snow')].filter(wet);
 const amount=values.precipitation;if(!Number.isFinite(amount)||amount/hours<.1)return [];
 if(recipe.startsWith('partitioned')){
  // Native convection includes rain and snow. Subtract once from total;
  // whole-cell phase guides symbols, without allocating snowfall separately
  // to each mechanism. Invalid partitions fall back to unsplit total.
  const convection=values.showers;
  if(!Number.isFinite(convection)||convection<0||convection>amount+.11)return [glyph('precipitation',amount)];
  const convective=Math.min(amount,convection);
  return [glyph('precipitation',amount-convective,'dynamic'),glyph('showers',convective,'convective')].filter(wet);
 }
 const category=recipe==='native'?nativeCategory(values.precipitation_type):recipe==='estimated'?estimatedCategory(amount,values.snowfall_water_equivalent):4;
 return [glyph(categoryKind[category]??'other',amount,values.shower_diagnostic===true?'convective':'unseparated')];
}
const latAt=(pixel,world)=>Math.atan(Math.sinh(Math.PI*(1-2*pixel/world)))*180/Math.PI;
// Keep the original global 16 px lattice and nearest-native-cell sampling.
// A larger halo covers both glyph overhang and all direct collision neighbours.
export async function precipitationSymbolProtocol(params,controller,OM,settings){
 if(params.type==='json')return OM.omProtocol(params,controller,settings);
 if(params.type!=='image')throw Error('Precipitation symbols require a raster tile.');
 const match=params.url.match(/^(.*)\/(\d+)\/(\d+)\/(\d+)$/);if(!match)throw Error('Missing symbol tile coordinates.');
 const [,base,zs,xs,ys]=match,z=Number(zs),tx=Number(xs),ty=Number(ys),world=512*2**z;
 const plain=base.replace(/^(?:om|briefing):\/\//,''),file=plain.split('?')[0],query=new URLSearchParams(plain.split('?')[1]);
 const recipe=query.get('precip_symbols');if(!['native','estimated','icon','partitioned','partitioned_native','partitioned_estimated','unresolved'].includes(recipe))throw Error('Unsupported precipitation symbol recipe.');
 const {domain,hours}=precipitationFileInfo(file),config=settings.domainOptions.find(d=>d.value===domain)?.grid;if(!config)throw Error('Unknown symbol grid.');
 const left=tx*512,top=ty*512,halo=SYMBOL_HALO;
 const bounds=[(left-halo)/world*360-180,latAt(top+512+halo,world),(left+512+halo)/world*360-180,latAt(top-halo,world)];
 const native=OM.GridFactory.create(config).getBounds();
 // Tile and collision halo are stable across panels and camera movements.
 const clip=[Math.max(bounds[0],native[0]),Math.max(bounds[1],native[1]),Math.min(bounds[2],native[2]),Math.min(bounds[3],native[3])];
 const canvas=new OffscreenCanvas(512,512),ctx=canvas.getContext('2d');
 if(clip[0]<clip[2]&&clip[1]<clip[3]){
  const ranges=OM.getRanges(config,clip),grid=OM.GridFactory.create(config,ranges),reader=OM.getProtocolInstance(settings).omFileReader,arrays={};
  for(const key of symbolInputs(recipe)){controller.signal.throwIfAborted();arrays[key]=(await reader.readVariable(file,key,ranges,controller.signal)).values;}
  const showerDiagnostic=await loadShowerDiagnostic(file);
  controller.signal.throwIfAborted();
  let thetaGrid,thetaValues;
  const thetaURL=query.get('theta_source');
  if(thetaURL){
   const thetaPlain=thetaURL.replace(/^(?:om|briefing):\/\//,''),thetaFile=thetaPlain.split('?')[0],thetaQuery=new URLSearchParams(thetaPlain.split('?')[1]);
   const surfaceInfo=precipitationFileInfo(file),upperDomain=new URL(thetaFile).pathname.match(/\/(?:data_spatial|ensemble-data)\/([^/]+)\//)?.[1],upperInfo=precipitationFileInfo(thetaFile.replace('/'+upperDomain+'/', '/'+surfaceInfo.domain+'/'));
   if(surfaceInfo.reference!==upperInfo.reference||surfaceInfo.time!==upperInfo.time)throw Error('Theta-w must match precipitation run and valid time.');
   const thetaConfig=settings.domainOptions.find(d=>d.value===upperDomain)?.grid;
   if(!thetaConfig)throw Error('Unknown theta-w grid.');
   const thetaRanges=OM.getRanges(thetaConfig,clip);
   thetaGrid=OM.GridFactory.create(thetaConfig,thetaRanges);
   thetaValues=(await reader.readVariable(thetaFile,thetaQuery.get('variable'),thetaRanges,controller.signal)).values;
  }
  const keys=Object.keys(arrays),samples=[];
  for(let row=Math.floor((top-halo)/SYMBOL_SPACING);row<Math.ceil((top+512+halo)/SYMBOL_SPACING);row++){
   controller.signal.throwIfAborted();
   for(let column=Math.floor((left-halo)/SYMBOL_SPACING);column<Math.ceil((left+512+halo)/SYMBOL_SPACING);column++){
    const x=(column+.5)*SYMBOL_SPACING,y=(row+.5)*SYMBOL_SPACING,lon=x/world*360-180,lat=latAt(y,world);
    if(lon<clip[0]||lon>clip[2]||lat<clip[1]||lat>clip[3])continue;
    const values=Object.fromEntries(keys.map(key=>[key,grid.getInterpolatedValue(arrays[key],lat,lon,'nearest')]));
    if(thetaGrid)values.theta_w=thetaGrid.getInterpolatedValue(thetaValues,lat,lon,'nearest');
    values.shower_diagnostic=showerAt(showerDiagnostic,lat,lon);
    const glyphs=precipitationSymbols(values,hours,recipe);
    if(glyphs.length)samples.push(makeSymbolSample(column,row,glyphs));
   }
  }
  for(const sample of thinSymbolSamples(samples)){
   const x=sample.x-left,y=sample.y-top;
   if(x < -MAX_CLUSTER_EXTENT||x > 512+MAX_CLUSTER_EXTENT||y < -MAX_CLUSTER_EXTENT||y > 512+MAX_CLUSTER_EXTENT)continue;
   drawPlacedPrecipitationSymbols(ctx,sample.glyphs,x,y);
  }
 }
 controller.signal.throwIfAborted();return {data:await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()};
}
