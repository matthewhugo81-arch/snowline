// Real page and bundled MapLibre, with delayed synthetic weather transport.
// This checks rendering integration and controls, not live-provider throughput.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+sep))throw Error('Invalid path');const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const fakeOM=`
 const fixtureScale=unit=>({unit,breakpoints:[0,10,20],colors:[[0,0,0,1],[100,100,100,1],[255,255,255,1]]});
 export const defaultOmProtocolSettings={colorScales:{temperature:fixtureScale('°C'),relative:fixtureScale('%'),wind:fixtureScale('m/s')}};
 export const domainOptions=['ncep_gfs013','ncep_gfs025','ukmo_uk_deterministic_2km','ecmwf_ifs'].map(value=>({value,grid:{type:'regular',nx:360,ny:181,latMin:-90,lonMin:-180,dx:1,dy:1}}));
 export const GridFactory={create:config=>({...config,originLat:config.latMin,originLon:config.lonMin,longitudeWrap:true,getInterpolatedValue:values=>values[0]})};
 export const getRanges=()=>[{start:0,end:181},{start:0,end:360}];
 window.fixtureGridReads=[];
 export const getProtocolInstance=()=>({omFileReader:{withReader:async()=>{},readVariable:async(url,variable,ranges,signal)=>{signal?.throwIfAborted();window.fixtureGridReads.push({url,variable});return {values:new Float32Array(360*181).fill(10)};}}});
 export const updateCurrentBounds=()=>{};
 export const getValueFromLatLong=async()=>({value:10});
 export const getColorScale=key=>defaultOmProtocolSettings.colorScales[key]??fixtureScale(key.startsWith('geopotential_height_')?'m':'m/s');
 window.fixtureRequests=[];window.fixturePalettes=[];
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQSznxHwAEOAJKNKHrggAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
 export async function omProtocol(params,controller,settings){
  if(params.type==='json')window.fixturePalettes.push({url:params.url,cloud:settings?.colorScales?.cloud_cover?.colors?.[0],rain:settings?.colorScales?.precipitation?.colors?.[0]});
  window.fixtureRequests.push({url:params.url,type:params.type});
  await new Promise(r=>setTimeout(r,window.fixtureDelay??80));
  if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!params.url.startsWith('om://fixture/'))return {data:{tilejson:'2.2.0',minzoom:0,maxzoom:10,tiles:['om://fixture/'+encodeURIComponent(params.url)+'/{z}/{x}/{y}']}};
  const fault=window.fixtureFault;
  if(fault&&params.type==='image'&&decodeURIComponent(params.url).includes(fault.match)){
   fault.url??=params.url;
   if(fault.url===params.url&&fault.remaining-->0)throw Error('Temporary test transport failure');
  }
  // Match the real OM worker's return type. Byte-only fixtures missed corrupt
  // bitmap persistence and the grossly underestimated in-memory cache size.
  if(params.type==='image'){
   const hour=Number(decodeURIComponent(params.url).match(/T(\\d{2})00\\.om/)?.[1]??0);
   const canvas=new OffscreenCanvas(32,32),context=canvas.getContext('2d');
   context.fillStyle='rgb('+hour*7+',100,180)';context.fillRect(0,0,32,32);
   return {data:canvas.transferToImageBitmap()};
  }
  return {data:new Uint8Array(0).buffer};
 }
