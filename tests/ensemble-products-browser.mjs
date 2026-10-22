import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
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
const productReference='2026-10-21T06:00:00Z';
const product={format_version:1,domain:'snowline_mogreps_uk_products',completed:true,reference_time:productReference,member_count:18,source_cycles:Array.from({length:6},(_,i)=>new Date(Date.parse(productReference)-i*3600000).toISOString()),variables:[key,rain,snow],valid_times:[time],variable_valid_times:Object.fromEntries([key,rain,snow].map(k=>[k,[time]])),variable_intervals:Object.fromEntries([key,rain,snow].map(k=>[k,{[time]:{hours:12,start:reference,end:time}}]))};
const six=['ens_gust_gt50kt_6h','ens_rain_ge10mm_6h','ens_snow_ge1mm_6h'];
for(const k of six){product.variables.push(k);product.variable_valid_times[k]=[time];product.variable_intervals[k]={[time]:{hours:6,start:'2026-10-21T18:00:00Z',end:time}};}
const anomalyTime='2026-10-23T09:00:00Z',anomalies=['ens_temperature_min_anomaly','ens_temperature_max_anomaly'];
const cold=['0','m2','m5','m10'].map(t=>`ens_temperature_le${t}c_24h`);
product.valid_times.push(anomalyTime);
product.anomaly_reference={dataset:'HadUK-Grid + Met Eireann',period:'1991-2020',statistic:'monthly normal of daily minimum/maximum',forecast_window:'24 hours ending 09 UTC'};
for(const k of [...anomalies,...cold]){product.variables.push(k);product.variable_valid_times[k]=[anomalyTime];product.variable_intervals[k]={[anomalyTime]:{hours:24,start:'2026-10-22T09:00:00Z',end:anomalyTime}};}
const sixTimes=Array.from({length:9},(_,i)=>new Date(Date.parse(time)+i*6*3600000).toISOString());
for(const k of six){product.variable_valid_times[k]=sixTimes;product.variable_intervals[k]=Object.fromEntries(sixTimes.map(t=>[t,{hours:6,start:new Date(Date.parse(t)-21600000).toISOString(),end:t}]));}
product.valid_times=[...new Set([...product.valid_times,...sixTimes])].sort();
const snowDay='ens_snow_ge1mm_24h';product.variables.push(snowDay);product.variable_valid_times[snowDay]=[sixTimes[4]];product.variable_intervals[snowDay]={[sixTimes[4]]:{hours:24,start:time,end:sixTimes[4]}};
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(()=>{localStorage.setItem('snowline-terrain','false');window.fixtureDelay=1;});
  await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('**/maps.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile('maps.js','utf8'))+'\nwindow.productState=state;window.productPanels=panels;window.productRefresh=refreshLiveRuns;window.productBriefing=()=>briefingView;'}));
  await page.route('**/map-briefing.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile('map-briefing.js','utf8')).replace('},close};','},close,refresh:refreshRun};')}));
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'white'}}]}}));
  await page.route('**/coastline.geojson',r=>r.fulfill({json:{type:'FeatureCollection',features:[]}}));
  await page.route('https://openmeteo.s3.amazonaws.com/**',r=>{
   const url=r.request().url();
   // Hourly upstream indexes must not enter the three-hourly MOGREPS chart menu.
   if(url.includes('/'+UK+'/')&&/\/(latest|in-progress)\.json$/.test(url)){
    const h=url.endsWith('latest.json')?13:14;
    return r.fulfill({json:{...native,reference_time:`2026-10-21T${h}:00:00Z`,valid_times:native.valid_times.filter(t=>Date.parse(t)>=Date.parse(`2026-10-21T${h}:00:00Z`))}});
   }
   return r.fulfill({json:native});
  });
  await page.route('**/ensemble-data/**',r=>r.request().url().includes('/snowline_ecmwf_ensemble/')?r.fulfill({json:{...native,domain:'snowline_ecmwf_ensemble',format_version:1,member_count:51}}):r.fulfill({status:404,json:{error:true}}));
  await page.route('https://raw.githubusercontent.com/**',r=>r.fulfill({json:r.request().url().endsWith('publication.json')?{revision:'a'.repeat(40)}:r.request().url().includes('/snowline_ecmwf_products/')?{...product,domain:'snowline_ecmwf_products',member_count:51,source_cycles:[productReference],variables:product.variables.filter(k=>!cold.includes(k))}:product}));
  const ready=()=>page.waitForFunction(()=>!document.getElementById('map-variable').disabled&&document.getElementById('animation-status').textContent.startsWith('Ready'),{},{timeout:60000});
  const ordered=async(selector)=>{
   const periods=await page.locator(selector+' optgroup[label="Ensemble probabilities"] option').evaluateAll(os=>os.map(o=>Number(o.textContent.match(/(6|12|24) h/)?.[1])).filter(Boolean));
   assert.ok(periods.includes(6)&&periods.includes(12)&&periods.includes(24));
   assert.deepEqual(periods,[...periods].sort((a,b)=>a-b),'All probability durations stay grouped');
  };
  const comparisonLayout=async(count)=>{
   const cards=page.locator('.timeline-panel-period');
   assert.equal(await cards.count(),count);
   assert.deepEqual(await page.locator('.timeline-panel-name').allTextContents(),Array.from({length:count},(_,i)=>'Panel '+(i+1)));
   assert.match(await page.locator('#range-start').textContent(),/^First frame/);
   assert.match(await page.locator('#range-end').textContent(),/^Last frame/);
   assert.doesNotMatch(await page.locator('.time-range').textContent(),/Panel \d/);
   const issues=await page.evaluate(()=>{
    const footer=document.querySelector('.map-timeline'),bounds=footer.getBoundingClientRect(),issues=[];
    const elements=[...footer.querySelectorAll('.timeline-panel-period,#play-map,#previous-time,#next-time,#map-time,#animation-status,.time-range')];
    for(const [i,element] of elements.entries()){
     const box=element.getBoundingClientRect();
     if(box.left<bounds.left||box.right>bounds.right+1||box.top<bounds.top||box.bottom>bounds.bottom+1)issues.push('Outside footer: '+element.className+'/'+element.id);
     for(const other of elements.slice(i+1)){
      const r=other.getBoundingClientRect();
      if(Math.min(box.right,r.right)-Math.max(box.left,r.left)>1&&Math.min(box.bottom,r.bottom)-Math.max(box.top,r.top)>1)issues.push('Overlap: '+element.className+'/'+element.id+' with '+other.className+'/'+other.id);
     }
    }
    for(const value of footer.querySelectorAll('.timeline-panel-value'))if(value.scrollWidth>value.clientWidth+1||value.scrollHeight>value.clientHeight+1)issues.push('Clipped period');
    if(bounds.height>(innerWidth<651?245:160))issues.push('Footer too tall: '+bounds.height);
    return issues;
   });
   assert.deepEqual(issues,[],count+' comparison periods must remain readable at '+viewport.width);
   await page.locator('.map-timeline').screenshot({path:`review-output/comparison-timeline-${count}-${viewport.width}.png`});
  };
  await page.goto(origin+'/maps.html');await ready();
  if(viewport.width<651)await page.locator('#mobile-map-settings').click();
  assert.equal(requests.filter(u=>u.includes('/ensemble-products/')).length,0,'Ordinary startup has no product requests');
  await page.locator('#map-model').selectOption(UK);await ready();
  assert.ok((await page.locator('#map-run option').evaluateAll(os=>os.map(o=>o.value))).every(v=>new Date(v.split('@')[1]).getUTCHours()%3===0));
  assert.ok(!requests.some(u=>u.includes('/'+UK+'/')&&/\/(1300|1400)Z\/meta.json/.test(u)));
  assert.equal(requests.filter(u=>u.includes('/ensemble-products/')).length,0,'Selecting MOGREPS alone does not load products');
  assert.equal(await page.locator('#map-variable optgroup[label="Temperature anomalies"] option:disabled').count(),0);
  await ordered('#map-variable');
  // Open briefing directly from ordinary charts: no main-map product detour.
  await page.locator(viewport.width<651?'#mobile-briefing':'#open-briefing').click();
  const briefingReady=()=>page.waitForFunction(()=>document.getElementById('briefing-preset')&&!document.getElementById('briefing-preset').disabled&&/charts ready/.test(document.getElementById('briefing-status').textContent)&&!document.querySelector('#briefing-grid .briefing-card:not([data-ready="true"])'),{},{timeout:60000});
  await briefingReady();
  assert.ok((await page.locator('#briefing-run-select option').evaluateAll(os=>os.map(o=>o.value))).every(v=>new Date(v.split('@')[1]).getUTCHours()%3===0));
  console.log('Ordinary briefing ready',viewport.width);
  assert.equal(requests.filter(u=>u.endsWith('publication.json')).length,0,'Ordinary briefing does not fetch product data');
  await ordered('#briefing-preset');
  for(const field of [six[0],rain,snowDay,cold[0],...anomalies]){
   await page.locator('#briefing-preset').selectOption(field);await briefingReady();
   console.log('Briefing product ready',viewport.width,field);
   assert.equal(await page.locator('#briefing-preset').inputValue(),field);
   assert.equal(await page.locator('#briefing-run-select option').count(),1);
   assert.match(await page.locator('#briefing-run-select option').textContent(),/06Z · ensemble products/);
   assert.match(await page.locator('#briefing-grid h3').first().textContent(),/VALID [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4} UTC$/);
   assert.doesNotMatch(await page.locator('#briefing-grid h3').first().textContent(),/\bto\b/);
   if(field===six[0]){assert.equal(await page.locator('#briefing-grid .briefing-card[data-ready="true"]').count(),6);await mkdir('review-output',{recursive:true});await page.screenshot({path:'review-output/briefing-products-'+viewport.width+'.png',fullPage:true});}
   if(field.includes('anomaly'))assert.match(await page.locator('#briefing-grid h3').first().textContent(),/24 hr (Minimum|Maximum) Temperature Anomaly for/);
   assert.doesNotMatch(await page.locator('#briefing-grid h3').first().textContent(),/precipitation.*snow probability/);
  }
  const productChecks=requests.filter(u=>u.endsWith('publication.json')).length;
  await page.evaluate(()=>window.productBriefing().refresh());await briefingReady();
  assert.equal(await page.locator('#briefing-preset').inputValue(),anomalies[1]);
  assert.ok(requests.filter(u=>u.endsWith('publication.json')).length>productChecks);
  await page.locator('#briefing-preset').selectOption('ens_gust_gt70kt_6h');
  await page.waitForFunction(()=>document.getElementById('briefing-status').textContent.includes('not yet published'));
  await page.locator('#briefing-preset').selectOption('temperature');await briefingReady();
  assert.equal(await page.locator('#briefing-preset').inputValue(),'temperature');
  await page.locator('#briefing-model').selectOption('snowline_ecmwf_ensemble');await briefingReady();
  assert.equal(await page.locator('#briefing-preset option[value="ens_temperature_le0c_24h"]').count(),0);
  await page.locator('#briefing-preset').selectOption(anomalies[0]);await briefingReady();
  assert.match(await page.locator('#briefing-grid h3').first().textContent(),/24 hr (Minimum|Maximum) Temperature Anomaly for/);
  await page.locator('#briefing-close').click();await ready();
  if(viewport.width<651&&!(await page.locator('#map-variable').isVisible()))await page.locator('#mobile-map-settings').click();
  // Anomalies must work as the first optional layer, without a probability detour.
  for(const anomaly of anomalies){
   await page.locator('#map-variable').selectOption(anomaly);await ready();
   assert.equal(await page.locator('#map-variable').inputValue(),anomaly);
   assert.equal(await page.locator('#map-run option').count(),1,'Only the published product run is offered');
   assert.match(await page.locator('#map-run option').textContent(),/06Z · ensemble products$/);
   assert.match(await page.locator('#panel-label-a').textContent(),anomaly===anomalies[0]?/24 hr Minimum Temperature Anomaly for Fri 23rd/:/24 hr Maximum Temperature Anomaly for Thu 22nd/);
   assert.match(await page.locator('#panel-label-a').textContent(),/09:00 to Fri 23 Oct 09:00 UTC/);
   assert.equal(await page.locator('#map-time-label').textContent(),'Thu 22 Oct at 09:00 to Fri 23 Oct at 09:00');
   assert.equal(await page.locator('#map-start-time option:checked').textContent(),'Thu 22 Oct at 09:00 to Fri 23 Oct at 09:00');
   assert.ok((await page.evaluate(()=>window.productPanels.a.url)).includes('_products/'));
  }
  await ordered('#map-variable');
  for(const k of six){
   await page.locator('#map-variable').selectOption(k);await ready();
   await page.locator('#map-time').fill('0');await page.locator('#map-time').dispatchEvent('change');await ready();
   assert.equal(await page.locator('#map-time-label').textContent(),'Wed 21 Oct at 18:00 to Thu 22 Oct at 00:00');
   assert.equal(await page.locator('#legend-title-a').textContent(),'%');
   await ordered('#map-variable');
  }
  await page.locator('#map-variable').selectOption(anomalies[1]);await ready();
  const beforeRefresh=requests.filter(u=>u.endsWith('publication.json')).length;
  await page.evaluate(()=>window.productRefresh());await ready();
  assert.ok(requests.filter(u=>u.endsWith('publication.json')).length>beforeRefresh,'Product-only refresh rechecks publication');
  assert.equal(await page.locator('#map-variable').inputValue(),anomalies[1]);
  for(const k of cold){
   await page.locator('#map-variable').selectOption(k);await ready();
   assert.equal(await page.locator('#map-variable').inputValue(),k);
   assert.match(await page.locator('#panel-label-a').textContent(),/Minimum temperature ≤/);
   assert.equal(await page.locator('#map-time-label').textContent(),'Thu 22 Oct at 09:00 to Fri 23 Oct at 09:00');
   assert.equal(await page.locator('#legend-title-a').textContent(),'%');
  }
  await page.locator('#map-variable').selectOption('temperature_2m');await ready();
  await page.locator('#compare-maps').check();await ready();
  await page.locator('#map-model-b').selectOption(UK);await ready();
  await ordered('#map-variable-b');
  const otherBefore=await page.evaluate(()=>({url:window.productPanels.b.url,time:window.productPanels.b.displayedTime}));
  await page.locator('#map-variable').selectOption(key);await ready();
  assert.equal(await page.locator('#map-variable').inputValue(),key);
  assert.match(await page.evaluate(()=>window.productPanels.a.url),/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(await page.locator('#panel-label-a').textContent(),/12:00 to Thu 22 Oct 00:00 UTC/);
  await comparisonLayout(2);
  assert.equal(await page.locator('.timeline-panel-value').first().textContent(),'Wed 21 Oct 12:00 → Thu 22 Oct 00:00');
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
  await page.locator('#map-comparison-count').selectOption('3');await ready();
  await page.locator('#map-model-c').selectOption(UK);await ready();await ordered('#map-variable-c');
  await page.locator('#map-variable-c').selectOption(six[0]);await ready();await ordered('#map-variable-c');
  await page.locator('#map-variable').selectOption(key);await ready();
  await page.locator('#map-variable-b').selectOption(six[1]);await ready();
  await comparisonLayout(3);
  assert.ok((await page.locator('.timeline-panel-value').allTextContents()).every(text=>text.includes(' → ')),'Three full periods fit without clipping');
  await page.locator('#compare-maps').uncheck();await ready();
  assert.equal(await page.locator('.comparison-timeline').count(),0,'Single-panel footer returns to its original layout');
  await page.locator('#map-model').selectOption('snowline_ecmwf_ensemble');await ready();
  for(const k of cold)assert.equal(await page.locator(`#map-variable option[value="${k}"]`).count(),0);
  for(const anomaly of anomalies){
   await page.locator('#map-variable').selectOption(anomaly);await ready();
   assert.ok((await page.evaluate(()=>window.productPanels.a.url)).includes('snowline_ecmwf_products/'));
   assert.equal(await page.locator('#map-time-label').textContent(),'Thu 22 Oct at 09:00 to Fri 23 Oct at 09:00');
  }
  for(const k of six){
   await page.locator('#map-variable').selectOption(k);await ready();
   await page.locator('#map-time').fill('0');await page.locator('#map-time').dispatchEvent('change');await ready();
   assert.equal(await page.locator('#map-time-label').textContent(),'Wed 21 Oct at 18:00 to Thu 22 Oct at 00:00');
   await ordered('#map-variable');
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Full periods fit the viewport');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport,ordinaryStartupProductRequests:0,probabilitySwitching:true,directAnomalySelection:true,refreshAndReload:true,returnToOrdinaryChart:true,otherPanelWasLoaded:!!otherBefore.url}));
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
