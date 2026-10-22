// Real OM data and raster workers. A blank basemap isolates forecast processing.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {loadSpatialModel} from '../map-sources.js';
const UKV='ukmo_uk_deterministic_2km',root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const cache=new Map(),load=url=>{if(!cache.has(url))cache.set(url,fetch(url,{signal:AbortSignal.timeout(20000)}).then(async r=>{if(!r.ok)throw Object.assign(Error('HTTP '+r.status),{status:r.status});return r.json();}));return cache.get(url);};
const meta=await loadSpatialModel(UKV,load),end=new Date(Date.parse(meta.reference_time)+24*3600000).toISOString();
assert.ok(meta.valid_times.some(t=>Date.parse(t)===Date.parse(end)),'Latest UKV must supply a complete 24 h period for this live check');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Invalid path');const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']}),page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[],reports=[];
const geo={type:'FeatureCollection',features:[]},style={version:8,sources:{roads:{type:'geojson',data:geo}},layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},{id:'road-lines',source:'roads',type:'line',paint:{'line-color':'#222222'}}]};
await mkdir('review-output',{recursive:true});
let omRequests=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.om($|\?)/.test(r.url()))omRequests++;});page.on('console',m=>{if(m.type()==='error')console.log('LIVE BROWSER',m.text());});
try{
 await page.addInitScript(()=>localStorage.setItem('snowline-terrain','false'));
 await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
 await page.route('**/coastline.geojson',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
 await page.route('https://openmeteo.s3.amazonaws.com/**',async route=>{
  const url=route.request().url();if(url.endsWith('.om'))return route.continue();
  if(cache.has(url))return route.fulfill({contentType:'application/json',body:JSON.stringify(await cache.get(url))});
  return route.fulfill({status:404,body:'{}'});
 });
 const initial=performance.now();await page.goto(origin+'/maps.html?time='+encodeURIComponent(end));
 await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.toLowerCase().includes('valid'),{},{timeout:120000});
 reports.push({phase:'ordinary-temperature',ms:Math.round(performance.now()-initial),omRequests});
 await page.locator('#map-mslp-a').uncheck();await page.waitForTimeout(300);
 for(const h of [6,24]){
  const start=performance.now(),requests=omRequests;await page.locator('#map-variable').selectOption('precipitation_total_'+h+'h');
  await page.waitForFunction(h=>document.querySelector('#panel-label-a').textContent.includes(h+' h precipitation total')&&document.querySelector('#map-error-a').hidden,h,{timeout:150000});
  const result={hours:h,ms:Math.round(performance.now()-start),omRequests:omRequests-requests,label:await page.locator('#panel-label-a').textContent()};
  await page.screenshot({path:`review-output/live-ukv-${h}h.png`});
  reports.push(result);console.log('REAL UKV RENDER',JSON.stringify(result));
 }
 assert.deepEqual(errors,[]);
 await writeFile('review-output/live-browser-metrics.json',JSON.stringify({checkedAt:new Date().toISOString(),reference_time:meta.reference_time,scope:'Real forecast OM data and raster workers on 1100x850 view, blank basemap and no pressure overlay. Timings are this runner only, not a user latency guarantee.',reports},null,2));
}catch(error){await page.screenshot({path:'review-output/live-browser-failure.png'}).catch(()=>{});console.log('LIVE STATUS',await page.evaluate(()=>({label:document.querySelector('#panel-label-a')?.textContent,error:document.querySelector('#map-error-a')?.textContent,status:document.querySelector('#preload-status')?.textContent})).catch(()=>({})));throw error;}
finally{await browser.close();server.close();}
