// Real, locally converted forecast grids and the bundled OM raster workers.
// Start work/ensemble_preview.py and prepare a scratch 0/3/6/24-hour run first.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const origin=process.env.SNOWLINE_PREVIEW_URL??'http://127.0.0.1:8771';
const errors=[],reports=[];
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
  page.on('console',m=>{if(['error','warning'].includes(m.type())&&!m.text().includes('404'))console.log('BROWSER',m.text());});
  await page.addInitScript(()=>{localStorage.setItem('snowline-terrain','false');localStorage.setItem('snowline-sidebar-collapsed','true');});
  const geo={type:'FeatureCollection',features:[]},style={version:8,sources:{roads:{type:'geojson',data:geo}},layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},{id:'road-lines',source:'roads',type:'line',paint:{'line-color':'#222222'}}]};
  await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(style)}));
  await page.route('**/coastline.geojson',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(geo)}));
  await page.route('**/maps.js*',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile('maps.js','utf8'))+'\nwindow.extraTest={state,panels,settings,fields,concreteURL};'}));
  for(const model of ['snowline_ecmwf_ensemble','snowline_gefs_ensemble']){
   await page.goto(origin+'/maps.html?model='+model+'&time=2026-10-20T00:00:00Z');
   await page.waitForFunction(()=>document.querySelector('#map-variable option[value="precipitation_mean"]'),null,{timeout:60000}).catch(async error=>{console.log('LOAD STATUS',await page.locator('body').innerText());throw error;});
   await page.locator('#map-mslp-a').uncheck({force:true});
   const keys=model.includes('ecmwf')?['precipitation_mean','precipitation_probability_10mm_24h','wind_speed_10m_mean','wind_speed_250hPa_spread','snowfall_water_equivalent_mean']:['precipitation_mean','snow_depth_mean','wind_vector_10m_mean'];
   for(const field of keys){
    console.log('CHECK',viewport.width,model,field);
    await page.locator('#map-variable').selectOption(field);
    await page.waitForFunction(field=>{
     const x=window.extraTest,p=x?.panels.a;
     return x?.state.field===field&&p?.frameCache?.current&&document.querySelector('#map-error-a')?.hidden&&document.querySelector('#panel-label-a')?.textContent.includes(x.fields.find(f=>f.key===field)?.name);
    },field,{timeout:45000}).catch(async error=>{console.log('RENDER STATUS',await page.evaluate(()=>({field:window.extraTest.state.field,panel:document.querySelector('#panel-label-a').textContent,error:document.querySelector('#map-error-a').textContent,hidden:document.querySelector('#map-error-a').hidden,current:!!window.extraTest.panels.a.frameCache?.current,preload:document.querySelector('#preload-status')?.textContent})));throw error;});
    const result=await page.evaluate(()=>({model:window.extraTest.state.model,field:window.extraTest.state.field,times:window.extraTest.state.times,interval:document.querySelector('#legend-interval-a').textContent,label:document.querySelector('#panel-label-a').textContent,note:document.querySelector('#variable-note-a').textContent}));
    if(field.includes('probability')){assert.match(result.interval,/≥10 mm \/ 24 h/);assert.ok(result.times.every(t=>new Date(t).getUTCHours()%12===0));}
    if(field==='precipitation_mean')assert.match(result.interval,/ h · /);
    assert.match(result.note,/Coverage: North Atlantic and Europe/);
    reports.push({viewport:viewport.width,...result});
   }
  }
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:reports,errors}));
}finally{await browser.close();}
