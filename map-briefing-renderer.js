import {accumulationHours} from './map-accumulation.js?v=20261012-accum-history';
import {installAccumulations} from './map-accumulation-reader.js?v=20261012-accum-speed';
import {ForecastFrames} from './map-frames.js?v=20261012-weather-composite';
import {ForecastTileCache} from './map-tile-cache.js?v=20261011-parallel-preload';
import {contourLineWidth} from './map-chart-style.js?v=20261012-chart-style';
import {overlayGroups} from './map-overlay-specs.js?v=20261012-chart-style';
import {hasFieldTime,fieldDataURL} from './map-sources.js?v=20261013-ukv-retention';
import {installDewPoint} from './map-dew-point.js';
import {installDiagnostics} from './map-diagnostics.js?v=20261011-vorticity-purple';
import {briefingValueLabels,drawBriefingValues} from './map-briefing-values.js?v=20261013-ukv-retention';

import {compositeSettings as briefingSettings} from './map-weather-composite.js?v=20261012-weather-composite';
export {briefingSettings};

const aborted=()=>new DOMException('Aborted','AbortError');
function rendered(map,signal){
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(aborted());return;}
  const finish=error=>{clearTimeout(timer);map.off('render',check);signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
  const check=()=>{if(map.areTilesLoaded())finish();};
  const cancel=()=>finish(aborted());
  const timer=setTimeout(()=>finish(Error('The chart background could not finish loading.')),30000);
  signal.addEventListener('abort',cancel,{once:true});map.on('render',check);map.triggerRepaint();
 });
}

