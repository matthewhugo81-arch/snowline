// The outline is shared geography, independent of forecast frames and preloads.
export const COASTLINE_SOURCE='coastline';
export const COASTLINE_LAYER='coast-line';
const emptyCollection=()=>({type:'FeatureCollection',features:[]});
const aborted=()=>new DOMException('Coastline loading was cancelled.','AbortError');

function validLine(line){return Array.isArray(line)&&line.length>=2&&line.every(point=>Array.isArray(point)&&point.length>=2&&point.every(Number.isFinite));}
function validFeature(feature){
 if(feature?.type!=='Feature')return false;
 const geometry=feature.geometry;
 return geometry===null||geometry?.type==='LineString'&&validLine(geometry.coordinates)||geometry?.type==='MultiLineString'&&Array.isArray(geometry.coordinates)&&geometry.coordinates.every(validLine);
}
function validateData(data){
 const valid=data?.type==='FeatureCollection'?Array.isArray(data.features)&&data.features.every(validFeature):validFeature(data);
 if(!valid)throw Error('The coastline map data is not valid GeoJSON.');
 return data;
}

// A failed request is never retained. Each caller can retry after an outage;
// concurrent maps share the same bounded request and the original full geometry.
export function createCoastlineDataLoader({fetcher=(...args)=>fetch(...args),url='coastline.geojson',timeout=8000,attempts=3,retryDelay=400,storage=globalThis.caches,storageTimeout=200,revision='full-lines-20261024'}={}){
 let data,pending;
 // Static full-resolution geography has its own version, independent of the
 // forecast cache. Bump revision when coastline.geojson changes.
 const cacheKey=new URL(url,import.meta.url);cacheKey.searchParams.set('geography',revision);
 const store=storage?Promise.resolve().then(()=>storage.open('snowline-map-geography-v1')).catch(()=>null):Promise.resolve(null);
 async function stored(){
  let timer;
  try{return await Promise.race([new Promise(resolve=>{timer=setTimeout(()=>resolve(null),storageTimeout);}),store.then(async cache=>{
   const response=await cache?.match(cacheKey.href);if(!response)return null;
   try{return validateData(await response.json());}catch{void cache.delete(cacheKey.href).catch(()=>{});return null;}
  }).catch(()=>null)]);}finally{clearTimeout(timer);}
 }
 function remember(value){
  void store.then(cache=>cache?.put(cacheKey.href,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/geo+json'}}))).catch(()=>{});
 }
 async function request(){
  const controller=new AbortController();let timer;
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{
   const error=Error('The coastline map data request timed out.');error.name='TimeoutError';error.retryable=true;
   controller.abort();reject(error);
  },timeout);});
  try{
   return await Promise.race([expired,(async()=>{
    const response=await fetcher(url,{signal:controller.signal});
    if(!response.ok){
     const error=Error('The coastline map data could not be downloaded (HTTP '+response.status+').');
     error.retryable=[408,425,429].includes(response.status)||response.status>=500;throw error;
    }
    return validateData(await response.json());
   })()]);
  }finally{clearTimeout(timer);}
 }
 return function load(){
  if(data)return Promise.resolve(data);
  if(pending)return pending;
  pending=(async()=>{
   try{
    if(storage){const cached=await stored();if(cached)return data=cached;}
    for(let attempt=0;;attempt++){
     try{data=await request();remember(data);return data;}
     catch(error){
      const transient=error.retryable===true||error instanceof TypeError||error.name==='AbortError';
      if(!transient||attempt+1>=Math.max(1,attempts))throw error;
      await new Promise(resolve=>setTimeout(resolve,retryDelay*(attempt+1)));
     }
    }
   }finally{pending=null;}
  })();
  return pending;
 };
}
export const loadCoastlineData=createCoastlineDataLoader();

