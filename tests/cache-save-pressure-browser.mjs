// Exercise real bitmap encoding and browser CacheStorage under a stalled disk.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium,firefox} from 'playwright';
const root=process.cwd();
const server=createServer(async(req,res)=>{try{
 const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);
 if(!path.startsWith(root+sep))throw Error('Invalid path');
 res.writeHead(200,{'Content-Type':extname(path)==='.js'?'text/javascript':'text/html'});res.end(await readFile(path));
}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const engine=process.env.CACHE_TEST_ENGINE==='firefox'?firefox:chromium;
let browser;
try{
 browser=await engine.launch({headless:true,timeout:15000});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/map-credits.html');
 const result=await page.evaluate(async()=>{
  const {ForecastTileCache}=await import('/map-tile-cache.js');
  let release,calls=0;
  const gate=new Promise(resolve=>release=resolve);
  const storage={keys:()=>caches.keys(),delete:name=>caches.delete(name),open:async name=>{
   const store=await caches.open(name);
   return {keys:()=>store.keys(),match:key=>store.match(key),delete:key=>store.delete(key),put:async(key,response)=>{await gate;await store.put(key,response);}};
  }};
  const cache=new ForecastTileCache(async()=>{
   calls++;const canvas=new OffscreenCanvas(32,32),ctx=canvas.getContext('2d');
   ctx.fillStyle='#247aaa';ctx.fillRect(0,0,32,32);return {data:canvas.transferToImageBitmap()};
  },{storage,memoryBytes:1024});
  cache.setContext('save-pressure');cache.setForeground(['om://selected']);
  const params=url=>({url:'om://'+url,type:'image'});
  const pending=Array.from({length:64},(_,i)=>cache.prefetch(params('background/'+i),new AbortController()));
  try{
   const deadline=performance.now()+10000;
   while(cache.writes.size<24&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
   const stalled={calls,writes:cache.writes.size,limited:cache.limited};
   const start=performance.now();
   const selected=await cache.protocol(params('selected'),new AbortController());
   const selectedMs=performance.now()-start;
   const bitmap=await createImageBitmap(new Blob([selected.data],{type:'image/png'}));
   const selectedDimensions=[bitmap.width,bitmap.height];bitmap.close();
   await cache.protocol(params('background/0'),new AbortController());
   const beforeRelease=calls;
   release();await Promise.all(pending);
   while(cache.writes.size)await Promise.all([...cache.writes.values()].map(job=>job.promise));
   const saved=(await(await cache.disk).keys()).length;
   cache.memory.clear();cache.bytes=0;
   for(let i=0;i<64;i++)await cache.protocol(params('background/'+i),new AbortController());
   return {stalled,selectedMs,selectedDimensions,beforeRelease,saved,calls,limited:cache.limited};
  }finally{release();cache.release();}
 });
 assert.deepEqual(result.stalled,{calls:24,writes:24,limited:false});
 assert.equal(result.beforeRelease,25,'Foreground and pending-save reads do not wait for disk');
 assert.deepEqual(result.selectedDimensions,[32,32]);
 assert.equal(result.saved,65);assert.equal(result.calls,65,'Every revisited tile restores without rendering');
 assert.equal(result.limited,false);assert.deepEqual(errors,[]);
 await mkdir('review-output',{recursive:true});
 await writeFile('review-output/cache-save-pressure-'+engine.name()+'.json',JSON.stringify(result,null,2));
 console.log(engine.name(),JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
