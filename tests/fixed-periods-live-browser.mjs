// Dated real-data check of fixed 48-hour windows and the tighter North Atlantic crop.
// Real forecast grids, pressure vectors, grid labels and raster workers. The full
// basemap, native rainfall intervals, grid labels and pressure overlays are retained.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd(),name='fixed-periods',output=resolve('review-output');
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
await mkdir(output,{recursive:true});
const pageHTML='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/vendor/maplibre-gl.css"><link rel="stylesheet" href="/maps.css"><link rel="stylesheet" href="/map-briefing.css"><link rel="stylesheet" href="/map-previous-runs.css"><body class="map-page"><header>Snowline · Previous Run Analysis</header><main class="map-main"><section class="briefing-stage" id="bench"></section></main>';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;if(path==='/benchmark.html'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(pageHTML);}const file=resolve(root,'.'+path);if(!file.startsWith(root+sep))throw Error('Bad path');const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']}),page=await browser.newPage({viewport:{width:1664,height:940}}),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('openmeteo.s3.amazonaws.com'))requests.push({url:r.url(),method:r.method()});});
const upstreamStyle=await fetch('https://tiles.openfreemap.org/styles/positron',{signal:AbortSignal.timeout(20000)}).then(r=>r.json());
const style=upstreamStyle; // Check the real background-map service as well as forecast imagery.
await page.route('https://tiles.openfreemap.org/styles/*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
let report={name,checkedAt:new Date().toISOString(),scope:'Three IFS 9 km runs, 48 h ending 2026-10-14 12Z, UK & Ireland, grid values and MSLP enabled. Real weather data and raster workers; full basemap; hosted-runner measurement, not an end-user speed guarantee.'};
try{
 await page.goto(origin+'/benchmark.html');
 await page.evaluate(async()=>{
  const OM=await import('/vendor/index.mjs'),maplibre=await import('/vendor/maplibre-gl.mjs');
  const {createPreviousRunAnalysis}=await import('/map-previous-runs.js'),{loadSpatialRun,fieldSource,fieldDataURL}=await import('/map-sources.js');
  const {sourceVariable,extendCatalogue,PRECIPITATION_SCALE,CLOUD_COVER_SCALE}=await import('/map-catalogue.js'),{MAP_MODELS}=await import('/map-models.js');
  const {BRIEFING_PRESETS}=await import('/map-briefing-data.js?v=20261013-fixed-periods');
  const position=BRIEFING_PRESETS.findIndex(p=>p.field==='precipitation_total_48h');BRIEFING_PRESETS.unshift(...BRIEFING_PRESETS.splice(position,1));
  // Match the application's explicitly registered base scales; the vendor's
  // defaults include lazy functions and are not the configured application.
  const fields=[{key:'cloud_cover',name:'Total cloud cover',unit:'%',...CLOUD_COVER_SCALE},{key:'precipitation',name:'Precipitation',unit:'mm water',...PRECIPITATION_SCALE},{key:'pressure_msl',overlayOnly:true,name:'Mean sea-level pressure (MSLP)',unit:'hPa',stops:[940,960,980,1000,1010,1020,1040,1060],colors:['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643']}];
  const rgba=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),hex.length===9?parseInt(hex.slice(7,9),16)/255:1];
  const settings={...OM.defaultOmProtocolSettings,maxStatesWithData:16,domainOptions:[...OM.domainOptions],colorScales:{...OM.defaultOmProtocolSettings.colorScales,...Object.fromEntries(fields.map(f=>[f.key,{type:'breakpoint',unit:f.unit,breakpoints:f.stops,colors:f.colors.map(rgba)}]))}};
  const cache=new Map(),load=async url=>{if(!cache.has(url))cache.set(url,fetch(url).then(async r=>{if(!r.ok)throw Object.assign(Error('HTTP '+r.status),{status:r.status});return r.json();}));return cache.get(url);};
  const contourLevels=field=>field?.contourValues??field?.stops??[];
  const latest=await loadSpatialRun('ecmwf_ifs','2026-10-12T12:00:00Z',load);extendCatalogue(fields,[latest],OM,settings);
  const reader=OM.getProtocolInstance(settings).omFileReader,native=reader.readSimpleVariable.bind(reader);window.nativeReads={};
  reader.readSimpleVariable=async(file,variable,...args)=>{window.nativeReads[variable]=(window.nativeReads[variable]??0)+1;return native(file,variable,...args);};
  const view=createPreviousRunAnalysis({host:document.getElementById('bench'),models:MAP_MODELS.filter(m=>m.id==='ecmwf_ifs'),fields,OM,maplibre,settings,
   loadModel:async()=>latest,loadRun:async(model,ref,load)=>{const meta=await loadSpatialRun(model,ref,load);extendCatalogue(fields,[meta],OM,settings);return meta;},loadJSON:load,
   createURL:(model,meta,time,field)=>'om://'+fieldDataURL(meta,field,time)+'?'+new URLSearchParams({variable:sourceVariable(fieldSource(meta,field,time),field)??field,interpolation:'linear',arrows:'false',tile_size:'512',color_blend:fields.find(f=>f.key===field)?.bands?'false':'true',contours:'true',intervals:(field==='pressure_msl'?[...Array.from({length:61},(_,i)=>880+i*4),...Array.from({length:61},(_,i)=>(880+i*4)*100)]:contourLevels(fields.find(f=>f.key===field))).join(',')}),onClose:()=>{}});
  document.getElementById('previous-grid-values').checked=true;document.getElementById('previous-interval').value='native';
  window.benchmarkStart=performance.now();view.open({model:'ecmwf_ifs',time:'2026-10-14T12:00:00Z',periodStart:'2026-10-12T12:00:00Z',bounds:[-12,48,5,61.5]});
 });
 await page.waitForFunction(()=>{const status=document.querySelector('#previous-progress')?.textContent??'';if(/not a function|undefined|cannot|could not/i.test(status))throw Error(status);if(document.querySelector('#previous-grid .briefing-card[data-failed="true"]'))throw Error('A required comparison chart failed');return document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length>=1;},{},{timeout:180000});
 report.firstPanelMs=await page.evaluate(()=>Math.round(performance.now()-window.benchmarkStart));
 await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:240000});
 report.allThreeMs=await page.evaluate(()=>Math.round(performance.now()-window.benchmarkStart));
 report.coldReads=await page.evaluate(()=>({...window.nativeReads}));report.coldRequests=requests.length;
 const cards=await page.locator('#previous-grid .briefing-card').evaluateAll(cs=>cs.map(c=>({run:c.dataset.run,time:c.dataset.time,caption:c.querySelector('p').textContent})));
 assert.deepEqual(cards.map(c=>new Date(c.run).getUTCHours()),[0,6,12]);assert.ok(cards.every(c=>Date.parse(c.time)===Date.parse('2026-10-14T12:00:00Z')));report.cards=cards;
 await page.screenshot({path:resolve(output,name+'-ifs-48h.png'),fullPage:true});
 const before=requests.length,t=performance.now();await page.locator('#previous-forward').click();await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:180000});report.nextPeriod={ms:Math.round(performance.now()-t),requests:requests.length-before};
 assert.equal(await page.locator('#previous-time').inputValue(),'2026-10-14T12:00:00.000Z');
 assert.ok((await page.locator('#previous-grid .briefing-card').evaluateAll(cs=>cs.map(c=>c.dataset.time))).every(t=>Date.parse(t)===Date.parse('2026-10-16T12:00:00Z')));
 const backRequests=requests.length,backTime=performance.now();await page.locator('#previous-back').click();await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3);report.cachedReturn={ms:Math.round(performance.now()-backTime),requests:requests.length-backRequests};
 if(await page.locator('#previous-toggle-controls').count()){
  const beforeImages=await page.locator('#previous-grid img').evaluateAll(is=>is.map(i=>i.src));await page.locator('#previous-toggle-controls').click();assert.equal(await page.locator('#previous-control-section').isVisible(),false);assert.equal(await page.locator('#previous-legend').isVisible(),true);assert.deepEqual(await page.locator('#previous-grid img').evaluateAll(is=>is.map(i=>i.src)),beforeImages);
  await page.screenshot({path:resolve(output,name+'-ifs-controls-hidden.png'),fullPage:true});
 }
 // Non-accumulation charts retain their normal cadence and use the shared tighter crop.
 if(await page.locator('#previous-control-section').isHidden())await page.locator('#previous-toggle-controls').click();
 await page.locator('#previous-preset').selectOption('weather');
 await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:90000});
 const atlanticStart=performance.now();await page.locator('#previous-area').selectOption('atlantic');
 await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:90000});
 report.atlanticThreeChartsMs=Math.round(performance.now()-atlanticStart);
 const beforeImages=await page.locator('#previous-grid img').evaluateAll(imgs=>imgs.map(i=>i.src));
 await page.locator('#previous-toggle-controls').click();
 assert.deepEqual(await page.locator('#previous-grid img').evaluateAll(imgs=>imgs.map(i=>i.src)),beforeImages);
 await page.screenshot({path:resolve(output,'north-atlantic-real-weather.png'),fullPage:true});
 report.periodChoice=await page.locator('#previous-time-heading').textContent();
 assert.equal(report.periodChoice,'Shared valid time · UTC');
 assert.deepEqual(errors,[]);console.log(JSON.stringify(report));
}catch(e){report.error=e.message;report.nativeReads=await page.evaluate(()=>window.nativeReads).catch(()=>null);report.requests=requests.length;report.pageErrors=errors;report.status=await page.locator('#previous-progress').textContent().catch(()=>null);await page.screenshot({path:resolve(output,name+'-ifs-error.png'),fullPage:true}).catch(()=>{});throw e;}
finally{await writeFile(resolve(output,name+'-ifs-benchmark.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
