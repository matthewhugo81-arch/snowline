// Manual live-feed integration: node tests/vertical-motion-live.mjs (requires Playwright).
// SNOWLINE_LIVE_URL optionally checks a deployed origin; SNOWLINE_TEST_OUTPUT controls artifacts.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd(),outputs=resolve(process.env.SNOWLINE_TEST_OUTPUT??'review-output/vertical-motion');await mkdir(outputs,{recursive:true});
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error();const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=process.env.SNOWLINE_LIVE_URL||'http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1050},deviceScaleFactor:1});let errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('snowline-terrain','false');localStorage.setItem('snowline-background','light');});
await page.route('**/maps.js*',async route=>{const body=process.env.SNOWLINE_LIVE_URL?(await route.fetch()).text():readFile(resolve(root,'maps.js'),'utf8');await route.fulfill({contentType:'text/javascript',body:await body+'\nwindow.verticalTest={panels,state,fields,settings,OM,readMapValue,concreteURL};'});});
const report={origin,models:[],errors};
async function ready(model){await page.waitForFunction(model=>{const x=window.verticalTest,p=x?.panels.a;return p?.loaded&&p.displayedField==='vertical_motion_700hPa'&&p.displayedModel===model&&p.displayedTime===x.state.times[x.state.index];},model,{timeout:90000});}
async function capture(name){const downloadPromise=page.waitForEvent('download',{timeout:30000});await page.locator('#map-a canvas').click({button:'right',position:{x:250,y:250}});await page.getByRole('menuitem',{name:'Save image',exact:true}).click();const download=await downloadPromise;await download.saveAs(resolve(outputs,name));}
try{
 await page.goto(origin+'/maps.html?model=gfs_global',{waitUntil:'domcontentloaded'});
 for(const model of ['gfs_global','ukmo_global_deterministic_10km','ecmwf_ifs025','ecmwf_aifs025_single','ncep_aigfs025','jma_gsm']){
  if(model!=='gfs_global')await page.locator('#map-model').selectOption(model);
  await page.waitForFunction(()=>!document.querySelector('#map-variable').disabled&&document.querySelector('#map-variable option[value="vertical_motion_700hPa"]'),null,{timeout:60000});
  await page.locator('#map-variable').selectOption('vertical_motion_700hPa');await ready(model);
  const info=await page.evaluate(async()=>{const {panels,state,readMapValue}=window.verticalTest,p=panels.a;const layers=p.map.getStyle().layers.filter(l=>/height700|wind700|omega-/.test(l.id));const read=await readMapValue(53,-3,p.url,p.map.getZoom());return {model:state.model,run:state.metas[state.model].reference_time,time:p.displayedTime,title:document.querySelector('#panel-label-a').textContent,layers:layers.map(l=>({id:l.id,type:l.type,source:l.source})),features:p.map.queryRenderedFeatures({layers:layers.filter(l=>l.type!=='symbol').map(l=>l.id)}).length,value:read,mslpDisabled:document.querySelector('#map-mslp-a').disabled,unit:document.querySelector('#legend-title-a').textContent};});
  assert.ok(Number.isFinite(info.value.value),"Clicked value must be finite");assert.equal(info.mslpDisabled,true);assert.ok(info.layers.some(l=>l.id.includes('height700-lines')));assert.ok(info.layers.some(l=>l.id.includes('wind700-barbs')));assert.ok(info.features>0);assert.match(info.unit,/0.1 Pa/);report.models.push(info);console.log('PASS',model,info.time,info.features,'features');
  if(['gfs_global','ukmo_global_deterministic_10km'].includes(model))await capture('700hpa-'+model+'.png');
  const before=info.time;await page.locator('#next-time').click();await ready(model);assert.notEqual(await page.evaluate(()=>window.verticalTest.panels.a.displayedTime),before);
  await page.locator('#map-contours-a').check();await ready(model);assert.ok(await page.evaluate(()=>window.verticalTest.panels.a.map.getStyle().layers.some(l=>/omega-lines/.test(l.id))));await page.locator('#map-contours-a').uncheck();await ready(model);
 }
 // Live comparison and playback keep shading, heights and winds synchronized.
 await page.locator('#map-model').selectOption('gfs_global');
 await page.waitForFunction(()=>!document.querySelector('#map-variable').disabled&&document.querySelector('#map-variable option[value="vertical_motion_700hPa"]'));
 await page.locator('#map-variable').selectOption('vertical_motion_700hPa');await ready('gfs_global');
 await page.locator('#compare-maps').check();
 await page.locator('#map-model-b').selectOption('ecmwf_ifs025');
 await page.waitForFunction(()=>!document.querySelector('#map-variable-b').disabled&&document.querySelector('#map-variable-b option[value="vertical_motion_700hPa"]'));
 await page.locator('#map-variable-b').selectOption('vertical_motion_700hPa');
 const bothReady=()=>page.waitForFunction(()=>{const x=window.verticalTest,{a,b}=x.panels;return a.loaded&&b.loaded&&a.displayedField===x.state.field&&b.displayedField===x.state.fieldB&&a.displayedTime===b.displayedTime&&a.displayedTime===x.state.times[x.state.index];},null,{timeout:90000});
 await bothReady();
 const playedFrom=await page.evaluate(()=>window.verticalTest.panels.a.displayedTime);
 await page.locator('#play-map').click();await page.waitForFunction(t=>window.verticalTest.panels.a.displayedTime!==t,playedFrom,{timeout:60000});await page.locator('#play-map').click();await bothReady();
 await page.locator('#map-time').evaluate(el=>{const n=Number(el.value);for(const step of [n+2,n+1,n+3]){el.value=String(Math.min(Number(el.max),step));el.dispatchEvent(new Event('change',{bubbles:true}));}});await bothReady();report.comparisonAndPlayback=true;
 await page.locator('#compare-maps').uncheck();await ready('gfs_global');
 // Grid values use the derived pressure velocity; zoom must rebuild all layers.
 await page.locator('#map-grid-a').check();await page.waitForFunction(()=>document.querySelector('#grid-note-a').textContent.includes('values')&&!document.querySelector('#grid-note-a').textContent.includes('loading'),null,{timeout:45000});
 assert.match(await page.locator('#grid-note-a').textContent(),/^Grid values · 0\.1 Pa\/s$/);
 await page.locator('#map-grid-a').uncheck();
 await page.locator('#open-briefing').click();
 await page.waitForFunction(()=>document.querySelector('#briefing-preset')?.value==='vertical-motion-700');
 await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length>=6,null,{timeout:150000});
 await page.locator('.briefing-chart').first().click();await page.locator('#briefing-enlarged-image').evaluate(image=>image.decode());
 assert.match(await page.locator('#briefing-enlarged-note').textContent(),/barbs in knots/);
 await page.locator('#briefing-enlarged-image').screenshot({path:resolve(outputs,'700hpa-briefing.png')});
 await page.locator('#briefing-enlarged-close').click();await page.locator('#briefing-close').click();report.briefing=true;
 await page.setViewportSize({width:390,height:844});await ready('gfs_global');
 await page.locator('#map-a canvas').scrollIntoViewIfNeeded();await page.locator('#map-a').screenshot({path:resolve(outputs,'700hpa-mobile.png')});
 const mobile=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,width:innerWidth,unit:document.querySelector('#legend-title-a').textContent}));assert.equal(mobile.overflow,false);assert.match(mobile.unit,/0.1 Pa/);report.mobile=mobile;
 await page.setViewportSize({width:1500,height:1050});await ready('gfs_global');
 // Unsupported feeds must not offer this chart.
 await page.locator('#map-model').selectOption('ukmo_uk_deterministic_2km');await page.waitForFunction(()=>window.verticalTest?.state.metas.ukmo_uk_deterministic_2km&&!document.querySelector('#map-variable').disabled);assert.equal(await page.locator('#map-variable option[value="vertical_motion_700hPa"]').count(),0);
 assert.deepEqual(errors,[]);report.passed=true;
}catch(e){report.failure=e.stack;console.log('FAIL',e.stack);await page.screenshot({path:resolve(outputs,'700hpa-browser-failure.png'),fullPage:true});process.exitCode=1;}
finally{await writeFile(resolve(outputs,'700hpa-browser-validation.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
