// Actual map/briefing controllers; synthetic transport isolates publication timing.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Invalid path');const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
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
   let newestHour=6,offline=false;
   const runs=new Map([[0,run(0)],[6,run(6,false,8)]]);
   const publish=(hour,completed=false,horizon=completed?54:8)=>{newestHour=hour;runs.set(hour,run(hour,completed,horizon));};
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    localStorage.setItem('snowline-terrain','false');window.fixtureDelay=5;window.fixtureRefreshers=[];window.fixtureShownFrames=[];window.fixtureClock=Number(sessionStorage.getItem('fixture-clock')??0);window.fixtureHidden=false;
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.fixtureHidden});
    const interval=window.setInterval,now=Date.now;Date.now=()=>now()+window.fixtureClock;
    // Publication changes drive these checks explicitly, avoiding real minute
    // timers overlapping a synthetic rollover on slower CI renderers.
    window.setInterval=(fn,ms,...args)=>{if(ms===60000){window.fixtureRefreshers.push(fn);return 0;}return interval(fn,ms,...args);};
   });
   await page.route('**/maps.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile(resolve(root,'maps.js'),'utf8'))+'\nwindow.fixturePanels=panels;'}));
   await page.route('**/map-frames.js*',async r=>{const code=await readFile(resolve(root,'map-frames.js'),'utf8');return r.fulfill({contentType:'text/javascript',body:code.replace('this.current=frame;',`this.current=frame;window.fixtureShownFrames.push({panel:this.prefix,url:frame.url,sources:frame.resources.map(id=>this.map.getStyle().sources[id]?.url).filter(Boolean)});`)});});
   await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
   await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
   await page.route('**/coastline.geojson',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
   await page.route('**/ensemble-data/**',r=>r.fulfill({status:404,body:'{}'}));
   await page.route('https://openmeteo.s3.amazonaws.com/**',r=>{
    const url=r.request().url();
    if(!url.includes('/'+id+'/'))return r.fulfill({status:404,body:'{}'});
    if(offline)return r.fulfill({status:503,body:'{}'});
    const newest=runs.get(newestHour),completeHour=Math.max(...[...runs].filter(([,meta])=>meta.completed).map(([hour])=>hour));
    let meta;
    if(url.endsWith('/in-progress.json'))meta=newest;
    // UKV's provider index also publishes intervening nowcasts. A completed
    // 05Z hint must not block discovery of the complete 00Z main cycle.
    else if(url.endsWith('/latest.json'))meta=completeHour===0&&id==='ukmo_uk_deterministic_2km'?run(5):runs.get(completeHour);
    else{
     const match=url.match(/\/2026\/10\/20\/(\d{2})00Z\/meta.json$/),hour=match?Number(match[1]):null;
     meta=runs.get(hour);
    }
    return r.fulfill({status:meta?200:404,contentType:'application/json',body:JSON.stringify(meta??{})});
   });
   const ready=()=>page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('Valid')&&document.querySelector('#animation-status').textContent.startsWith('Ready'),{},{timeout:45000});
   const tick=()=>page.evaluate(async()=>{window.fixtureClock+=61000;sessionStorage.setItem('fixture-clock',String(window.fixtureClock));await Promise.all(window.fixtureRefreshers.map(fn=>fn()));});
   const selectRun=async(selector,h)=>{await page.locator(selector).selectOption(choice(id,h));await ready();};
   const assertCompletedLabel=async(selector,h)=>{
    const suffix='(20 Oct · '+String(h).padStart(2,'0')+'Z)';
    await page.waitForFunction(({selector,suffix})=>document.querySelector(selector)?.selectedOptions[0]?.textContent.endsWith(suffix),{selector,suffix},{timeout:15000});
   };
   const assertRunOptions=async(selector,hours,selected,preferred)=>{
    const result=await page.locator(selector).evaluate(select=>({value:select.value,preferred:select.dataset.preferredRun,options:[...select.options].map(option=>({value:option.value,text:option.textContent}))}));
    const expected=hours.map(hour=>({value:choice(id,hour),text:'20 Oct · '+String(hour).padStart(2,'0')+'Z · '+(runs.get(hour).completed?'Complete':'Updating')+(hour===newestHour?' · newest':'')}));
    assert.deepEqual(result.options,expected,'The run menu must contain each dated initialization once, with its correct completion state');
    assert.equal(new Set(result.options.map(option=>option.value)).size,result.options.length,'Run choices must have distinct dated values');
    assert.ok(result.options.every(option=>option.value.includes('@')&&!/Auto/i.test(option.text)),'No duplicate automatic or bare-model option may appear');
    assert.equal(result.value,choice(id,selected),'The run menu must show the selected initialization');
    assert.equal(result.preferred,choice(id,preferred),'The newest complete choice restores automatic following');
   };
   const assertMapRun=async(key,hour)=>{
    const result=await page.evaluate(key=>{
     const panel=window.fixturePanels[key],frame=panel.frameCache?.current;
     return {label:document.querySelector('#panel-label-'+key).textContent,model:panel.displayedModel,url:frame?.url,sources:frame?.resources.map(id=>panel.map.getStyle().sources[id]?.url).filter(Boolean)};
    },key);
    const cycle=String(hour).padStart(2,'0')+'00Z',path='/2026/10/20/'+cycle+'/';
    assert.equal(result.model,choice(id,hour),'Rendered panel must use the selected initialization');
    assert.ok(result.label.includes(cycle),'Panel label must describe its rendered run');
    assert.ok(decodeURIComponent(result.url).includes(path),'Main chart source must advance with its run label');
    assert.ok(result.sources.length>0&&result.sources.every(url=>decodeURIComponent(url).includes(path)),'All chart overlays must use the same initialization');
   };
   const briefingReady=hour=>page.waitForFunction(cycle=>{
    const time=document.querySelector('#briefing-time'),run=document.querySelector('#briefing-run'),images=[...document.querySelectorAll('#briefing-grid .briefing-card img')];
    return time&&!time.disabled&&run?.textContent.includes(cycle)&&images.length>0&&images.every(image=>image.alt.includes(cycle));
   },String(hour).padStart(2,'0')+'00Z',{timeout:45000});
   const openBriefing=()=>page.locator(viewport.width<650?'#mobile-briefing':'#open-briefing').click();
   try{
    await page.goto('http://127.0.0.1:'+server.address().port+'/maps.html?model='+id+'&time='+ref(8));await ready();
    assert.equal(await page.locator('#map-model').inputValue(),id);
    await assertRunOptions('#map-run',[6,0],0,0);
    await assertCompletedLabel('#map-model',0);
    await assertMapRun('a',0);
    assert.equal(await page.locator('#map-model option[value="ukmo_uk_deterministic_2km"]').count(),1);
    assert.equal(await page.locator('#map-model option[value$="_previous"]').count(),0);
    assert.match(await page.locator('#map-run').textContent(),/06Z · Updating/);
    publish(6,false,12);await tick();await ready();await assertMapRun('a',0);
    await assertRunOptions('#map-run',[6,0],0,0);
    await selectRun('#map-run',6);assert.match(await page.locator('#panel-label-a').textContent(),/0600Z · updating/);
    await assertCompletedLabel('#map-model',0);
    publish(6,false,16);await tick();await ready();await assertRunOptions('#map-run',[6,0],6,0);
    assert.ok(Number(await page.locator('#map-time').getAttribute('max'))>=5);
    await selectRun('#map-run',0);await assertMapRun('a',0);
    if(viewport.width<650)await page.locator('#mobile-map-settings').click();
    await page.locator('#compare-maps').check();await ready();
    if(viewport.width<650)await page.locator('#mobile-return-map').click();
    await selectRun('#map-run-b',6);await page.locator('#map-variable-b').selectOption('temperature_2m');await ready();
    await page.locator('#map-time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
    assert.ok(await page.locator('#map-error-b').isVisible());assert.ok(!await page.locator('#map-error-a').isVisible());
    assert.match(await page.locator('#panel-label-a').textContent(),/0000Z/);
    await page.locator('#map-start-time').selectOption(ref(12));await ready();
    await selectRun('#map-run-b',0);
    publish(6,true);await tick();await ready();
    await assertRunOptions('#map-run',[6,0],6,6);
    await assertRunOptions('#map-run-b',[6,0],6,6);
    await assertMapRun('a',6);await assertMapRun('b',6);
    // Selecting the preferred 00Z above resumed following. Once 06Z completes,
    // selecting the now-older 00Z deliberately pins only this comparison panel.
    await selectRun('#map-run-b',0);await assertRunOptions('#map-run-b',[6,0],0,6);
    await assertMapRun('a',6);await assertMapRun('b',0);
    await assertCompletedLabel('#map-model',6);await assertCompletedLabel('#map-model-b',6);
    await page.locator('#map-start-time').selectOption(ref(24));await ready();
    publish(12,false,5);await tick();await ready();await assertMapRun('a',6);await assertMapRun('b',0);
    await assertRunOptions('#map-run',[12,6],6,6);await assertRunOptions('#map-run-b',[12,6,0],0,6);
    // Hidden pages catch up on return without needing a reload or a menu click.
    await page.evaluate(()=>{window.fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    publish(12,true);await tick();
    assert.match(await page.locator('#panel-label-a').textContent(),/0600Z/);
    await page.evaluate(()=>{
     window.fixtureTransportGate=new Promise(resolve=>{window.fixtureReleaseTransport=()=>{window.fixtureTransportGate=null;resolve();};});
     window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(()=>window.fixtureRequests.some(request=>decodeURIComponent(request.url).includes('/2026/10/20/1200Z/')),{},{timeout:45000});
    await assertMapRun('a',6);await assertMapRun('b',0);
    assert.ok(await page.evaluate(()=>{
     const panel=window.fixturePanels.a,frame=panel.frameCache?.current;
     return !!frame&&!!panel.map.getLayer(frame.layer)&&panel.map.getLayoutProperty(frame.layer,'visibility')!=='none';
    }),'The complete previous image must remain visible while the promoted run loads');
    await page.evaluate(()=>{window.fixtureFault={match:'/2026/10/20/1200Z/',remaining:100};window.fixtureReleaseTransport();});
    await page.waitForFunction(()=>document.querySelector('#animation-status').textContent.startsWith('Frame unavailable'),{},{timeout:45000});
    await assertMapRun('a',6);await assertMapRun('b',0);
    assert.ok(await page.locator('#map-error-a').isVisible(),'A failed new image is reported while the previous image remains labelled correctly');
    await page.evaluate(()=>window.fixtureFault=null);
    await tick();
    await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('1200Z')&&document.querySelector('#animation-status').textContent.startsWith('Ready'),{},{timeout:45000});
    await assertMapRun('a',12);await assertMapRun('b',0);
    await assertRunOptions('#map-run',[12,6],12,12);await assertRunOptions('#map-run-b',[12,6,0],0,12);
    assert.equal(await page.locator('#map-start-time').inputValue(),ref(24),'Run promotion preserves the requested valid time when available');
    offline=true;await tick();await assertMapRun('a',12);await assertMapRun('b',0);
    offline=false;await tick();await ready();
    await page.screenshot({path:`review-output/run-selector-${id}-${viewport.width}.png`,fullPage:true});
    await page.reload();await ready();await assertRunOptions('#map-run',[12,6],12,12);
    await assertMapRun('a',12);
    await openBriefing();await briefingReady(12);
    await assertRunOptions('#briefing-run-select',[12,6],12,12);
    publish(18,false,3);await tick();await briefingReady(12);
    await assertRunOptions('#briefing-run-select',[18,12],12,12);
    publish(18,true);await tick();await briefingReady(18);
    await assertRunOptions('#briefing-run-select',[18,12],18,18);
    const briefingSources=await page.evaluate(()=>window.fixtureShownFrames.filter(frame=>frame.panel.startsWith('briefing-frame-')).at(-1));
    assert.ok([briefingSources.url,...briefingSources.sources].every(url=>decodeURIComponent(url).includes('/2026/10/20/1800Z/')),'New briefing images and overlays must use the promoted run');
    await page.locator('#briefing-run-select').selectOption(choice(id,12));await briefingReady(12);
    await tick();await briefingReady(12);await assertRunOptions('#briefing-run-select',[18,12],12,18);
    await page.locator('#briefing-run-select').selectOption(choice(id,18));await briefingReady(18);
    offline=true;await tick();await briefingReady(18);await assertRunOptions('#briefing-run-select',[18,12],18,18);
    offline=false;
    // Dated shared URLs are an explicit choice, unlike ordinary model links.
    await page.goto('http://127.0.0.1:'+server.address().port+'/maps.html?model='+encodeURIComponent(choice(id,0))+'&time='+ref(24));await ready();
    await tick();await ready();await assertRunOptions('#map-run',[18,12,0],0,18);await assertMapRun('a',0);
    await openBriefing();await briefingReady(0);
    await assertRunOptions('#briefing-run-select',[18,12,0],0,18);
    assert.equal(errors.length,0,errors.join('\n'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Controls must fit viewport');
    console.log('PASS',id,viewport.width);
   }catch(error){await page.screenshot({path:`review-output/run-selector-failure-${id}-${viewport.width}.png`,fullPage:true});console.error(await page.locator('#map-status').textContent(),errors);throw error;}
   finally{await context.close();}
  }
 }
}finally{await browser.close();server.close();}
