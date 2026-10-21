import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Path');const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const source=await readFile('tests/map-browser.mjs','utf8'),fakeOM=vm.runInNewContext(source.match(/const fakeOM=(`[^]*?`);\r?\nconst geo=/)[1]);
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const reference='2026-10-21T12:00:00Z',time='2026-10-22T00:00:00Z',UK='ukmo_uk_ensemble_2km',key='ens_gust_gt50kt_12h',rain='ens_rain_ge10mm_12h',snow='ens_snow_ge1mm_12h';
const native={completed:true,reference_time:reference,variables:['temperature_2m','precipitation'],valid_times:Array.from({length:25},(_,h)=>new Date(Date.parse(reference)+h*3600000).toISOString())};
const product={format_version:1,domain:'snowline_mogreps_uk_products',completed:true,reference_time:reference,member_count:18,source_cycles:Array.from({length:6},(_,i)=>new Date(Date.parse(reference)-i*3600000).toISOString()),variables:[key,rain,snow],valid_times:[time],variable_valid_times:Object.fromEntries([key,rain,snow].map(k=>[k,[time]])),variable_intervals:Object.fromEntries([key,rain,snow].map(k=>[k,{[time]:{hours:12,start:reference,end:time}}]))};
const anomalyTime='2026-10-23T09:00:00Z',anomalies=['ens_temperature_min_anomaly','ens_temperature_max_anomaly'];
product.valid_times.push(anomalyTime);
product.anomaly_reference={dataset:'HadUK-Grid',period:'1991-2020',statistic:'monthly normal of daily minimum/maximum',forecast_window:'24 hours ending 09 UTC'};
for(const k of anomalies){product.variables.push(k);product.variable_valid_times[k]=[anomalyTime];product.variable_intervals[k]={[anomalyTime]:{hours:24,start:'2026-10-22T09:00:00Z',end:anomalyTime}};}
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(()=>{localStorage.setItem('snowline-terrain','false');window.fixtureDelay=1;});
  await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('**/maps.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile('maps.js','utf8'))+'\nwindow.productState=state;window.productPanels=panels;window.productRefresh=refreshLiveRuns;'}));
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'white'}}]}}));
  await page.route('**/coastline.geojson',r=>r.fulfill({json:{type:'FeatureCollection',features:[]}}));
  await page.route('https://openmeteo.s3.amazonaws.com/**',r=>r.fulfill({json:native}));
  await page.route('**/ensemble-data/**',r=>r.fulfill({status:404,json:{error:true}}));
  await page.route('https://raw.githubusercontent.com/**',r=>r.fulfill({json:r.request().url().endsWith('publication.json')?{revision:'a'.repeat(40)}:product}));
  const ready=()=>page.waitForFunction(()=>!document.getElementById('map-variable').disabled&&document.getElementById('animation-status').textContent.startsWith('Ready'),{},{timeout:60000});
  await page.goto(origin+'/maps.html');await ready();
  if(viewport.width<651)await page.locator('#mobile-map-settings').click();
  assert.equal(requests.filter(u=>u.includes('/ensemble-products/')).length,0,'Ordinary startup has no product requests');
  await page.locator('#map-model').selectOption(UK);await ready();
  assert.equal(requests.filter(u=>u.includes('/ensemble-products/')).length,0,'Selecting MOGREPS alone does not load products');
  assert.equal(await page.locator('#map-variable optgroup[label="Temperature anomalies"] option:disabled').count(),0);
  // Anomalies must work as the first optional layer, without a probability detour.
  for(const anomaly of anomalies){
   await page.locator('#map-variable').selectOption(anomaly);await ready();
   assert.equal(await page.locator('#map-variable').inputValue(),anomaly);
   assert.match(await page.locator('#panel-label-a').textContent(),/09:00 to 23 Oct 09:00 UTC/);
   assert.ok((await page.evaluate(()=>window.productPanels.a.url)).includes('_products/'));
  }
  await page.locator('#reload-maps').click();await ready();
  assert.equal(await page.locator('#map-variable').inputValue(),anomalies[1]);
  await page.locator('#map-variable').selectOption('temperature_2m');await ready();
  await page.locator('#compare-maps').check();await ready();
  await page.locator('#map-model-b').selectOption(UK);await ready();
  const otherBefore=await page.evaluate(()=>({url:window.productPanels.b.url,time:window.productPanels.b.displayedTime}));
  await page.locator('#map-variable').selectOption(key);await ready();
  assert.equal(await page.locator('#map-variable').inputValue(),key);
  assert.match(await page.evaluate(()=>window.productPanels.a.url),/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(await page.locator('#panel-label-a').textContent(),/12:00 to 22 Oct 00:00 UTC/);
  // The common timeline changes but the other panel remains a normal source.
  assert.ok(!(await page.evaluate(()=>window.productPanels.b.url)).includes('_products/'));
  await page.locator('#map-variable').selectOption(rain);await ready();
  await page.locator('#map-variable').selectOption(snow);await ready();
  await page.evaluate(()=>window.productRefresh());await ready();
  assert.equal(await page.locator('#map-variable').inputValue(),snow,'A normal-panel refresh does not remove product sources');
  await page.locator('#reload-maps').click();await ready();
  assert.equal(await page.locator('#map-variable').inputValue(),snow,'Reload retains the selected product');
  await page.locator('#map-variable').selectOption('temperature_2m');await ready();
  assert.ok(!(await page.evaluate(()=>window.productPanels.a.url)).includes('_products/'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport,ordinaryStartupProductRequests:0,probabilitySwitching:true,directAnomalySelection:true,refreshAndReload:true,returnToOrdinaryChart:true,otherPanelWasLoaded:!!otherBefore.url}));
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
