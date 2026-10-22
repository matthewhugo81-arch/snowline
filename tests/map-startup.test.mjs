import test from 'node:test';
import assert from 'node:assert/strict';
import {showStartupFailure,startMapPage} from '../map-startup.js';
function fixture(){
 const elements=new Map();
 const doc={getElementById(id){if(!elements.has(id))elements.set(id,{hidden:true,setAttribute(k,v){this[k]=v;},addEventListener(k,v){this[k]=v;}});return elements.get(id);},querySelectorAll(){return [this.getElementById('control')];}};
 return doc;
}
test('unavailable graphics produces an accessible error and a working reload action',()=>{
 const doc=fixture();let reloads=0;
 showStartupFailure(Error('WebGL2 is required'),doc,()=>reloads++);
 assert.match(doc.getElementById('map-error-a').textContent,/WebGL2/);
 assert.equal(doc.getElementById('map-error-a').hidden,false);
 assert.equal(doc.getElementById('map-error-a').role,'alert');
 assert.equal(doc.getElementById('map-time-label').textContent,'Map unavailable');
 assert.equal(doc.getElementById('control').disabled,true);
 doc.getElementById('reload-maps').click();assert.equal(reloads,1);
});
test('successful startup is unchanged and module failures leave a recovery message',async()=>{
 const doc=fixture();
 assert.equal(await startMapPage({doc,load:async()=>{}}),true);
 const original=console.error;console.error=()=>{};
 try{assert.equal(await startMapPage({doc,load:async()=>{throw Error('Failed to fetch module');}}),false);}finally{console.error=original;}
 assert.match(doc.getElementById('map-status').textContent,/connection and reload/);
});
