// Real page and bundled MapLibre, with delayed synthetic weather transport.
// This checks rendering integration and controls, not live-provider throughput.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+'/'))throw Error('Invalid path');const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const fakeOM=`
 export const defaultOmProtocolSettings={colorScales:{}};
 export const domainOptions=[];
 export const updateCurrentBounds=()=>{};
 export const getValueFromLatLong=async()=>({value:10});
 export const getColorScale=()=>({unit:'m/s',breakpoints:[0,10,20],colors:[[0,0,0,1],[100,100,100,1],[255,255,255,1]]});
 window.fixtureRequests=[];
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQSznxHwAEOAJKNKHrggAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
 export async function omProtocol(params,controller){
  window.fixtureRequests.push({url:params.url,type:params.type});
  await new Promise(r=>setTimeout(r,80));
  if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!params.url.startsWith('om://fixture/'))return {data:{tilejson:'2.2.0',minzoom:0,maxzoom:10,tiles:['om://fixture/'+encodeURIComponent(params.url)+'/{z}/{x}/{y}']}};
  return {data:params.type==='image'?png.slice().buffer:new Uint8Array(0).buffer};
 }
`;
const geo={type:'FeatureCollection',features:[]};
const style={version:8,sources:{roads:{type:'geojson',data:geo}},layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},{id:'road-lines',source:'roads',type:'line',paint:{'line-color':'#222222'}}]};
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport,deviceScaleFactor:1});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log('BROWSER',m.text());});
  await page.addInitScript(()=>localStorage.setItem('snowline-terrain','false'));
  await page.route('**/vendor/index.mjs',route=>route.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
  await page.route('**/coastline.geojson',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
  const metadata=[];
  const fixture=(hour,hours)=>({completed:true,reference_time:'2026-10-10T'+String(hour).padStart(2,'0')+':00:00Z',variables:['temperature_2m','precipitation','pressure_msl'],valid_times:Array.from({length:hours+1},(_,i)=>new Date(Date.UTC(2026,9,10,hour+i)).toISOString())});
  await page.route('https://openmeteo.s3.amazonaws.com/**',route=>{
   const url=route.request().url();metadata.push(url);
   const meta=url.endsWith('/latest.json')?fixture(8,12):url.includes('/0600Z/meta.json')?fixture(6,54):url.includes('/0300Z/meta.json')?fixture(3,120):null;
   return route.fulfill({status:meta?200:404,contentType:'application/json',body:JSON.stringify(meta??{error:true})});
  });
  await page.goto(origin+'/maps.html');
  try{
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Valid'),{},{timeout:40000});
   const selectTime=async value=>{
    await page.locator('#map-time').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
    await page.waitForFunction(hour=>document.getElementById('panel-label-a').textContent.split('Valid ')[1]?.includes(String(hour).padStart(2,'0')+':00'),value+6);
   };
   await selectTime(0);
   await page.locator('#play-map').click();
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.split('Valid ')[1]?.includes('07:00'));
   await page.locator('#play-map').click();
   const paused=await page.locator('#panel-label-a').textContent();await page.waitForTimeout(1000);
   assert.equal(await page.locator('#panel-label-a').textContent(),paused,'Pause must stop late commits');
   await selectTime(2);await selectTime(1);await selectTime(2);
   assert.match(await page.locator('#panel-label-a').textContent(),/0600Z/);
   await page.locator('#map-variable').selectOption('precipitation');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Precipitation'));
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('Valid'));
   await selectTime(0);
   for(const value of [1,2,3]){
    await selectTime(value);
    const labels=await page.locator('.map-panel-label').allTextContents();
    assert.equal(labels[0].split('Valid ')[1],labels[1].split('Valid ')[1],'Comparison panels commit together');
   }
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
   assert.equal(metadata.some(url=>url.includes('/0300Z/')),false,'Do not fetch an older longer main cycle');
   await page.locator('#map-model-b').selectOption(nowcast);
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('0800Z'));
   assert.equal(await page.locator('#map-time').getAttribute('max'),'12','Comparison uses the 13 overlapping timestamps');
   const labels=await page.locator('.map-panel-label').allTextContents();
   assert.match(labels[0],/0600Z/);assert.match(labels[1],/0800Z/);
   assert.equal(labels[0].split('Valid ')[1],labels[1].split('Valid ')[1]);
   await page.locator('#compare-maps').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.getElementById('map-time').max==='54'&&document.getElementById('panel-label-a').textContent.includes('0600Z'));
   await page.locator('#map-model').selectOption(nowcast);
   await page.waitForFunction(()=>document.getElementById('map-time').max==='12'&&document.getElementById('panel-label-a').textContent.includes('0800Z'));
   assert.match(await page.locator('#run-a').textContent(),/nowcast/);
   await page.locator('#map-model').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('map-time').max==='54'&&document.getElementById('panel-label-a').textContent.includes('0600Z'));
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({viewport,passed:true,transportRequests:await page.evaluate(()=>window.fixtureRequests.length)}));
  }catch(error){
   console.log('DIAGNOSTICS',JSON.stringify(await page.evaluate(()=>({labels:[...document.querySelectorAll('.map-panel-label')].map(e=>e.textContent),errors:[...document.querySelectorAll('.map-error')].map(e=>e.textContent),status:document.getElementById('animation-status').textContent,requests:window.fixtureRequests?.slice(-5).map(r=>({type:r.type,url:r.url.slice(0,120)}))}))));
   throw error;
  }finally{await page.close();}
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
