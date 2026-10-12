// Real application and MapLibre with deterministic synthetic weather transport.
// Live numerical/provider checks run separately; this test does not claim live speed.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Invalid path');const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const oldTests=await readFile('tests/map-browser.mjs','utf8'),fakeOM=vm.runInNewContext(oldTests.match(/const fakeOM=(`[^]*?`);\nconst geo=/)[1]);
const geo={type:'FeatureCollection',features:[]},style={version:8,sources:{roads:{type:'geojson',data:geo}},layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},{id:'road-lines',source:'roads',type:'line',paint:{'line-color':'#222222'}}]};
const UKV='ukmo_uk_deterministic_2km',ref='2026-10-12T12:00:00Z',hour=3600000,periods=[6,12,18,24,36,48,72,120],key=h=>'precipitation_total_'+h+'h';
const meta=(reference_time,domain=UKV)=>{const cycle=new Date(reference_time).getUTCHours(),ukv=domain===UKV,max=ukv?(cycle%3===0?54:12):168;return {completed:true,reference_time,variables:['temperature_2m','temperature_850hPa','relative_humidity_2m','precipitation','cloud_cover','pressure_msl'],valid_times:Array.from({length:max+1},(_,i)=>new Date(Date.parse(reference_time)+i*hour).toISOString()).filter((_,i)=>ukv||i<=120||i%3===0)};};
const metrics=[];
await mkdir('review-output',{recursive:true});
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1}),page=await context.newPage(),errors=[],requests=[];let newer=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('snowline-terrain','false');window.fixtureDelay=5;});
  await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
  await page.route('**/coastline.geojson',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
  await page.route('**/ensemble-data/*/latest.json',r=>r.fulfill({status:404,contentType:'application/json',body:'{}'}));
  await page.route('https://openmeteo.s3.amazonaws.com/**',r=>{
   const url=r.request().url(),domain=new URL(url).pathname.split('/')[2],isUKV=domain===UKV;requests.push(url);
   if(!isUKV&&!['ncep_gfs013','ncep_gfs025'].includes(domain))return r.fulfill({status:404,body:'{}'});
   let reference;if(/latest.json$/.test(url))reference=isUKV?'2026-10-12T13:00:00Z':ref;
   else if(/in-progress.json$/.test(url))reference=isUKV?(newer?'2026-10-12T15:00:00Z':'2026-10-12T13:00:00Z'):ref;
   else {const match=url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})00Z\/meta.json$/);if(match)reference=`${match[1]}-${match[2]}-${match[3]}T${match[4]}:00:00Z`;}
   const valid=reference&&Date.parse(reference)>=Date.parse(ref)-48*hour&&Date.parse(reference)<=Date.parse(newer?'2026-10-12T15:00:00Z':'2026-10-12T13:00:00Z');
   return r.fulfill({status:valid?200:404,contentType:'application/json',body:JSON.stringify(valid?meta(reference,domain):{})});
  });
  try{
   const start=performance.now();await page.goto(origin+'/maps.html?time=2026-10-13T12:00:00Z');
   await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('Valid'),{},{timeout:40000});const firstMs=performance.now()-start;
   const opt=await page.locator('#map-variable option').evaluateAll(os=>os.filter(o=>o.value.startsWith('precipitation_total')).map(o=>({key:o.value,disabled:o.disabled})));
   assert.deepEqual(opt,periods.map(h=>({key:key(h),disabled:h>54})), 'All windows are explicit; no extended run substitute');
   assert.equal(await page.evaluate(()=>window.fixtureRequests.some(r=>decodeURIComponent(r.url).includes('precipitation_total'))),false,'No accumulation grid work before selection');
   assert.ok(requests.filter(u=>/\/meta.json$/.test(u)&&!u.includes('/1200Z/')&&!u.includes('/1300Z/')).length===0,'No history fetch before the history mode is opened');
   const accumStart=performance.now();await page.locator('#map-variable').selectOption(key(24));
   await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('24 h precipitation total'),{},{timeout:30000});
   const legend=await page.locator('#legend-interval-a').textContent();assert.match(legend,/12 Oct.*12:00.*13 Oct.*12:00.*UTC/);
   assert.match(await page.locator('#range-start').textContent(),/13 Oct/);
   await page.screenshot({path:`review-output/accumulation-${viewport.width}.png`});
   metrics.push({viewport:viewport.width,syntheticFirstMapMs:Math.round(firstMs),syntheticSelected24hMs:Math.round(performance.now()-accumStart)});
   if(viewport.width<650)await page.locator('#mobile-map-settings').click();await page.locator('#compare-maps').check();if(viewport.width<650)await page.locator('#mobile-return-map').click();
   await page.locator('#map-variable-b').selectOption('temperature_2m');await page.waitForFunction(()=>document.querySelector('#panel-label-b').textContent.includes('Valid'));
   assert.match(await page.locator('#panel-label-a').textContent(),/13 Oct.*12:00/);assert.match(await page.locator('#panel-label-b').textContent(),/13 Oct.*12:00/);
   await page.locator(viewport.width<650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelector('#briefing-preset')&&!document.querySelector('#briefing-preset').disabled);
   await page.locator('#briefing-history-mode').click();await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:60000});
   const initial=await page.locator('#previous-grid .briefing-card').evaluateAll(cs=>cs.map(c=>({run:c.dataset.run,time:c.dataset.time,caption:c.querySelector('p').textContent})));
   assert.deepEqual(initial.map(c=>new Date(c.run).getUTCHours()),[6,9,12]);assert.equal(new Set(initial.map(c=>c.time)).size,1);assert.equal(new Set(initial.map(c=>c.caption.match(/T\+\d+/)?.[0])).size,3);
   assert.match(await page.locator('#previous-status').textContent(),/17 published runs/);
   assert.match(await page.locator('#previous-model option:checked').textContent(),/12 Oct.*12Z/);
   const historyRect=await page.locator('#previous-grid').boundingBox();assert.ok(historyRect.width<=viewport.width);
   await page.screenshot({path:`review-output/previous-runs-${viewport.width}.png`,fullPage:true});
   await page.locator('#previous-forward').click();await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3);
   const advanced=await page.locator('#previous-grid .briefing-card').evaluateAll(cs=>cs.map(c=>c.dataset.time));assert.equal(new Set(advanced).size,1);assert.notEqual(advanced[0],initial[0].time);
   await page.locator('#previous-preset').selectOption(key(24));await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3);
   const captions=await page.locator('#previous-grid .briefing-card>p').allTextContents();assert.equal(new Set(captions.map(c=>c.split(' · 24 h · ')[1])).size,1,'All three total windows have matching UTC endpoints');
   const pinned=await page.locator('#previous-grid select').evaluateAll(ss=>ss.map(s=>s.value));
   newer=true;await page.evaluate(()=>document.dispatchEvent(new CustomEvent('snowline-model-run-available',{detail:{model:'ukmo_uk_deterministic_2km',meta:{reference_time:'2026-10-12T15:00:00Z'}}})));
   assert.equal(await page.locator('#previous-new').isVisible(),true);assert.deepEqual(await page.locator('#previous-grid select').evaluateAll(ss=>ss.map(s=>s.value)),pinned);
   const saved=page.waitForEvent('download');await page.locator('#previous-grid img').first().click({button:'right'});await page.getByRole('menuitem',{name:'Save image'}).click();const download=await saved;await download.saveAs(`review-output/history-export-${viewport.width}.png`);assert.match(download.suggestedFilename(),/precipitation/);await page.keyboard.press('Escape');
   await page.locator('#previous-run-0').selectOption(pinned[1]);assert.match(await page.locator('#previous-progress').textContent(),/three different/);await page.locator('#previous-run-0').selectOption(pinned[0]);await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3);
   await page.locator('#previous-refresh').click();await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3);assert.deepEqual(await page.locator('#previous-grid select').evaluateAll(ss=>ss.map(s=>new Date(s.value).getUTCHours())),[9,12,15]);
   newer=false;await page.locator('#previous-model').selectOption(UKV+'_nowcast');await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3);
   assert.ok((await page.locator('#previous-grid select').evaluateAll(ss=>ss.map(s=>new Date(s.value).getUTCHours()))).every(h=>h%3!==0));assert.equal(await page.locator('#previous-preset option[value="precipitation_total_24h"]').count(),0);
   await page.locator('#briefing-sequence-mode').click();await page.waitForFunction(()=>!document.querySelector('#briefing-preset').disabled);assert.equal(await page.locator('#previous-run-view').isVisible(),false);
   await page.locator('#briefing-close').click();assert.equal(await page.locator('#map-a').isVisible(),true);
   await page.locator('#map-model').selectOption('gfs_global');await page.waitForFunction(()=>!document.querySelector('#map-variable').disabled);
   assert.equal(await page.locator('#map-variable option[value="precipitation_total_120h"]').isDisabled(),false);
   if(viewport.width<650)await page.locator('#mobile-map-settings').click();await page.locator('#compare-maps').uncheck();if(viewport.width<650)await page.locator('#mobile-return-map').click();
   await page.locator('#map-variable').selectOption(key(120));await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('120 h precipitation total'));
   assert.match(await page.locator('#legend-interval-a').textContent(),/120 h.*12 Oct.*17 Oct/);
   assert.deepEqual(errors,[]);console.log(`Accumulation menus, exact windows, three-run comparison, pinning and export passed at ${viewport.width}px`);
  }catch(e){console.error('ORIGINAL FAILURE',e);console.log('DIAGNOSTICS',await page.evaluate(()=>({main:document.querySelector('#map-status')?.textContent,history:document.querySelector('#previous-status')?.textContent,progress:document.querySelector('#previous-progress')?.textContent})).catch(()=>({})));await page.screenshot({path:`review-output/failure-history-${viewport.width}.png`,fullPage:true}).catch(()=>{});throw e;}
  finally{await context.close();}
 }
 await writeFile('review-output/browser-metrics.json',JSON.stringify(metrics,null,2));
}finally{await browser.close();server.close();}
