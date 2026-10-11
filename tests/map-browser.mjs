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
  const ensembleFixture=(hours,step)=>({...fixture(0,hours),variables:['precipitation_probability'],valid_times:fixture(0,hours).valid_times.filter((_,i)=>i%step===0)});
  const ensembleFixtures={ncep_gefs025:ensembleFixture(24,3),ncep_gefs05:ensembleFixture(48,6),ecmwf_ifs025_ensemble:ensembleFixture(30,3)};
  await page.route('https://openmeteo.s3.amazonaws.com/**',route=>{
   const url=route.request().url();metadata.push(url);
   const domain=new URL(url).pathname.split('/')[2],ensemble=ensembleFixtures[domain];
   const meta=ensemble?(url.endsWith('/latest.json')?ensemble:null):domain==='ukmo_uk_deterministic_2km'?(url.endsWith('/latest.json')?fixture(8,12):url.includes('/0600Z/meta.json')?fixture(6,54):url.includes('/0300Z/meta.json')?fixture(3,120):null):null;
   return route.fulfill({status:meta?200:404,contentType:'application/json',body:JSON.stringify(meta??{error:true})});
  });
  await page.goto(origin+'/maps.html');
  try{
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Valid'),{},{timeout:40000});
   let firstHour=6;
   const selectTime=async value=>{
    await page.locator('#map-time').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
    await page.waitForFunction(hour=>document.getElementById('panel-label-a').textContent.split('Valid ')[1]?.includes(String(hour).padStart(2,'0')+':00'),value+firstHour);
   };
   // ICU versions differ on the comma after the weekday; the time must match.
   const bothAt=time=>page.waitForFunction(time=>[...document.querySelectorAll('.map-panel-label')].every(el=>el.textContent.split('Valid ')[1]?.replaceAll(',','')===time.replaceAll(',','')),time);
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
   assert.equal(await page.locator('#map-time').getAttribute('max'),'11','Comparison uses the 12 overlapping precipitation intervals');
   const labels=await page.locator('.map-panel-label').allTextContents();
   assert.match(labels[0],/0600Z/);assert.match(labels[1],/0800Z/);
   assert.equal(labels[0].split('Valid ')[1],labels[1].split('Valid ')[1]);
   await page.locator('#compare-maps').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.getElementById('map-time').max==='53'&&document.getElementById('panel-label-a').textContent.includes('0600Z'));
   await page.locator('#map-model').selectOption(nowcast);
   await page.waitForFunction(()=>document.getElementById('map-time').max==='11'&&document.getElementById('panel-label-a').textContent.includes('0800Z'));
   assert.match(await page.locator('#run-a').textContent(),/nowcast/);
   await page.locator('#map-model').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('map-time').max==='53'&&document.getElementById('panel-label-a').textContent.includes('0600Z'));
   // Playback must wrap both panels together and remain active after the final hour.
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-model-b').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('map-time').max==='53'&&document.getElementById('panel-label-b').textContent.includes('0600Z'));
   await page.locator('#map-time').evaluate(el=>{el.value='52';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Mon 12 Oct, 11:00 UTC');
   await page.locator('#play-map').click();
   await bothAt('Mon 12 Oct, 12:00 UTC');
   await bothAt('Sat 10 Oct, 07:00 UTC');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'true','Loop restart must not reset Play');
   await bothAt('Sat 10 Oct, 08:00 UTC');
   await page.locator('#play-map').click();
   const loopPaused=await page.locator('.map-panel-label').allTextContents();await page.waitForTimeout(1000);
   assert.deepEqual(await page.locator('.map-panel-label').allTextContents(),loopPaused,'Pause still stops after wrapping');
   // Adding initialization back in panel B must also reindex panel A's images.
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature'));
   await selectTime(0);
   const initialTemperatureRequests=()=>page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&r.url.includes('/2026-10-10T0600.om?variable=temperature_2m&')).length);
   const beforeInitial=await initialTemperatureRequests();
   await page.locator('#map-variable-b').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('map-time').max==='54');
   firstHour=6;await selectTime(0);
   await bothAt('Sat 10 Oct, 06:00 UTC');
   assert.ok(await initialTemperatureRequests()>=beforeInitial+2,'Both panels request the newly available initial image');
   const invalidIntervals=await page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&r.url.includes('variable=precipitation&')&&/\/(\d{4})Z\/2026-10-10T\1\.om/.test(r.url)));
   assert.deepEqual(invalidIntervals,[],'Do not request precipitation at initialization');
   // Ensembles auto-select only their supplied layer, then compare and loop together.
   const ensembleOptions=await page.locator('#map-model optgroup[label="Ensemble models"] option').evaluateAll(options=>options.map(o=>o.value));
   for(const id of Object.keys(ensembleFixtures))assert.ok(ensembleOptions.includes(id));
   assert.ok(ensembleOptions.includes('ncep_hgefs025_ensemble_mean'),'Existing ensemble mean remains available');
   await page.locator('#map-model').selectOption('ncep_gefs025');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('GEFS 0.25°'));
   assert.deepEqual(await page.locator('#map-variable option').evaluateAll(options=>options.map(o=>o.value)),['precipitation_probability']);
   assert.equal(await page.locator('#legend-title-a').textContent(),'Chance (%)');
   assert.equal(await page.locator('#legend-interval-a').textContent(),'≥0.3 mm / 3 h ending at valid time');
   assert.equal(await page.locator('#map-mslp-a').isDisabled(),true);
   await page.locator('#map-model-b').selectOption('ecmwf_ifs025_ensemble');
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('ECMWF ENS'));
   assert.equal(await page.locator('#map-time').getAttribute('max'),'7');
   await page.locator('#map-time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Sun 11 Oct, 00:00 UTC');
   await page.locator('#play-map').click();
   await bothAt('Sat 10 Oct, 03:00 UTC');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'true');
   await page.locator('#play-map').click();
   await page.locator('#map-model').selectOption('ncep_gefs05');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('GEFS 0.5°'));
   assert.equal(await page.locator('#map-time').getAttribute('max'),'4','Comparison intersects 3-hour and 6-hour native steps');
   assert.equal(await page.locator('#legend-interval-a').textContent(),'≥0.6 mm / 6 h ending at valid time');
   assert.equal(await page.locator('#legend-interval-b').textContent(),'≥0.3 mm / 3 h ending at valid time');
   await page.locator('#compare-maps').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.getElementById('map-time').max==='7');
   assert.match(await page.locator('#range-end').textContent(),/12 Oct/,'Single panel recovers extended GEFS horizon');
   const invalidEnsembleRequests=await page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&/\/(ncep_gefs025|ncep_gefs05|ecmwf_ifs025_ensemble)\//.test(r.url)&&(!r.url.includes('variable=precipitation_probability&')||r.url.includes('/2026-10-10T0000.om'))));
   assert.deepEqual(invalidEnsembleRequests,[],'Ensembles request neither unavailable MSLP nor initialization files');
   await page.locator('#map-model').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('UKV — latest main run'));
   assert.equal(await page.locator('#map-variable').inputValue(),'temperature_2m');
   assert.equal(await page.locator('#map-mslp-a').isDisabled(),false,'Returning to UKV restores pressure availability');
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({viewport,passed:true,transportRequests:await page.evaluate(()=>window.fixtureRequests.length)}));
  }catch(error){
   console.log('DIAGNOSTICS',JSON.stringify(await page.evaluate(()=>({labels:[...document.querySelectorAll('.map-panel-label')].map(e=>e.textContent),errors:[...document.querySelectorAll('.map-error')].map(e=>e.textContent),status:document.getElementById('animation-status').textContent,requests:window.fixtureRequests?.slice(-5).map(r=>({type:r.type,url:r.url.slice(0,120)}))}))));
   throw error;
  }finally{await page.close();}
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
