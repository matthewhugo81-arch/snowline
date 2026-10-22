import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{try{const path=resolve('.'+new URL(req.url,'http://local').pathname),data=await readFile(path);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.wasm':'application/wasm','.css':'text/css'})[extname(path)]??'text/html'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',r=>r.abort());
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};});
 await page.goto(origin+'/maps.html');
 await page.locator('#map-error-a').waitFor({state:'visible'});
 assert.match(await page.locator('#map-error-a').textContent(),/WebGL2/);
 assert.equal(await page.locator('#reload-maps').textContent(),'Reload map');
 assert.equal(await page.locator('#map-time-label').textContent(),'Map unavailable');
 await page.waitForTimeout(200);
 assert.deepEqual(errors,[],'Graphics failure and cache initialization must not leak uncaught exceptions');
 console.log('Startup graphics failure displays recovery controls without uncaught errors');
}finally{await browser.close();await new Promise(r=>server.close(r));}
