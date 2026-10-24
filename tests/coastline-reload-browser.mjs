import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd(),baseline=process.env.COASTLINE_BASELINE;
const server=createServer(async(req,res)=>{try{
 const name=new URL(req.url,'http://local').pathname.slice(1);
 const body=baseline&&['map-coastline.js','maps.html'].includes(name)?execFileSync('git',['show',baseline+':'+name]):await readFile(resolve(root,name));
 res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.geojson':'application/json'})[extname(name)]??'application/octet-stream'});res.end(body);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
let release;const gate=new Promise(r=>release=r);
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
 const source=await readFile('tests/map-browser.mjs','utf8'),fakeOM=vm.runInNewContext(source.match(/const fakeOM=(`[^]*?`);\r?\nconst geo=/)[1]);
 const geography=await readFile('coastline.geojson','utf8');
 const ref=h=>new Date(Date.UTC(2026,9,20,h)).toISOString();
 const run=h=>({completed:true,reference_time:ref(h),variables:['temperature_2m','pressure_msl'],valid_times:Array.from({length:55},(_,i)=>ref(h+i))});
 let warm=false,coldRequests=0,warmRequests=0;
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{
  window.fixtureDelay=1;
  localStorage.setItem('snowline-map-favourite-v1:audit',JSON.stringify({id:'audit',name:'Audit',updated:Date.now(),layout:{version:1,panels:[{model:'ukmo_uk_deterministic_2km',field:'temperature_2m',followLatest:true,isobars:true,camera:[-3,55,4]}],compare:false,comparisonCount:2,interval:'3',area:'uk',background:'light',terrain:false,roads:false,opacity:.8,speed:700}}));localStorage.setItem('snowline-map-startup-v1','audit');
 });
 await page.route('**/vendor/index.mjs*',r=>r.fulfill({body:fakeOM,contentType:'text/javascript'}));
 await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'white'}}]}}));
 await page.route('**/ensemble-data/**',r=>r.fulfill({status:404,json:{}}));
 await page.route('https://openmeteo.s3.amazonaws.com/**',r=>{
  const u=r.request().url();if(!u.includes('/ukmo_uk_deterministic_2km/'))return r.fulfill({status:404,json:{}});
  const h=u.match(/\/(\d\d)00Z\/meta.json/);return r.fulfill({json:run(h?Number(h[1]):12)});
 });
 await page.route('**/coastline.geojson',async r=>{if(warm){warmRequests++;await gate;}else coldRequests++;return r.fulfill({body:geography,contentType:'application/geo+json'});});
 await page.goto('http://127.0.0.1:'+server.address().port+'/maps.html');
 await page.waitForFunction(()=>document.querySelector('#animation-status')?.textContent.startsWith('Ready'),null,{timeout:20000});
 if(!baseline)await page.waitForFunction(async()=>{const cache=await caches.open('snowline-map-geography-v1');return (await cache.keys()).length===1;});
 warm=true;const start=performance.now();await page.reload();let ready=true;
 await page.waitForFunction(()=>document.querySelector('#animation-status')?.textContent.startsWith('Ready'),null,{timeout:5000}).catch(()=>{ready=false;});
 const result={variant:baseline?'baseline':'candidate',warmReadyWhileNetworkHeld:ready,elapsedMs:Math.round(performance.now()-start),coldRequests,warmRequests,errors};
 assert.equal(ready,!baseline);assert.equal(warmRequests,baseline?1:0);assert.deepEqual(errors,[]);
 release();await page.waitForFunction(()=>document.querySelector('#animation-status')?.textContent.startsWith('Ready'),null,{timeout:15000});
 result.label=await page.locator('#panel-label-a').textContent();
 console.log(JSON.stringify(result));
}finally{release();await browser.close();server.close();}
