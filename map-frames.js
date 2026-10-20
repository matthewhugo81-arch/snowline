let cacheSequence=0;
// Retain a bounded window. The browser selects a smaller budget in comparison mode.
export function frameWindow(urls,index,{ahead=2,behind=2,loop=false,direction=1}={}){
 const reverse=direction<0;
 if(loop&&urls.length){
  const at=offset=>urls[(index+(reverse?-offset:offset)+urls.length)%urls.length];
  const keep=new Set(),upcoming=[];
  for(let offset=-Math.min(behind,urls.length-1);offset<=Math.min(ahead,urls.length-1);offset++)if(at(offset))keep.add(at(offset));
  for(let offset=1;offset<=Math.min(ahead,urls.length-1);offset++)if(at(offset))upcoming.push(at(offset));
  return {keep,upcoming:[...new Set(upcoming)]};
 }
 return {keep:new Set(urls.slice(Math.max(0,index-(reverse?ahead:behind)),index+(reverse?behind:ahead)+1).filter(Boolean)),upcoming:(reverse?urls.slice(Math.max(0,index-ahead),index).reverse():urls.slice(index+1,index+ahead+1)).filter(Boolean)};
}
// Begin just after the selected frame, then wrap to all earlier valid times.
export function fullSequence(urls,index){return [...new Set([...urls.slice(index+1),...urls.slice(0,index+1)].filter(Boolean))];}

