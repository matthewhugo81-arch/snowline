// Retain a small window of rendered forecasts, including backwards steps.
export function frameWindow(urls,index){
 return {keep:new Set(urls.slice(Math.max(0,index-2),index+3).filter(Boolean)),upcoming:urls.slice(index+1,index+3).filter(Boolean)};
}

export class ForecastFrames{
 constructor(map,prefix,{timeout=25000}={}){this.map=map;this.prefix=prefix;this.timeout=timeout;this.frames=new Map();this.sequence=0;this.current=null;this.epoch=0;}
 prepare(url){
  let frame=this.frames.get(url);
  if(frame?.pending)return frame;
  if(!frame){
   const id=this.prefix+'-'+(++this.sequence);frame={url,id,layer:id+'-image'};this.frames.set(url,frame);
   this.map.addSource(id,{type:'raster',url,maxzoom:10,tileSize:512,attribution:'Weather © Open-Meteo'});
   // Covered by the base map until ready: no flashing or partially drawn frame.
   this.map.addLayer({id:frame.layer,type:'raster',source:id,paint:{'raster-opacity':1,'raster-fade-duration':0}},this.map.getStyle().layers[0]?.id);
  }else{
   this.map.setLayoutProperty(frame.layer,'visibility','visible');
   const first=this.map.getStyle().layers[0]?.id;
   if(frame!==this.current&&first!==frame.layer)this.map.moveLayer(frame.layer,first);
   if(!frame.suspended&&this.map.isSourceLoaded(frame.id)){frame.ready=Promise.resolve(true);return frame;}
  }
  frame.pending=true;
  frame.ready=new Promise(resolve=>{
   let done=false,rendered=false;
   const finish=ok=>{if(done)return;done=true;clearTimeout(timer);this.map.off('render',render);this.map.off('sourcedata',check);this.map.off('error',failed);frame.pending=false;if(ok)frame.suspended=false;resolve(ok);};
   const check=()=>{if(rendered&&this.map.getSource(frame.id)&&this.map.isSourceLoaded(frame.id))finish(true);};
   const render=()=>{rendered=true;check();};
   const failed=event=>{if(event.sourceId===frame.id)finish(false);};
   const timer=setTimeout(()=>finish(false),this.timeout);frame.cancel=()=>finish(false);
   this.map.on('render',render);this.map.on('sourcedata',check);this.map.on('error',failed);this.map.triggerRepaint();
  });
  return frame;
 }
 show(frame,opacity,resampling){
  if(this.current&&this.current!==frame)this.cover(this.current);
  this.current=frame;
  this.map.setLayoutProperty(frame.layer,'visibility','visible');
  this.map.setPaintProperty(frame.layer,'raster-opacity',opacity);
  this.map.setPaintProperty(frame.layer,'raster-resampling',resampling);
  this.map.moveLayer(frame.layer);
 }
 cover(frame){const first=this.map.getStyle().layers[0]?.id;if(first!==frame.layer)this.map.moveLayer(frame.layer,first);}
 suspend(exceptURL){
  this.stop(exceptURL);
  // Keep nearby textures ready while stationary, but never download old frames
  // for a newly panned or zoomed viewport.
  for(const frame of this.frames.values()){
   frame.suspended=true;
   if(frame!==this.current&&frame.url!==exceptURL)this.map.setLayoutProperty(frame.layer,'visibility','none');
  }
 }
 discard(frame){
  frame.cancel?.();
  if(this.map.getLayer(frame.layer))this.map.removeLayer(frame.layer);
  if(this.map.getSource(frame.id))this.map.removeSource(frame.id);
  this.frames.delete(frame.url);if(this.current===frame)this.current=null;
 }
 stop(exceptURL){
  clearTimeout(this.timer);this.epoch++;
  for(const frame of [...this.frames.values()])if(frame!==this.current&&frame.pending&&frame.url!==exceptURL)this.discard(frame);
 }
 warm({keep,upcoming}){
  this.stop();const epoch=this.epoch;
  for(const frame of [...this.frames.values()])if(frame!==this.current&&!keep.has(frame.url))this.discard(frame);
  this.timer=setTimeout(async()=>{
   // One future image at a time, after the selected panels are displayed.
   for(const url of upcoming){
    if(epoch!==this.epoch)break;
    const frame=this.prepare(url),ready=await frame.ready;
    if(epoch!==this.epoch)break;
    if(!ready){this.discard(frame);continue;}
    if(frame!==this.current)this.cover(frame);
   }
  },180);
 }
 clear(){this.stop();for(const frame of [...this.frames.values()])this.discard(frame);}
}
