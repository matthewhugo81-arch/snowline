// Actual map/briefing controllers; synthetic transport isolates publication timing.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Invalid path');res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const oldTests=(await readFile('tests/map-browser.mjs','utf8')).replaceAll('\r\n','\n'),fakeOM=vm.runInNewContext(oldTests.match(/const fakeOM=(`[^]*?`);\nconst geo=/)[1]);
const geo={type:'FeatureCollection',features:[]},style={version:8,sources:{roads:{type:'geojson',data:geo}},layers:[{id:'background',type:'background',paint:{'background-color':'#fff'}},{id:'road-lines',source:'roads',type:'line',paint:{'line-color':'#222'}}]};
const ref=h=>new Date(Date.UTC(2026,9,20,h)).toISOString();
const run=(h,completed=true,horizon=54)=>({reference_time:ref(h),completed,variables:['temperature_2m','relative_humidity_2m','precipitation','cloud_cover','pressure_msl'],valid_times:Array.from({length:horizon+1},(_,i)=>ref(h+i))});
const choice=(id,h)=>id+'@'+ref(h);
await mkdir('review-output',{recursive:true});
try{
 for(const id of ['ecmwf_ifs','ukmo_uk_deterministic_2km']){
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
   const context=await browser.newContext({viewport,timezoneId:'America/Los_Angeles'}),page=await context.newPage(),errors=[];
   let phase=0,offline=false;
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    localStorage.setItem('snowline-terrain','false');window.fixtureDelay=5;window.fixtureRefreshers=[];window.fixtureShownFrames=[];window.fixtureClock=Number(sessionStorage.getItem('fixture-clock')??0);
    const interval=window.setInterval,now=Date.now;Date.now=()=>now()+window.fixtureClock;
    window.setInterval=(fn,ms,...args)=>{if(ms===60000)window.fixtureRefreshers.push(fn);return interval(fn,ms,...args);};
   });
   await page.route('**/map-frames.js*',async r=>{const code=await readFile(resolve(root,'map-frames.js'),'utf8');return r.fulfill({contentType:'text/javascript',body:code.replace('this.current=frame;',`this.current=frame;window.fixtureShownFrames.push({panel:this.prefix,url:frame.url,sources:frame.resources.map(id=>this.map.getStyle().sources[id]?.url).filter(Boolean)});`)});});
   await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
   await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
   await page.route('**/coastline.geojson',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
   await page.route('**/ensemble-data/**',r=>r.fulfill({status:404,body:'{}'}));
   await page.route('https://openmeteo.s3.amazonaws.com/**',r=>{
    const url=r.request().url();
    if(!url.includes('/'+id+'/'))return r.fulfill({status:404,body:'{}'});
    if(offline)return r.fulfill({status:503,body:'{}'});
    const newest=phase<3?run(6,phase===2,phase===2?54:phase===1?16:8):phase===3?run(12,false,5):run(18,false,3);
    let meta;
    if(url.endsWith('/in-progress.json'))meta=newest;
    else if(url.endsWith('/latest.json'))meta=phase<2?run(0):run(6);
    else{
     const match=url.match(/\/2026\/10\/20\/(\d{2})00Z\/meta.json$/),hour=match?Number(match[1]):null;
     if(hour===0)meta=run(0);
     else if(hour===6)meta=phase>=2?run(6):newest;
     else if(hour===12&&phase>=3)meta=run(12,false,5);
     else if(hour===18&&phase>=4)meta=newest;
    }
    return r.fulfill({status:meta?200:404,contentType:'application/json',body:JSON.stringify(meta??{})});
   });
   const ready=()=>page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('Valid')&&document.querySelector('#animation-status').textContent.startsWith('Ready'),{},{timeout:45000});
   const tick=()=>page.evaluate(async()=>{window.fixtureClock+=61000;sessionStorage.setItem('fixture-clock',String(window.fixtureClock));await Promise.all(window.fixtureRefreshers.map(fn=>fn()));});
   const selectRun=async(selector,h)=>{await page.locator(selector).selectOption(choice(id,h));await ready();};
   try{
    await page.goto('http://127.0.0.1:'+server.address().port+'/maps.html?model='+id+'&time='+ref(8));await ready();
    assert.equal(await page.locator('#map-model').inputValue(),id);
    assert.equal(await page.locator('#map-run').inputValue(),choice(id,0));
    assert.equal(await page.locator('#map-model option[value="ukmo_uk_deterministic_2km"]').count(),1);
    assert.equal(await page.locator('#map-model option[value$="_previous"]').count(),0);
    assert.match(await page.locator('#map-run').textContent(),/06Z · Updating/);
    await selectRun('#map-run',6);assert.match(await page.locator('#panel-label-a').textContent(),/0600Z · updating/);
    phase=1;await tick();await ready();assert.equal(await page.locator('#map-run').inputValue(),choice(id,6));
    assert.ok(Number(await page.locator('#map-time').getAttribute('max'))>=5);
    await selectRun('#map-run',0);
    if(viewport.width<650)await page.locator('#mobile-map-settings').click();
    await page.locator('#compare-maps').check();await ready();
    if(viewport.width<650)await page.locator('#mobile-return-map').click();
    await selectRun('#map-run-b',6);await page.locator('#map-variable-b').selectOption('temperature_2m');await ready();
    await page.locator('#map-time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
    assert.ok(await page.locator('#map-error-b').isVisible());assert.ok(!await page.locator('#map-error-a').isVisible());
    assert.match(await page.locator('#panel-label-a').textContent(),/0000Z/);
    await page.screenshot({path:`review-output/run-selector-${id}-${viewport.width}.png`,fullPage:true});
    phase=2;await tick();await ready();assert.equal(await page.locator('#map-run').inputValue(),choice(id,0));
    phase=3;await tick();await ready();assert.equal(await page.locator('#map-run').inputValue(),choice(id,0));
    assert.equal(await page.locator('#map-run-b').inputValue(),choice(id,6));
    await page.reload();await ready();assert.equal(await page.locator('#map-run').inputValue(),choice(id,6),'Fresh page prefers newest complete');
    phase=4;await tick();await ready();assert.equal(await page.locator('#map-run').inputValue(),choice(id,6),'Failed intermediate run cannot replace complete');
    if(viewport.width<650)await page.locator('#mobile-briefing').click();else await page.locator('#open-briefing').click();
    await page.waitForFunction(()=>document.querySelector('#briefing-run-select')?.value.includes('@')&&!document.querySelector('#briefing-time').disabled);
    assert.equal(await page.locator('#briefing-run-select').inputValue(),choice(id,6));
    await page.locator('#briefing-run-select').selectOption(choice(id,18));
    await page.waitForFunction(()=>document.querySelector('#briefing-run').textContent.includes('1800Z'));
    offline=true;await tick();assert.equal(await page.locator('#briefing-run-select').inputValue(),choice(id,18));
    assert.equal(errors.length,0,errors.join('\n'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Controls must fit viewport');
    console.log('PASS',id,viewport.width);
   }catch(error){await page.screenshot({path:`review-output/run-selector-failure-${id}-${viewport.width}.png`,fullPage:true});console.error(await page.locator('#map-status').textContent(),errors);throw error;}
   finally{await context.close();}
  }
 }
}finally{await browser.close();server.close();}
