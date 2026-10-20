// Real page and bundled MapLibre, with delayed synthetic weather transport.
// This checks rendering integration and controls, not live-provider throughput.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Invalid path');const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const fakeOM=`
 const fixtureScale=unit=>({unit,breakpoints:[0,10,20],colors:[[0,0,0,1],[100,100,100,1],[255,255,255,1]]});
 export const defaultOmProtocolSettings={colorScales:{temperature:fixtureScale('°C'),relative:fixtureScale('%'),wind:fixtureScale('m/s')}};
 export const domainOptions=['ncep_gfs013','ncep_gfs025','ukmo_uk_deterministic_2km','ecmwf_ifs','dwd_icon'].map(value=>({value,grid:{type:'regular',nx:360,ny:181,latMin:-90,lonMin:-180,dx:1,dy:1}}));
 export const GridFactory={create:config=>({...config,originLat:config.latMin,originLon:config.lonMin,longitudeWrap:true,getInterpolatedValue:values=>values[0]})};
 export const getRanges=()=>[{start:0,end:181},{start:0,end:360}];
 window.fixtureGridReads=[];
 export const getProtocolInstance=()=>({omFileReader:{withReader:async()=>{},readVariable:async(url,variable,ranges,signal)=>{signal?.throwIfAborted();window.fixtureGridReads.push({url,variable,purpose:new Error().stack.includes('briefingValueLabels')?'label':'native'});return {values:new Float32Array(360*181).fill(10)};}}});
 export const updateCurrentBounds=()=>{};
 export const getValueFromLatLong=async()=>({value:10});
 export const getColorScale=key=>defaultOmProtocolSettings.colorScales[key]??fixtureScale(key.startsWith('geopotential_height_')?'m':'m/s');
 window.fixtureRequests=[];window.fixturePalettes=[];
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQSznxHwAEOAJKNKHrggAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
 export async function omProtocol(params,controller,settings){
  if(params.type==='json')window.fixturePalettes.push({url:params.url,cloud:settings?.colorScales?.cloud_cover?.colors?.[0],rain:settings?.colorScales?.precipitation?.colors?.[0]});
  window.fixtureRequests.push({url:params.url,type:params.type});
  // A deterministic network hold lets separate click events overlap real
  // foreground/background work without relying on the machine's render speed.
  if(window.fixtureTransportGate)await window.fixtureTransportGate;
  await new Promise(r=>setTimeout(r,window.fixtureDelay??80));
  if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!params.url.startsWith('om://fixture/'))return {data:{tilejson:'2.2.0',minzoom:0,maxzoom:10,tiles:['om://fixture/'+encodeURIComponent(params.url)+'/{z}/{x}/{y}']}};
  const fault=window.fixtureFault;
  if(fault&&params.type==='image'&&decodeURIComponent(params.url).includes(fault.match)){
   fault.url??=params.url;
   if(fault.url===params.url&&fault.remaining-->0)throw Error('Temporary test transport failure');
  }
  // Match the real OM worker's return type. Byte-only fixtures missed corrupt
  // bitmap persistence and the grossly underestimated in-memory cache size.
  if(params.type==='image'){
   const hour=Number(decodeURIComponent(params.url).match(/T(\\d{2})00\\.om/)?.[1]??0);
   const canvas=new OffscreenCanvas(32,32),context=canvas.getContext('2d');
   context.fillStyle='rgb('+hour*7+',100,180)';context.fillRect(0,0,32,32);
   return {data:canvas.transferToImageBitmap()};
  }
  return {data:new Uint8Array(0).buffer};
 }
