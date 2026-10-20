// Exercise the actual application/controllers with deterministic UKV publication.
// Transport is synthetic; initialization URLs, labels and hourly menus are real.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Invalid path');res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const oldTests=(await readFile('tests/map-browser.mjs','utf8')).replaceAll('\r\n','\n'),fakeOM=vm.runInNewContext(oldTests.match(/const fakeOM=(`[^]*?`);\nconst geo=/)[1]);
const geo={type:'FeatureCollection',features:[]},style={version:8,sources:{roads:{type:'geojson',data:geo}},layers:[{id:'background',type:'background',paint:{'background-color':'#fff'}},{id:'road-lines',source:'roads',type:'line',paint:{'line-color':'#222'}}]};
const UKV='ukmo_uk_deterministic_2km',previous=UKV+'_previous';
const run=(h,complete=true,horizon=54)=>({reference_time:new Date(Date.UTC(2026,9,13,h)).toISOString(),completed:complete,variables:['temperature_2m','relative_humidity_2m','precipitation','cloud_cover','pressure_msl'],valid_times:Array.from({length:horizon+1},(_,i)=>new Date(Date.UTC(2026,9,13,h+i)).toISOString())});
await mkdir('review-output',{recursive:true});
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport,timezoneId:'America/Los_Angeles'}),page=await context.newPage(),errors=[],metadata=[];
  let phase=0,offline=false,partialHorizon=8;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='warning'||message.type()==='error')console.error('UKV BROWSER',message.text());});
  await page.addInitScript(()=>{
   localStorage.setItem('snowline-terrain','false');window.fixtureDelay=5;
   const interval=window.setInterval,timeout=window.setTimeout,clear=window.clearTimeout,now=Date.now;
   window.fixtureShownFrames=[];window.fixtureRefreshers=[];window.fixtureMenuChecks=new Map();window.fixtureClock=0;Date.now=()=>now()+window.fixtureClock;
   window.setInterval=(fn,ms,...args)=>{if(ms===60000)window.fixtureRefreshers.push(fn);return interval(fn,ms,...args);};
   window.setTimeout=(fn,ms,...args)=>{const id=timeout(fn,ms,...args);if(ms===60000)window.fixtureMenuChecks.set(id,fn);return id;};
   window.clearTimeout=id=>{window.fixtureMenuChecks.delete(id);clear(id);};
  });
  // Observe promoted raster/overlay sources, excluding obsolete background downloads.
  await page.route('**/map-frames.js*',async r=>{const code=await readFile(resolve(root,'map-frames.js'),'utf8');return r.fulfill({contentType:'text/javascript',body:code.replace('this.frames=new Map();', 'this.frames=new Map();(window.fixtureCaches??=new Map()).set(prefix,this);').replace('this.current=frame;',"this.current=frame;window.fixtureShownFrames.push({url:frame.url,sources:frame.resources.map(id=>this.map.getStyle().sources[id]?.url).filter(Boolean)});")});});
  await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
  await page.route('**/coastline.geojson',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
  await page.route('**/ensemble-data/**',r=>r.fulfill({status:404,body:'{}'}));
  await page.route('https://openmeteo.s3.amazonaws.com/**',r=>{
   const url=r.request().url();metadata.push(url);
   if(!url.includes('/'+UKV+'/'))return r.fulfill({status:404,body:'{}'});
   if(offline)return r.fulfill({status:503,body:'{}'});
   const latest=phase<2?run(3,phase===1,phase===1?54:partialHorizon):phase===2?run(6,false,8):phase===3?run(9,false,8):run(12,false,8);
   const records=new Map([[-3,run(-3)],[0,run(0)],[3,phase?run(3):latest],[6,run(6,false,8)],[9,run(9,phase===4,phase===4?54:8)],[12,run(12,false,8)]]);
   let meta;if(url.endsWith('/latest.json'))meta=phase<2?run(0):phase<4?run(3):run(9);
   else if(url.endsWith('/in-progress.json'))meta=latest;
   else{const match=url.match(/\/2026\/10\/13\/(\d{2})00Z\/meta.json$/);if(match)meta=records.get(Number(match[1]));}
   return r.fulfill({status:meta?200:404,contentType:'application/json',body:JSON.stringify(meta??{})});
  });
  const ready=()=>page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('Valid')&&document.querySelector('#animation-status').textContent.startsWith('Ready'),{},{timeout:40000});
  const tick=async()=>{
   // Finish each metadata queue before advancing the next simulated minute.
   await page.waitForFunction(()=>window.fixtureMenuChecks.size>0);
   await page.evaluate(async()=>{window.fixtureClock+=61000;await Promise.all(window.fixtureRefreshers.map(fn=>fn()));for(const fn of [...window.fixtureMenuChecks.values()])fn();});
   await page.waitForFunction(()=>window.fixtureMenuChecks.size>0);
  };
  const checkChoices=async id=>assert.deepEqual(await page.locator('#'+id+' option').evaluateAll(options=>options.filter(o=>o.value.startsWith('ukmo_uk_deterministic_2km')).map(o=>o.value)),[UKV,previous]);
  const assertCycleOnly=async cycle=>{
   const requests=await page.evaluate(()=>window.fixtureShownFrames.flatMap(frame=>frame.sources).map(decodeURIComponent));
   assert.ok(requests.length);assert.ok(requests.every(url=>url.includes('/'+cycle+'00Z/')),requests.slice(-3).join('\n'));
  };
  try{
   await page.goto(origin+'/maps.html?time=2026-10-13T07:00:00Z');await ready();await checkChoices('map-model');await checkChoices('map-model-b');
   assert.match(await page.locator('#map-model option:checked').textContent(),/13 Oct · 03Z · updating/);
   assert.match(await page.locator('#panel-label-a').textContent(),/0300Z · updating/);
   assert.equal(await page.locator('#map-time').getAttribute('max'),'8');
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'native');
   assert.ok(metadata.filter(u=>u.endsWith('/meta.json')).every(u=>u.includes('/0000Z/')),'Only one previous main run is read');
   await page.locator('#map-model').evaluate((el,value)=>{window.fixtureShownFrames=[];el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},previous);await ready();
   assert.match(await page.locator('#panel-label-a').textContent(),/previous completed.*0000Z/);assert.equal(await page.locator('#map-time').getAttribute('max'),'54');await assertCycleOnly('00');
   await page.locator('#map-time').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
   assert.match(await page.locator('#panel-label-a').textContent(),/14 Oct.*16:00 UTC/);
   await page.screenshot({path:`review-output/ukv-fallback-${viewport.width}.png`,fullPage:true});
   // A partially published latest must not truncate the completed fallback.
   if(viewport.width<650)await page.locator('#mobile-map-settings').click();await page.locator('#compare-maps').check();if(viewport.width<650)await page.locator('#mobile-return-map').click();
   await page.locator('#map-model-b').selectOption(UKV);await page.locator('#map-variable-b').selectOption('temperature_2m');await ready();
   assert.equal(await page.locator('#map-time').getAttribute('max'),'54');
   assert.match(await page.locator('#panel-label-a').textContent(),/14 Oct.*16:00 UTC/);
   assert.match(await page.locator('#map-error-b').textContent(),/Not yet published/);assert.ok(await page.locator('#map-error-b').isVisible());
   assert.equal(await page.locator('#preload-status').getAttribute('data-total'),'64');
   assert.equal(await page.evaluate(()=>window.fixtureCaches.get('frame-b').current),null,'Unpublished panel must not show the previous weather');
   await page.locator('#play-map').click();await page.waitForFunction(()=>Number(document.querySelector('#map-time').value)>40);await page.locator('#play-map').click();
   await page.locator('#map-time').evaluate(el=>{el.value='54';el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
   assert.match(await page.locator('#panel-label-a').textContent(),/15 Oct.*06:00 UTC/);
   await page.screenshot({path:`review-output/ukv-full-comparison-${viewport.width}.png`,fullPage:true});
   // New hours inside the existing shared range must refresh missing slots even
   // with pressure overlays off (the overall timeline itself has not changed).
   await page.locator('#map-time').evaluate(el=>{el.value='11';el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
   await page.locator('#map-mslp-b').uncheck();await ready();
   await page.locator('#map-time').evaluate(el=>{el.value='54';el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
   partialHorizon=40;await tick();await ready();
   assert.equal(await page.locator('#map-time').getAttribute('max'),'54');
   await page.locator('#map-time').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
   assert.ok(!await page.locator('#map-error-b').isVisible());assert.equal(await page.evaluate(()=>!!window.fixtureCaches.get('frame-b').current),true);
   assert.equal(await page.locator('#preload-status').getAttribute('data-total'),'96');
   // The same behaviour applies with latest on the left, and before its start.
   await page.locator('#map-model').selectOption(UKV);await ready();await page.locator('#map-model-b').selectOption(previous);await ready();
   await page.locator('#map-time').evaluate(el=>{el.value='54';el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
   assert.ok(await page.locator('#map-error-a').isVisible());assert.ok(!await page.locator('#map-error-b').isVisible());
   await page.locator('#map-time').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
   assert.match(await page.locator('#map-error-a').textContent(),/No forecast/);
   partialHorizon=8;
   // A fresh page must rediscover the same pair, without session-only history.
   await page.reload();await ready();await page.locator('#map-model').selectOption(previous);await ready();
   phase=1;await tick();await page.waitForFunction(()=>document.querySelector('#map-model option[value="ukmo_uk_deterministic_2km"]').textContent.includes('03Z')&&!document.querySelector('#map-model option[value="ukmo_uk_deterministic_2km"]').textContent.includes('updating'));
   assert.match(await page.locator('#panel-label-a').textContent(),/0000Z/,'Completion alone does not retire the previous run');
   phase=2;await tick();await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('0300Z'));
   assert.equal(await page.locator('#map-model').inputValue(),previous);await checkChoices('map-model');
   // Menu metadata has its own bounded queue; a selected map can finish first.
   await page.waitForFunction(()=>document.querySelector('#map-model option[value="ukmo_uk_deterministic_2km"]').textContent.includes('06Z · updating'));
   assert.match(await page.locator('#map-model option[value="'+UKV+'"]').textContent(),/06Z · updating/);
   // Both comparison panels use their own cycles at identical hourly valid times.
   if(viewport.width<650)await page.locator('#mobile-map-settings').click();await page.locator('#compare-maps').check();if(viewport.width<650)await page.locator('#mobile-return-map').click();
   await page.locator('#map-model-b').selectOption(UKV);await page.waitForFunction(()=>document.querySelector('#panel-label-b').textContent.includes('0600Z'));
   const labels=await page.locator('.map-panel-label').allTextContents();assert.match(labels[0],/0300Z/);assert.match(labels[1],/0600Z · updating/);assert.equal(labels[0].split('Valid ')[1],labels[1].split('Valid ')[1]);
   offline=true;await tick();await page.waitForFunction(()=>document.querySelector('#run-update-status').textContent.includes('temporarily unavailable'));
   assert.match(await page.locator('#panel-label-a').textContent(),/0300Z/);assert.match(await page.locator('#panel-label-b').textContent(),/0600Z/);
   offline=false;await tick();await ready();
   await page.locator(viewport.width<650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid .briefing-card[data-ready="true"]').length===6,{},{timeout:40000});await checkChoices('briefing-model');
   assert.equal(await page.locator('#briefing-model').inputValue(),previous);assert.match(await page.locator('#briefing-run').textContent(),/0300Z/);
   await page.locator('#briefing-model').evaluate((el,value)=>{window.fixtureShownFrames=[];el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},UKV);await page.waitForFunction(()=>document.querySelector('#briefing-run').textContent.includes('0600Z')&&document.querySelectorAll('#briefing-grid .briefing-card[data-ready="true"]').length===6);
   assert.match(await page.locator('#briefing-run').textContent(),/Updating · to T\+8 h/);await assertCycleOnly('06');
   await page.locator('#briefing-model').selectOption(previous);await page.waitForFunction(()=>document.querySelector('#briefing-run').textContent.includes('0300Z'));
   // 06Z stays incomplete: 09Z must retain completed 03Z, never partial 06Z.
   phase=3;await tick();await page.waitForFunction(()=>document.querySelector('#briefing-model option[value="ukmo_uk_deterministic_2km"]').textContent.includes('09Z'));
   assert.match(await page.locator('#briefing-run').textContent(),/0300Z/);
   await page.locator('#briefing-history-mode').click();await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===2&&document.querySelectorAll('#previous-grid .briefing-card[data-unavailable="true"]').length===1,{},{timeout:40000});
   assert.equal(await page.locator('#previous-grid .briefing-card:visible').count(),3);
   assert.equal(await page.locator('#previous-time').count(),1,'The map back button has a unique ID');
   assert.equal(await page.locator('#previous-valid-time').count(),1,'History time control cannot collide with map navigation');
   const visible='#previous-grid .briefing-card:not([hidden])';
   assert.deepEqual(await page.locator(visible+' select').evaluateAll(ss=>ss.map(s=>new Date(s.value).getUTCHours())),[0,3,9]);
   for(const select of await page.locator(visible+' select').all())assert.equal(await select.locator('option').count(),3);
   const times=await page.locator(visible).evaluateAll(cs=>cs.map(c=>c.dataset.time));assert.equal(new Set(times).size,1);
   assert.equal(times[0],'2026-10-13T07:00:00.000Z','Opening history retains the requested time, even before the newest run begins');
   const sharedTime=await page.locator('#previous-valid-time option').evaluateAll(os=>os.find(o=>o.textContent.includes('13 Oct')&&o.textContent.includes('13:00'))?.value);
   await page.locator('#previous-valid-time').selectOption(sharedTime);await page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3);
   assert.equal(await page.locator('#previous-interval').inputValue(),'native');
   phase=4;await tick();
   await page.waitForFunction(()=>document.querySelector('#previous-run-0').value.startsWith('2026-10-13T03:00')&&document.querySelector('#previous-run-1').value.startsWith('2026-10-13T09:00')&&document.querySelector('#previous-run-2').value.startsWith('2026-10-13T12:00')&&document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:40000});
   assert.deepEqual(await page.locator(visible+' select').evaluateAll(ss=>ss.map(s=>new Date(s.value).getUTCHours())),[3,9,12],'History rolls automatically on the shared minute check');
   await page.screenshot({path:`review-output/ukv-pair-${viewport.width}.png`,fullPage:true});
   assert.deepEqual(errors,[]);console.log(`UKV latest/previous, completion, rollover, failed checks, hourly steps, exact-cycle maps/briefing/history passed at ${viewport.width}px`);
  }catch(error){console.error('UKV STATE',await page.locator('#map-status,#run-update-status,#briefing-run,#previous-status,#previous-progress').allTextContents());console.error('UKV CHART ERRORS',await page.locator('#previous-grid .briefing-card[data-failed] .briefing-chart').allTextContents());await page.screenshot({path:`review-output/ukv-failure-${viewport.width}.png`,fullPage:true}).catch(()=>{});throw error;}
  finally{await context.close();}
 }
}finally{await browser.close();server.close();}

