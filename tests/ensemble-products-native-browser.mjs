// Optional local smoke check against actual generated OM files.
// Usage: PRODUCT_RENDER_CASES=/absolute/cases.json node tests/ensemble-products-native-browser.mjs
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const cases=JSON.parse(await readFile(process.env.PRODUCT_RENDER_CASES,'utf8'));
const root=process.cwd(),types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!p.startsWith(root+sep))throw Error();res.writeHead(200,{'Content-Type':types[extname(p)]??'application/octet-stream'});res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/map-credits.html');
 let requests=0,bytes=0;
 await page.route('https://raw.githubusercontent.com/**',async r=>{
  const row=cases.find(c=>r.request().url().includes('/'+c.domain+'/'));assert.ok(row);
  const body=await readFile(row.file),range=r.request().headers().range;
  const match=range?.match(/bytes=(\d+)-(\d*)/);const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),body.length-1):body.length-1;
  requests++;bytes+=end-start+1;
  await r.fulfill({status:match?206:200,headers:{'Content-Type':'image/png','Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Length,Content-Range','Content-Length':String(end-start+1),...(match?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})},body:body.subarray(start,end+1)});
 });
 for(const row of cases){
  const result=await page.evaluate(async row=>{
   const OM=await import('./vendor/index.mjs');const {PRODUCT_DOMAINS,productField}=await import('./map-ensemble-products.js');const {installEnsembleTransport}=await import('./map-ensemble-transport.js');
   const f=productField(row.field),rgba=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16),1];
   const settings={...OM.defaultOmProtocolSettings,domainOptions:[...OM.domainOptions,...PRODUCT_DOMAINS],colorScales:{...OM.defaultOmProtocolSettings.colorScales,[row.field]:{type:'breakpoint',unit:'%',breakpoints:f.stops,colors:f.colors.map(rgba)}}};
   installEnsembleTransport(OM,settings);OM.updateCurrentBounds([-8,50,2,59]);
   const run=row.reference.slice(0,10).replaceAll('-','/')+'/'+row.reference.slice(11,16).replace(':','')+'Z/';
   const file='https://raw.githubusercontent.com/matthewhugo81-arch/snowline/'+'a'.repeat(40)+'/ensemble-data/'+row.domain+'/'+run+row.time.slice(0,16).replace(':','')+'.om';
   const url='om://'+file+'?variable='+row.field+'&interpolation=linear&tile_size=512&color_blend=true/5/15/10';
   const render=async()=>{const {data}=await OM.omProtocol({url,type:'image'},new AbortController(),settings);const c=new OffscreenCanvas(512,512),ctx=c.getContext('2d');ctx.drawImage(data,0,0);data.close();const pixels=ctx.getImageData(0,0,512,512).data;return {opaque:pixels.filter((v,i)=>i%4===3&&v>0).length,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)))};};
   const first=await render(),second=await render();return {first,second};
  },row);
  assert.ok(result.first.opaque>0,row.domain+' renders real data');assert.deepEqual(result.first,result.second);
  console.log(JSON.stringify({domain:row.domain,field:row.field,opaquePixels:result.first.opaque,requests,bytes,repeatStable:true}));
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
