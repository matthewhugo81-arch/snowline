// Retain a bounded window. The browser selects a smaller budget in comparison mode.
export function frameWindow(urls,index,{ahead=2,behind=2}={}){
 return {keep:new Set(urls.slice(Math.max(0,index-behind),index+ahead+1).filter(Boolean)),upcoming:urls.slice(index+1,index+ahead+1).filter(Boolean)};
}

// A frame owns its raster AND enabled vector overlays. They are prepared behind
// the opaque basemap, then promoted together; we never blend forecast times.
export class ForecastFrames{
 constructor(map,prefix,{timeout=25000,delay=180,decorate=()=>[],rasterBefore,overlayBefore}={}){
  Object.assign(this,{map,prefix,timeout,delay,decorate,rasterBefore,overlayBefore});
  this.frames=new Map();this.sequence=0;this.current=null;this.epoch=0;this.queue=[];this.keep=new Set();
 }
 prepare(url){
  let frame=this.frames.get(url);
  if(frame?.pending)return frame;
  if(frame?.failed){this.discard(frame);frame=null;}
  if(!frame){
   const id=this.prefix+'-'+(++this.sequence);
   frame={url,id,layer:id+'-image',resources:[id],layers:[id+'-image'],pending:false,loaded:false};
   this.frames.set(url,frame);
   try{
    this.map.addSource(id,{type:'raster',url,maxzoom:10,tileSize:512,attribution:'Weather © Open-Meteo'});
    this.map.addLayer({id:frame.layer,type:'raster',source:id,paint:{'raster-opacity':1,'raster-opacity-transition':{duration:0},'raster-fade-duration':0}},this.firstLayer());
    for(const group of this.decorate(url)){
     const source=id+'-'+group.id;
     this.map.addSource(source,group.source);frame.resources.push(source);
     for(const spec of group.layers){
      const layer={...spec,id:id+'-'+spec.id,source};
      // Hidden future labels must not displace the current map's place labels.
      if(layer.type==='symbol')layer.layout={...layer.layout,'text-ignore-placement':true};
      this.map.addLayer(layer,this.firstLayer());frame.layers.push(layer.id);
     }
    }
   }catch(error){this.discard(frame);throw error;}
  }else{
   for(const id of frame.layers)this.map.setLayoutProperty(id,'visibility','visible');
   if(frame!==this.current)this.cover(frame);
   if(frame.loaded&&!frame.suspended&&this.sourcesReady(frame)){frame.ready=Promise.resolve(true);return frame;}
  }
  frame.pending=true;frame.loaded=false;
  frame.ready=new Promise(resolve=>{
   let done=false,rendered=false;
   const finish=ok=>{
    if(done)return;done=true;clearTimeout(timer);
    this.map.off('render',render);this.map.off('sourcedata',check);this.map.off('error',failed);
    frame.pending=false;frame.loaded=ok;frame.failed=!ok;
    if(ok)frame.suspended=false;
    resolve(ok);
   };
   const check=()=>{if(rendered&&this.sourcesReady(frame))finish(true);};
   const render=()=>{rendered=true;check();};
   const failed=event=>{if(frame.resources.includes(event.sourceId))finish(false);};
   const timer=setTimeout(()=>finish(false),this.timeout);frame.cancel=()=>finish(false);
   this.map.on('render',render);this.map.on('sourcedata',check);this.map.on('error',failed);this.map.triggerRepaint();
  });
  return frame;
 }
 firstLayer(){return this.map.getStyle().layers[0]?.id;}
 sourcesReady(frame){return frame.resources.every(id=>this.map.getSource(id)&&this.map.isSourceLoaded(id));}
 isReady(url){const frame=this.frames.get(url);return !!(frame?.loaded&&!frame.suspended&&!frame.pending&&this.sourcesReady(frame));}
 show(frame,opacity,resampling){
  if(!frame.loaded||frame.pending||frame.failed)return false;
  if(this.current&&this.current!==frame)this.cover(this.current);
  this.current=frame;
  for(const id of frame.layers)this.map.setLayoutProperty(id,'visibility','visible');
  this.map.setPaintProperty(frame.layer,'raster-opacity',opacity);
  this.map.setPaintProperty(frame.layer,'raster-resampling',resampling);
  this.map.moveLayer(frame.layer,this.rasterBefore);
  for(const id of frame.layers.slice(1))this.map.moveLayer(id,this.overlayBefore);
  return true;
 }
 cover(frame){
  // Only weather layers move. The basemap is ordered once, not every hour.
  for(const id of frame.layers){const first=this.firstLayer();if(first!==id)this.map.moveLayer(id,first);}
 }
 suspend(exceptURL){
  this.stop(exceptURL);
  for(const frame of this.frames.values()){
   frame.suspended=true;
   if(frame!==this.current&&frame.url!==exceptURL)for(const id of frame.layers)this.map.setLayoutProperty(id,'visibility','none');
  }
 }
 discard(frame){
  if(!frame||this.frames.get(frame.url)!==frame)return;
  frame.cancel?.();
  for(const id of [...frame.layers].reverse())if(this.map.getLayer(id))this.map.removeLayer(id);
  for(const id of [...frame.resources].reverse())if(this.map.getSource(id))this.map.removeSource(id);
  this.frames.delete(frame.url);if(this.current===frame)this.current=null;
 }
 stop(exceptURL){
  clearTimeout(this.timer);this.epoch++;this.queue=[];
  for(const frame of [...this.frames.values()])if(frame!==this.current&&frame.pending&&frame.url!==exceptURL)this.discard(frame);
 }
 warm({keep,upcoming}){
  clearTimeout(this.timer);const epoch=++this.epoch;
  this.keep=keep;this.queue=[...new Set(upcoming)];
  // Crucially, do NOT stop/cancel pending frames that are still in the window.
  for(const frame of [...this.frames.values()])if(frame!==this.current&&!keep.has(frame.url))this.discard(frame);
  this.timer=setTimeout(async()=>{
   for(const url of this.queue){
    if(epoch!==this.epoch)break;
    let frame;
    try{frame=this.prepare(url);const ready=await frame.ready;
     if(epoch!==this.epoch)break;
     if(!ready){this.discard(frame);continue;}
     if(frame!==this.current)this.cover(frame);
    }catch{if(frame)this.discard(frame);}
   }
  },this.delay);
 }
 clear(){this.stop();for(const frame of [...this.frames.values()])this.discard(frame);this.keep.clear();}
}