`;
const geo={type:'FeatureCollection',features:[]};
const style={version:8,sources:{roads:{type:'geojson',data:geo}},layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},{id:'road-lines',source:'roads',type:'line',paint:{'line-color':'#222222'}}]};
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport,deviceScaleFactor:1});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log('BROWSER',m.text());});
  await page.addInitScript(()=>localStorage.setItem('snowline-terrain','false'));
  await page.addInitScript(()=>{
   const original=window.setInterval;window.fixtureRefreshers=[];
   window.setInterval=(callback,delay,...args)=>{if(delay===60000)window.fixtureRefreshers.push(callback);return original(callback,delay,...args);};
  });
  await page.route('**/vendor/index.mjs*',route=>route.fulfill({contentType:'text/javascript',body:fakeOM}));
  await page.route('**/map-tile-cache.js*',async route=>{
   const code=await readFile(resolve(root,'map-tile-cache.js'),'utf8');
   // Exercise restoration from disk, not only the hot memory cache.
   return route.fulfill({contentType:'text/javascript',body:code.replace('memoryBytes=32*1024*1024','memoryBytes=1024')});
  });
  await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
  await page.route('**/coastline.geojson',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
  const metadata=[];
  let livePhase=0;
  const fixture=(hour,hours)=>({completed:true,reference_time:'2026-10-10T'+String(hour).padStart(2,'0')+':00:00Z',variables:['temperature_2m','relative_humidity_2m','cloud_cover','cloud_cover_high','precipitation','pressure_msl'],valid_times:Array.from({length:hours+1},(_,i)=>new Date(Date.UTC(2026,9,10,hour+i)).toISOString())});
  const ensembleFixture=(hours,step)=>({...fixture(0,hours),variables:['precipitation_probability'],valid_times:fixture(0,hours).valid_times.filter((_,i)=>i%step===0)});
  const ensembleFixtures={ncep_gefs025:ensembleFixture(24,3),ncep_gefs05:ensembleFixture(48,6),ecmwf_ifs025_ensemble:ensembleFixture(30,3)};
  const statisticVariables=['geopotential_height_500hPa','temperature_850hPa','pressure_msl'].flatMap(f=>[f+'_mean',f+'_spread']);
  await page.route('**/ensemble-data/*/latest.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...ensembleFixture(24,3),variables:statisticVariables})}));
  await page.route('https://openmeteo.s3.amazonaws.com/**',route=>{
   const url=route.request().url();metadata.push(url);
   const domain=new URL(url).pathname.split('/')[2],ensemble=ensembleFixtures[domain];
   let gfs=domain==='ncep_gfs013'?{...fixture(0,48),variables:['temperature_2m','snowfall_water_equivalent','cloud_cover','precipitation']}:domain==='ncep_gfs025'?{...fixture(0,48),variables:['pressure_msl','freezing_level_height','temperature_850hPa','relative_humidity_850hPa','geopotential_height_500hPa',...['300','400'].flatMap(level=>['wind_u_component_'+level+'hPa','wind_v_component_'+level+'hPa'])]}:null;
   if(gfs&&livePhase&& !url.endsWith('/latest.json'))gfs={...gfs,...fixture(12,livePhase===1?6:livePhase===2?12:18),variables:gfs.variables,completed:false};
   const ifs=domain==='ecmwf_ifs'?{...fixture(0,48),variables:['pressure_msl','temperature_2m','temperature_2m_max','temperature_2m_min',...['temperature','relative_humidity','geopotential_height','wind_u_component','wind_v_component'].flatMap(kind=>[1000,925,850,700,500,400,300,250,200,100,50,10].map(level=>kind+'_'+level+'hPa'))]}:null;
   const meta=ifs??gfs??(ensemble?(url.endsWith('/latest.json')?ensemble:null):domain==='ukmo_uk_deterministic_2km'?(url.endsWith('/latest.json')?fixture(8,12):url.includes('/0600Z/meta.json')?fixture(6,54):url.includes('/0300Z/meta.json')?fixture(3,120):null):null);
   return route.fulfill({status:meta?200:404,contentType:'application/json',body:JSON.stringify(meta??{error:true})});
  });
  await page.goto(origin+'/maps.html');
  try{
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Valid'),{},{timeout:40000});
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'native');
   assert.equal(await page.locator('#map-forecast-interval').isDisabled(),true,'UKV always retains every supplied hour');
   await page.locator('#map-variable').selectOption('dew_point_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m dew point'));
   assert.ok(await page.evaluate(()=>window.fixtureRequests.some(r=>r.url.includes('variable=dew_point_2m_derived'))),'UKV dew point uses calculated imagery');
   assert.equal(await page.locator('#map-error-a').isVisible(),false);
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature'));
   // Combined field: complete same-time cloud/precipitation/pressure in either panel.
   const composite='cloud_precipitation_mslp';
   assert.equal(await page.locator('#map-variable option[value="'+composite+'"]').count(),1);
   await page.locator('#map-mslp-a').uncheck();
   await page.locator('#map-variable').selectOption(composite);
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Cloud, precipitation & MSLP')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-mslp-a').isChecked(),true);
   assert.equal(await page.locator('#map-mslp-a').isDisabled(),true);
   assert.match(await page.locator('#legend-title-a').textContent(),/cloud.*precipitation/i);
   assert.match(await page.locator('#legend-interval-a').textContent(),/1 h ending/);
   await page.locator('#map-grid-a').check();
   await page.waitForFunction(()=>document.getElementById('grid-note-a').textContent.includes('precipitation · mm water'));
   await page.locator('#map-grid-a').uncheck();
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('Precipitation')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   const palettes=await page.evaluate(()=>window.fixturePalettes);
   assert.ok(palettes.some(p=>p.url.includes('weather_composite=1')&&p.rain?.[3]===0&&p.cloud?.[0]===65),'Composite uses transparent dry band and grayscale cloud');
   assert.ok(palettes.some(p=>!p.url.includes('weather_composite=1')&&p.url.includes('variable=precipitation')&&p.rain?.[3]===1),'Ordinary precipitation stays opaque');
   await page.locator('#map-variable-b').selectOption(composite);
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature')&&document.getElementById('panel-label-b').textContent.includes('Cloud, precipitation & MSLP')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-mslp-a').isChecked(),false,'Leaving composite restores the independent pressure switch');
   assert.equal(await page.locator('#map-mslp-a').isDisabled(),false);
   assert.equal(await page.locator('#map-mslp-b').isDisabled(),true);
   assert.equal(await page.locator('.map-error:visible').count(),0);
   const compositeLabels=await page.locator('.map-panel-label').allTextContents();
   assert.equal(compositeLabels[0].split('Valid ')[1],compositeLabels[1].split('Valid ')[1]);
   const legendLayout=await page.evaluate(()=>{
    const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return {height:r.height,bottom:r.bottom,top:r.top};};
    const legend=document.getElementById('legend-bands-b').closest('.layer-legend').getBoundingClientRect();
    return {legendBottom:legend.bottom,bands:bounds('legend-bands-b'),a:bounds('map-a'),b:bounds('map-b')};
   });
   assert.ok(legendLayout.bands.bottom<=legendLayout.legendBottom,'Both cloud and rainfall scales fit inside the legend');
   if(viewport.width>1050)assert.equal(legendLayout.a.height,legendLayout.b.height,'Comparison imagery stays aligned with a combined legend');
   await page.screenshot({path:'review-output/composite-'+viewport.width+'.png',fullPage:true});
   await page.locator('#map-variable-b').selectOption('precipitation');
   await page.locator('#map-mslp-a').check();
   await page.locator('#compare-maps').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   if(viewport.width>650)assert.equal(await page.locator('#legend-bands-a').evaluate(el=>el.closest('.layer-legend').getBoundingClientRect().height),58,'Ordinary layers retain the compact legend');
   if(process.env.SNOWLINE_COMPOSITE_SMOKE==='1'){console.log(JSON.stringify({viewport,compositeSmokePassed:true}));await page.close();continue;}
   const bitmapRoundTrip=await page.evaluate(async()=>{
    const {ForecastTileCache}=await import('./map-tile-cache.js');
    let calls=0;
    const cache=new ForecastTileCache(async()=>{
     calls++;const canvas=new OffscreenCanvas(512,512),context=canvas.getContext('2d');
     context.fillStyle='rgb(12,80,180)';context.fillRect(0,0,512,512);
     return {data:canvas.transferToImageBitmap()};
    },{memoryBytes:1});cache.setContext('bitmap-regression');
    try{
     const read=()=>cache.protocol({url:'om://fixture/bitmap-round-trip',type:'image'},new AbortController());
     await read();const restored=await read();
     const bitmap=await createImageBitmap(new Blob([restored.data],{type:'image/png'}));
     const canvas=new OffscreenCanvas(1,1),context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();
     return {calls,rgba:[...context.getImageData(0,0,1,1).data]};
    }finally{cache.release();}
   });
   assert.deepEqual(bitmapRoundTrip,{calls:1,rgba:[12,80,180,255]},'Native bitmaps survive disk eviction with exact pixels and no rerender');
   let firstHour=6;
   const selectTime=async value=>{
    await page.locator('#map-time').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
    await page.waitForFunction(hour=>document.getElementById('panel-label-a').textContent.split('Valid ')[1]?.includes(String(hour).padStart(2,'0')+':00'),value+firstHour);
   };
   // ICU versions differ on the comma after the weekday; the time must match.
   const bothAt=time=>page.waitForFunction(time=>[...document.querySelectorAll('.map-panel-label')].every(el=>el.textContent.split('Valid ')[1]?.replaceAll(',','')===time.replaceAll(',','')),time);
   await selectTime(0);
   await page.locator('#play-map').click();
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.split('Valid ')[1]?.includes('07:00'));
   await page.locator('#play-map').click();
   const paused=await page.locator('#panel-label-a').textContent();await page.waitForTimeout(1000);
   assert.equal(await page.locator('#panel-label-a').textContent(),paused,'Pause must stop late commits');
   await selectTime(2);await selectTime(1);await selectTime(2);
   assert.match(await page.locator('#panel-label-a').textContent(),/0600Z/);
   await page.locator('#map-variable').selectOption('precipitation');
   firstHour=7;
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Precipitation'));
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('Valid'));
   await selectTime(0);
   for(const value of [1,2,3]){
    await selectTime(value);
    const labels=await page.locator('.map-panel-label').allTextContents();
    assert.equal(labels[0].split('Valid ')[1],labels[1].split('Valid ')[1],'Comparison panels commit together');
   }
   // The reported cloud/rain comparison must recover a failed selected tile,
   // including exhaustion of tile retries, without a manual click or wrong time.
   await page.evaluate(()=>window.fixtureFault={match:'variable=cloud_cover',remaining:3});
   await page.locator('#map-variable').selectOption('cloud_cover');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Total cloud cover')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.ok(await page.evaluate(()=>window.fixtureFault.remaining<=0));
   assert.equal(await page.locator('.map-error:visible').count(),0,'A recovered frame has no stale error banner');
   const recovered=await page.locator('.map-panel-label').allTextContents();
   assert.equal(recovered[0].split('Valid ')[1],recovered[1].split('Valid ')[1]);
   await page.evaluate(()=>window.fixtureFault=null);
   // Rapid jumps while background warming is unfinished cannot commit an old request.
   await page.locator('#map-time').evaluate(el=>{for(const value of ['20','40','6']){el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}});
   await bothAt('Sat 10 Oct, 13:00 UTC');
   assert.equal(await page.locator('.map-error:visible').count(),0);
   // After a genuinely failed selected time, Retry must display that original
   // time and clear both banners, not merely warm files behind the old image.
   await page.evaluate(()=>window.fixtureFault={match:'2026-10-11T0300.om?variable=cloud_cover_high',remaining:100});
   await page.locator('#map-variable').selectOption('cloud_cover_high');
   await page.locator('#map-time').evaluate(el=>{el.value='20';el.dispatchEvent(new Event('change',{bubbles:true}));});
   if(viewport.width<=650)await page.locator('#mobile-map-settings').click();
   await page.locator('#retry-preload').filter({hasText:'Retry selected frame'}).waitFor({state:'visible'});
   assert.equal(await page.locator('.map-error:visible').count(),2);
   await page.evaluate(()=>window.fixtureFault=null);
   await page.locator('#retry-preload').click();
   await bothAt('Sun 11 Oct, 03:00 UTC');
   assert.equal(await page.locator('.map-error:visible').count(),0);
   if(viewport.width<=650)await page.locator('#mobile-return-map').click();
   await page.locator('#map-variable').selectOption('precipitation');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('Precipitation'));
   // Dragging during playback preserves the requested slider position and pauses.
   await page.locator('#play-map').click();
   await page.locator('#map-time').evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
   assert.equal(await page.locator('#map-time').inputValue(),'5');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'false');
   await selectTime(5);
   // Latest.json is 0800Z (nowcast), but the default must select 0600Z main.
   const main='ukmo_uk_deterministic_2km',nowcast=main+'_nowcast';
   assert.equal(await page.locator('#map-model').inputValue(),main);
   assert.match(await page.locator('#panel-label-a').textContent(),/0600Z/);
   assert.equal(metadata.some(url=>url.includes('/0300Z/')),true,'Verify precisely one previous completed main cycle');
   assert.deepEqual(await page.locator('#map-model option').evaluateAll(os=>os.filter(o=>o.value.startsWith('ukmo_uk_deterministic_2km')).map(o=>o.value)),[main,main+'_previous']);
   assert.equal(await page.locator('#map-model-b option[value="'+nowcast+'"]').count(),0);
   await page.locator('#map-model-b').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('0600Z'));
   // Playback must wrap both panels together and remain active after the final hour.
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-model-b').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('map-time').max==='53'&&document.getElementById('panel-label-b').textContent.includes('0600Z'));
   await page.locator('#map-time').evaluate(el=>{el.value='52';el.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('play-map').click();});
   await bothAt('Mon 12 Oct, 11:00 UTC');
   await bothAt('Mon 12 Oct, 12:00 UTC');
   await bothAt('Sat 10 Oct, 07:00 UTC');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'true','Loop restart must not reset Play');
   await bothAt('Sat 10 Oct, 08:00 UTC');
   await page.locator('#play-map').click();
   const loopPaused=await page.locator('.map-panel-label').allTextContents();await page.waitForTimeout(1000);
   assert.deepEqual(await page.locator('.map-panel-label').allTextContents(),loopPaused,'Pause still stops after wrapping');
   // Adding initialization back in panel B must also reindex panel A's images.
   await page.locator('#map-variable').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('2 m air temperature'));
   await selectTime(0);
   const initialTemperatureRequests=()=>page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&r.url.includes('/2026-10-10T0600.om?variable=temperature_2m&')).length);
   await page.locator('#map-variable-b').selectOption('temperature_2m');
   await page.waitForFunction(()=>document.getElementById('map-time').max==='54');
   firstHour=6;await selectTime(0);
   await bothAt('Sat 10 Oct, 06:00 UTC');
   assert.ok(await initialTemperatureRequests()>=1,'The initialization image is available; cached data is shared across panels');
   const invalidIntervals=await page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&r.url.includes('variable=precipitation&')&&/\/(\d{4})Z\/2026-10-10T\1\.om/.test(r.url)));
   assert.deepEqual(invalidIntervals,[],'Do not request precipitation at initialization');
   // Removed menu products must also stop their metadata polling. Existing
   // mean/spread layer, buffering and comparison tests continue below.
   const ensembleOptions=await page.locator('#map-model optgroup[label="Ensemble models"] option').evaluateAll(os=>os.map(o=>o.value));
   for(const id of Object.keys(ensembleFixtures))assert.equal(ensembleOptions.includes(id),false);
   assert.ok(ensembleOptions.includes('ncep_hgefs025_ensemble_mean'));
   assert.ok(ensembleOptions.includes('snowline_gefs_ensemble'));
   assert.ok(ensembleOptions.includes('snowline_ecmwf_ensemble'));
   assert.equal(metadata.some(url=>/\/(ncep_gefs025|ncep_gefs05|ecmwf_ifs025_ensemble)\//.test(url)),false,'Removed feeds are not polled');
   await page.locator('#compare-maps').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-model').selectOption('snowline_gefs_ensemble');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('500 hPa height'));
   assert.equal(await page.locator('#map-variable option').count(),6);
   assert.equal(await page.locator('#map-mslp-a').isDisabled(),false);
   await page.locator('#compare-maps').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('#map-model-b').selectOption('snowline_ecmwf_ensemble');
   await page.waitForFunction(()=>document.getElementById('map-variable-b').options.length===6&&!document.getElementById('map-variable-b').disabled);
   for(const field of statisticVariables){
    await page.locator('#map-variable-b').selectOption(field);
    await page.waitForFunction(field=>document.getElementById('panel-label-b').textContent.includes(field.endsWith('_spread')?'spread (SD)':'ensemble mean')&&document.getElementById('map-variable-b').value===field,field);
    assert.equal(await page.locator('#legend-title-b').textContent(),field.startsWith('temperature')?'\u00b0C':field.startsWith('pressure')?'hPa':'m');
   }
   await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:60000});
   assert.equal(await page.locator('#preload-status').getAttribute('data-loaded'),'18');
   await page.locator('#map-time').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Sun 11 Oct, 00:00 UTC');
   await page.locator('#play-map').click();
   await bothAt('Sat 10 Oct, 00:00 UTC');
   await page.locator('#play-map').click();
   // Independent regions/zooms, GFS surface + companion grids and a pending
   // selection during a move must all use the new view, without false failures.
   await page.locator('#map-model').selectOption('gfs_global');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('GFS global'));
   await page.locator('#map-model-b').selectOption('gfs_global');
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('GFS global'));
   await page.locator('#map-variable').selectOption('wind_speed_300hPa');
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('300 hPa wind'));
   assert.equal(await page.locator('#legend-title-a').textContent(),'mph');
   assert.deepEqual(await page.locator('#legend-bands-a span').allTextContents(),['60','75','90','105','120','135','150','165','180+']);
   assert.equal(await page.locator('#legend-bands-a > div').first().getAttribute('aria-label'),'60–<75 mph');
   assert.ok(await page.evaluate(()=>window.fixtureRequests.some(r=>r.url.includes('variable=wind_u_component_300hPa')&&r.url.includes('color_blend=false'))),'Jet shading requests discrete bands on the companion wind grid');
   await page.locator('#map-variable').selectOption('snowfall_water_equivalent');
   await page.locator('#map-variable-b').selectOption('freezing_level_height');
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('Freezing level')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'3');
   assert.equal(await page.locator('#map-forecast-interval').isDisabled(),false);
   assert.equal(await page.locator('#map-time').getAttribute('max'),'15','Default loads 16 three-hour steps instead of 48 hourly steps');
   assert.equal(await page.locator('#legend-interval-a').textContent(),'1 h ending at valid time','Viewing interval must not alter snow accumulation');
   await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:60000});
   assert.equal(await page.locator('#preload-status').getAttribute('data-loaded'),'32');
   const defaultGFSHours=await page.evaluate(()=>window.fixtureRequests.filter(r=>r.url.startsWith('om://https://')&&/\/ncep_gfs0(13|25)\//.test(r.url)).map(r=>Number(r.url.match(/T(\d{2})00\.om/)?.[1])));
   assert.ok(defaultGFSHours.length>0);
   assert.ok(defaultGFSHours.every(hour=>Number.isInteger(hour)&&hour%3===0),'Hourly gaps are not downloaded in the background');
   await page.locator('#map-time').evaluate(el=>{el.value='14';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Sun 11 Oct, 21:00 UTC');
   await page.locator('#play-map').click();
   await bothAt('Mon 12 Oct, 00:00 UTC');
   await bothAt('Sat 10 Oct, 03:00 UTC');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'true');
   // Changing the interval during playback cancels the old sequence. The same
   // setting controls steps, slider, loop and the complete background queue.
   const setInterval=async value=>{
    if(viewport.width<=650)await page.locator('#mobile-map-settings').click();
    await page.locator('#map-forecast-interval').selectOption(value);
    if(viewport.width<=650)await page.locator('#mobile-return-map').click();
    await page.waitForFunction(()=>document.getElementById('animation-status').textContent.startsWith('Ready'));
   };
   await setInterval('6');
   assert.equal(await page.locator('#play-map').getAttribute('aria-pressed'),'false');
   assert.equal(await page.locator('#map-time').getAttribute('max'),'7');
   await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:60000});
   assert.equal(await page.locator('#preload-status').getAttribute('data-loaded'),'16');
   assert.equal(await page.locator('#legend-interval-a').textContent(),'1 h ending at valid time');
   // Adding a regional panel restores all common native hours; returning to
   // globals remembers the chosen six-hour setting.
   await page.locator('#map-model-b').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('UKV')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'native');
   assert.equal(await page.locator('#map-forecast-interval').isDisabled(),true);
   assert.equal(await page.locator('#map-time').getAttribute('max'),'42','Mixed comparison preserves every common hourly step');
   await page.locator('#map-model-b').selectOption('gfs_global');
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('GFS global')&&document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.equal(await page.locator('#map-forecast-interval').inputValue(),'6');
   await page.locator('#map-variable-b').selectOption('freezing_level_height');
   await setInterval('native');
   assert.equal(await page.locator('#map-time').getAttribute('max'),'47');
   await page.locator('#map-a .maplibregl-ctrl-zoom-out').click();
   await page.locator('#map-b .maplibregl-ctrl-zoom-in').click();
   await page.evaluate(()=>window.fixtureDelay=180);
   await page.locator('#map-a canvas.maplibregl-canvas').press('ArrowRight');
   await page.locator('#map-time').evaluate(el=>{el.value='30';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await bothAt('Sun 11 Oct, 07:00 UTC');
   await page.waitForFunction(()=>document.getElementById('animation-status').textContent.startsWith('Ready'));
   await page.evaluate(()=>window.fixtureDelay=80);
   assert.equal(await page.locator('.map-error:visible').count(),0);
   assert.notEqual(await page.locator('#zoom-a').textContent(),await page.locator('#zoom-b').textContent());
   await page.waitForFunction(()=>document.getElementById('preload-status').dataset.complete==='true',{},{timeout:60000});
   const cachedGFSRequests=await page.evaluate(()=>window.fixtureRequests.length);
   for(const [index,time]of [[0,'Sat 10 Oct, 01:00 UTC'],[47,'Mon 12 Oct, 00:00 UTC'],[16,'Sat 10 Oct, 17:00 UTC']]){
    await page.locator('#map-time').evaluate((el,index)=>{el.value=index;el.dispatchEvent(new Event('change',{bubbles:true}));},String(index));
    await bothAt(time);assert.equal(await page.locator('.map-error:visible').count(),0);
   }
   assert.equal(await page.evaluate(()=>window.fixtureRequests.length),cachedGFSRequests,'GFS bitmap images and overlays restore from disk for either area');
   // Briefing uses six static, complete composite images and one renderer.
   // Returning must retain the exact interactive comparison selection.
   const originalSelection=await page.evaluate(()=>['map-model','map-variable','map-model-b','map-variable-b','map-time'].map(id=>document.getElementById(id).value));
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid [data-ready="true"]').length===6,{},{timeout:60000});
   assert.equal(await page.locator('#briefing-model').inputValue(),'gfs_global');
   await page.locator('#briefing-preset').selectOption('weather');
   await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid [data-ready="true"]').length===6,{},{timeout:60000});
   await page.waitForFunction(()=>document.querySelector('#briefing-model option:checked').textContent.includes('00Z'));
   assert.equal(await page.locator('#briefing-model option:checked').textContent(),await page.locator('#map-model option:checked').textContent());
   assert.deepEqual(await page.locator('#briefing-model optgroup').evaluateAll(groups=>groups.map(g=>g.label)),['Short-term models','Medium-term models','Ensemble models']);
   assert.equal(await page.locator('#briefing-area').inputValue(),'uk');
   assert.equal(await page.locator('#briefing-grid canvas').count(),0);
   assert.equal(await page.locator('.briefing-renderer canvas').count(),1);
   const pixels=await page.locator('#briefing-grid img').first().evaluate(async image=>{
    await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d');context.drawImage(image,0,0,1,1);return {width:image.naturalWidth,height:image.naturalHeight,pixel:[...context.getImageData(0,0,1,1).data]};
   });
   assert.ok(pixels.width>=960);assert.equal(pixels.pixel[3],255);assert.ok(pixels.pixel.slice(0,3).some(value=>value<240),'Snapshot includes rendered weather, not a blank canvas');
   assert.equal(pixels.width,pixels.height,'UK chart is rendered square, not cropped or stretched by CSS');
   const chartBox=await page.locator('.briefing-chart').first().boundingBox();
   assert.ok(Math.abs(chartBox.width-chartBox.height)<1,'UK card retains a square view at every screen size');
   await page.locator('#briefing-interval').selectOption('3');
   await page.locator('#briefing-time').selectOption('0');
   await page.waitForFunction(()=>document.getElementById('briefing-status').textContent==='6/6 charts ready · 6/6 next charts prepared',{},{timeout:60000});
   const firstBriefingTimes=await page.locator('.briefing-card').evaluateAll(cards=>cards.map(card=>card.dataset.time));
   assert.deepEqual(firstBriefingTimes,[3,6,9,12,15,18].map(hour=>new Date(Date.UTC(2026,9,10,hour)).toISOString()));
   const chartPixels=await page.locator('.briefing-card').evaluateAll(async cards=>Promise.all(cards.map(async card=>{
    const image=card.querySelector('img');await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d');context.drawImage(image,0,0,1,1);return {hour:new Date(card.dataset.time).getUTCHours(),red:context.getImageData(0,0,1,1).data[0]};
   })));
   for(const {hour,red}of chartPixels)assert.ok(Math.abs(red-hour*7)<3,'Each snapshot contains the pixels for its labelled valid time');
   assert.match(await page.locator('.briefing-card>p').first().textContent(),/1 h precipitation/);
   await page.locator('.briefing-chart').first().click();
   assert.equal(await page.locator('#briefing-enlarged').evaluate(dialog=>dialog.open),true);
   const enlargedBox=await page.locator('#briefing-enlarged-image').boundingBox();
   assert.ok(Math.abs(enlargedBox.width-enlargedBox.height)<1,'Enlarged UK chart reserves its square shape before decoding');
   await page.locator('#briefing-enlarged-image').evaluate(image=>image.decode());
   const decodedBox=await page.locator('#briefing-enlarged-image').boundingBox();
   assert.ok(Math.abs(decodedBox.width-decodedBox.height)<1,'Enlarged UK chart stays square after decoding');
   await page.locator('#briefing-enlarged-close').click();
   assert.equal(await page.locator('#briefing-contours').isChecked(),false);
   assert.equal(await page.locator('#briefing-grid-values').isChecked(),false);
   const plainImage=await page.locator('#briefing-grid img').first().getAttribute('src');
   await page.locator('#briefing-contours').check();
   await page.locator('#briefing-grid-values').check();
   await page.waitForFunction(()=>document.getElementById('briefing-status').textContent==='6/6 charts ready · 6/6 next charts prepared',{},{timeout:60000});
   assert.notEqual(await page.locator('#briefing-grid img').first().getAttribute('src'),plainImage,'Enabling overlays renders a distinct image');
   assert.match(await page.locator('#briefing-overlay-note').textContent(),/cloud cover.*%/i);
   const preparedImages=await page.locator('#briefing-grid img').evaluateAll(images=>images.map(image=>image.src));
   const preparedRequests=await page.evaluate(()=>window.fixtureRequests.length);
   const expandedGridTop=await page.locator('#briefing-grid').evaluate(grid=>grid.getBoundingClientRect().top);
   await page.getByRole('button',{name:'Hide controls',exact:true}).click();
   assert.equal(await page.locator('#briefing-control-section').isVisible(),false);
   assert.equal(await page.locator('#briefing-toggle-controls').getAttribute('aria-expanded'),'false');
   assert.equal(await page.locator('#briefing-next').isVisible(),true);
   assert.ok(await page.locator('#briefing-grid').evaluate(grid=>grid.getBoundingClientRect().top)<expandedGridTop,'Hiding controls gives the charts more viewing space');
   await page.getByRole('button',{name:'Show controls',exact:true}).click();
   assert.equal(await page.locator('#briefing-control-section').isVisible(),true);
   assert.equal(await page.locator('#briefing-contours').isChecked(),true);
   assert.equal(await page.locator('#briefing-grid-values').isChecked(),true);
   assert.deepEqual(await page.locator('#briefing-grid img').evaluateAll(images=>images.map(image=>image.src)),preparedImages,'Collapsing controls retains prepared imagery');
   assert.equal(await page.evaluate(()=>window.fixtureRequests.length),preparedRequests,'Toggling controls does not fetch or redraw the charts');
   const gridReads=await page.evaluate(()=>window.fixtureGridReads);
   assert.ok(gridReads.length>=12);assert.ok(gridReads.every(r=>r.variable==='cloud_cover'));
   assert.ok(await page.evaluate(()=>window.fixtureRequests.some(r=>r.type==='arrayBuffer'&&decodeURIComponent(r.url).includes('variable=cloud_cover'))),'Cloud contours need the correct vector field');
   await page.locator('.briefing-chart').first().click();
   assert.equal(await page.locator('#briefing-enlarged-image').getAttribute('src'),await page.locator('#briefing-grid img').first().getAttribute('src'),'Enlargement retains both overlays');
   await page.locator('#briefing-enlarged-close').click();
   await page.locator('#briefing-contours').uncheck();
   await page.locator('#briefing-grid-values').uncheck();
   await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid [data-ready="true"]').length===6);
   assert.equal(await page.locator('#briefing-grid img').first().getAttribute('src'),plainImage,'Turning overlays off restores the correct cached plain charts');
   await page.locator('#briefing-next').click();
   assert.equal(await page.locator('.briefing-card[data-ready="true"]').count(),6,'Next prepared page is displayed immediately from image cache');
   await page.locator('#briefing-previous').click();
   assert.deepEqual(await page.locator('.briefing-card').evaluateAll(cards=>cards.map(card=>card.dataset.time)),firstBriefingTimes);
   await page.evaluate(()=>window.fixtureFault={match:'variable=cloud_cover',remaining:100});
   await page.locator('#briefing-area').selectOption('europe');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-failed="true"]').length>0,{},{timeout:60000});
   await page.evaluate(()=>window.fixtureFault=null);
   await page.locator('#briefing-retry').click();
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
   assert.equal(await page.locator('.briefing-card[data-failed="true"]').count(),0,'Retry recovers missing charts without stale error labels');
   const wideShape=await page.locator('#briefing-grid img').first().evaluate(async image=>{await image.decode();return image.naturalWidth/image.naturalHeight;});
   assert.ok(Math.abs(wideShape-960/660)<.001,'Europe retains its wider framing');
   await page.locator('#briefing-area').selectOption('uk');
   assert.equal(await page.locator('.briefing-card[data-ready="true"]').count(),6,'Returning to UK reuses the square chart cache');
   await page.locator('#briefing-preset').selectOption('airmass');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
   assert.match(await page.locator('#briefing-note').textContent(),/not theta-w/);
   for(const [preset,variable] of [['theta-w','wet_bulb_potential_temperature_850hPa'],['vorticity-300','relative_vorticity_300hPa'],['vorticity-400','relative_vorticity_400hPa']]){
    await page.locator('#briefing-preset').selectOption(preset);
    await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
    assert.ok(await page.evaluate(variable=>window.fixtureRequests.some(request=>request.url.includes('variable='+variable+'_derived')),variable),'Briefing requests calculated '+variable+' grids');
    assert.equal(await page.locator('.briefing-card[data-failed="true"]').count(),0);
   }
   await page.locator('#briefing-preset').selectOption('jet');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===6,{},{timeout:60000});
   assert.match(await page.locator('#briefing-legend').textContent(),/mph/);
   assert.match(await page.locator('#briefing-legend').textContent(),/180\+/);
   assert.match(await page.locator('#briefing-overlay-note').textContent(),/mph/);
   assert.equal(await page.locator('#briefing-legend .briefing-band-labels span').count(),9);
   assert.ok(await page.evaluate(()=>window.fixtureRequests.some(r=>r.type==='arrayBuffer'&&decodeURIComponent(r.url).includes('variable=wind_u_component_300hPa')&&decodeURIComponent(r.url).includes('arrow_profile=jet'))),'Briefing uses the wind component pair and jet arrow profile');
   await page.locator('#briefing-preset').selectOption('upper');
   await page.locator('#briefing-count').selectOption('9');
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===9,{},{timeout:60000});
   await page.locator('#briefing-area').selectOption('atlantic');
   await page.locator('#briefing-model').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('briefing-run').textContent.includes('UKV')&&document.querySelectorAll('.briefing-card[data-ready="true"]').length===9,{},{timeout:60000});
   assert.equal(await page.locator('#briefing-interval').inputValue(),'native');
   assert.equal(await page.locator('#briefing-interval').isDisabled(),true);
   const ukvChoices=await page.locator('#briefing-preset option').evaluateAll(options=>options.map(option=>option.value));
   for(const key of ['weather','temperature','dew-point','cloud_cover','relative_humidity_2m','precipitation','precipitation_total_48h'])assert.ok(ukvChoices.includes(key),'Full UKV catalogue includes '+key);
   assert.ok(!ukvChoices.includes('theta-w'),'Unsupported diagnostics remain unavailable');
   for(const field of ['cloud_cover','precipitation']){
    await page.locator('#briefing-preset').selectOption(field);
    await page.waitForFunction(()=>document.querySelectorAll('#briefing-grid .briefing-card[data-ready="true"]').length===9,{},{timeout:60000});
    const palettes=await page.evaluate(()=>window.fixturePalettes.filter(p=>p.url.includes('briefing_style=20261013-catalogue-field')));
    assert.ok(palettes.length>0);
    assert.deepEqual(palettes.at(-1).cloud,[38,60,85,1],'Standalone cloud keeps the main map palette');
    assert.deepEqual(palettes.at(-1).rain,[255,255,255,1],'Standalone precipitation keeps its opaque dry band');
    if(field==='precipitation')assert.match(await page.locator('#briefing-grid .briefing-card>p').first().textContent(),/1 h precipitation/);
   }
   for(const selectedModel of [main]){
    await page.evaluate(()=>{window.fixtureRequests=[];window.fixtureGridReads=[];});
    await page.locator('#briefing-model').selectOption(selectedModel);
    await page.waitForFunction(()=>!document.getElementById('briefing-preset').disabled);
    await page.locator('#briefing-time').selectOption('0');
    await page.locator('#briefing-contours').check();
    await page.locator('#briefing-grid-values').check();
    for(const [preset,variable] of [['temperature','temperature_2m'],['dew-point','dew_point_2m_derived']]){
     await page.locator('#briefing-preset').selectOption(preset);
     await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length===9,{},{timeout:60000});
     assert.match(await page.locator('#briefing-legend').textContent(),/°C/);
     assert.match(await page.locator('#briefing-overlay-note').textContent(),/°C/);
     assert.equal(await page.locator('.briefing-card[data-failed="true"]').count(),0);
     assert.ok(await page.evaluate(variable=>window.fixtureRequests.some(r=>decodeURIComponent(r.url).includes('variable='+variable)),variable),'UKV briefing uses '+variable);
     assert.ok(await page.evaluate(variable=>window.fixtureGridReads.some(r=>r.variable===variable),variable),'UKV briefing grid labels use the same '+variable);
    }
   }
   await page.locator('#briefing-close').click();
   await page.waitForFunction(()=>document.getElementById('animation-status').textContent.startsWith('Ready'));
   assert.deepEqual(await page.evaluate(()=>['map-model','map-variable','map-model-b','map-variable-b','map-time'].map(id=>document.getElementById(id).value)),originalSelection);
   assert.equal(await page.locator('.briefing-renderer').count(),0,'Briefing renderer is released on return');
   if(viewport.width<=650){
    await page.locator('#mobile-expand-map').click();
    assert.equal(await page.locator('#expanded-map').evaluate(dialog=>dialog.open),true);
   }
   // Close during preparation, then reopen: old jobs must not commit or hang.
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   assert.equal(await page.locator('#expanded-map').evaluate(dialog=>dialog.open),false,'Briefing leaves the expanded-map dialog');
   await page.locator('#briefing-close').click();
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length>0,{},{timeout:60000});
   await page.locator('#briefing-close').click();
   // Provider latest.json stays at the old complete run. The live pointer has
   // an earlier horizon, and grows while the user keeps this page open.
   livePhase=1;
   await page.evaluate(()=>Promise.all(window.fixtureRefreshers.map(refresh=>refresh())));
   await page.waitForFunction(()=>document.getElementById('panel-label-a').textContent.includes('1200Z'));
   assert.match(await page.locator('#run-update-status').textContent(),/Updating/);
   assert.equal(await page.locator('#map-time').getAttribute('max'),'5');
   const selectedValid=await page.locator('#map-time-label').textContent();
   livePhase=2;
   await page.evaluate(()=>Promise.all(window.fixtureRefreshers.map(refresh=>refresh())));
   assert.equal(await page.locator('#map-time').getAttribute('max'),'11','New forecast hours arrive without a page reload');
   assert.equal(await page.locator('#map-time-label').textContent(),selectedValid,'Refreshing retains the selected valid time');
   assert.equal(await page.locator('.map-error:visible').count(),0);
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.getElementById('briefing-run').textContent.includes('1200Z'));
   assert.match(await page.locator('#briefing-run').textContent(),/Updating/);
   const briefingHours=await page.locator('#briefing-time option').count();
   livePhase=3;
   await page.evaluate(()=>Promise.all(window.fixtureRefreshers.map(refresh=>refresh())));
   assert.ok(await page.locator('#briefing-time option').count()>briefingHours,'Briefing also appends newly published forecast hours');
   await page.locator('#briefing-close').click();
   await page.locator('#map-model').selectOption('ecmwf_ifs');
   await page.waitForFunction(()=>document.querySelector('#map-variable option[value="temperature_2m_max"]'));
   const pressureKeys=await page.locator('#map-variable option').evaluateAll(options=>options.map(o=>o.value).filter(k=>/^(temperature|wind_speed|relative_humidity|geopotential_height)_\d+hPa$/.test(k)));
   assert.deepEqual(pressureKeys,['temperature_1000hPa','temperature_850hPa','temperature_500hPa','temperature_250hPa','wind_speed_1000hPa','wind_speed_500hPa','wind_speed_300hPa','wind_speed_200hPa','relative_humidity_1000hPa','relative_humidity_700hPa','relative_humidity_300hPa','geopotential_height_500hPa','geopotential_height_300hPa','geopotential_height_200hPa']);
   for(const statistic of ['max','min']){
    await page.locator('#map-variable').selectOption('temperature_2m_'+statistic);
    await page.waitForFunction(word=>document.getElementById('panel-label-a').textContent.includes(word),statistic==='max'?'maximum':'minimum');
    assert.match(await page.locator('#legend-interval-a').textContent(),/Native period/);
    assert.ok(await page.evaluate(key=>window.fixtureRequests.some(r=>r.url.includes('variable='+key)),'temperature_2m_'+statistic));
   }
   await page.locator(viewport.width<=650?'#mobile-briefing':'#open-briefing').click();
   await page.waitForFunction(()=>document.querySelector('#briefing-preset option[value="temperature-max"]'));
   assert.equal(await page.locator('#briefing-preset').inputValue(),'temperature-min','Chart selection carries from main maps to briefing');
   for(const statistic of ['max','min']){
    await page.locator('#briefing-preset').selectOption('temperature-'+statistic);
    await page.waitForFunction(()=>document.querySelectorAll('.briefing-card[data-ready="true"]').length>=6,{},{timeout:60000});
    assert.match(await page.locator('#briefing-note').textContent(),/not a daily extreme/);
    assert.match(await page.locator('.briefing-card p').first().textContent(),/duration unspecified/);
   }
   assert.equal(await page.locator('#briefing-model option:checked').textContent(),await page.locator('#map-model option:checked').textContent());
   await page.locator('#briefing-close').click();
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({viewport,passed:true,transportRequests:await page.evaluate(()=>window.fixtureRequests.length)}));
  }catch(error){
   console.log('DIAGNOSTICS',JSON.stringify(await page.evaluate(()=>({labels:[...document.querySelectorAll('.map-panel-label')].map(e=>e.textContent),errors:[...document.querySelectorAll('.map-error')].map(e=>e.textContent),status:document.getElementById('animation-status').textContent,requests:window.fixtureRequests?.slice(-5).map(r=>({type:r.type,url:r.url.slice(0,120)}))}))));
   throw error;
  }finally{await page.close();}
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
