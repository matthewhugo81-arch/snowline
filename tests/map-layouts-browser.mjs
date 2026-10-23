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
product.anomaly_reference={dataset:'HadUK-Grid',period:'1991-2020',statistic:'monthly normal of daily minimum/maximum',forecast_window:'24 hours ending 09 UTC'};
for(const k of [...anomalies,...cold]){product.variables.push(k);product.variable_valid_times[k]=[anomalyTime];product.variable_intervals[k]={[anomalyTime]:{hours:24,start:'2026-10-22T09:00:00Z',end:anomalyTime}};}
const sixTimes=Array.from({length:9},(_,i)=>new Date(Date.parse(time)+i*6*3600000).toISOString());
for(const k of six){product.variable_valid_times[k]=sixTimes;product.variable_intervals[k]=Object.fromEntries(sixTimes.map(t=>[t,{hours:6,start:new Date(Date.parse(t)-21600000).toISOString(),end:t}]));}
product.valid_times=[...new Set([...product.valid_times,...sixTimes])].sort();
const snowDay='ens_snow_ge1mm_24h';product.variables.push(snowDay);product.variable_valid_times[snowDay]=[sixTimes[4]];product.variable_intervals[snowDay]={[sixTimes[4]]:{hours:24,start:time,end:sixTimes[4]}};

