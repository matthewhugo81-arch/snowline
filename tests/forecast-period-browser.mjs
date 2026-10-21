import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chromium} from 'playwright';
import {MOGREPS_GLOBAL_DOMAIN} from '../map-mogreps-global.js';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!p.startsWith(root+sep))throw Error();const body=await readFile(p);res.writeHead(200,{'Content-Type':types[extname(p)]??'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const fixtureSource=await readFile('tests/map-browser.mjs','utf8'),fakeOM=vm.runInNewContext(fixtureSource.match(/const fakeOM=(`[^]*?`);\r?\nconst geo=/)[1]);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const time=h=>new Date(Date.UTC(2026,9,10,h)).toISOString(),times=Array.from({length:49},(_,i)=>time(i*3)),geo={type:'FeatureCollection',features:[]};
const ensemble={completed:true,reference_time:time(0),variables:['geopotential_height_500hPa_mean','temperature_850hPa_mean','pressure_msl_mean'],valid_times:times};
const mogreps={...ensemble,format_version:2,domain:'snowline_mogreps_global',member_count:18,member_ids:Array.from({length:18},(_,i)=>i),threshold_mm_per_hour:.1,grid:MOGREPS_GLOBAL_DOMAIN.grid,variable_valid_times:Object.fromEntries(ensemble.variables.map(key=>[key,times]))};
const ensembles=['snowline_gefs_ensemble','snowline_ecmwf_ensemble','snowline_mogreps_global','ukmo_uk_ensemble_2km'];
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  console.log('Viewport',viewport.width);const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
  await page.addInitScript(()=>{localStorage.setItem('snowline-terrain','false');window.fixtureDelay=5;window.periodStarts=[];});
  await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('**/maps.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile('maps.js','utf8'))+'\nwindow.periodTest={panels,state,periodURLs,periodPriority,imageryCache};'}));
  await page.route('**/map-frames.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile('map-frames.js','utf8'))+`\nconst originalPreload=ForecastFrames.prototype.preload;ForecastFrames.prototype.preload=function(url){const x=window.periodTest,p=x&&Object.values(x.panels).find(p=>p.frameCache===this);if(p&&x.state.period&&!this.prefetches.has(url))window.periodStarts.push({url,priority:x.periodURLs(p).includes(url),pending:x.periodPriority.pending()});return originalPreload.call(this,url);};`}));
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'white'}}]}}));
  await page.route('**/coastline.geojson',r=>r.fulfill({json:geo}));
  await page.route('**/ensemble-data/**',r=>{
   const url=r.request().url();let value;
   if(/\/(?:latest|meta)\.json/.test(url)){if(url.includes('/snowline_mogreps_global/'))value=mogreps;else if(/\/snowline_(gefs|ecmwf)_ensemble\//.test(url))value=ensemble;}
   return r.fulfill({status:value?200:404,json:value??{error:true}});
  });
  await page.route('https://openmeteo.s3.amazonaws.com/**',r=>{
   const isUK=r.request().url().includes('/ukmo_uk_ensemble_2km/'),value={...ensemble,variables:isUK?['precipitation_probability']:['temperature_2m','pressure_msl'],valid_times:isUK?times.slice(1,19):times};
   return r.fulfill({json:value});
  });
  const diagnose=async e=>{console.log(await page.evaluate(()=>({status:document.querySelector('#animation-status').textContent,progress:document.querySelector('#preload-status').textContent,errors:[...document.querySelectorAll('.map-error')].map(x=>x.textContent),state:window.periodTest?.state,panels:Object.values(window.periodTest?.panels??{}).map(p=>({key:p.key,queue:p.frameCache?.queue,prefetches:p.frameCache?.prefetches.size,loaded:p.frameCache?.preloaded.size}))})));throw e;};
  const ready=()=>page.waitForFunction(()=>window.periodTest&&!document.querySelector('#reload-maps').disabled&&document.querySelector('#animation-status').textContent.startsWith('Ready'),null,{timeout:45000}).catch(diagnose);
  const complete=()=>page.waitForFunction(()=>document.querySelector('#preload-status').dataset.complete==='true',null,{timeout:45000}).catch(diagnose);
  await page.goto(origin+'/maps.html?model=snowline_gefs_ensemble&time='+time(0));
  await page.locator('#map-forecast-period').selectOption('36');await ready();console.log('Initial ready');
  await page.locator('#map-forecast-interval').selectOption('12');await ready();await complete();console.log('Single complete');
  assert.deepEqual(await page.locator('#map-forecast-period option').evaluateAll(xs=>xs.map(x=>x.value)),['0','24','36','48','72','96','120']);
  assert.equal(await page.locator('#map-time').getAttribute('max'),'12','The entire 144-hour run stays on the timeline');
  assert.equal(await page.locator('#preload-status').getAttribute('data-priority-total'),'4');
  if(viewport.width<651)await page.locator('#mobile-map-settings').click();
  await page.locator('#compare-maps').check();await ready();
  await page.locator('#map-model-b').selectOption(ensembles[1]);await ready();await complete();
  assert.equal(await page.locator('#map-forecast-period').inputValue(),'36');
  await page.locator('#map-comparison-count').selectOption('3');await ready();
  await page.locator('#map-model-c').selectOption(ensembles[2]);await ready();await complete();
  await page.locator('#map-model-b').selectOption(ensembles[3]);await ready();await complete();
  const before=await page.evaluate(()=>({sources:Object.values(window.periodTest.panels).map(p=>p.sourceId),requests:window.fixtureRequests.length,loaded:Object.values(window.periodTest.panels).map(p=>p.frameCache.preloaded.size),index:window.periodTest.state.index}));
  await page.locator('#map-forecast-period').selectOption('72');await complete();await page.waitForTimeout(150);
  const after=await page.evaluate(()=>({sources:Object.values(window.periodTest.panels).map(p=>p.sourceId),requests:window.fixtureRequests.length,loaded:Object.values(window.periodTest.panels).map(p=>p.frameCache.preloaded.size),index:window.periodTest.state.index}));
  assert.deepEqual(after,before,'Changing the period preserves charts, time, prepared counts and tiles');
  const starts=await page.evaluate(()=>window.periodStarts);assert.ok(starts.some(x=>x.priority));assert.ok(starts.some(x=>!x.priority),'The rest of the run follows automatically');
  assert.deepEqual(starts.filter(x=>!x.priority&&x.pending),[],'Every ensemble defers later charts until all priority charts settle');
  if(viewport.width<651)await page.locator('#mobile-return-map').click();
  const box=await page.locator('#map-forecast-period').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width,'The new control fits the viewport');
  assert.deepEqual(errors,[]);await mkdir('review-output',{recursive:true});await page.screenshot({path:`review-output/forecast-period-${viewport.width}.png`});
  console.log(JSON.stringify({viewport,ensembles,panels:[1,2,3],priorityRequests:starts.length,retainedCharts:true,fullTimeline:true}));await page.close();
 }
}finally{await browser.close();server.close();}