// A frame owns its raster AND enabled vector overlays. They are prepared behind
// the opaque basemap, then promoted together; we never blend forecast times.
export class ForecastFrames{
 constructor(map,prefix,{timeout=25000,delay=180,decorate=()=>[],rasterBefore,overlayBefore,onProgress=()=>{},canPreload=()=>true,isActive=()=>true,maxAttempts=3,prefetch,preloadConcurrency=2}={}){
  Object.assign(this,{map,prefix,timeout,delay,decorate,rasterBefore,overlayBefore,onProgress,canPreload,isActive,maxAttempts,prefetch,preloadConcurrency});
  this.prefix=prefix+'-'+(++cacheSequence);
  this.frames=new Map();this.sequence=0;this.current=null;this.epoch=0;this.queue=[];this.keep=new Set();
  this.preloaded=new Set();this.failures=new Set();this.failureAttempts=new Map();this.retired=new Set();
  this.prefetches=new Map();
 }
 prepare(url){
  let frame=this.frames.get(url);
  if(frame?.pending)return frame;
  // Reusing a prepared frame must not reorder its layers or invalidate its
  // already-loaded sources. Only show() changes the visible forecast.
  if(this.isReady(url)){frame.ready=Promise.resolve(true);return frame;}
  if(frame?.failed){this.discard(frame);frame=null;}
  if(!frame){
   const id=this.prefix+'-'+(++this.sequence);
   frame={url,id,layer:id+'-image',resources:[id],layers:[id+'-image'],underlays:[],pending:false,loaded:false};
   this.frames.set(url,frame);
   try{
    const mogreps=/\/(ukmo_uk_ensemble_2km|snowline_mogreps_uk|snowline_mogreps_global)\//.test(url);
    this.map.addSource(id,{type:'raster',url,maxzoom:10,tileSize:512,attribution:mogreps?'Weather: <a href="map-credits.html#mogreps">Met Office MOGREPS · © Crown copyright · CC BY-SA 4.0</a>':url.includes('/ensemble-data/')?'Weather: <a href="map-credits.html#ensembles">NOAA / ECMWF</a>':'Weather © Open-Meteo'});
    this.map.addLayer({id:frame.layer,type:'raster',source:id,paint:{'raster-opacity':1,'raster-opacity-transition':{duration:0},'raster-fade-duration':0}},this.firstLayer());
    for(const group of this.decorate(url)){
     const source=id+'-'+group.id;
     this.map.addSource(source,group.source);frame.resources.push(source);
     for(const spec of group.layers){
      const layer={...spec,id:id+'-'+spec.id,source};
      // Hidden future labels must not displace the current map's place labels.
      if(layer.type==='symbol')layer.layout={...layer.layout,'text-ignore-placement':true};
      this.map.addLayer(layer,this.firstLayer());frame.layers.push(layer.id);
      if(group.placement==='underlay')frame.underlays.push(layer.id);
     }
    }
   }catch(error){this.discard(frame);throw error;}
  }else{
   for(const id of frame.layers)this.map.setLayoutProperty(id,'visibility','visible');
   if(frame!==this.current)this.cover(frame);
   if(frame.loaded&&!frame.suspended&&this.sourcesReady(frame)){this.preloaded.add(url);this.failures.delete(url);this.failureAttempts.delete(url);this.onProgress();frame.ready=Promise.resolve(true);return frame;}
  }
  frame.pending=true;frame.loaded=false;
  frame.ready=new Promise(resolve=>{
   let done=false,timer;
   const finish=ok=>{
    if(done)return;done=true;clearTimeout(timer);
    this.map.off('render',render);this.map.off('sourcedata',check);this.map.off('error',failed);
    frame.pending=false;frame.loaded=ok;frame.failed=!ok;
    if(ok){frame.suspended=false;this.preloaded.add(url);this.failures.delete(url);this.failureAttempts.delete(url);}
    else if(!frame.cancelled){this.preloaded.delete(url);this.failures.add(url);this.failureAttempts.set(url,(this.failureAttempts.get(url)??0)+1);}
    this.onProgress();
    resolve(ok);
   };
   // Source notifications can precede the renderer's tile/visibility update.
   // Only a completed render of the current view can confirm readiness.
   const check=()=>this.map.triggerRepaint();
   const render=()=>{if(this.isActive()&&this.sourcesReady(frame))finish(true);};
   const failed=event=>{if(event.error?.name!=='AbortError'&&frame.resources.includes(event.sourceId))finish(false);};
   frame.pauseTimeout=()=>clearTimeout(timer);
   // Browsers suspend map rendering in hidden tabs. That is not a failed file.
   frame.renewTimeout=()=>{if(!done){clearTimeout(timer);if(this.isActive())timer=setTimeout(()=>{if(this.isActive())finish(false);},this.timeout);}};
   frame.renewTimeout();frame.cancel=()=>{frame.cancelled=true;finish(false);};
   this.map.on('render',render);this.map.on('sourcedata',check);this.map.on('error',failed);this.map.triggerRepaint();
  });
  return frame;
 }
 async acquire(url,valid=()=>true){
  if(!valid())return null;
  // Pause new speculative work while the selection prepares. Existing tile
  // jobs finish once and can be shared with this foreground request.
  if(!this.isReady(url))this.focus(url);
  for(let attempt=0;attempt<2&&valid();attempt++){
   const frame=this.prepare(url);frame.renewTimeout?.();
   const ready=await frame.ready;
   if(!valid()||frame.cancelled)return null;
   if(ready)return frame;
   if(attempt===0){
    this.discard(frame);this.failures.delete(url);this.onProgress();
   }
  }
  return null;
 }
 firstLayer(){return this.map.getStyle().layers[0]?.id;}
 sourcesReady(frame){return frame.resources.every(id=>this.map.getSource(id)&&this.map.isSourceLoaded(id));}
 isReady(url){const frame=this.frames.get(url);return !!(frame?.loaded&&!frame.suspended&&!frame.pending&&this.sourcesReady(frame));}
 show(frame,opacity,resampling){
  if(!frame.loaded||frame.pending||frame.failed)return false;
  const previous=this.current;
  if(previous&&previous!==frame)this.cover(previous);
  this.current=frame;
  for(const id of frame.layers)this.map.setLayoutProperty(id,'visibility','visible');
  this.map.setPaintProperty(frame.layer,'raster-opacity',opacity);
  this.map.setPaintProperty(frame.layer,'raster-resampling',resampling);
  this.map.moveLayer(frame.layer,this.rasterBefore);
  for(const id of frame.underlays){this.map.setPaintProperty(id,'raster-opacity',opacity);this.map.moveLayer(id,frame.layer);}
  for(const id of frame.layers.slice(1))if(!frame.underlays.includes(id))this.map.moveLayer(id,this.overlayBefore);
  if(this.retired.has(previous))this.discard(previous);
  return true;
 }
 hide(){
  const frame=this.current;if(!frame)return;
  this.cover(frame);this.current=null;
  if(this.retired.has(frame))this.discard(frame);
 }
 cover(frame){
  // Only weather layers move. The basemap is ordered once, not every hour.
  for(const id of frame.layers){const first=this.firstLayer();if(first!==id)this.map.moveLayer(id,first);}
 }
 pause(){
  clearTimeout(this.timer);this.epoch++;this.queue=[];
  this.cancelPrefetches();
  for(const frame of this.frames.values())frame.pauseTimeout?.();
 }
 resume(){
  for(const frame of this.frames.values())if(frame.pending)frame.renewTimeout?.();
  this.map.triggerRepaint();
 }
 retryFailures(){this.failures.clear();this.failureAttempts.clear();}
 canRetry(url){return (this.failureAttempts.get(url)??0)<this.maxAttempts;}
 suspend(exceptURL){
  this.stop(exceptURL);
  this.preloaded.clear();this.retryFailures();this.onProgress();
  for(const frame of this.frames.values()){
   frame.suspended=true;
   if(frame!==this.current&&frame.url!==exceptURL)for(const id of frame.layers)this.map.setLayoutProperty(id,'visibility','none');
  }
 }
 invalidateView(){
  this.stop();
  // Keep the labelled image until its replacement is rendered, but recreate
  // its sources: a pan may have started tiles using the previous clip bounds.
  for(const frame of [...this.frames.values()]){
   if(frame===this.current){this.frames.delete(frame.url);this.retired.add(frame);frame.suspended=true;}
   else this.discard(frame);
  }
  this.preloaded.clear();this.retryFailures();this.onProgress();
 }
 discard(frame){
  if(!frame||(this.frames.get(frame.url)!==frame&&!this.retired.has(frame)))return;
  frame.cancel?.();
  for(const id of [...frame.layers].reverse())if(this.map.getLayer(id))this.map.removeLayer(id);
  for(const id of [...frame.resources].reverse())if(this.map.getSource(id))this.map.removeSource(id);
  if(this.frames.get(frame.url)===frame)this.frames.delete(frame.url);
  this.retired.delete(frame);if(this.current===frame)this.current=null;
 }
 // A same-cycle timeline may grow without invalidating any existing pixels.
 retain(urls){
  this.cancelPrefetches(urls);
  for(const frame of [...this.frames.values()])if(!urls.has(frame.url)){
   if(frame===this.current){this.frames.delete(frame.url);this.retired.add(frame);}
   else this.discard(frame);
  }
  for(const set of [this.preloaded,this.failures,this.keep])for(const url of set)if(!urls.has(url))set.delete(url);
  for(const url of this.failureAttempts.keys())if(!urls.has(url))this.failureAttempts.delete(url);
  this.queue.splice(0,this.queue.length,...this.queue.filter(url=>urls.has(url)));this.onProgress();
 }
 // Navigation changes priority, not the model/run/view of existing downloads.
 // Keep their bounded jobs alive while pausing dispatch of more distant work.
 focus(url,keep=this.keep){
  clearTimeout(this.timer);this.epoch++;this.queue=[];this.keep=keep;
  for(const frame of [...this.frames.values()])if(frame!==this.current&&frame.url!==url&&!keep.has(frame.url))this.discard(frame);
 }
 stop(exceptURL,keep=new Set()){
  clearTimeout(this.timer);this.epoch++;this.queue=[];
  this.cancelPrefetches(new Set([...keep,exceptURL]));
  for(const frame of [...this.frames.values()])if(frame!==this.current&&frame.pending&&frame.url!==exceptURL&&!keep.has(frame.url))this.discard(frame);
 }
 cancelPrefetches(keep=new Set()){
  for(const [url,job]of this.prefetches)if(!keep.has(url)){job.controller.abort();this.prefetches.delete(url);}
 }
 preload(url){
  const existing=this.prefetches.get(url);if(existing)return existing.promise;
  const job={controller:new AbortController()};this.prefetches.set(url,job);
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;job.controller.abort();},this.timeout);
  job.promise=Promise.resolve().then(()=>this.prefetch(url,job.controller)).then(()=>{
   if(job.controller.signal.aborted)return false;
   this.preloaded.add(url);this.failures.delete(url);this.failureAttempts.delete(url);return true;
  },error=>{
   if(timedOut||(!job.controller.signal.aborted&&error?.name!=='AbortError')){
    this.failures.add(url);this.failureAttempts.set(url,(this.failureAttempts.get(url)??0)+1);
   }
   return false;
  }).finally(()=>{clearTimeout(timer);job.controller.abort();if(this.prefetches.get(url)===job)this.prefetches.delete(url);this.onProgress();});
  return job.promise;
 }
 warm({keep,upcoming,all=[],delay=this.delay}){
  clearTimeout(this.timer);const epoch=++this.epoch;
  this.cancelPrefetches(new Set([...keep,...all]));
  // A ready step must not restart useful distant downloads. Rejoin existing
  // jobs first so each keeps its slot across queue generations; do not launch
  // another full batch beside it. Cold navigation pauses new dispatch only.
  this.keep=keep;this.queue=[...new Set([...this.prefetches.keys(),...upcoming.filter(url=>this.canRetry(url)),...all.filter(url=>!this.preloaded.has(url)&&this.canRetry(url))])];
  // Crucially, do NOT stop/cancel pending frames that are still in the window.
  for(const frame of [...this.frames.values()])if(frame!==this.current&&!keep.has(frame.url))this.discard(frame);
  if(!this.queue.length||!this.isActive())return;
  if(this.prefetch){
   // Nearby display frames must not wait behind slow distant downloads. Finish
   // their bounded window first, then rejoin (not duplicate) the existing distant
   // jobs before starting more. The two queues have separate waiters, so an
   // already-running distant request cannot occupy every nearby preparation slot.
   this.timer=setTimeout(()=>{
    const nearby=this.queue.filter(url=>this.keep.has(url));
    const distant=this.queue.filter(url=>!this.keep.has(url));
    const worker=async queue=>{
     while(epoch===this.epoch&&this.isActive()&&queue.length){
      const url=queue[0];
      // retain() can remove changed companion data while this queue awaits a
      // download. Do not start a retired URL from either copied work list.
      const queued=this.queue.indexOf(url);if(queued<0){queue.shift();continue;}
      // A surviving prefetch may now be a nearby/displayed frame, so merely
      // rejoining the distant list does not account for every occupied slot.
      // Leave this URL queued while waiting, so retain()/focus() can remove it.
      if(!this.keep.has(url)&&!this.prefetches.has(url)&&this.prefetches.size>=this.preloadConcurrency){
       await Promise.race([...this.prefetches.values()].map(job=>job.promise));continue;
      }
      queue.shift();this.queue.splice(queued,1);
      if(this.isReady(url))continue;
      if(!this.keep.has(url)&&(!this.canPreload()||this.preloaded.has(url)))continue;
      let frame,ready=false;
      try{
       if(this.keep.has(url)){frame=this.prepare(url);ready=await frame.ready;}
       else ready=await this.preload(url);
       if(epoch!==this.epoch)break;
       if(!ready){if(frame)this.discard(frame);if(this.canRetry(url)&&this.failures.has(url)){queue.push(url);this.queue.push(url);}}
       else if(frame&&frame!==this.current)this.cover(frame);
      }catch{if(frame)this.discard(frame);}
     }
    };
    const workers=queue=>Array.from({length:this.preloadConcurrency},()=>worker(queue));
    void Promise.all(workers(nearby)).then(()=>Promise.all(workers(distant)));
   },delay);
   return;
  }
  this.timer=setTimeout(async()=>{
   for(const url of this.queue){
    if(epoch!==this.epoch||!this.isActive())break;
    if(!this.keep.has(url)&&(!this.canPreload()||this.preloaded.has(url)))continue;
    let frame;
    try{frame=this.prepare(url);const ready=await frame.ready;
     if(epoch!==this.epoch)break;
     if(!ready){
      const retry=!frame.cancelled&&this.canRetry(url);
      this.discard(frame);
      // Finish the rest of the sequence first, then retry the missing frame.
      // Counts survive queue restarts so an outage cannot create an endless loop.
      if(retry)this.queue.push(url);
      continue;
     }
     if(frame!==this.current){if(!this.keep.has(url))this.discard(frame);else this.cover(frame);}
    }catch{if(frame)this.discard(frame);}
   }
  },delay);
 }
 clear(){this.stop();for(const frame of [...this.frames.values(),...this.retired])this.discard(frame);this.keep.clear();this.preloaded.clear();this.retryFailures();this.onProgress();}
}