const errors=[];
async function fixtures(context){
 context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
 await context.addInitScript(()=>{window.fixtureDelay=1;});
 await context.route('**/vendor/index.mjs*',r=>r.fulfill({contentType:'text/javascript',body:fakeOM}));
 await context.route('**/maps.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile('maps.js','utf8'))+'\nwindow.layoutState=state;window.layoutPanels=panels;window.flushLayout=()=>layoutRestore.save();'}));
 await context.route('https://tiles.openfreemap.org/**',r=>r.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'white'}}]}}));
 await context.route('**/coastline.geojson',r=>r.fulfill({json:{type:'FeatureCollection',features:[]}}));
 await context.route('https://openmeteo.s3.amazonaws.com/**',r=>r.fulfill({json:native}));
 await context.route('**/ensemble-data/**',r=>r.fulfill({status:404,json:{error:true}}));
 await context.route('https://raw.githubusercontent.com/**',r=>r.fulfill({json:r.request().url().endsWith('publication.json')?{revision:'a'.repeat(40)}:product}));
}
const ready=page=>page.waitForFunction(()=>window.layoutState&&!document.getElementById('map-variable').disabled&&document.getElementById('animation-status').textContent.startsWith('Ready'),{},{timeout:60000});
const briefingReady=page=>page.waitForFunction(()=>document.querySelector('#briefing-grid .briefing-card[data-ready="true"]')&&!document.querySelector('#briefing-grid .briefing-card:not([data-ready="true"])'),{},{timeout:60000});
const saved=page=>page.waitForFunction(()=>location.search.includes('layout=')&&document.getElementById('layout-notice').textContent.startsWith('Saved automatically'),{},{timeout:10000});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});await fixtures(context);
 const pages=[];
 for(let i=0;i<4;i++){
  const page=await context.newPage();pages.push(page);await page.goto(origin+'/maps.html');await ready(page);
  await page.locator('#map-forecast-interval').selectOption(['3','6','12','native'][i]);await ready(page);
  await page.locator('#layout-restore summary').click();await page.locator('#layout-name').fill('Monitor '+(i+1));await page.locator('#layout-save-name').click();await saved(page);await page.locator('#layout-restore summary').click();
 }
 const p=pages[0];
 await p.evaluate(()=>{document.getElementById('layout-restore').open=true;document.getElementById('layout-name').value='Monitor 1 - typed immediately';});
 await p.waitForTimeout(100);assert.equal(await p.locator('#layout-name').inputValue(),'Monitor 1 - typed immediately','Opening the menu must not overwrite an in-progress name');await p.locator('#layout-save-name').click();await p.locator('#layout-restore summary').click();

 await p.locator('#compare-maps').check();await ready(p);await p.locator('#map-comparison-count').selectOption('3');await ready(p);
 await p.locator('#map-model-b').selectOption('ukmo_uk_ensemble_2km');await ready(p);
 await p.locator('#map-variable-b').selectOption(six[0]);await ready(p);
 await p.locator('#map-variable-c').selectOption('temperature_2m');await ready(p);
 await p.locator('#map-contours-c').check();await p.locator('#toggle-panel-menu-b').click();
 await p.locator('#map-area').selectOption('current');await p.evaluate(()=>window.layoutPanels.a.map.jumpTo({center:[-4,54],zoom:5.3}));
 await p.locator('#toggle-map-sidebar').click();
 await p.waitForTimeout(1000);await p.reload();await ready(p);
 assert.equal(await p.locator('#map-comparison-count').inputValue(),'3');assert.equal(await p.locator('#compare-maps').isChecked(),true);
 assert.equal(await p.locator('#map-model-b').inputValue(),UK);assert.equal(await p.locator('#map-variable-b').inputValue(),six[0]);
 assert.equal(await p.locator('#map-variable-c').inputValue(),'temperature_2m');assert.equal(await p.locator('#map-contours-c').isChecked(),true);
 assert.equal(await p.locator('#toggle-panel-menu-b').getAttribute('aria-expanded'),'false');assert.equal(await p.locator('#toggle-map-sidebar').getAttribute('aria-expanded'),'false');
 assert.ok(Math.abs(await p.evaluate(()=>layoutPanels.a.map.getCenter().lng)+4)<.01);
 assert.ok(Math.abs(await p.evaluate(()=>layoutPanels.a.map.getZoom())-5.3)<.01);
 console.log('Three-panel models, optional product, overlays, camera and collapsed controls survive refresh');
 for(let i=1;i<4;i++){await pages[i].reload();await ready(pages[i]);assert.equal(await pages[i].locator('#map-forecast-interval').inputValue(),['3','6','12','native'][i]);}
 // A deliberately pinned run remains pinned; latest layouts store the base model.
 const pinned=await pages[2].evaluate(()=>{const id=new URL(location.href).searchParams.get('layout'),key='snowline-map-layout-v1:'+id,entry=JSON.parse(localStorage.getItem(key));entry.layout.panels[0].model=window.layoutState.model;entry.layout.panels[0].followLatest=false;localStorage.setItem(key,JSON.stringify(entry));return window.layoutState.model;});
 await pages[2].reload();await ready(pages[2]);assert.equal(await pages[2].evaluate(()=>window.layoutState.model),pinned);
 assert.equal(await pages[2].evaluate(()=>JSON.parse(localStorage.getItem('snowline-map-layout-v1:'+new URL(location.href).searchParams.get('layout'))).layout.panels[0].followLatest),false);
 const b=pages[1];await b.locator('#open-briefing').click();await briefingReady(b);await b.locator('#briefing-count').selectOption('9');await briefingReady(b);await b.locator('#briefing-toggle-controls').click();
 await b.waitForTimeout(800);await b.reload();await briefingReady(b);
 assert.equal(await b.locator('#briefing-count').inputValue(),'9');assert.equal(await b.locator('#briefing-control-section').isHidden(),true);console.log('Nine-panel Briefing survives refresh');
 await p.locator('#layout-restore summary').click();assert.equal(await p.locator('#layout-list li').count(),4);
 const restoreURL=await p.locator('#layout-list .layout-choice').filter({hasText:'Monitor 2'}).getAttribute('href');
 const storage=await context.storageState();const originalId=new URL(p.url()).searchParams.get('layout');
 await p.screenshot({path:'review-output/restore-layout-desktop.png'});
 // A restarted browser has local storage and a restored/bookmarked URL, but no session storage.
 await context.close();const restarted=await browser.newContext({viewport:{width:390,height:844},storageState:storage});await fixtures(restarted);
 const phone=await restarted.newPage();await phone.goto(restoreURL);await briefingReady(phone);
 assert.equal(await phone.locator('#briefing-count').inputValue(),'9');await phone.locator('#layout-restore summary').click();
 const overflow=await phone.locator('.layout-menu').evaluate(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.bottom>innerHeight;});assert.equal(overflow,false);
 await phone.screenshot({path:'review-output/restore-layout-phone.png'});
 await phone.keyboard.press('Escape');assert.equal(await phone.locator('#layout-restore').getAttribute('open'),null);
 // Opening another layout creates an independent tab, without inherited session identity.
 const q=await restarted.newPage();await q.setViewportSize({width:1440,height:900});await q.goto(origin+'/maps.html?layout='+originalId);await ready(q);assert.equal(await q.locator('#map-comparison-count').inputValue(),'3');
 assert.notEqual(new URL(q.url()).searchParams.get('layout'),new URL(phone.url()).searchParams.get('layout'));
 // Duplicating a tab can copy sessionStorage. It must acquire a new slot while the original stays active.
 const qId=new URL(q.url()).searchParams.get('layout'),duplicate=await restarted.newPage();await duplicate.addInitScript(id=>sessionStorage.setItem('snowline-layout-tab',id),qId);await duplicate.goto(q.url());await ready(duplicate);
 assert.notEqual(new URL(duplicate.url()).searchParams.get('layout'),qId);
 assert.ok(await duplicate.evaluate(async()=>{const id=new URL(location.href).searchParams.get('layout');return (await navigator.locks.query()).held.some(lock=>lock.name==='snowline-layout-tab:'+id);}),'The duplicated tab owns its new slot too');
 assert.equal(await q.locator('#map-comparison-count').inputValue(),'3');
 console.log('Four durable layouts, restart, separate tabs and mobile menu passed');
 // A favourite is a durable template; autosaving a working tab cannot alter it.
 await q.locator('#layout-restore summary').click();await q.locator('#layout-name').fill('Daily model comparison');await q.locator('#layout-save-favourite').click();
 const favouriteURL=await q.locator('#layout-favourites .layout-choice').first().getAttribute('href'),favouriteId=new URL(favouriteURL).searchParams.get('favourite');
 const readFavourite=()=>q.evaluate(id=>JSON.parse(localStorage.getItem('snowline-map-favourite-v1:'+id)),favouriteId);
 const template=await readFavourite();assert.equal(template.layout.comparisonCount,3);
 await q.locator('#layout-startup').selectOption(favouriteId);
 await q.locator('#layout-restore summary').click();await q.locator('#map-forecast-interval').selectOption('12');await ready(q);await q.waitForTimeout(650);
 assert.deepEqual(await readFavourite(),template,'Automatic saving must leave the favourite unchanged');
 await q.reload();await ready(q);assert.equal(await q.locator('#map-forecast-interval').inputValue(),'12');
 await q.locator('#layout-restore summary').click();await q.locator('#layout-update-favourite').click();
 assert.equal((await readFavourite()).layout.interval,'12');
 // Renaming a favourite must survive autosaves from other monitor tabs.
 const favouriteRow=q.locator('#layout-favourites li').filter({hasText:'Daily model comparison'});
 await favouriteRow.getByRole('button',{name:'Rename',exact:true}).click();await favouriteRow.getByRole('textbox').fill('Monitor 1 – models');
 await duplicate.locator('#map-forecast-interval').selectOption('6');await ready(duplicate);await duplicate.waitForTimeout(650);
 assert.equal(await favouriteRow.getByRole('textbox').inputValue(),'Monitor 1 – models');await favouriteRow.getByRole('button',{name:'Save name',exact:true}).click();
 assert.equal((await readFavourite()).name,'Monitor 1 – models');
 // A fresh visit starts from the chosen favourite; it receives its own working ID.
 const startPage=await restarted.newPage();await startPage.goto(origin+'/maps.html');await ready(startPage);
 assert.equal(await startPage.locator('#compare-maps').isChecked(),true);assert.equal(await startPage.locator('#map-comparison-count').inputValue(),'3');assert.equal(await startPage.locator('#map-forecast-interval').inputValue(),'12');
 assert.notEqual(new URL(startPage.url()).searchParams.get('layout'),new URL(q.url()).searchParams.get('layout'));
 const explicitPage=await restarted.newPage();await explicitPage.goto(origin+'/maps.html?model='+UK);await ready(explicitPage);
 assert.equal(await explicitPage.locator('#compare-maps').isChecked(),false,'Explicit model links override startup');
 const extraPage=await restarted.newPage();await extraPage.goto(origin+'/maps.html?model='+UK);await ready(extraPage);
 await explicitPage.locator('#layout-restore summary').click();
 assert.equal(await explicitPage.locator('#layout-list li').count(),4);assert.equal(await explicitPage.locator('#layout-favourites .layout-choice').count(),1);
 assert.equal(await explicitPage.evaluate(id=>localStorage.getItem('snowline-map-layout-v1:'+id),qId),null,'The oldest recent tab can be evicted without deleting its favourite');
 // Opening a favourite link still works after its original recent tab was evicted.
 await explicitPage.goto(favouriteURL);await ready(explicitPage);assert.equal(await explicitPage.locator('#map-comparison-count').inputValue(),'3');
 await q.locator('#layout-restore summary').click();await q.locator('#layout-restore summary').click();
 await q.screenshot({path:'review-output/favourite-layout-desktop.png'});
 await phone.locator('#layout-restore summary').click();
 await phone.waitForFunction(id=>document.getElementById('layout-startup').value===id,favouriteId);
 assert.equal(await phone.locator('#layout-startup').inputValue(),favouriteId);
 assert.equal(await phone.locator('.layout-menu').evaluate(e=>e.scrollWidth>e.clientWidth),false,'The menu must not scroll horizontally on a phone');
 await phone.screenshot({path:'review-output/favourite-layout-phone.png'});
 // Removing the chosen favourite also clears startup; working tabs remain usable.
 q.once('dialog',dialog=>dialog.accept());await q.locator('#layout-favourites li').filter({hasText:'Monitor 1 – models'}).getByRole('button',{name:'Remove',exact:true}).click();
 assert.equal(await q.locator('#layout-startup').inputValue(),'');assert.equal(await q.locator('#layout-update-favourite').isHidden(),true);
 await explicitPage.goto(origin+'/maps.html');await ready(explicitPage);assert.equal(await explicitPage.locator('#compare-maps').isChecked(),false);
 assert.deepEqual(errors,[]);console.log('Favourite snapshots, explicit updates, rename, startup precedence, eviction and removal passed');await restarted.close();
 // Upgrade a browser with a named layout from the previous release.
 const upgrade=await browser.newContext({viewport:{width:1440,height:900}});await fixtures(upgrade);
 await upgrade.addInitScript(({entry,origin})=>{if(location.origin===origin&&!localStorage.getItem('upgrade-fixture')){localStorage.setItem('snowline-map-layout-v1:legacy',JSON.stringify({...entry,id:'legacy',name:'Monitor 2 and 3'}));localStorage.setItem('upgrade-fixture','1');}},{entry:template,origin});
 const legacy=await upgrade.newPage();await legacy.goto(origin+'/maps.html?layout=legacy');await ready(legacy);await legacy.locator('#layout-restore summary').click();
 assert.equal(await legacy.locator('#layout-favourites .layout-choice').count(),1);assert.ok((await legacy.locator('#layout-favourites').textContent()).includes('Monitor 2 and 3'));
 await legacy.reload();await ready(legacy);await legacy.locator('#layout-restore summary').click();assert.equal(await legacy.locator('#layout-favourites .layout-choice').count(),1);
 assert.deepEqual(errors,[]);console.log('Existing named layouts migrate once and retain their original restore links');await upgrade.close();
}finally{await browser.close();server.close();}
