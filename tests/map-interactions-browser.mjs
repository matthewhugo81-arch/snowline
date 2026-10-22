// Real MapLibre and application state, deterministic delayed weather transport.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Invalid path');const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const source=await readFile('tests/map-browser.mjs','utf8'),fakeOM=vm.runInNewContext(source.match(/const fakeOM=(`[^]*?`);\r?\nconst geo=/)[1]);
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const geo={type:'FeatureCollection',features:[]},style={version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'white'}}]};
const UKV='ukmo_uk_deterministic_2km',UKMO='ukmo_global_deterministic_10km';
const variables=['temperature_2m','precipitation','cloud_cover','pressure_msl'];
const meta=(hours,reference='2026-10-10T00:00:00Z')=>({completed:true,reference_time:reference,variables,valid_times:hours.map(h=>new Date(Date.parse(reference)+h*3600000).toISOString())});
const ukv=meta(Array.from({length:55},(_,i)=>i)),ukmo=meta([...Array.from({length:49},(_,i)=>i),...Array.from({length:40},(_,i)=>51+i*3)]);
try{
 // Exercise the actual native renderer as well as the synthetic UI transport.
 // The native file reader supplies a deterministic grid; tile parsing, grid
 // clipping, interpolation, worker rendering and PNG pixels are production code.
 const native=await browser.newPage();await native.goto(origin+'/map-credits.html');
 const rendered=await native.evaluate(async()=>{
  const OM=await import('./vendor/index.mjs'),settings={...OM.defaultOmProtocolSettings};
  const reads=[];
  OM.getProtocolInstance(settings).omFileReader.readVariable=async(url,variable,ranges)=>{
   reads.push(ranges);return {values:new Float32Array(ranges.reduce((size,r)=>size*(r.end-r.start),1)).fill(10),scaleFactor:1};
  };
  const url='om://https://openmeteo.s3.amazonaws.com/data_spatial/ncep_gfs025/2026/10/10/0000Z/2026-10-10T1800.om?variable=temperature_2m/5/15/10';
  const pixels=async bounds=>{
   OM.updateCurrentBounds(bounds);
   const {data}=await OM.omProtocol({url,type:'image'},new AbortController(),settings);
   const canvas=new OffscreenCanvas(512,512),context=canvas.getContext('2d');context.drawImage(data,0,0);data.close();
   const bytes=context.getImageData(0,0,512,512).data;
   return {hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))],opaque:bytes.filter((v,i)=>i%4===3&&v===255).length};
  };
  const first=await pixels([-2,52,0,54]),second=await pixels([20,30,40,60]);
  return {first,second,reads:reads.length};
 });
 assert.deepEqual(rendered.first,rendered.second,'A complete native tile has identical pixels regardless of another panel’s camera');
 assert.equal(rendered.first.opaque,512*512,'No viewport-clipped transparent strip remains in a cached tile');
 console.log(JSON.stringify({nativeTileStable:true,nativeReads:rendered.reads}));await native.close();
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('snowline-terrain','false');window.fixtureDelay=1;});
  await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('**/maps.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile('maps.js','utf8'))+'\nwindow.fixturePanels=panels;window.fixtureImageryCache=imageryCache;const fixtureResolve=resolvePanelRun;resolvePanelRun=async(...args)=>{if(window.fixtureMetadataGate)await window.fixtureMetadataGate;return fixtureResolve(...args);};'}));
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({json:style}));
  await page.route('**/coastline.geojson',r=>r.fulfill({json:geo}));
  let holdMetadata=false,releaseMetadata,releaseArchive;
  const metadataGate=new Promise(resolve=>releaseMetadata=resolve);
  const archiveGate=new Promise(resolve=>releaseArchive=resolve);
  await page.route('https://openmeteo.s3.amazonaws.com/**',async r=>{
   const url=r.request().url(),domain=new URL(url).pathname.split('/')[2];
   if(holdMetadata&&domain.startsWith('ncep_gfs'))await metadataGate;
   const value=domain===UKV?ukv:domain===UKMO?ukmo:domain.startsWith('ncep_gfs')?ukmo:null;
   const dated=url.match(/\/(\d{4}\/\d{2}\/\d{2})\/(\d{4})Z\/meta.json/);
   if(holdMetadata&&domain.startsWith('ncep_gfs')&&dated?.[1]==='2026/10/09')await archiveGate;
   const known=!dated||dated[1]==='2026/10/10'&&dated[2]==='0000'||domain.startsWith('ncep_gfs')&&dated[1]==='2026/10/09'&&dated[2]==='1800';
   const previous=dated?.[1]==='2026/10/09'?meta([...Array(169).keys()],'2026-10-09T18:00:00Z'):value;
   await r.fulfill({status:value&&known?200:404,json:value&&known?previous:{error:true}});
  });
  await page.route('**/ensemble-data/**',r=>r.fulfill({status:404,json:{error:true}}));
  const ready=()=>page.waitForFunction(()=>!document.getElementById('reload-maps').disabled&&document.getElementById('animation-status').textContent.startsWith('Ready'),{},{timeout:120000});
  const settings=async()=>{if(viewport.width<651)await page.locator('#mobile-map-settings').click();};
  const mapView=async()=>{if(viewport.width<651)await page.locator('#mobile-return-map').click();};
  await page.goto(origin+'/maps.html?time=2026-10-10T18:00:00Z');await ready();await settings();
  await page.locator('#compare-maps').check();await ready();
  await page.locator('#map-model-b').selectOption(UKMO);await ready();
  await page.locator('#map-variable').selectOption('cloud_precipitation_mslp');await ready();
  await page.locator('#map-variable-b').selectOption('temperature_2m');await ready();
  await page.locator('#map-forecast-interval').selectOption('native');await ready();await mapView();
  await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:120000});
  assert.equal(await page.locator('#preload-status').getAttribute('data-total'),'143','UKV + UKMO complete all 143 charts');
  const snapshot=()=>page.evaluate(()=>({panels:Object.fromEntries(Object.entries(window.fixturePanels).map(([key,p])=>[key,{source:p.sourceId,time:p.displayedTime,url:p.url,loaded:[...p.frameCache.preloaded].sort(),layer:p.map.getLayer(p.weatherLayer)?.id}])),generation:window.fixtureImageryCache.generation,preparedRequests:[...window.fixtureImageryCache.memory.keys()].map(key=>{const [type,url]=JSON.parse(key);return type+' '+url;}),requests:window.fixtureRequests.map(r=>r.type+' '+r.url)}));
  const before=await snapshot();
  await page.evaluate(()=>window.fixturePanels.a.map.panBy([1,0],{duration:0}));await ready();await page.waitForTimeout(300);
  const smallPan=await snapshot();
  assert.equal(smallPan.generation,before.generation,'A drag does not reset shared imagery');
  assert.equal(smallPan.panels.a.source,before.panels.a.source,'A drag retains the current weather source');
  assert.deepEqual(smallPan.panels.b,before.panels.b,'Dragging Panel 1 leaves Panel 2 intact');
  for(const request of new Set(before.requests))assert.equal(smallPan.requests.filter(r=>r===request).length,before.requests.filter(r=>r===request).length,'A small pan never re-renders a previously prepared tile');
  const camera=await page.evaluate(()=>{const map=window.fixturePanels.a.map;return {center:map.getCenter().toArray(),zoom:map.getZoom()};});
  const zoomStart=await page.evaluate(()=>{
   const p=window.fixturePanels.a;p.map.jumpTo({zoom:p.map.getZoom()+1});
   return {cached:p.frameCache.cachedFrames().size,prepared:p.frameCache.preloaded.size};
  });
  assert.equal(zoomStart.cached,smallPan.panels.a.loaded.length,'Zoom retains the completed-frame cache');
  await ready();await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:120000});
  const zoomed=await snapshot();assert.deepEqual(zoomed.panels.b,before.panels.b,'Zooming one panel leaves the other fully prepared');
  const restored=await page.evaluate(camera=>{
   const p=window.fixturePanels.a;p.map.jumpTo(camera);
   return {prepared:p.frameCache.preloaded.size,cached:p.frameCache.cachedFrames().size};
  },camera);
  assert.equal(restored.prepared,smallPan.panels.a.loaded.length,'Returning to the original zoom immediately restores its completed sequence');
  await ready();await page.waitForTimeout(350);
  const zoomBack=await snapshot();
  assert.equal(zoomBack.requests.length,zoomed.requests.length,'Returning to a prepared zoom makes no native render requests');
  assert.equal(zoomBack.panels.a.source,before.panels.a.source);
  await page.evaluate(()=>window.fixturePanels.a.map.panBy([180,80],{duration:0}));await ready();
  await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:120000});
  const largePan=await snapshot();
  assert.deepEqual(largePan.panels.b,before.panels.b,'A larger pan only prepares the moved panel');
  assert.equal(largePan.panels.a.source,before.panels.a.source);
  // Initial camera changes can cancel native attempts before they enter the cache.
  // Only successfully prepared tiles have a reuse guarantee when exposed again.
  assert.ok(before.preparedRequests.length>100,'The complete sequence has prepared tiles to reuse');
  for(const request of before.preparedRequests)assert.equal(largePan.requests.filter(r=>r===request).length,before.requests.filter(r=>r===request).length,'Exposing new tiles retains already prepared tiles: '+request);
  await settings();await page.locator('#map-comparison-count').selectOption('3');await ready();
  for(const suffix of ['','-b','-c']){await page.locator('#map-variable'+suffix).selectOption('precipitation_total_48h');await ready();}
  // Select a common valid time with a complete 48-hour rainfall window.
  await page.locator('#map-start-time').selectOption('2026-10-12T00:00:00.000Z');await ready();
  const rain=await snapshot();holdMetadata=true;
  await page.evaluate(()=>{window.fixtureMetadataGate=new Promise(resolve=>window.releaseMetadataGate=resolve);});
  await page.locator('#map-model-b').selectOption('gfs_global');
  await page.waitForFunction(()=>document.getElementById('map-variable-b').disabled);
  const held=await snapshot();
  for(const key of ['a','c'])assert.deepEqual(held.panels[key],rain.panels[key],'Other rainfall panels stay visible while metadata is pending');
  // Neither archive discovery nor slow weather rendering may lock the layer menu
  // after the selected complete run has been verified.
  await page.evaluate(()=>{window.fixtureTransportGate=new Promise(resolve=>window.releaseTransport=resolve);window.releaseMetadataGate();window.fixtureMetadataGate=null;});
  releaseMetadata();
  await page.waitForFunction(()=>!document.getElementById('map-variable-b').disabled,{},{timeout:10000});
  await page.locator('#map-variable-b').selectOption('temperature_2m');
  assert.equal(await page.locator('#map-variable-b').isEnabled(),true);
  releaseArchive();
  await page.waitForFunction(()=>[...document.getElementById('map-run-b').options].some(o=>o.value.includes('2026-10-09')));
  assert.equal(await page.locator('#map-variable-b').inputValue(),'temperature_2m','Background archive discovery preserves the chosen layer');
  await page.evaluate(()=>{window.releaseTransport();window.fixtureTransportGate=null;});await ready();
  const changed=await snapshot();
  for(const key of ['a','c'])assert.equal(changed.panels[key].source,rain.panels[key].source,'Only the changed model replaces its source');
  await page.locator('#map-variable-b').selectOption('temperature_2m');await ready();
  const field=await snapshot();for(const key of ['a','c'])assert.equal(field.panels[key].source,rain.panels[key].source,'Only the changed weather layer replaces its source');
  const previous=await page.locator('#map-run-b option').evaluateAll(options=>options.find(o=>o.value.includes('2026-10-09'))?.value);
  assert.ok(previous,'An older GFS run is available');
  await page.locator('#map-run-b').selectOption(previous);await ready();
  const run=await snapshot();for(const key of ['a','c'])assert.equal(run.panels[key].source,rain.panels[key].source,'Only the changed run replaces its source');
  assert.deepEqual(errors,[]);await mapView();await mkdir('review-output',{recursive:true});
  await page.screenshot({path:`review-output/independent-panels-${viewport.width}.png`});
  console.log(JSON.stringify({viewport,completeFrames:143,smallPanReuse:true,largePanReuse:true,zoomReturnReuse:true,independentModelLayerRun:true,layerMenuBeforeArchiveAndImagery:true}));await page.close();
 }
}finally{await browser.close();server.close();}