function lineLayer(){
 return {id:COASTLINE_LAYER,type:'line',source:COASTLINE_SOURCE,layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#000000','line-width':['interpolate',['linear'],['zoom'],3,1,6,1.25,10,1.6],'line-opacity':1}};
}
const controllers=new WeakMap();

export function coastlineController(map,options={}){
 let controller=controllers.get(map);
 if(!controller){controller=createController(map,options);controllers.set(map,controller);}
 controller.subscribe(options);
 return controller;
}

function createController(map,{loadData=loadCoastlineData,renderTimeout=15000,isActive=()=>typeof document==='undefined'||!document.hidden}={}){
 let epoch=0,source=null,sourceListeners=null,before,disposed=false,styleAvailable=false;
 let fetching=false,dataApplied=false,applyDone=false,contentSeen=false,renderedEpoch=-1,watchdog;
 let state={status:'loading'};
 const observers=new Set(),errorObservers=new Set(),waiters=new Set();
 const sourceAt=()=>{try{return map.getSource(COASTLINE_SOURCE);}catch{return null;}};
 const layerAt=()=>{try{return map.getLayer(COASTLINE_LAYER);}catch{return null;}};
 const current=(version,item=source)=>!disposed&&styleAvailable&&version===epoch&&item&&source===item&&sourceAt()===item;
 const emit=(callback,value)=>{try{callback(value);}catch(error){console.warn('Coastline status callback:',error);}};
 function update(status,error){
  if(state.status!==status||state.error!==error){
   state=error?{status,error}:{status};
   for(const callback of observers)emit(callback,state);
   if(status==='error')for(const callback of errorObservers)emit(callback,error);
  }
  if(status==='ready'||status==='error')for(const waiter of [...waiters])waiter.finish(error);
 }
 function fail(error,version=epoch,item=source){
  if(disposed||version!==epoch||item&&source!==item)return;
  clearTimeout(watchdog);renderedEpoch=-1;update('error',error instanceof Error?error:Error(String(error)));
 }
 function detachSource(){
  if(source&&sourceListeners)for(const [event,handler]of sourceListeners)source.off(event,handler);
  sourceListeners=null;
 }
 function reset(){
  ++epoch;clearTimeout(watchdog);detachSource();source=null;fetching=false;
  dataApplied=false;applyDone=false;contentSeen=false;renderedEpoch=-1;
  update('loading');
 }
 function armWatchdog(version,item){
  clearTimeout(watchdog);
  watchdog=setTimeout(()=>{
   if(!current(version,item)||state.status==='ready'||state.status==='error')return;
   if(!isActive()){armWatchdog(version,item);return;}
   fail(Error('The coastline outline could not finish rendering. Retry the map background.'),version,item);
  },renderTimeout);
 }
 function isReady(){
  if(disposed||state.status!=='ready'||renderedEpoch!==epoch||!dataApplied||!applyDone||!contentSeen||!source||sourceAt()!==source||!layerAt())return false;
  try{return map.isSourceLoaded(COASTLINE_SOURCE);}catch{return false;}
 }
 function render(){
  if(disposed||!styleAvailable||state.status==='error'||!source)return;
  if(sourceAt()!==source){reset();return;}
  if(!dataApplied||!applyDone||!contentSeen||!layerAt())return;
  let loaded=false;try{loaded=map.isSourceLoaded(COASTLINE_SOURCE);}catch{}
  if(loaded){clearTimeout(watchdog);renderedEpoch=epoch;update('ready');}
  else if(state.status==='ready'){renderedEpoch=-1;update('loading');armWatchdog(epoch,source);}
 }
 function install(reorder=false){
  let item=sourceAt();
  if(!item){map.addSource(COASTLINE_SOURCE,{type:'geojson',data:emptyCollection()});item=sourceAt();}
  if(!item)throw Error('The coastline map source could not start.');
  if(source!==item){
   detachSource();source=item;
   const version=epoch;
   const data=event=>{
    if(!current(version,item)||!dataApplied||state.status==='error')return;
    if(event.sourceDataType==='content')contentSeen=true;
    map.triggerRepaint();
   };
   const loading=event=>{
    if(!current(version,item)||!dataApplied||state.status==='error')return;
    // New viewport tiles emit dataloading/data without a GeoJSON content
    // event. Only a source data update invalidates successful geometry;
    // tile loads still require their own completed render below.
    if(!event.tile)contentSeen=false;
    renderedEpoch=-1;update('loading');armWatchdog(version,item);
   };
   const error=event=>{if(current(version,item)&&event.error?.name!=='AbortError')fail(event.error??Error('The coastline outline could not be drawn.'),version,item);};
   sourceListeners=[['data',data],['dataloading',loading],['error',error]];
   for(const [event,handler]of sourceListeners)item.on(event,handler);
  }
  const anchor=before&&map.getLayer(before)?before:map.getStyle().layers.find(layer=>layer.type==='symbol')?.id;
  if(!layerAt())map.addLayer(lineLayer(),anchor);
  else if(reorder&&anchor!==COASTLINE_LAYER)map.moveLayer(COASTLINE_LAYER,anchor);
 }
 function ensure(nextBefore){
  if(disposed)return controller;
  const reorder=arguments.length>0;if(reorder)before=nextBefore;
  if(!styleAvailable||state.status==='error')return controller;
  try{install(reorder);}catch(error){
   // A caller may subscribe before the initial style.load event. Defer an
   // early addSource attempt; the style event will install it without a retry.
   if(/style is not done loading/i.test(error.message)){styleAvailable=false;reset();}
   else fail(error);
   return controller;
  }
  if(fetching||dataApplied)return controller;
  fetching=true;const version=epoch,item=source;
  // The placeholder reserves exactly the old layer order. Its source events
  // cannot mark the outline ready before the real data has been applied.
  Promise.resolve().then(()=>loadData()).then(data=>{
   if(!current(version,item)||state.status==='error')return;
   fetching=false;dataApplied=true;applyDone=false;contentSeen=false;renderedEpoch=-1;
   armWatchdog(version,item);
   return Promise.resolve(item.setData(data)).then(()=>{
    if(!current(version,item)||state.status==='error')return;
    applyDone=true;map.triggerRepaint();
   });
  }).catch(error=>{if(current(version,item))fail(error,version,item);});
  return controller;
 }
 function wait({signal,timeout=45000}={}){
  if(signal?.aborted||disposed)return Promise.reject(aborted());
  ensure();
  if(isReady())return Promise.resolve();
  if(state.status==='error')return Promise.reject(state.error);
  return new Promise((resolve,reject)=>{
   let timer;
   const waiter={
    finish(error){clearTimeout(timer);signal?.removeEventListener('abort',cancel);waiters.delete(waiter);error?reject(error):resolve();},
    renewTimeout(){clearTimeout(timer);timer=setTimeout(()=>{
     if(!isActive()){waiter.renewTimeout();return;}
     waiter.finish(Error('The coastline outline is still loading. Retry the map background.'));
    },timeout);}
   };
   const cancel=()=>waiter.finish(aborted());
   waiters.add(waiter);signal?.addEventListener('abort',cancel,{once:true});
   waiter.renewTimeout();
  });
 }
 function retry(){
  if(disposed)return controller;
  const layers=styleAvailable?map.getStyle()?.layers??[]:[],position=layers.findIndex(layer=>layer.id===COASTLINE_LAYER),successor=layers[position+1]?.id;
  reset();
  if(styleAvailable){
   try{if(layerAt())map.removeLayer(COASTLINE_LAYER);if(sourceAt())map.removeSource(COASTLINE_SOURCE);}
   catch(error){fail(error);return controller;}
  }
  ensure();
  // Forecast labels may have been inserted after the coastline since the
  // initial ordering. Restore its exact position without changing the native
  // anchor retained for the next complete style replacement.
  if(position>=0&&layerAt()&&(!successor||map.getLayer(successor)))map.moveLayer(COASTLINE_LAYER,successor);
  return controller;
 }
 const styleLoading=()=>{if(!disposed){styleAvailable=false;reset();}};
 const styleLoaded=()=>{if(!disposed){reset();styleAvailable=true;ensure();}};
 const resume=()=>{
  if(disposed||!isActive())return;
  for(const waiter of waiters)waiter.renewTimeout();
  if(dataApplied&&state.status==='loading'){armWatchdog(epoch,source);map.triggerRepaint();}
 };
 function destroy(){
  if(disposed)return;disposed=true;++epoch;clearTimeout(watchdog);detachSource();
  for(const [event,handler]of listeners)map.off(event,handler);
  if(typeof document!=='undefined')document.removeEventListener('visibilitychange',resume);
  for(const waiter of [...waiters])waiter.finish(aborted());
  observers.clear();errorObservers.clear();controllers.delete(map);
 }
 const listeners=[['styledataloading',styleLoading],['style.load',styleLoaded],['render',render],['remove',destroy]];
 const controller={ensure,isReady,wait,retry,destroy,get state(){return state;},subscribe({onState,onError}={}){
  if(onState&&!observers.has(onState)){observers.add(onState);emit(onState,state);}
  if(onError&&!errorObservers.has(onError)){errorObservers.add(onError);if(state.status==='error')emit(onError,state.error);}
  return controller;
 }};
 for(const [event,handler]of listeners)map.on(event,handler);
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume);
 // getStyle() has parsed layers in a style.load callback even when unrelated
 // provider or forecast tiles keep map.isStyleLoaded() false.
 try{styleAvailable=Array.isArray(map.getStyle()?.layers);}catch{}
 ensure();
 return controller;
}