// One renderer produces reusable PNGs. Six/nine visible panels are plain images,
// not six/nine live maps, worker pools and independent download queues.
export class BriefingRenderer{
 constructor({maplibre,OM,settings,fields,createURL}){
  Object.assign(this,{maplibre,OM,fields,createURL});this.baseSettings=settings;this.settings=briefingSettings(settings);
  installDiagnostics(OM,this.settings);
  installDewPoint(OM,this.settings);
  this.accumulations=installAccumulations(OM,this.settings);
  this.cache=new ForecastTileCache(async(params,controller)=>{
   const result=await OM.omProtocol({...params,url:params.url.replace(/^briefing:\/\//,'om://')},controller,this.settings);
   // TileJSON from the renderer uses its native protocol; keep briefing colours
   // and caching isolated from the interactive map's opaque precipitation scale.
   if(params.type==='json')return {...result,data:{...result.data,tiles:result.data.tiles.map(url=>url.replace(/^om:\/\//,'briefing://'))}};
   return result;
  });
  maplibre.addProtocol('briefing',(params,controller)=>this.cache.protocol(params,controller));
  this.container=document.createElement('div');this.container.className='briefing-renderer';this.container.setAttribute('aria-hidden','true');document.body.append(this.container);
  this.map=new maplibre.Map({container:this.container,style:'https://tiles.openfreemap.org/styles/positron',center:[-3,55],zoom:4,interactive:false,attributionControl:false,preserveDrawingBuffer:true,fadeDuration:0,renderWorldCopies:false});
  this.ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('The chart map could not start. Try again.')),30000);
   this.cancelReady=()=>{clearTimeout(timer);reject(aborted());};
   this.map.once('load',()=>{clearTimeout(timer);
    for(const layer of this.map.getStyle().layers){
     if(['transportation','transportation_name'].includes(layer['source-layer'])||(layer.type==='symbol'&&!layer.id.startsWith('label_country_')))this.map.setLayoutProperty(layer.id,'visibility','none');
     if(layer.id.startsWith('label_country_'))this.map.setLayoutProperty(layer.id,'text-size',18);
    }
    const lines=this.map.getStyle().layers.filter(layer=>['line','symbol'].includes(layer.type));
    for(const layer of lines)this.map.moveLayer(layer.id);
    this.rasterBefore=lines[0]?.id;this.overlayBefore=lines.find(layer=>layer.type==='symbol')?.id;
    this.map.addSource('briefing-coast',{type:'geojson',data:'coastline.geojson'});
    this.map.addLayer({id:'briefing-coast',type:'line',source:'briefing-coast',paint:{'line-color':'#111','line-width':.8}},this.overlayBefore);
    resolve();
   });
  });
  // The caller awaits this promise; attach a handler immediately for slow starts.
  this.ready.catch(()=>{});
 }
 cancel(){this.frames?.clear();}
 async render({model,meta,preset,bounds,size=[960,660],time,signal,overlays={},onProgress}){
  await this.ready;if(signal.aborted)throw aborted();
  // A newly selected model may add a pressure-level scale to the catalogue.
  this.settings.colorScales=briefingSettings(this.baseSettings).colorScales;
  this.frames?.clear();
  const view=JSON.stringify([bounds,size]);
  if(this.area!==view){
   this.area=view;
   this.container.style.width=size[0]+'px';this.container.style.height=size[1]+'px';this.map.resize();
   this.map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:18,duration:0});
  }
  const extent=this.map.getBounds(),clip=[extent.getWest(),extent.getSouth(),extent.getEast(),extent.getNorth()];
  this.OM.updateCurrentBounds(clip);this.cache.setContext(JSON.stringify(clip));
  // Worker requests are shared across both views. Distinguish the composite's
  // colours even if an interactive tile is still finishing cancellation.
  const url=key=>this.createURL(model,meta,time,key).replace(/^om:\/\//,'briefing://')+'&briefing_style=1';
  const field=this.fields.find(field=>field.key===preset.field);
  if(!field||!preset.required.every(key=>hasFieldTime(meta,key,time)))throw Error('This chart is unavailable for the selected time.');
  const main=url(preset.field),pressureURL=url('pressure_msl');
  const decorate=()=>{
   const groups=[];
   if(preset.id==='weather')groups.push({id:'rain',source:{type:'raster',url:url('precipitation'),tileSize:512,maxzoom:10},layers:[{id:'rain-image',type:'raster',paint:{'raster-opacity':1,'raster-resampling':'nearest','raster-fade-duration':0}}]});
   const pressure=overlayGroups({field,url:main,pressureURL,contours:!!overlays.contours,isobars:true});
   for(const group of pressure)for(const layer of group.layers){
    if(layer.type==='line'&&layer['source-layer']!=='wind-arrows')layer.paint={...layer.paint,'line-width':layer.id==='contour-lines'?contourLineWidth(field,2.6,1.3):1.3};
    if(layer.type==='symbol'){layer.layout={...layer.layout,'text-size':18,'text-padding':30};layer.paint={...layer.paint,'text-halo-color':'rgba(255,255,255,0.8)','text-halo-width':1};}
   }
   groups.push(...pressure);
   return groups;
  };
  const frames=this.frames=new ForecastFrames(this.map,'briefing-frame',{timeout:accumulationHours(preset.field)?120000:25000,decorate,rasterBefore:this.rasterBefore,overlayBefore:this.overlayBefore,isActive:()=>!signal.aborted});
  const cancel=()=>frames.clear();signal.addEventListener('abort',cancel,{once:true});
  const dataURL=fieldDataURL(meta,preset.field,time);
  const unsubscribe=onProgress&&accumulationHours(preset.field)?this.accumulations.subscribe(update=>{if(!signal.aborted&&update.url===dataURL&&update.key===preset.field)onProgress(update);}):null;
  try{
   const frame=await frames.acquire(main,()=>!signal.aborted);
   if(signal.aborted)throw aborted();
   if(!frame)throw Error('Chart could not load. Use Retry charts.');
   frames.show(frame,1,'linear');
   // All raster fills belong below coast/place labels; pressure lines above.
   if(preset.id==='weather')this.map.moveLayer(frame.id+'-rain-image',this.rasterBefore);
   await rendered(this.map,signal);
   let canvas=this.map.getCanvas();
   if(overlays.grid){
    const labels=await briefingValueLabels({OM:this.OM,settings:this.settings,meta,field,time,bounds:clip,width:size[0],height:size[1],unproject:point=>this.map.unproject(point),project:point=>this.map.project(point),signal});
    if(signal.aborted)throw aborted();
    const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;
    output.getContext('2d').drawImage(canvas,0,0);drawBriefingValues(output,labels,...size);canvas=output;
   }
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   if(signal.aborted)throw aborted();
   if(!blob)throw Error('Chart image could not be prepared.');
   return URL.createObjectURL(blob);
  }finally{unsubscribe?.();signal.removeEventListener('abort',cancel);frames.clear();}
 }
 destroy(){this.cancelReady?.();this.frames?.clear();this.cache.release();this.map.remove();this.container.remove();this.maplibre.removeProtocol('briefing');}
}