`;
const geo={type:'FeatureCollection',features:[]};
const style={version:8,sources:{roads:{type:'geojson',data:geo}},layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},{id:'road-lines',source:'roads',type:'line',paint:{'line-color':'#222222'}}]};
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport,deviceScaleFactor:1});const errors=[];
  let releaseBriefing,briefingRequests=0;
  const briefingGate=new Promise(resolve=>{releaseBriefing=resolve;});
  await page.route('**/map-briefing.js*',async route=>{
   briefingRequests++;
   await briefingGate;
   await route.fulfill({contentType:'text/javascript',body:(await readFile(resolve(root,'map-briefing.js'),'utf8'))+'\nwindow.fixtureBriefingImported=true;'});
  });
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log('BROWSER',m.text());});
  await page.addInitScript(()=>localStorage.setItem('snowline-terrain','false'));
  await page.addInitScript(()=>{
   const original=window.setInterval;window.fixtureRefreshers=[];
   window.setInterval=(callback,delay,...args)=>{if(delay===60000)window.fixtureRefreshers.push(callback);return original(callback,delay,...args);};
  });
  await page.route('**/vendor/index.mjs*',route=>route.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('**/maps.js*',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(resolve(root,'maps.js'),'utf8'))+'\nwindow.fixturePanel=panels.a;window.fixturePanels=panels;window.fixtureImageryCache=imageryCache;'}));
  await page.route('**/map-tile-cache.js*',async route=>{
   const code=await readFile(resolve(root,'map-tile-cache.js'),'utf8');
   // Exercise restoration from disk, not only the hot memory cache.
   return route.fulfill({contentType:'text/javascript',body:code.replace('memoryBytes=32*1024*1024','memoryBytes=1024')});
  });
  await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
  await page.route('**/coastline.geojson',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
  const metadata=[];
  let livePhase=0;
  const fixture=(hour,hours)=>({completed:true,reference_time:'2026-10-10T'+String(hour).padStart(2,'0')+':00:00Z',variables:['temperature_2m','relative_humidity_2m','cloud_cover','cloud_cover_high','precipitation','pressure_msl'],valid_times:Array.from({length:hours+1},(_,i)=>new Date(Date.UTC(2026,9,10,hour+i)).toISOString())});
  const ensembleFixture=(hours,step)=>({...fixture(0,hours),variables:['precipitation_probability'],valid_times:fixture(0,hours).valid_times.filter((_,i)=>i%step===0)});
  const ensembleFixtures={ncep_gefs025:ensembleFixture(24,3),ncep_gefs05:ensembleFixture(48,6),ecmwf_ifs025_ensemble:ensembleFixture(30,3)};
  const statisticVariables=['geopotential_height_500hPa','temperature_850hPa','pressure_msl'].flatMap(f=>[f+'_mean',f+'_spread']);
  await page.route('**/ensemble-data/*/latest.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...ensembleFixture(24,3),variables:statisticVariables})}));
  await page.route('https://openmeteo.s3.amazonaws.com/**',route=>{
   const url=route.request().url();metadata.push(url);
   const domain=new URL(url).pathname.split('/')[2],ensemble=ensembleFixtures[domain];
   let gfs=domain==='ncep_gfs013'?{...fixture(0,48),variables:['temperature_2m','snowfall_water_equivalent','cloud_cover','precipitation']}:domain==='ncep_gfs025'?{...fixture(0,48),variables:['pressure_msl','freezing_level_height','temperature_850hPa','relative_humidity_850hPa','geopotential_height_500hPa',...['300','400'].flatMap(level=>['wind_u_component_'+level+'hPa','wind_v_component_'+level+'hPa'])]}:null;
   if(gfs&&livePhase&& !url.endsWith('/latest.json'))gfs={...gfs,...fixture(12,livePhase===1?6:livePhase===2?12:18),variables:gfs.variables,completed:false};
   const ifs=domain==='ecmwf_ifs'?{...fixture(0,process.env.MAP_THREE_PANELS_ONLY?24:48),variables:['pressure_msl','temperature_2m','temperature_2m_max','temperature_2m_min',...['temperature','relative_humidity','geopotential_height','wind_u_component','wind_v_component'].flatMap(kind=>[1000,925,850,700,500,400,300,250,200,100,50,10].map(level=>kind+'_'+level+'hPa'))]}:null;
   if(ifs&&process.env.MAP_THREE_PANELS_ONLY)ifs.valid_times=ifs.valid_times.filter((_,i)=>i%3===0);
   const meta=(domain==='dwd_icon'?fixture(0,process.env.MAP_THREE_PANELS_ONLY?60:48):null)??ifs??gfs??(ensemble?(url.endsWith('/latest.json')?ensemble:null):domain==='ukmo_uk_deterministic_2km'?(url.endsWith('/latest.json')?fixture(8,12):url.includes('/0600Z/meta.json')?fixture(6,54):url.includes('/0300Z/meta.json')?fixture(3,120):null):null);
   return route.fulfill({status:meta?200:404,contentType:'application/json',body:JSON.stringify(meta??{error:true})});
  });
  await page.goto(origin+'/maps.html'+(process.env.MAP_THREE_PANELS_ONLY?'?time=2026-10-10T00:00:00Z':''));
  try{
   if(process.env.MAP_THREE_PANELS_ONLY){
   const ready=()=>page.waitForFunction(()=>!document.getElementById('reload-maps').disabled&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   await ready();
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'native');
   assert.equal(await page.locator('#map-forecast-interval').isEnabled(),true,'UKV viewing interval is selectable');
   assert.equal(await page.locator('.map-start-controls #map-forecast-interval').isVisible(),true,'Interval is alongside the shared starting time');
   const nativeUKV=await page.locator('#map-start-time option').evaluateAll(opts=>opts.map(o=>o.value));
   for(const choice of ['3','6','12']){
    await page.locator('#map-forecast-interval').selectOption(choice);await ready();
    const times=await page.locator('#map-start-time option').evaluateAll(opts=>opts.map(o=>o.value));
    assert.ok(times.length<nativeUKV.length);
    assert.ok(times.every(t=>new Date(t).getUTCHours()%Number(choice)===0));
   }
   await page.locator('#map-forecast-interval').selectOption('native');await ready();
   assert.deepEqual(await page.locator('#map-start-time option').evaluateAll(opts=>opts.map(o=>o.value)),nativeUKV,'Hourly restores every supplied UKV time');
   if(viewport.width<=650)await page.locator('#mobile-map-settings').click();
   await page.locator('#map-model').selectOption('gfs_global');await ready();
   await page.locator('#map-forecast-interval').selectOption('12');await ready();
   const check12=()=>page.locator('#map-start-time option').evaluateAll(opts=>opts.map(o=>new Date(o.value).getUTCHours()));
   assert.deepEqual(await check12(),[0,12,0,12,0]);
   releaseBriefing();
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.locator('#briefing-interval').selectOption('12');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length>0,{},{timeout:60000});
   assert.equal(await page.locator('#briefing-interval').inputValue(),'12');
   await page.locator('#briefing-close').click();await ready();
   if(viewport.width<=650&&!(await page.locator('#compare-maps').isVisible()))await page.locator('#mobile-map-settings').click();
   await page.locator('#compare-maps').check();await ready();
   assert.equal(await page.locator('#map-variable-b').inputValue(),'precipitation','The existing second-panel default is retained');
   await page.locator('#map-comparison-count').selectOption('3');await ready();
   await page.locator('#map-model-b').selectOption('ecmwf_ifs');await ready();
   await page.locator('#map-model-c').selectOption('icon_global');await ready();
   assert.equal(await page.locator('.map-panel:visible').count(),3);
   await page.locator('#map-variable-c').selectOption('cloud_cover');await ready();
   assert.equal(await page.locator('#map-variable').inputValue(),'temperature_2m');
   assert.equal(await page.locator('#map-variable-b').inputValue(),'temperature_2m');
   assert.equal(await page.locator('#map-variable-c').inputValue(),'cloud_cover');
   if(viewport.width<=650)await page.locator('#mobile-return-map').click();
   await page.locator('#next-time').click();await ready();
   const labels=await page.locator('.map-panel:not([hidden]) .map-panel-label').allTextContents();
   assert.equal(new Set(labels.map(label=>label.split('Valid ')[1])).size,1);
   if(viewport.width<=650)await page.locator('#mobile-map-settings').click();
   await page.locator('#map-comparison-count').selectOption('2');await ready();
   assert.equal(await page.locator('#panel-c').isVisible(),false);
   await page.locator('#map-comparison-count').selectOption('3');await ready();
   assert.equal(await page.locator('#map-model-c').inputValue(),'icon_global');
   assert.equal(await page.locator('#map-variable-c').inputValue(),'cloud_cover');
   const boxes=await page.locator('.map-panel').evaluateAll(panels=>panels.map(p=>{const r=p.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));
   if(viewport.width>1050){
    assert.equal(new Set(boxes.map(b=>b.y)).size,1);assert.ok(boxes[2].x>boxes[1].x);
    const selection=()=>page.evaluate(()=>['map-model','map-variable','map-model-b','map-variable-b','map-model-c','map-variable-c','map-start-time'].map(id=>document.getElementById(id).value));
    const before=await selection();
    await page.locator('#toggle-map-sidebar').click();
    await page.waitForFunction(()=>['a','b','c'].every(key=>{const box=document.getElementById('map-'+key),canvas=box.querySelector('canvas');return Math.abs(box.clientWidth-canvas.clientWidth)<2;}));
    const wider=await page.locator('.map-panel').evaluateAll(ps=>ps.map(p=>p.getBoundingClientRect().width));
    wider.forEach((width,i)=>assert.ok(width>boxes[i].width+40,'Every map gains width when the sidebar collapses'));
    assert.deepEqual(await selection(),before,'Collapse retains all three model/layer selections and the shared forecast time');
    assert.equal(await page.locator('#map-forecast-interval').isVisible(),true,'Interval remains available with the sidebar collapsed');
    await page.locator('#map-forecast-interval').selectOption('6');await ready();
    assert.ok((await check12()).every(hour=>hour%6===0));
    await page.locator('#map-forecast-interval').selectOption('12');await ready();
    await page.locator('#toggle-map-sidebar').click();await ready();
   }
   else assert.ok(boxes[2].y>boxes[1].y);
   // Shorter and coarser model feeds must not remove another panel's hours.
   // GFS supplies 0–48 hourly, IFS 0–24 every three hours, ICON 0–60 hourly.
   const validTime=hour=>new Date(Date.UTC(2026,9,10,hour)).toISOString();
   const allTimes=()=>page.locator('#map-start-time option').evaluateAll(opts=>opts.map(o=>o.value));
   const selectTime=async hour=>{await page.locator('#map-start-time').selectOption(validTime(hour));await ready();};
   const panelState=()=>page.evaluate(()=>Object.fromEntries(['a','b','c'].map(key=>{
    const panel=window.fixturePanels[key];
    return [key,{time:panel.displayedTime,loaded:panel.loaded,url:panel.url,current:!!panel.frameCache?.current,image:!!panel.imageInfo,error:!document.getElementById('map-error-'+key).hidden}];
   })));
   await page.locator('#map-forecast-interval').selectOption('native');await ready();
   assert.deepEqual(await allTimes(),Array.from({length:61},(_,i)=>validTime(i)),'Three-panel timeline retains the longest selected forecast');
   assert.equal(await page.locator('#preload-status').getAttribute('data-total'),'119','Preloading counts only the 49 + 9 + 61 supplied frames');
   await selectTime(12);
   const previousIFSLayers=await page.evaluate(()=>window.fixturePanels.b.frameCache.current.layers);
   await selectTime(36);
   let shown=await panelState();
   for(const panel of Object.values(shown))assert.equal(panel.time,validTime(36),'Every panel identifies the requested valid time');
   assert.equal(shown.a.loaded,true);assert.equal(shown.c.loaded,true);
   assert.deepEqual(shown.b,{time:validTime(36),loaded:false,url:null,current:false,image:false,error:true},'An expired panel is cleared while the other forecasts continue');
   assert.ok(await page.evaluate(ids=>{
    const layers=window.fixturePanels.b.map.getStyle().layers;
    const background=layers.findIndex(layer=>layer.type==='background');
    return ids.every(id=>{const index=layers.findIndex(layer=>layer.id===id);return index<0||index<background;});
   },previousIFSLayers),'Old IFS imagery and overlays are removed or covered by the opaque basemap');
   assert.equal((await page.locator('#map-error-b').textContent()).includes('UKV'),false,'Missing data identifies the selected layer without a UKV-only message');
   await selectTime(12);
   shown=await panelState();assert.equal(shown.b.loaded,true);assert.equal(shown.b.error,false);assert.equal(shown.b.current,true);
   await selectTime(13);
   shown=await panelState();assert.equal(shown.a.loaded,true);assert.equal(shown.c.loaded,true);assert.equal(shown.b.loaded,false);
   assert.equal(shown.b.url,null,'A coarse model never borrows or interpolates a neighbouring hour');
   await selectTime(12);
   // Physical double/triple clicks arrive in separate tasks. Hold fresh native
   // reads while retaining the displayed map, then start known distant jobs.
   // The old navigation path cancelled every one of these jobs on a cold click.
   const holdColdNavigation=async()=>{
    await page.evaluate(async()=>{
     const cache=window.fixtureImageryCache;
     for(const panel of Object.values(window.fixturePanels))panel.frameCache.pause();
     cache.resetPending();
     const store=await cache.disk;
     if(store)await Promise.all((await store.keys()).map(key=>store.delete(key)));
     window.fixtureRequestStart=window.fixtureRequests.length;
     window.fixtureTransportGate=new Promise(resolve=>window.fixtureReleaseTransport=resolve);
     window.fixtureNavigationJobs=[];
     for(const panel of Object.values(window.fixturePanels)){
      const frames=panel.frameCache,current=frames.current;
      for(const frame of [...frames.frames.values()])if(frame!==current)frames.discard(frame);
      frames.preloaded.clear();frames.retryFailures();
      if(current)frames.preloaded.add(current.url);
      const index=panel.cacheTimes.indexOf(panel.displayedTime);
      const distant=panel.frameURLs.map((url,i)=>({url,distance:Math.abs(i-index)})).filter(({url})=>url&&url!==current?.url).sort((a,b)=>b.distance-a.distance).slice(0,frames.preloadConcurrency).map(({url})=>url);
      frames.warm({keep:new Set(current?[current.url]:[]),upcoming:[],all:distant,delay:0});
      frames.onProgress();
     }
    });
    await page.waitForFunction(()=>Object.values(window.fixturePanels).every(panel=>panel.frameCache.prefetches.size===panel.frameCache.preloadConcurrency));
    return page.evaluate(()=>{
     window.fixtureNavigationJobs=Object.values(window.fixturePanels).flatMap(panel=>[...panel.frameCache.prefetches].map(([url,job])=>({key:panel.key,url,job})));
     return Object.fromEntries(Object.entries(window.fixturePanels).map(([key,panel])=>[key,{time:panel.displayedTime,url:panel.url,loaded:panel.frameCache.preloaded.size}]));
    });
   };
   const releaseTransport=()=>page.evaluate(()=>{window.fixtureTransportGate=null;window.fixtureReleaseTransport();});
   const rapidClicks=async directions=>{
    for(const direction of directions){
     await page.locator(direction>0?'#next-time':'#previous-time').click({force:true});
     // Keep click events in distinct tasks; coalescing itself has unit coverage.
     await page.waitForTimeout(30);
    }
   };
   const checkTime=async hour=>{
    await ready();
    const state=await panelState();
    for(const panel of Object.values(state))assert.equal(panel.time,validTime(hour),'All panels identify the final requested time after a click burst');
    assert.equal(await page.locator('#map-time').inputValue(),String(hour));
    assert.equal(await page.locator('.map-error').filter({hasText:'Unable to load'}).count(),0,'Superseded requests cannot leave a stale loading error');
   };
   if(viewport.width<=650)await page.locator('#mobile-return-map').click();
   const held=await holdColdNavigation();
   await rapidClicks([1,1,1]);
   await page.waitForFunction(()=>window.fixturePanels.a.frameCache.frames.has(window.fixturePanels.a.frameURLs[15]));
   assert.equal(await page.evaluate(()=>window.fixtureNavigationJobs.every(({job})=>!job.controller.signal.aborted)),true,'Cold arrow clicks preserve useful in-flight background downloads');
   for(const [key,panel]of Object.entries(await panelState())){
    assert.equal(panel.time,held[key].time,'A loading target keeps the preceding image and its own label');
    assert.equal(panel.url,held[key].url);
   }
   assert.equal(await page.evaluate(()=>Object.values(window.fixturePanels).every(panel=>panel.frameCache.preloaded.size>=1)),true,'Cold navigation does not reset completed-frame progress');
   await releaseTransport();await checkTime(15);
   await page.waitForFunction(()=>window.fixtureNavigationJobs.every(({key,url})=>window.fixturePanels[key].frameCache.preloaded.has(url)));
   assert.equal(await page.evaluate(()=>window.fixtureNavigationJobs.every(({url})=>window.fixtureRequests.slice(window.fixtureRequestStart).filter(request=>request.type==='json'&&request.url===url).length===1)),true,'Retained downloads are not started again after the final selection commits');
   const selectedRequestCount=()=>page.evaluate(()=>{
    const urls=Object.values(window.fixturePanels).map(panel=>panel.frameURLs[15]).filter(Boolean);
    return window.fixtureRequests.filter(request=>urls.some(url=>decodeURIComponent(request.url).includes(url))).length;
   });
   const cachedRequests=await selectedRequestCount();
   await rapidClicks([-1,-1,-1]);await checkTime(12);
   await rapidClicks([1,1,1]);await checkTime(15);
   assert.equal(await selectedRequestCount(),cachedRequests,'Revisiting a prepared frame reuses its cached imagery');
   await rapidClicks([1,1,-1]);await checkTime(16);
   assert.equal((await panelState()).b.loaded,false,'A rapid reversal retains the explicit gap at an unsupported IFS hour');
   // Controls follow the requested index while data is pending, so reversing
   // immediately away from either timeline end never waits for a download.
   for(const [edge,away,reverse]of [[0,1,-1],[60,-1,1]]){
    await selectTime(edge);await holdColdNavigation();
    await rapidClicks([away]);
    assert.equal(await page.locator(reverse>0?'#next-time':'#previous-time').isEnabled(),true,'The reverse arrow enables immediately after leaving an endpoint');
    await rapidClicks([reverse]);
    assert.equal(await page.locator(edge===0?'#previous-time':'#next-time').isDisabled(),true,'Requested timeline bounds disable further clicks immediately');
    await releaseTransport();await checkTime(edge);
   }
   if(viewport.width<=650)await page.locator('#mobile-map-settings').click();
   await selectTime(12);
   await page.locator('#compare-maps').uncheck();await ready();
   assert.deepEqual(await allTimes(),Array.from({length:49},(_,i)=>validTime(i)),'Single-panel mode uses the selected model alone');
   await page.locator('#compare-maps').check();await ready();
   assert.equal((await allTimes()).at(-1),validTime(60),'Reopening comparison restores the third model horizon');
   await page.locator('#map-comparison-count').selectOption('2');await ready();
   assert.deepEqual(await allTimes(),Array.from({length:49},(_,i)=>validTime(i)),'Hiding the third panel removes only its unique extra times');
   await selectTime(48);shown=await panelState();assert.equal(shown.a.loaded,true);assert.equal(shown.b.loaded,false);
   await page.locator('#map-comparison-count').selectOption('3');await ready();
   await selectTime(60);shown=await panelState();
   assert.equal(shown.a.loaded,false);assert.equal(shown.b.loaded,false);assert.equal(shown.c.loaded,true,'Panel three continues even after the first two horizons end');
   await page.locator('#map-forecast-interval').selectOption('12');await ready();
   assert.deepEqual(await allTimes(),[0,12,24,36,48,60].map(validTime),'Twelve-hour steps cover the full comparison horizon');
   await selectTime(48);
   await page.locator('#map-playback-speed').selectOption('1200');
   if(viewport.width<=650)await page.locator('#mobile-return-map').click();
   await page.locator('#play-map').click();
   await page.waitForFunction(time=>window.fixturePanels.c.displayedTime===time,validTime(60));
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'true','Playback continues past shorter panels');
   await page.waitForFunction(time=>window.fixturePanels.a.loaded&&window.fixturePanels.b.loaded&&window.fixturePanels.c.displayedTime===time,validTime(0));
   await page.locator('#play-map').click();
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'false');
   if(viewport.width<=650)await page.locator('#mobile-map-settings').click();
   await page.locator('#map-model').selectOption('ukmo_uk_deterministic_2km');await ready();
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'12','Adding UKV retains the chosen shared interval');
   assert.ok((await check12()).every(hour=>hour%12===0));
   await page.locator('#map-forecast-interval').selectOption('native');await ready();
   const availableHours=await check12();
   assert.ok(availableHours.some(hour=>hour%3!==0),'Hourly restores all supplied times in a mixed three-model comparison');
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({viewport,threePanelControlsPassed:true,twelveHourMapsAndBriefingPassed:true,fullPanelHorizonsPassed:true,missingPanelPlaybackPassed:true,rapidArrowNavigationPassed:true}));
    continue;
   }
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Valid'),{},{timeout:40000});
   assert.equal(briefingRequests,0,'Optional briefing code must not compete with the first map frame');
   assert.equal(await page.locator('header .strap').count(),0);
   assert.equal(await page.locator('#open-briefing').textContent(),'Briefing View');
   const selection=()=>page.evaluate(()=>['map-model','map-variable','map-start-time'].map(id=>document.getElementById(id).value));
   let selected;
   if(viewport.width>650){
    await page.locator('#compare-maps').check();
    await page.locator('#panel-b').waitFor({state:'visible'});
    await page.waitForFunction(()=>['a','b'].every(key=>document.getElementById('panel-label-'+key).textContent.includes('Valid')));
    selected=await selection();
    const width=(await page.locator('.map-stage').boundingBox()).width;
    await page.locator('#toggle-map-sidebar').click();
    assert.equal(await page.locator('#map-settings-content').isVisible(),false);
    assert.equal(await page.locator('#toggle-map-sidebar').getAttribute('aria-expanded'),'false');
    assert.ok((await page.locator('.map-stage').boundingBox()).width>width+150,'Collapsed sidebar gives its width to the maps');
    await page.waitForFunction(()=>['a','b'].every(key=>{
     const map=document.getElementById('map-'+key),canvas=map.querySelector('canvas');
     return canvas&&Math.abs(canvas.getBoundingClientRect().width-map.clientWidth)<2;
    }));
    assert.deepEqual(await selection(),selected,'Collapsing retains the chosen model, layer and time');
    assert.equal(await page.locator('#compare-maps').isChecked(),true);
    await page.setViewportSize({width:390,height:844});
    await page.locator('#mobile-map-settings').click();
    assert.equal(await page.locator('#map-area').isVisible(),true,'Desktop collapse does not hide phone settings');
    assert.equal(await page.locator('#toggle-map-sidebar').isVisible(),false);
    await page.setViewportSize(viewport);
    // The media-query change event is asynchronous after viewport emulation.
    await page.waitForFunction(()=>document.getElementById('map-settings-content').hidden);
    assert.equal(await page.locator('#map-settings-content').isVisible(),false,'Desktop collapse preference survives resizing');
    await page.locator('#toggle-map-sidebar').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#map-settings-content').isVisible(),true);
    assert.equal(await page.locator('#toggle-map-sidebar').getAttribute('aria-expanded'),'true');
    await page.locator('#compare-maps').uncheck();
    await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Valid'));
   }else{
    assert.equal(await page.locator('#toggle-map-sidebar').isVisible(),false);
   }
   await page.locator('#map-start-time').selectOption({index:0});
   selected=await selection();
   const briefingButton=page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing');
   await briefingButton.click();
   assert.equal(await page.locator('#briefing-loading').isVisible(),true,'Briefing switches views even while its module download is held');
   assert.equal(await page.locator('.map-workspace').isVisible(),false);
   await page.locator('#briefing-loading-close').click();
   assert.equal(await page.locator('.map-workspace').isVisible(),true);
   releaseBriefing();
   await page.waitForFunction(()=>window.fixtureBriefingImported);
   assert.equal(await page.locator('#briefing-view').isVisible(),false,'Late download completion cannot reopen a cancelled view');
   await briefingButton.click();
   await page.locator('#briefing-close').waitFor({state:'visible'});
   await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid [data-ready="true"]').length===6,{},{timeout:60000});
   await page.locator('#briefing-close').click();
   assert.deepEqual(await selection(),selected,'Briefing round trip retains the map selection');
   if(process.env.MAP_NAVIGATION_ONLY){
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({viewport,navigationPassed:true}));
    continue;
   }
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'native');
   assert.equal(await page.locator('#map-forecast-interval').isDisabled(),false,'UKV defaults to hourly and allows other viewing intervals');
   await page.locator('#map-variable').selectOption('dew_point_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m dew point'));
   assert.ok(await page.evaluate(()=>window.fixtureRequests.some(r=>r.url.includes('variable=dew_point_2m_derived'))),'UKV dew point uses calculated imagery');
   assert.equal(await page.locator('#map-error-a').isVisible(),false);
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature'));
   // Combined field: complete same-time cloud/precipitation/pressure in either panel.
   const composite='cloud_precipitation_mslp';
   assert.equal(await page.locator('#map-variable option[value="'+composite+'"]').count(),1);
   await page.locator('#map-mslp-a').uncheck();
   // Complete the preceding overlay change before observing only the
   // commits caused by the composite selection below.
   await page.waitForFunction(()=>{
    const panel=window.fixturePanel;
    return document.getElementById('animation-status').textContent.startsWith('Ready')&&panel.frameCache?.current?.id===panel.sourceId&&panel.frameCache.isReady(panel.url)&&panel.frameDescriptors.get(panel.url)?.isobars===false;
   });
   await page.evaluate(()=>{
    window.fixtureFrameCommits=[];
    const proto=Object.getPrototypeOf(window.fixturePanel.frameCache),show=proto.show;
    proto.show=function(frame,...args){window.fixtureFrameCommits.push({url:frame.url,id:frame.id});return show.call(this,frame,...args);};
   });
   await page.locator('#map-variable').selectOption(composite);
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Cloud, precipitation & MSLP')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   // Allow the resize observer and the settled-view debounce to fire. The first
   // composite must remain prepared, rather than being invalidated by its legend.
   await page.waitForTimeout(300);
   const committed=await page.evaluate(()=>({commits:window.fixtureFrameCommits,current:window.fixturePanel.frameCache.current?.id,ready:window.fixturePanel.frameCache.isReady(window.fixturePanel.url)}));
   assert.equal(committed.commits.length,1,'Legend layout must not load the same selected frame twice: '+JSON.stringify(committed));
   assert.equal(committed.current,committed.commits[0].id);assert.equal(committed.ready,true);
   assert.equal(await page.locator('#map-mslp-a').isChecked(),true);
   assert.equal(await page.locator('#map-mslp-a').isDisabled(),true);
   assert.match(await page.locator('#legend-title-a').textContent(),/cloud.*precipitation/i);
   assert.match(await page.locator('#legend-interval-a').textContent(),/Mean rate over preceding 1 h/);
   await page.locator('#map-grid-a').check();
   await page.waitForFunction(()=>document.getElementById('grid-note-a').textContent.includes('precipitation · mm/h'));
   await page.locator('#map-grid-a').uncheck();
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('Precipitation')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   const palettes=await page.evaluate(()=>window.fixturePalettes);
   assert.ok(palettes.some(p=>p.url.includes('weather_composite=1')&&p.rain?.[3]===0&&p.cloud?.[0]===65),'Composite uses transparent dry band and grayscale cloud');
   assert.ok(palettes.some(p=>!p.url.includes('weather_composite=1')&&p.url.includes('variable=precipitation')&&p.rain?.[3]===1),'Ordinary precipitation stays opaque');
   await page.locator('#map-variable-b').selectOption(composite);
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature')&&document.getElementById('panel-label-b').textContent.includes('Cloud, precipitation & MSLP')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-mslp-a').isChecked(),false,'Leaving composite restores the independent pressure switch');
   assert.equal(await page.locator('#map-mslp-a').isDisabled(),false);
   assert.equal(await page.locator('#map-mslp-b').isDisabled(),true);
   assert.equal(await page.locator('.map-error:visible').count(),0);
   const compositeLabels=await page.locator('.map-panel:not([hidden]) .map-panel-label').allTextContents();
   assert.equal(compositeLabels[0].split('Valid ')[1],compositeLabels[1].split('Valid ')[1]);
   const legendLayout=await page.evaluate(()=>{
    const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return {height:r.height,bottom:r.bottom,top:r.top};};
    const legend=document.getElementById('legend-bands-b').closest('.layer-legend').getBoundingClientRect();
    return {legendBottom:legend.bottom,bands:bounds('legend-bands-b'),a:bounds('map-a'),b:bounds('map-b')};
   });
   assert.ok(legendLayout.bands.bottom<=legendLayout.legendBottom,'Both cloud and rainfall scales fit inside the legend');
   if(viewport.width>1050)assert.equal(legendLayout.a.height,legendLayout.b.height,'Comparison imagery stays aligned with a combined legend');
   await page.screenshot({path:'review-output/composite-'+viewport.width+'.png',fullPage:true});
   await page.locator('#map-variable-b').selectOption('precipitation');
   await page.locator('#map-mslp-a').check();
   await page.locator('#compare-maps').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   if(viewport.width>650)assert.equal(await page.locator('#legend-bands-a').evaluate(el=>el.closest('.layer-legend').getBoundingClientRect().height),58,'Ordinary layers retain the compact legend');
   if(process.env.SNOWLINE_COMPOSITE_SMOKE==='1'){console.log(JSON.stringify({viewport,compositeSmokePassed:true}));await page.close();continue;}
   const bitmapRoundTrip=await page.evaluate(async()=>{
    const {ForecastTileCache}=await import('./map-tile-cache.js');
    let calls=0;
    const cache=new ForecastTileCache(async()=>{
     calls++;const canvas=new OffscreenCanvas(512,512),context=canvas.getContext('2d');
     context.fillStyle='rgb(12,80,180)';context.fillRect(0,0,512,512);
     return {data:canvas.transferToImageBitmap()};
    },{memoryBytes:1});cache.setContext('bitmap-regression');
    try{
     const read=()=>cache.protocol({url:'om://fixture/bitmap-round-trip',type:'image'},new AbortController());
     await read();const restored=await read();
     const bitmap=await createImageBitmap(new Blob([restored.data],{type:'image/png'}));
     const canvas=new OffscreenCanvas(1,1),context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();
     return {calls,rgba:[...context.getImageData(0,0,1,1).data]};
    }finally{cache.release();}
   });
   assert.deepEqual(bitmapRoundTrip,{calls:1,rgba:[12,80,180,255]},'Native bitmaps survive disk eviction with exact pixels and no rerender');
   let firstHour=6;
   const selectTime=async value=>{
    await page.locator('#map-time').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
    await page.waitForFunction(hour=>document.getElementById('panel-label-a').textContent.split('Valid ')[1]?.includes(String(hour).padStart(2,'0')+':00'),value+firstHour);
   };
   // ICU versions differ on the comma after the weekday; the time must match.
   const bothAt=time=>page.waitForFunction(time=>[...document.querySelectorAll('.map-panel:not([hidden]) .map-panel-label')].every(el=>el.textContent.split('Valid ')[1]?.replaceAll(',','')===time.replaceAll(',','')),time);
   await selectTime(0);
   await page.locator('#play-map').click();
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.split('Valid ')[1]?.includes('07:00'));
   await page.locator('#play-map').click();
   const paused=await page.locator('#panel-label-a').textContent();await page.waitForTimeout(1000);
   assert.equal(await page.locator('#panel-label-a').textContent(),paused,'Pause must stop late commits');
   await selectTime(2);await selectTime(1);await selectTime(2);
   assert.match(await page.locator('#panel-label-a').textContent(),/0600Z/);
   await page.locator('#map-variable').selectOption('precipitation');
   firstHour=7;
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Precipitation'));
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('Valid'));
   await selectTime(0);
   for(const value of [1,2,3]){
    await selectTime(value);
    const labels=await page.locator('.map-panel:not([hidden]) .map-panel-label').allTextContents();
    assert.equal(labels[0].split('Valid ')[1],labels[1].split('Valid ')[1],'Comparison panels commit together');
   }
   // The reported cloud/rain comparison must recover a failed selected tile,
   // including exhaustion of tile retries, without a manual click or wrong time.
   await page.evaluate(()=>window.fixtureFault={match:'variable=cloud_cover',remaining:3});
   await page.locator('#map-variable').selectOption('cloud_cover');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Total cloud cover')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.ok(await page.evaluate(()=>window.fixtureFault.remaining<=0));
   assert.equal(await page.locator('.map-error:visible').count(),0,'A recovered frame has no stale error banner');
   const recovered=await page.locator('.map-panel:not([hidden]) .map-panel-label').allTextContents();
   assert.equal(recovered[0].split('Valid ')[1],recovered[1].split('Valid ')[1]);
   await page.evaluate(()=>window.fixtureFault=null);
   // Rapid jumps while background warming is unfinished cannot commit an old request.
   await page.locator('#map-time').evaluate(el=>{for(const value of ['20','40','6']){el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}});
   await bothAt('Sat 10 Oct, 12:00 UTC');
   assert.equal(await page.locator('.map-error:visible').count(),0);
   // Starting another drag supersedes a pending request before release. The
   // cancelled request cannot commit its label or overwrite the preview thumb.
   const beforeDrag=await page.locator('#panel-label-a').textContent();
   await page.evaluate(()=>window.fixtureDelay=300);
   await page.locator('#map-time').evaluate(el=>{el.value='39';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForTimeout(50);
   await page.locator('#map-time').evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
   await page.waitForTimeout(800);
   assert.equal(await page.locator('#map-time').inputValue(),'5');
   assert.equal(await page.locator('#panel-label-a').textContent(),beforeDrag);
   assert.equal(await page.locator('.map-error:visible').count(),0);
   await page.evaluate(()=>window.fixtureDelay=80);
   await page.locator('#map-time').evaluate(el=>{el.value='6';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Sat 10 Oct, 12:00 UTC');
   // After a genuinely failed selected time, Retry must display that original
   // time and clear both banners, not merely warm files behind the old image.
   await page.evaluate(()=>window.fixtureFault={match:'2026-10-11T0300.om?variable=cloud_cover_high',remaining:100});
   await page.locator('#map-variable').selectOption('cloud_cover_high');
   await page.locator('#map-time').evaluate(el=>{el.value='21';el.dispatchEvent(new Event('change',{bubbles:true}));});
   if(viewport.width<=650)await page.locator('#mobile-map-settings').click();
   await page.locator('#retry-preload').filter({hasText:'Retry selected frame'}).waitFor({state:'visible'});
   assert.equal(await page.locator('.map-error:visible').count(),2);
   await page.evaluate(()=>window.fixtureFault=null);
   await page.locator('#retry-preload').click();
   await bothAt('Sun 11 Oct, 03:00 UTC');
   assert.equal(await page.locator('.map-error:visible').count(),0);
   if(viewport.width<=650)await page.locator('#mobile-return-map').click();
   await page.locator('#map-variable').selectOption('precipitation');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Precipitation'));
   // Dragging during playback preserves the requested slider position and pauses.
   await page.locator('#play-map').click();
   await page.locator('#map-time').evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
   assert.equal(await page.locator('#map-time').inputValue(),'5');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'false');
   await selectTime(5);
   // Latest.json is 0800Z (nowcast), but the default must select 0600Z main.
   const main='ukmo_uk_deterministic_2km',nowcast=main+'_nowcast';
   assert.equal(await page.locator('#map-model').inputValue(),main);
   assert.match(await page.locator('#panel-label-a').textContent(),/0600Z/);
   assert.equal(metadata.some(url=>url.includes('/0300Z/')),true,'Verify precisely one previous completed main cycle');
   assert.deepEqual(await page.locator('#map-model option').evaluateAll(os=>os.filter(o=>o.value.startsWith('ukmo_uk_deterministic_2km')).map(o=>o.value)),[main,main+'_previous']);
   assert.equal(await page.locator('#map-model-b option[value="'+nowcast+'"]').count(),0);
   await page.locator('#map-model-b').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('0600Z'));
   // Playback must wrap both panels together and remain active after the final hour.
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-model-b').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('map-time').max==='53'&&document.getElementById('panel-label-b').textContent.includes('0600Z'));
   await page.locator('#map-time').evaluate(el=>{el.value='52';el.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('play-map').click();});
   await bothAt('Mon 12 Oct, 11:00 UTC');
   await bothAt('Mon 12 Oct, 12:00 UTC');
   await bothAt('Sat 10 Oct, 07:00 UTC');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'true','Loop restart must not reset Play');
   await bothAt('Sat 10 Oct, 08:00 UTC');
   await page.locator('#play-map').click();
   const loopPaused=await page.locator('.map-panel:not([hidden]) .map-panel-label').allTextContents();await page.waitForTimeout(1000);
   assert.deepEqual(await page.locator('.map-panel:not([hidden]) .map-panel-label').allTextContents(),loopPaused,'Pause still stops after wrapping');
   // Instantaneous data keeps initialization available even when the other
   // panel's interval field cannot supply that hour.
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature'));
   firstHour=6;await selectTime(0);
   assert.equal(await page.locator('#map-error-b').isVisible(),true,'Precipitation is explicitly unavailable at initialization');
   const initialTemperatureRequests=()=>page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&r.url.includes('/2026-10-10T0600.om?variable=temperature_2m&')).length);
   await page.locator('#map-variable-b').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('map-time').max==='54');
   firstHour=6;await selectTime(0);
   await bothAt('Sat 10 Oct, 06:00 UTC');
   assert.ok(await initialTemperatureRequests()>=1,'The initialization image is available; cached data is shared across panels');
   const invalidIntervals=await page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&r.url.includes('variable=precipitation_hourly_rate&')&&/\/(\d{4})Z\/2026-10-10T\1\.om/.test(r.url)));
   assert.deepEqual(invalidIntervals,[],'Do not request precipitation at initialization');
   // Removed menu products must also stop their metadata polling. Existing
   // mean/spread layer, buffering and comparison tests continue below.
   const ensembleOptions=await page.locator('#map-model optgroup[label="Ensemble models"] option').evaluateAll(os=>os.map(o=>o.value));
   for(const id of Object.keys(ensembleFixtures))assert.equal(ensembleOptions.includes(id),false);
   assert.ok(ensembleOptions.includes('ncep_hgefs025_ensemble_mean'));
   assert.ok(ensembleOptions.includes('snowline_gefs_ensemble'));
   assert.ok(ensembleOptions.includes('snowline_ecmwf_ensemble'));
   assert.equal(metadata.some(url=>/\/(ncep_gefs025|ncep_gefs05|ecmwf_ifs025_ensemble)\//.test(url)),false,'Removed feeds are not polled');
   await page.locator('#compare-maps').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-model').selectOption('snowline_gefs_ensemble');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('500 hPa height'));
   assert.equal(await page.locator('#map-variable option').count(),6);
   assert.equal(await page.locator('#map-mslp-a').isDisabled(),false);
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-model-b').selectOption('snowline_ecmwf_ensemble');
   await page.waitForFunction(()=>document.getElementById('map-variable-b').options.length===6&&!document.getElementById('map-variable-b').disabled);
   for(const field of statisticVariables){
    await page.locator('#map-variable-b').selectOption(field);
    await page.waitForFunction(field=>document.getElementById('panel-label-b').textContent.includes(field.endsWith('_spread')?'spread (SD)':'ensemble mean')&&document.getElementById('map-variable-b').value===field,field);
    assert.equal(await page.locator('#legend-title-b').textContent(),field.startsWith('temperature')?'\u00b0C':field.startsWith('pressure')?'hPa':'m');
   }
   await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:60000});
   assert.equal(await page.locator('#preload-status').getAttribute('data-loaded'),'18');
   await page.locator('#map-time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Sun 11 Oct, 00:00 UTC');
   await page.locator('#play-map').click();
   await bothAt('Sat 10 Oct, 00:00 UTC');
   await page.locator('#play-map').click();
   // Independent regions/zooms, GFS surface + companion grids and a pending
   // selection during a move must all use the new view, without false failures.
   await page.locator('#map-model').selectOption('gfs_global');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('GFS global'));
   await page.locator('#map-model-b').selectOption('gfs_global');
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('GFS global'));
   await page.locator('#map-variable').selectOption('wind_speed_300hPa');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('300 hPa wind'));
   assert.equal(await page.locator('#legend-title-a').textContent(),'mph');
   assert.deepEqual(await page.locator('#legend-bands-a span').allTextContents(),['60','75','90','105','120','135','150','165','180+']);
   assert.equal(await page.locator('#legend-bands-a > div').first().getAttribute('aria-label'),'60–<75 mph');
   assert.ok(await page.evaluate(()=>window.fixtureRequests.some(r=>r.url.includes('variable=wind_u_component_300hPa')&&r.url.includes('color_blend=false'))),'Jet shading requests discrete bands on the companion wind grid');
   await page.locator('#map-variable').selectOption('snowfall_water_equivalent');
   await page.locator('#map-variable-b').selectOption('freezing_level_height');
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('Freezing level')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'3');
   assert.equal(await page.locator('#map-forecast-interval').isDisabled(),false);
   assert.equal(await page.locator('#map-time').getAttribute('max'),'16','Instantaneous companion retains initialization beside the 16 interval-field frames');
   assert.equal(await page.locator('#legend-interval-a').textContent(),'Period unavailable','Initialization has no snowfall interval');
   await page.locator('#map-start-time').selectOption('2026-10-10T03:00:00.000Z');
   await bothAt('Sat 10 Oct, 03:00 UTC');
   assert.equal(await page.locator('#legend-interval-a').textContent(),'Mean rate over preceding 1 h','Viewing interval must not alter the snow averaging period');
   await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:60000});
   assert.equal(await page.locator('#preload-status').getAttribute('data-loaded'),'33');
   const defaultGFSHours=await page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&/\/ncep_gfs0(13|25)\//.test(r.url)).map(r=>Number(r.url.match(/T(\d{2})00\.om/)?.[1])));
   assert.ok(defaultGFSHours.length>0);
   assert.ok(defaultGFSHours.every(hour=>Number.isInteger(hour)&&hour%3===0),'Hourly gaps are not downloaded in the background');
   await page.locator('#map-time').evaluate(el=>{el.value='15';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Sun 11 Oct, 21:00 UTC');
   await page.locator('#play-map').click();
   await bothAt('Mon 12 Oct, 00:00 UTC');
   await bothAt('Sat 10 Oct, 03:00 UTC');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'true');
   // Changing the interval during playback cancels the old sequence. The same
   // setting controls steps, slider, loop and the complete background queue.
   const setInterval=async value=>{
    if(viewport.width<=650)await page.locator('#mobile-map-settings').click();
    await page.locator('#map-forecast-interval').selectOption(value);
    if(viewport.width<=650)await page.locator('#mobile-return-map').click();
    await page.waitForFunction(()=>document.getElementById('animation-status').textContent.startsWith('Ready'));
   };
   await setInterval('6');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'false');
   assert.equal(await page.locator('#map-time').getAttribute('max'),'8');
   await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:60000});
   assert.equal(await page.locator('#preload-status').getAttribute('data-loaded'),'17');
   await page.locator('#map-start-time').selectOption('2026-10-10T06:00:00.000Z');
   await bothAt('Sat 10 Oct, 06:00 UTC');
   assert.equal(await page.locator('#legend-interval-a').textContent(),'Mean rate over preceding 1 h');
   // Adding a regional panel preserves the explicitly selected shared interval.
   await page.locator('#map-model-b').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('UKV')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'6');
   assert.equal(await page.locator('#map-forecast-interval').isDisabled(),false);
   assert.equal(await page.locator('#map-time').getAttribute('max'),'9','Mixed comparison keeps six-hour steps through the longer UKV horizon');
   await page.locator('#map-model-b').selectOption('gfs_global');
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('GFS global')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'6');
   await page.locator('#map-variable-b').selectOption('freezing_level_height');
   await setInterval('native');
   assert.equal(await page.locator('#map-time').getAttribute('max'),'48');
   await page.locator('#map-a .maplibregl-ctrl-zoom-out').click();
   await page.locator('#map-b .maplibregl-ctrl-zoom-in').click();
   await page.evaluate(()=>window.fixtureDelay=180);
   await page.locator('#map-a canvas.maplibregl-canvas').press('ArrowRight');
   await page.locator('#map-time').evaluate(el=>{el.value='30';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Sun 11 Oct, 06:00 UTC');
   await page.waitForFunction(()=>document.getElementById('animation-status').textContent.startsWith('Ready'));
   await page.evaluate(()=>window.fixtureDelay=80);
   assert.equal(await page.locator('.map-error:visible').count(),0);
   assert.notEqual(await page.locator('#zoom-a').textContent(),await page.locator('#zoom-b').textContent());
   await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:60000});
   const cachedGFSRequests=await page.evaluate(()=>window.fixtureRequests.length);
   for(const [index,time]of [[1,'Sat 10 Oct, 01:00 UTC'],[48,'Mon 12 Oct, 00:00 UTC'],[17,'Sat 10 Oct, 17:00 UTC']]){
    await page.locator('#map-time').evaluate((el,index)=>{el.value=index;el.dispatchEvent(new Event('change',{bubbles:true}));},String(index));
    await bothAt(time);assert.equal(await page.locator('.map-error:visible').count(),0);
   }
   assert.equal(await page.evaluate(()=>window.fixtureRequests.length),cachedGFSRequests,'GFS bitmap images and overlays restore from disk for either area');
   // Briefing uses six static, complete composite images and one renderer.
   // Returning must retain the exact interactive comparison selection.
   const originalSelection=await page.evaluate(()=>['map-model','map-variable','map-model-b','map-variable-b','map-time'].map(id=>document.getElementById(id).value));
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid [data-ready="true"]').length===6,{},{timeout:60000});
   assert.equal(await page.locator('#briefing-model').inputValue(),'gfs_global');
   await page.locator('#briefing-preset').selectOption('weather');
   await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid [data-ready="true"]').length===6,{},{timeout:60000});
   await page.waitForFunction(()=>document.querySelector('#briefing-model option:checked').textContent.includes('00Z'));
   assert.equal(await page.locator('#briefing-model option:checked').textContent(),await page.locator('#map-model option:checked').textContent());
   assert.deepEqual(await page.locator('#briefing-model optgroup').evaluateAll(groups=>groups.map(g=>g.label)),['Short-term models','Medium-term models','Ensemble models']);
   assert.equal(await page.locator('#briefing-area').inputValue(),'uk');
   assert.equal(await page.locator('#briefing-grid canvas').count(),0);
   assert.equal(await page.locator('.briefing-renderer canvas').count(),1);
   const pixels=await page.locator('#briefing-grid img').first().evaluate(async image=>{
    await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d');context.drawImage(image,0,0,1,1);return {width:image.naturalWidth,height:image.naturalHeight,pixel:[...context.getImageData(0,0,1,1).data]};
   });
   assert.ok(pixels.width>=960);assert.equal(pixels.pixel[3],255);assert.ok(pixels.pixel.slice(0,3).some(value=>value<240),'Snapshot includes rendered weather, not a blank canvas');
   assert.equal(pixels.width,pixels.height,'UK chart is rendered square, not cropped or stretched by CSS');
   const chartBox=await page.locator('.briefing-chart').first().boundingBox();
   assert.ok(Math.abs(chartBox.width-chartBox.height)<1,'UK card retains a square view at every screen size');
   await page.locator('#briefing-interval').selectOption('3');
   await page.locator('#briefing-time').selectOption('0');
   await page.waitForFunction(()=>document.getElementById('briefing-status').textContent==='6/6 charts ready · 6/6 next charts prepared',{},{timeout:60000});
   const firstBriefingTimes=await page.locator('.briefing-card').evaluateAll(cards=>cards.map(card=>card.dataset.time));
   assert.deepEqual(firstBriefingTimes,[3,6,9,12,15,18].map(hour=>new Date(Date.UTC(2026,9,10,hour)).toISOString()));
   const chartPixels=await page.locator('.briefing-card').evaluateAll(async cards=>Promise.all(cards.map(async card=>{
    const image=card.querySelector('img');await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d');context.drawImage(image,0,0,1,1);return {hour:new Date(card.dataset.time).getUTCHours(),red:context.getImageData(0,0,1,1).data[0]};
   })));
   for(const {hour,red}of chartPixels)assert.ok(Math.abs(red-(hour*7*.96+255*.04))<3,'Each snapshot contains the pixels for its labelled valid time');
   assert.match(await page.locator('.briefing-card>p').first().textContent(),/Mean rate \(mm\/h\) over preceding 1 h/);
   await page.locator('.briefing-chart').first().click();
   assert.equal(await page.locator('#briefing-enlarged').evaluate(dialog=>dialog.open),true);
   const enlargedBox=await page.locator('#briefing-enlarged-image').boundingBox();
   assert.ok(Math.abs(enlargedBox.width-enlargedBox.height)<1,'Enlarged UK chart reserves its square shape before decoding');
   await page.locator('#briefing-enlarged-image').evaluate(image=>image.decode());
   const decodedBox=await page.locator('#briefing-enlarged-image').boundingBox();
   assert.ok(Math.abs(decodedBox.width-decodedBox.height)<1,'Enlarged UK chart stays square after decoding');
   await page.locator('#briefing-enlarged-close').click();
   assert.equal(await page.locator('#briefing-contours').isChecked(),false);
   assert.equal(await page.locator('#briefing-grid-values').isChecked(),false);
   const plainImage=await page.locator('#briefing-grid img').first().getAttribute('src');
   await page.locator('#briefing-contours').check();
   await page.locator('#briefing-grid-values').check();
   await page.waitForFunction(()=>document.getElementById('briefing-status').textContent==='6/6 charts ready · 6/6 next charts prepared',{},{timeout:60000});
   assert.notEqual(await page.locator('#briefing-grid img').first().getAttribute('src'),plainImage,'Enabling overlays renders a distinct image');
   assert.match(await page.locator('#briefing-legend').textContent(),/precipitation.*mm\/h/i);
   const preparedImages=await page.locator('#briefing-grid img').evaluateAll(images=>images.map(image=>image.src));
   const preparedRequests=await page.evaluate(()=>window.fixtureRequests.length);
   const expandedGridTop=await page.locator('#briefing-grid').evaluate(grid=>grid.getBoundingClientRect().top);
   await page.getByRole('button',{name:'Hide controls',exact:true}).click();
   assert.equal(await page.locator('#briefing-control-section').isVisible(),false);
   assert.equal(await page.locator('#briefing-toggle-controls').getAttribute('aria-expanded'),'false');
   assert.equal(await page.locator('#briefing-next').isVisible(),true);
   assert.ok(await page.locator('#briefing-grid').evaluate(grid=>grid.getBoundingClientRect().top)<expandedGridTop,'Hiding controls gives the charts more viewing space');
   await page.getByRole('button',{name:'Show controls',exact:true}).click();
   assert.equal(await page.locator('#briefing-control-section').isVisible(),true);
   assert.equal(await page.locator('#briefing-contours').isChecked(),true);
   assert.equal(await page.locator('#briefing-grid-values').isChecked(),true);
   assert.deepEqual(await page.locator('#briefing-grid img').evaluateAll(images=>images.map(image=>image.src)),preparedImages,'Collapsing controls retains prepared imagery');
   assert.equal(await page.evaluate(()=>window.fixtureRequests.length),preparedRequests,'Toggling controls does not fetch or redraw the charts');
   const gridReads=await page.evaluate(()=>window.fixtureGridReads.filter(read=>read.purpose==='label'));
   assert.ok(gridReads.length>=12);assert.ok(gridReads.every(r=>r.variable==='precipitation_hourly_rate'));
   assert.ok(await page.evaluate(()=>window.fixtureGridReads.some(read=>read.purpose==='native'&&read.variable==='cloud_cover')),'Composite prefetch prepares its cloud input separately from precipitation labels');
   assert.ok(await page.evaluate(()=>window.fixtureRequests.some(r=>r.type==='arrayBuffer'&&decodeURIComponent(r.url).includes('variable=precipitation'))),'Composite contours use precipitation in every view');
   await page.locator('.briefing-chart').first().click();
   assert.equal(await page.locator('#briefing-enlarged-image').getAttribute('src'),await page.locator('#briefing-grid img').first().getAttribute('src'),'Enlargement retains both overlays');
   await page.locator('#briefing-enlarged-close').click();
   await page.locator('#briefing-contours').uncheck();
   await page.locator('#briefing-grid-values').uncheck();
   await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid [data-ready="true"]').length===6);
   assert.equal(await page.locator('#briefing-grid img').first().getAttribute('src'),plainImage,'Turning overlays off restores the correct cached plain charts');
   await page.locator('#briefing-next').click();
   assert.equal(await page.locator('.briefing-card[data-ready="true"]').count(),6,'Next prepared page is displayed immediately from image cache');
   await page.locator('#briefing-previous').click();
   assert.deepEqual(await page.locator('.briefing-card').evaluateAll(cards=>cards.map(card=>card.dataset.time)),firstBriefingTimes);
   await page.evaluate(()=>window.fixtureFault={match:'variable=cloud_cover',remaining:100});
   await page.locator('#briefing-area').selectOption('europe');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-failed="true"]').length>0,{},{timeout:60000});
   await page.evaluate(()=>window.fixtureFault=null);
   await page.locator('#briefing-retry').click();
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
   assert.equal(await page.locator('.briefing-card[data-failed="true"]').count(),0,'Retry recovers missing charts without stale error labels');
   const wideShape=await page.locator('#briefing-grid img').first().evaluate(async image=>{await image.decode();return image.naturalWidth/image.naturalHeight;});
   assert.ok(Math.abs(wideShape-960/660)<.001,'Europe retains its wider framing');
   await page.locator('#briefing-area').selectOption('uk');
   assert.equal(await page.locator('.briefing-card[data-ready="true"]').count(),6,'Returning to UK reuses the square chart cache');
   await page.locator('#briefing-preset').selectOption('airmass');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
   await page.locator('.briefing-chart').first().click();
   assert.match(await page.locator('#briefing-enlarged-note').textContent(),/not theta-w/,'The airmass chart retains its not-theta-w explanation');
   await page.locator('#briefing-enlarged-close').click();
   for(const [preset,variable] of [['theta-w','wet_bulb_potential_temperature_850hPa'],['vorticity-300','relative_vorticity_300hPa'],['vorticity-400','relative_vorticity_400hPa']]){
    await page.locator('#briefing-preset').selectOption(preset);
    await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
    assert.ok(await page.evaluate(variable=>window.fixtureRequests.some(request=>request.url.includes('variable='+variable+'_derived')),variable),'Briefing requests calculated '+variable+' grids');
    assert.equal(await page.locator('.briefing-card[data-failed="true"]').count(),0);
   }
   await page.locator('#briefing-preset').selectOption('jet');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
   assert.match(await page.locator('#briefing-legend').textContent(),/mph/);
   assert.match(await page.locator('#briefing-legend').textContent(),/180\+/);
   assert.match(await page.locator('#briefing-legend').textContent(),/mph/);
   assert.equal(await page.locator('#briefing-legend .briefing-band-labels span').count(),9);
   assert.ok(await page.evaluate(()=>window.fixtureRequests.some(r=>r.type==='arrayBuffer'&&decodeURIComponent(r.url).includes('variable=wind_u_component_300hPa')&&decodeURIComponent(r.url).includes('arrow_profile=jet'))),'Briefing uses the wind component pair and jet arrow profile');
   await page.locator('#briefing-preset').selectOption('upper');
   await page.locator('#briefing-count').selectOption('9');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===9,{},{timeout:60000});
   await page.locator('#briefing-area').selectOption('atlantic');
   await page.locator('#briefing-model').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('briefing-run').textContent.includes('UKV')&&document.querySelectorAll('.briefing-card[data-ready="true"]').length===9,{},{timeout:60000});
   assert.equal(await page.locator('#briefing-interval').inputValue(),'native');
   assert.equal(await page.locator('#briefing-interval').isDisabled(),true);
   const ukvChoices=await page.locator('#briefing-preset option').evaluateAll(options=>options.map(option=>option.value));
   for(const key of ['weather','temperature','dew-point','cloud_cover','relative_humidity_2m','precipitation','precipitation_total_48h'])assert.ok(ukvChoices.includes(key),'Full UKV catalogue includes '+key);
   assert.ok(!ukvChoices.includes('theta-w'),'Unsupported diagnostics remain unavailable');
   for(const field of ['cloud_cover','precipitation']){
    await page.locator('#briefing-preset').selectOption(field);
    await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid .briefing-card[data-ready="true"]').length===9,{},{timeout:60000});
    const palettes=await page.evaluate(()=>window.fixturePalettes.filter(p=>p.url.includes('briefing_style=20261013-catalogue-field')));
    assert.ok(palettes.length>0);
    assert.deepEqual(palettes.at(-1).cloud,[38,60,85,1],'Standalone cloud keeps the main map palette');
    assert.deepEqual(palettes.at(-1).rain,[255,255,255,1],'Standalone precipitation keeps its opaque dry band');
    if(field==='precipitation')assert.match(await page.locator('#briefing-grid .briefing-card>p').first().textContent(),/Mean rate \(mm\/h\) over preceding 1 h/);
   }
   for(const selectedModel of [main]){
    await page.evaluate(()=>{window.fixtureRequests=[];window.fixtureGridReads=[];});
    await page.locator('#briefing-model').selectOption(selectedModel);
    await page.waitForFunction(()=>!document.getElementById('briefing-preset').disabled);
    await page.locator('#briefing-time').selectOption('0');
    await page.locator('#briefing-contours').check();
    await page.locator('#briefing-grid-values').check();
    for(const [preset,variable] of [['temperature','temperature_2m'],['dew-point','dew_point_2m_derived']]){
     await page.locator('#briefing-preset').selectOption(preset);
     await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===9,{},{timeout:60000});
     assert.match(await page.locator('#briefing-legend').textContent(),/°C/);
     assert.match(await page.locator('#briefing-legend').textContent(),/°C/);
     assert.equal(await page.locator('.briefing-card[data-failed="true"]').count(),0);
     assert.ok(await page.evaluate(variable=>window.fixtureRequests.some(r=>decodeURIComponent(r.url).includes('variable='+variable)),variable),'UKV briefing uses '+variable);
     assert.ok(await page.evaluate(variable=>window.fixtureGridReads.some(r=>r.variable===variable),variable),'UKV briefing grid labels use the same '+variable);
    }
   }
   await page.locator('#briefing-close').click();
   await page.waitForFunction(()=>document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.deepEqual(await page.evaluate(()=>['map-model','map-variable','map-model-b','map-variable-b','map-time'].map(id=>document.getElementById(id).value)),originalSelection);
   assert.equal(await page.locator('.briefing-renderer').count(),0,'Briefing renderer is released on return');
   if(viewport.width<=650){
    await page.locator('#mobile-expand-map').click();
    assert.equal(await page.locator('#expanded-map').evaluate(dialog=>dialog.open),true);
   }
   // Close during preparation, then reopen: old jobs must not commit or hang.
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   assert.equal(await page.locator('#expanded-map').evaluate(dialog=>dialog.open),false,'Briefing leaves the expanded-map dialog');
   await page.locator('#briefing-close').click();
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length>0,{},{timeout:60000});
   await page.locator('#briefing-close').click();
   // Provider latest.json stays at the old complete run. The live pointer has
   // an earlier horizon, and grows while the user keeps this page open.
   await page.waitForFunction(()=>!document.getElementById('reload-maps').disabled&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   livePhase=1;
   await page.evaluate(()=>Promise.all(window.fixtureRefreshers.map(refresh=>refresh())));
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('1200Z'));
   assert.match(await page.locator('#run-update-status').textContent(),/Updating/);
   assert.equal(await page.locator('#map-time').getAttribute('max'),'6');
   const selectedValid=await page.locator('#map-time-label').textContent();
   await page.evaluate(()=>{window.fixtureCache=window.fixturePanel.frameCache;window.fixtureCurrent=window.fixtureCache.current;});
   livePhase=2;
   await page.evaluate(()=>Promise.all(window.fixtureRefreshers.map(refresh=>refresh())));
   assert.equal(await page.locator('#map-time').getAttribute('max'),'12','New forecast hours arrive without a page reload');
   assert.equal(await page.locator('#map-time-label').textContent(),selectedValid,'Refreshing retains the selected valid time');
   assert.equal(await page.evaluate(()=>window.fixturePanel.frameCache===window.fixtureCache&&window.fixturePanel.frameCache.current===window.fixtureCurrent),true,'Appending hours retains the same decoded current frame and cache');
   assert.equal(await page.locator('.map-error:visible').count(),0);
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.getElementById('briefing-run').textContent.includes('1200Z'));
   assert.match(await page.locator('#briefing-run').textContent(),/Updating/);
   const briefingHours=await page.locator('#briefing-time option').count();
   livePhase=3;
   await page.evaluate(()=>Promise.all(window.fixtureRefreshers.map(refresh=>refresh())));
   assert.ok(await page.locator('#briefing-time option').count()>briefingHours,'Briefing also appends newly published forecast hours');
   await page.locator('#briefing-close').click();
   await page.locator('#map-model').selectOption('ecmwf_ifs');
   await page.waitForFunction(()=>document.querySelector('#map-variable option[value="temperature_2m_max"]'));
   const pressureKeys=await page.locator('#map-variable option').evaluateAll(options=>options.map(o=>o.value).filter(k=>/^(temperature|wind_speed|relative_humidity|geopotential_height)_\d+hPa$/.test(k)));
   assert.deepEqual(pressureKeys,['temperature_1000hPa','temperature_850hPa','temperature_500hPa','temperature_250hPa','wind_speed_1000hPa','wind_speed_500hPa','wind_speed_300hPa','wind_speed_200hPa','relative_humidity_1000hPa','relative_humidity_700hPa','relative_humidity_300hPa','geopotential_height_500hPa','geopotential_height_300hPa','geopotential_height_200hPa']);
   for(const statistic of ['max','min']){
    await page.locator('#map-variable').selectOption('temperature_2m_'+statistic);
    await page.waitForFunction(word=>document.getElementById('panel-label-a').textContent.includes(word),statistic==='max'?'maximum':'minimum');
    assert.match(await page.locator('#legend-interval-a').textContent(),/Native period/);
    assert.ok(await page.evaluate(key=>window.fixtureRequests.some(r=>r.url.includes('variable='+key)),'temperature_2m_'+statistic));
   }
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelector('#briefing-preset option[value="temperature-max"]'));
   assert.equal(await page.locator('#briefing-preset').inputValue(),'temperature-min','Chart selection carries from main maps to briefing');
   for(const statistic of ['max','min']){
    await page.locator('#briefing-preset').selectOption('temperature-'+statistic);
    await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length>=6,{},{timeout:60000});
    await page.locator('.briefing-chart').first().click();
    assert.match(await page.locator('#briefing-enlarged-note').textContent(),/not a daily extreme/,'Native-period extrema explanation appears in the enlarged chart');
    await page.locator('#briefing-enlarged-close').click();
    assert.match(await page.locator('.briefing-card p').first().textContent(),/duration unspecified/);
   }
   assert.equal(await page.locator('#briefing-model option:checked').textContent(),await page.locator('#map-model option:checked').textContent());
   await page.locator('#briefing-close').click();
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({viewport,passed:true,transportRequests:await page.evaluate(()=>window.fixtureRequests.length)}));
  }catch(error){
   console.log('DIAGNOSTICS',JSON.stringify(await page.evaluate(()=>({labels:[...document.querySelectorAll('.map-panel:not([hidden]) .map-panel-label')].map(e=>e.textContent),errors:[...document.querySelectorAll('.map-error')].map(e=>e.textContent),status:document.getElementById('animation-status').textContent,requests:window.fixtureRequests?.slice(-5).map(r=>({type:r.type,url:r.url.slice(0,120)}))}))));
   throw error;
  }finally{await page.close();}
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
