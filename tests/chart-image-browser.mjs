// Bundled MapLibre + actual application UI; only network transport is synthetic.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
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
const coast={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-3,53],[-3,57]]}};
const UKV='ukmo_uk_deterministic_2km',meta={completed:true,reference_time:'2026-10-12T06:00:00Z',variables:['temperature_2m','temperature_850hPa','relative_humidity_2m','precipitation','cloud_cover','pressure_msl',...['300','200'].flatMap(l=>['wind_speed_'+l+'hPa','wind_direction_'+l+'hPa'])],valid_times:Array.from({length:10},(_,i)=>new Date(Date.UTC(2026,9,12,6+i)).toISOString())};
await mkdir('review-output',{recursive:true});
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('snowline-terrain','false');window.fixtureDelay=5;});
  await page.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
  const backgrounds=[];
  await page.route('https://tiles.openfreemap.org/**',r=>{backgrounds.push(r.request().url());return r.fulfill({contentType:'application/json',body:JSON.stringify(style)});});
  await page.route('**/coastline.geojson',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(coast)}));
  await page.route('https://openmeteo.s3.amazonaws.com/**',r=>{const u=r.request().url(),ok=u.includes('/'+UKV+'/')&&(u.endsWith('latest.json')||u.endsWith('in-progress.json')||u.includes('/0600Z/meta.json'));return r.fulfill({status:ok?200:404,contentType:'application/json',body:JSON.stringify(ok?meta:{error:true})});});
  await page.route('**/ensemble-data/*/latest.json',r=>r.fulfill({status:404,contentType:'application/json',body:'{}'}));
  await page.goto(origin+'/maps.html?time=2026-10-12T07:00:00Z');
  await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('Valid'),{},{timeout:40000});
  await page.evaluate(async()=>{const {Map}=await import('/vendor/maplibre-gl.mjs');window.fixtureLayers=[];window.fixtureOpacity=[];const paint=Map.prototype.setPaintProperty;Map.prototype.setPaintProperty=function(id,name,value){if(name==='raster-opacity'&&value>0)window.fixtureOpacity.push({briefing:this.getContainer().classList.contains('briefing-renderer'),id,value});return paint.call(this,id,name,value);};const original=Map.prototype.addLayer;Map.prototype.addLayer=function(layer,before){window.fixtureLayers.push(structuredClone(layer));if(layer.id==='coast-line'&&this.getContainer().classList.contains('briefing-renderer'))window.fixtureChartMap=this;return original.call(this,layer,before);};});
  const map=page.locator('#map-a .maplibregl-canvas'),menu=page.locator('.chart-image-menu'),copy=menu.getByRole('menuitem',{name:'Copy image'}),save=menu.getByRole('menuitem',{name:'Save image'});
  const right=async(target=map)=>{
   // Settle test-driven page scrolling before contextmenu: the actual menu
   // correctly closes on scroll. Click the visible centre so Playwright does
   // not initiate another scroll for an off-screen fixed canvas coordinate.
   await target.scrollIntoViewIfNeeded();
   await target.evaluate(async el=>{
    if(el instanceof HTMLImageElement)await el.decode();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   });
   const box=await target.boundingBox();assert.ok(box,'Chart must have a visible rectangle');
   const left=Math.max(0,box.x),right=Math.min(viewport.width,box.x+box.width);
   const top=Math.max(0,box.y),bottom=Math.min(viewport.height,box.y+box.height);
   assert.ok(right>left&&bottom>top,'Chart must intersect the viewport');
   await page.mouse.click((left+right)/2,(top+bottom)/2,{button:'right'});
   await menu.waitFor({state:'visible'});
  };
  const saveFile=async name=>{
   const [download]=await Promise.all([page.waitForEvent('download'),save.click()]);const path=resolve('review-output',name+'.png');await download.saveAs(path);
   assert.match(download.suggestedFilename(),/^Snowline-.*\.png$/);const bytes=await readFile(path);assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
   const pixel=await page.evaluate(async b=>{const img=new Image();img.src='data:image/png;base64,'+b;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(c.width>>1,c.height>>1,1,1).data];},bytes.toString('base64'));
   assert.equal(pixel[3],255,'PNG is opaque, not a cleared WebGL buffer');assert.ok(pixel.slice(0,3).some(v=>v<230),'PNG includes displayed weather pixels');await page.keyboard.press('Escape');return download;
  };
  for(const level of [300,200]){
   await page.locator('#map-variable').selectOption('wind_speed_'+level+'hPa');await page.waitForFunction(l=>document.querySelector('#panel-label-a').textContent.includes(l+' hPa'),level);
   assert.deepEqual(await page.locator('#legend-bands-a span').allTextContents(),['60','75','90','105','120','135','150','165','180+']);assert.match(await page.locator('#legend-interval-a').textContent(),/below 60 mph/);
   await right();assert.equal(await page.locator('.maplibregl-popup').count(),0,'Right-click does not trigger drill-down');const d=await saveFile(`jet-${level}-${viewport.width}`);assert.match(d.suggestedFilename(),new RegExp(level+'-hPa'));
  }
  await map.click({position:{x:100,y:130}});await page.locator('.maplibregl-popup a').waitFor();assert.equal(await page.locator('.maplibregl-popup a').textContent(),'Open location charts');await page.keyboard.press('Escape');
  await right();await copy.click();await page.waitForFunction(()=>document.querySelector('.chart-image-message').textContent==='Image copied.',{},{timeout:10000});
  const clip=await page.evaluate(async()=>{const items=await navigator.clipboard.read(),b=await items[0].getType('image/png');return {type:b.type,size:b.size};});assert.equal(clip.type,'image/png');assert.ok(clip.size>1000);await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.originalWrite=navigator.clipboard.write.bind(navigator.clipboard);navigator.clipboard.write=()=>Promise.reject(new DOMException('denied','NotAllowedError'));});
  await right();await copy.click();await page.locator('.chart-image-preview[open] img').waitFor();assert.ok(await page.locator('.chart-image-preview a').getAttribute('download'));await page.locator('.chart-image-preview button').click();await page.evaluate(()=>{navigator.clipboard.write=window.originalWrite;});
  await page.locator('#map-variable').selectOption('temperature_850hPa');await page.locator('#map-contours-a').check();await page.waitForFunction(()=>document.querySelector('#panel-label-a').textContent.includes('850 hPa'));
  await page.waitForFunction(()=>window.fixtureLayers.some(l=>l.id.includes('contour-lines')&&Array.isArray(l.paint?.['line-width'])));
  const major=await page.evaluate(()=>window.fixtureLayers.filter(l=>l.id.includes('contour-lines')&&Array.isArray(l.paint?.['line-width'])).at(-1).paint['line-width']);assert.deepEqual(major,['match',['to-number',['get','value']],[-25,-20,-15,-10,-5,0,5,10,15,20,25],1.8,.7]);
  const intervals=await page.evaluate(()=>{const req=window.fixtureRequests.find(r=>r.url.startsWith('om://https://')&&r.url.includes('variable=temperature_850hPa'));return new URL(req.url.replace('om://','')).searchParams.get('intervals').split(',').map(Number);});assert.ok([-25,-15,-5,5,15,25].every(v=>intervals.includes(v)),'Odd 5°C levels are actually requested, not only styled');
  await right();await page.screenshot({path:`review-output/context-menu-${viewport.width}.png`});const box=await menu.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1);await saveFile(`850-temperature-${viewport.width}`);
  await right();await page.evaluate(()=>window.dispatchEvent(new Event('resize')));assert.equal(await menu.isVisible(),false);
  if(viewport.width<650)await page.locator('#mobile-map-settings').click();await page.locator('#compare-maps').check();if(viewport.width<650)await page.locator('#mobile-return-map').click();
  await page.locator('#map-variable-b').selectOption('cloud_precipitation_mslp');await page.waitForFunction(()=>document.querySelector('#panel-label-b').textContent.includes('Cloud, precipitation'));
  await right(page.locator('#map-b .maplibregl-canvas'));await saveFile(`composite-export-${viewport.width}`);
  if(viewport.width<650)await page.locator('#mobile-map-settings').click();
  await page.getByText('Map appearance',{exact:true}).click();
  assert.equal(await page.locator('#map-opacity').inputValue(),'80');
  for(let step=0;step<20;step++)await page.locator('#map-opacity').press('ArrowLeft');
  assert.equal(await page.locator('#map-opacity').inputValue(),'60');
  if(viewport.width<650)await page.locator('#mobile-return-map').click();
  await page.locator(viewport.width<650?'#mobile-briefing':'#open-briefing').click();await page.waitForFunction(()=>document.querySelector('#briefing-preset')&&!document.querySelector('#briefing-preset').disabled);
  await page.locator('#briefing-preset').selectOption('airmass');await page.locator('#briefing-contours').check();await page.locator('#briefing-time').selectOption('0');
  await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
  assert.ok(await page.evaluate(()=>window.fixtureOpacity.some(p=>p.briefing&&p.value===.6)),'Briefing inherits the selected main-map transparency');
  // Verify exported pixels contain the coastline above an opaque weather raster.
  const coastPixel=await page.locator('.briefing-card img').first().evaluate(async img=>{
   await img.decode();const map=window.fixtureChartMap,point=map.project([-3,55]),canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
   const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const x=Math.round(point.x*canvas.width/map.getCanvas().clientWidth),y=Math.round(point.y*canvas.height/map.getCanvas().clientHeight);
   const pixels=ctx.getImageData(x-2,y-2,5,5).data;return Array.from({length:25},(_,i)=>Array.from(pixels.slice(i*4,i*4+3))).some(rgb=>rgb.every(v=>v<60));
  });assert.equal(coastPixel,true,'Dark coastline remains visible above chart weather');
  const bw=await page.evaluate(()=>window.fixtureLayers.filter(l=>l.id.includes('contour-lines')&&Array.isArray(l.paint?.['line-width'])).at(-1).paint['line-width']);assert.equal(bw.at(-2),1.8);assert.equal(bw.at(-1),.7);
  const image=page.locator('.briefing-card img').first();await right(image);await saveFile(`briefing-850-${viewport.width}`);await image.click();await page.locator('#briefing-enlarged[open]').waitFor();await right(page.locator('#briefing-enlarged-image'));assert.equal(await menu.evaluate(e=>e.closest('dialog')?.id),'briefing-enlarged');await saveFile(`enlarged-850-${viewport.width}`);await page.locator('#briefing-enlarged-close').click();
  await page.locator('#briefing-preset').selectOption('jet');await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});assert.deepEqual(await page.locator('#briefing-legend .briefing-band-labels span').allTextContents(),['60','75','90','105','120','135','150','165','180+']);
  const lightImage=await page.locator('.briefing-card img').first().getAttribute('src');
  await page.locator('#briefing-background').selectOption('streets');
  await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
  assert.match(backgrounds.at(-1),/\/liberty$/,'Briefing renderer loads the selected background');
  assert.notEqual(await page.locator('.briefing-card img').first().getAttribute('src'),lightImage,'Background changes generate new charts');
  await page.locator('#briefing-background').selectOption('light');
  await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6);
  assert.equal(await page.locator('.briefing-card img').first().getAttribute('src'),lightImage,'Switching back reuses only the matching background');
  assert.deepEqual(errors,[],`No page errors at ${viewport.width}px`);await context.close();console.log(`Jet/850 hPa styling, left-click, right-click PNG, clipboard and fallback passed at ${viewport.width}px`);
 }
}finally{await browser.close();server.close();}
