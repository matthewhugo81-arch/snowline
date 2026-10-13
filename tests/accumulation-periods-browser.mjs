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
const oldTests=await readFile('tests/map-browser.mjs','utf8'),fakeOM=vm.runInNewContext(oldTests.match(/const fakeOM=(`[^]*?`);\nconst geo=/)[1]).replace('export const updateCurrentBounds=()=>{};','export const updateCurrentBounds=b=>{window.fixtureBounds=[...b]};');
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
  // Use the real local coastline to visually check the requested North Atlantic crop.
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
   await page.goto(origin+'/maps.html?time=2026-10-13T12:00:00Z');
   await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('Valid'),{},{timeout:40000});
   await page.locator(viewport.width<650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelector('#briefing-preset')&&!document.querySelector('#briefing-preset').disabled);
   const readySequence=()=>page.waitForFunction(()=>{const cs=[...document.querySelectorAll('#briefing-grid .briefing-card')];return cs.length>0&&cs.every(c=>c.dataset.ready==='true');},{},{timeout:30000});
   const readyHistory=()=>page.waitForFunction(()=>document.querySelectorAll('#previous-grid .briefing-card[data-ready="true"]').length===3,{},{timeout:30000});
   const ends=()=>page.locator('#briefing-grid .briefing-card').evaluateAll(cs=>cs.map(c=>c.dataset.time));
   await page.locator('#briefing-preset').selectOption(key(24));
   await page.locator('#briefing-time').selectOption('2026-10-12T12:00:00.000Z');await readySequence();
   assert.equal(await page.locator('#briefing-time-heading').textContent(),'Period start · UTC');
   assert.equal(await page.locator('#briefing-interval').isDisabled(),true);
   assert.deepEqual(await page.locator('#briefing-interval option').allTextContents(),['24-hour periods']);
   assert.deepEqual(await ends(),['2026-10-13T12:00:00.000Z','2026-10-14T12:00:00.000Z']);
   assert.match(await page.locator('#briefing-grid h3').first().textContent(),/12 Oct.*12:00.*13 Oct.*12:00/);
   assert.match(await page.locator('#briefing-note').textContent(),/do not overlap/);
   assert.equal(await page.locator('#briefing-next').isDisabled(),true);
   await page.screenshot({path:`review-output/fixed-24h-${viewport.width}.png`,fullPage:true});
   await page.locator('#briefing-area').selectOption('atlantic');await readySequence();
   const checkAtlantic=async()=>{const b=await page.evaluate(()=>window.fixtureBounds);assert.ok(b[0]>-71&&b[2]<41&&b[1]>30&&b[3]<76,JSON.stringify(b));return b;};
   const sequenceAtlantic=await checkAtlantic();
   await page.screenshot({path:`review-output/fixed-atlantic-sequence-${viewport.width}.png`,fullPage:true});
   await page.locator('#briefing-area').selectOption('uk');await readySequence();

   await page.locator('#briefing-preset').selectOption(key(48));await readySequence();
   assert.deepEqual(await ends(),['2026-10-14T12:00:00.000Z']);
   assert.equal(await page.locator('#briefing-time').inputValue(),'2026-10-12T12:00:00.000Z');
   assert.deepEqual(await page.locator('#briefing-interval option').allTextContents(),['48-hour periods']);
   await page.locator('#briefing-preset').selectOption(key(6));
   await page.locator('#briefing-time').selectOption('2026-10-12T13:00:00.000Z');await readySequence();
   assert.deepEqual(await ends(),[19,25,31,37,43,49].map(h=>new Date(Date.UTC(2026,9,12,h)).toISOString()));
   await page.locator('#briefing-next').click();await readySequence();
   assert.deepEqual(await ends(),[55,61].map(h=>new Date(Date.UTC(2026,9,12,h)).toISOString()));
   assert.equal(await page.locator('#briefing-time').inputValue(),'2026-10-14T01:00:00.000Z');
   await page.locator('#briefing-previous').click();await readySequence();
   assert.equal(await page.locator('#briefing-time').inputValue(),'2026-10-12T13:00:00.000Z');
   await page.locator('#briefing-preset').selectOption(key(24));
   await page.locator('#briefing-time').selectOption('2026-10-12T12:00:00.000Z');await readySequence();
   const sources=await page.locator('#briefing-grid img').evaluateAll(imgs=>imgs.map(i=>i.src));
   const rasterBefore=await page.evaluate(()=>window.fixtureRequests.length);
   await page.locator('#briefing-toggle-controls').click();
   assert.deepEqual(await page.locator('#briefing-grid img').evaluateAll(imgs=>imgs.map(i=>i.src)),sources);
   await page.locator('#briefing-toggle-controls').click();
   assert.equal(await page.evaluate(()=>window.fixtureRequests.length),rasterBefore,'Hide/show does not request any imagery');
   await page.locator('#briefing-history-mode').click();await readyHistory();
   assert.equal(await page.locator('#previous-preset').inputValue(),key(24));
   assert.equal(await page.locator('#previous-run-view #previous-time').inputValue(),'2026-10-12T12:00:00.000Z');
   assert.equal(await page.locator('#previous-time-heading').textContent(),'Shared period start · UTC');
   assert.deepEqual(await page.locator('#previous-grid .briefing-card').evaluateAll(cs=>cs.map(c=>c.dataset.time)),Array(3).fill('2026-10-13T12:00:00.000Z'));
   await page.locator('#previous-forward').click();await readyHistory();
   assert.deepEqual(await page.locator('#previous-grid .briefing-card').evaluateAll(cs=>cs.map(c=>c.dataset.time)),Array(3).fill('2026-10-14T12:00:00.000Z'));
   assert.equal(await page.locator('#previous-forward').isDisabled(),true);
   await page.locator('#previous-back').click();await readyHistory();
   await page.locator('#previous-area').selectOption('atlantic');await readyHistory();
   assert.deepEqual(await checkAtlantic(),sequenceAtlantic,'Both briefing modes share exactly the same Atlantic extent');
   await page.screenshot({path:`review-output/fixed-atlantic-history-${viewport.width}.png`,fullPage:true});
   await page.locator('#previous-area').selectOption('uk');await readyHistory();

   await page.locator('#previous-toggle-controls').click();
   assert.match(await page.locator('#previous-progress').textContent(),/Shared period.*12 Oct.*13 Oct/);
   await page.screenshot({path:`review-output/fixed-previous-24h-${viewport.width}.png`,fullPage:true});
   await page.locator('#previous-toggle-controls').click();
   await page.locator('#previous-preset').selectOption('weather');await readyHistory();
   assert.equal(await page.locator('#previous-time-heading').textContent(),'Shared valid time · UTC');
   assert.equal(await page.locator('#previous-interval').inputValue(),'native');
   await page.locator('#previous-model').selectOption('gfs_global');await readyHistory();
   await page.locator('#previous-interval').selectOption('6');await readyHistory();
   await page.locator('#previous-preset').selectOption(key(24));await readyHistory();
   assert.equal(await page.locator('#previous-interval').isDisabled(),true);
   await page.locator('#previous-preset').selectOption('temperature');await readyHistory();
   assert.equal(await page.locator('#previous-interval').isDisabled(),false);
   assert.equal(await page.locator('#previous-interval').inputValue(),'6');
   await page.locator('#briefing-sequence-mode').click();await readySequence();
   await page.locator('#briefing-preset').selectOption('weather');await readySequence();
   assert.equal(await page.locator('#briefing-time-heading').textContent(),'Starting time');
   assert.equal(await page.locator('#briefing-interval').inputValue(),'native');
   await page.locator('#briefing-model').selectOption('gfs_global');await readySequence();
   await page.locator('#briefing-interval').selectOption('6');await readySequence();
   await page.locator('#briefing-preset').selectOption(key(24));await readySequence();
   await page.locator('#briefing-preset').selectOption('temperature');await readySequence();
   assert.equal(await page.locator('#briefing-interval').isDisabled(),false);
   assert.equal(await page.locator('#briefing-interval').inputValue(),'6');
   assert.deepEqual(errors,[]);
   console.log(`Fixed rainfall periods, exact user start, fewer complete charts, paired history, hide/show and restored intervals passed at ${viewport.width}px`);
  }catch(e){await page.screenshot({path:`review-output/fixed-failure-${viewport.width}.png`,fullPage:true}).catch(()=>{});throw e;}
  finally{await context.close();}
 }
}finally{await browser.close();server.close();}
