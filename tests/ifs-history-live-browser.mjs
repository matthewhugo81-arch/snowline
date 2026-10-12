// Isolated before/after benchmark of the user's three-run 72 h IFS case.
// Real forecast grids, pressure vectors, grid labels and raster workers. A blank
// basemap with real glyphs isolates forecast work from background map-tile latency.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]??'.'),name=process.argv[3]??'optimized',output=resolve('review-output');
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
await mkdir(output,{recursive:true});
const pageHTML='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/vendor/maplibre-gl.css"><link rel="stylesheet" href="/maps.css"><link rel="stylesheet" href="/map-briefing.css"><link rel="stylesheet" href="/map-previous-runs.css"><body class="map-page"><header>Snowline · Previous Run Analysis</header><main class="map-main"><section class="briefing-stage" id="bench"></section></main>';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;if(path==='/benchmark.html'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(pageHTML);}const file=resolve(root,'.'+path);if(!file.startsWith(root+sep))throw Error('Bad path');const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']}),page=await browser.newPage({viewport:{width:1664,height:940}}),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('openmeteo.s3.amazonaws.com'))requests.push({url:r.url(),method:r.method()});});
const upstreamStyle=await fetch('https://tiles.openfreemap.org/styles/positron',{signal:AbortSignal.timeout(20000)}).then(r=>r.json());
const style={version:8,glyphs:upstreamStyle.glyphs,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}}]};
await page.route('https://tiles.openfreemap.org/styles/*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
let report={name,checkedAt:new Date().toISOString(),scope:'Three IFS 9 km runs, 72 h ending 2026-10-15 13Z, UK & Ireland, grid values and MSLP enabled. Real weather data and raster workers; blank basemap with glyphs. Same hosted runner, independent cold browser contexts.'};
try{
 await page.goto(origin+'/benchmark.html');
 await page.evaluate(async()=>{
  const OM=await import('/vendor/index.mjs'),maplibre=await import('/vendor/maplibre-gl.mjs');
  const {createPreviousRunAnalysis}=await import('/map-previous-runs.js'),{loadSpatialRun,fieldSource,fieldDataURL}=await import('/map-sources.js');
  const {sourceVariable,extendCatalogue}=await import('/map-catalogue.js'),{MAP_MODELS}=await import('/map-models.js');
  const {BRIEFING_PRESETS}=await import('/map-briefing-data.js?v=20261012-accum-history');
  const position=BRIEFING_PRESETS.findIndex(p=>p.field==='precipitation_total_72h');BRIEFING_PRESETS.unshift(...BRIEFING_PRESETS.splice(position,1));
  const settings={...OM.defaultOmProtocolSettings,maxStatesWithData:16,colorScales:{...OM.defaultOmProtocolSettings.colorScales}},fields=[];
  const cache=new Map(),load=async url=>{if(!cache.has(url))cache.set(url,fetch(url).then(async r=>{if(!r.ok)throw Object.assign(Error('HTTP '+r.status),{status:r.status});return r.json();}));return cache.get(url);};
  const contourLevels=field=>field?.contourValues??field?.stops??[];
  const latest=await loadSpatialRun('ecmwf_ifs','2026-10-12T12:00:00Z',load);extendCatalogue(fields,[latest],OM,settings);
  const reader=OM.getProtocolInstance(settings).omFileReader,native=reader.readSimpleVariable.bind(reader);window.nativeReads={};
  reader.readSimpleVariable=async(file,variable,...args)=>{window.nativeReads[variable]=(window.nativeReads[variable]??0)+1;return native(file,variable,...args);};
  const view=createPreviousRunAnalysis({host:document.getElementById('bench'),models:MAP_MODELS.filter(m=>m.id==='ecmwf_ifs'),fields,OM,maplibre,settings,
   loadModel:async()=>latest,loadRun:async(model,ref,load)=>{const meta=await loadSpatialRun(model,ref,load);extendCatalogue(fields,[meta],OM,settings);return meta;},loadJSON:load,
   createURL:(model,meta,time,field)=>'om://'+fieldDataURL(meta,field,time)+'?'+new URLSearchParams({variable:sourceVariable(fieldSource(meta,field,time),field)??field,interpolation:'linear',arrows:'false',tile_size:'512',color_blend:fields.find(f=>f.key===field)?.bands?'false':'true',contours:'true',intervals:(field==='pressure_msl'?[...Array.from({length:61},(_,i)=>880+i*4),...Array.from({length:61},(_,i)=>(880+i*4)*100)]:contourLevels(fields.find(f=>f.key===field))).join(',')}),onClose:()=>{}});
  document.getElementById('previous-grid-values').checked=true;document.getElementById('previous-interval').value='native';
  window.benchmarkStart=performance.now();view.open({model:'ecmwf_ifs',time:'2026-10-15T13:00:00Z',bounds:[-12,48,5,61.5]});
 });
 await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length>=1,{},{timeout:180000});
 report.firstPanelMs=await page.evaluate(()=>Math.round(performance.now()-window.benchmarkStart));
 await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:240000});
 report.allThreeMs=await page.evaluate(()=>Math.round(performance.now()-window.benchmarkStart));
 report.coldReads=await page.evaluate(()=>({...window.nativeReads}));report.coldRequests=requests.length;
 const cards=await page.locator('#previous-grid .briefing-card').evaluateAll(cs=>cs.map(c=>({run:c.dataset.run,time:c.dataset.time,caption:c.querySelector('p').textContent})));
 assert.deepEqual(cards.map(c=>new Date(c.run).getUTCHours()),[0,6,12]);assert.ok(cards.every(c=>Date.parse(c.time)===Date.parse('2026-10-15T13:00:00Z')));report.cards=cards;
 await page.screenshot({path:resolve(output,name+'-ifs-72h.png'),fullPage:true});
 const before=requests.length,t=performance.now();await page.locator('#previous-forward').click();await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:180000});report.nextHour={ms:Math.round(performance.now()-t),requests:requests.length-before};
 const backRequests=requests.length,backTime=performance.now();await page.locator('#previous-back').click();await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3);report.cachedReturn={ms:Math.round(performance.now()-backTime),requests:requests.length-backRequests};
 if(await page.locator('#previous-toggle-controls').count()){
  const beforeImages=await page.locator('#previous-grid img').evaluateAll(is=>is.map(i=>i.src));await page.locator('#previous-toggle-controls').click();assert.equal(await page.locator('#previous-control-section').isVisible(),false);assert.equal(await page.locator('#previous-legend').isVisible(),true);assert.deepEqual(await page.locator('#previous-grid img').evaluateAll(is=>is.map(i=>i.src)),beforeImages);
  await page.screenshot({path:resolve(output,name+'-ifs-controls-hidden.png'),fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify(report));
}catch(e){report.error=e.message;report.status=await page.locator('#previous-progress').textContent().catch(()=>null);await page.screenshot({path:resolve(output,name+'-ifs-error.png'),fullPage:true}).catch(()=>{});throw e;}
finally{await writeFile(resolve(output,name+'-ifs-benchmark.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
