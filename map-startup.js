// Map startup must settle visibly even when a GPU or a basemap is unavailable.
// This guard changes no forecast, renderer or model-run behaviour.
export function createMapSafely(create){
 try{return create();}
 catch(cause){throw Object.assign(new Error('The map renderer could not start.',{cause}),{code:'MAP_RENDERER_UNAVAILABLE'});}
}

export function waitForMapStyle(map,{timeout=20000,signal,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
 if(map.isStyleLoaded())return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let timer,done=false;
  const finish=error=>{
   if(done)return;done=true;clearTimer(timer);
   map.off('style.load',loaded);map.off('remove',removed);signal?.removeEventListener('abort',aborted);
   if(error)reject(error);else resolve();
  };
  const loaded=()=>finish();
  const removed=()=>finish(Object.assign(new Error('The map was closed before its background loaded.'),{code:'MAP_CLOSED'}));
  const aborted=()=>finish(new DOMException('Aborted','AbortError'));
  map.on('style.load',loaded);map.on('remove',removed);signal?.addEventListener('abort',aborted,{once:true});
  timer=setTimer(()=>finish(Object.assign(new Error('The map background did not finish loading.'),{code:'MAP_STYLE_TIMEOUT'})),timeout);
 });
}

export function renderMapStartupFailure(root,error){
 const message=error?.code==='MAP_RENDERER_UNAVAILABLE'
  ?'This browser could not start the map renderer. Check that hardware acceleration and WebGL are available, or open the location charts.'
  :error?.code==='MAP_STYLE_TIMEOUT'
   ?'The map background did not finish loading. Check your connection and reload the maps, or open the location charts.'
   :'Weather maps could not start. Reload the maps, or open the location charts.';
 let panel=root.getElementById('map-startup-error');
 if(!panel){
  panel=root.createElement('section');panel.id='map-startup-error';panel.className='map-startup-error';panel.setAttribute('role','alert');
  const title=root.createElement('h2');title.textContent='Weather maps unavailable';
  const description=root.createElement('p');description.id='map-startup-message';
  const reload=root.createElement('button');reload.type='button';reload.textContent='Reload maps';
  reload.addEventListener('click',()=>root.defaultView?.location.reload());
  const charts=root.createElement('a');charts.href='./';charts.textContent='Open location charts';
  panel.append(title,description,reload,charts);(root.querySelector('main')??root.body).prepend(panel);
 }
 root.getElementById('map-startup-message').textContent=message;panel.hidden=false;
 for(const id of ['map-status','animation-status','preload-status','run-update-status','map-time-label','panel-label-a','panel-label-b','panel-label-c']){
  const item=root.getElementById(id);if(item)item.textContent=id==='map-status'?message:'Map unavailable';
 }
 for(const id of ['map-time','map-start-time','play-map','previous-time','next-time','map-playback-speed','map-forecast-interval','compare-maps','map-comparison-count','open-briefing','mobile-briefing','reload-maps','map-background','map-terrain','map-roads','map-opacity','map-area','reset-map',...['a','b','c'].flatMap(key=>['map-model','map-run','map-variable'].map(id=>id+(key==='a'?'':'-'+key))),...['a','b','c'].flatMap(key=>['map-contours','map-mslp','map-grid'].map(id=>id+'-'+key))]){
  const control=root.getElementById(id);if(control){control.disabled=true;for(const option of control.options??[])if(/^(Checking|Loading)/.test(option.textContent))option.textContent='Map unavailable';}
 }
 if(root.body)root.body.dataset.mapState='unavailable';
 return message;
}

export async function runMapStartup(initialize,{root=document,onError=renderMapStartupFailure}={}){
 try{await initialize();return true;}
 catch(error){onError(root,error);return false;}
}
