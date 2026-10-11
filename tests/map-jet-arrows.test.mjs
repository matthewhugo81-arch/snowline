import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {overlayGroups} from '../map-overlay-specs.js';

// Decode the actual worker's vector-tile geometry, without a browser or network.
function fields(bytes){
 let i=0;const result=[];
 const varint=()=>{let value=0,shift=0,byte;do{byte=bytes[i++];value+=(byte&127)*2**shift;shift+=7;}while(byte&128);return value;};
 while(i<bytes.length){const tag=varint(),wire=tag&7,id=tag>>3;let value;
  if(wire===0)value=varint();
  else if(wire===2){const length=varint();value=bytes.slice(i,i+length);i+=length;}
  else {const length=wire===1?8:4;value=bytes.slice(i,i+length);i+=length;}
  result.push({id,value});
 }return result;
}
function geometry(bytes){
 let i=0,x=0,y=0;const points=[];
 const varint=()=>{let value=0,shift=0,byte;do{byte=bytes[i++];value+=(byte&127)*2**shift;shift+=7;}while(byte&128);return value;};
 const signed=()=>{const v=varint();return v&1?-(v+1)/2:v/2;};
 while(i<bytes.length){const command=varint();for(let n=0;n<(command>>3);n++){x+=signed();y+=signed();points.push([x,y]);}}
 return points;
}
const code=readFileSync(new URL('../vendor/worker.js',import.meta.url),'utf8');
async function arrows(speed,direction=0,jetArrows=true){
 let reply;const self={},context={self,postMessage:message=>{reply=message;},console};
 vm.runInNewContext(code,context);
 await self.onmessage({data:{type:'getArrayBuffer',key:'test',tileIndex:{x:2,y:1,z:2},renderOptions:{tileSize:512,interpolation:'nearest',drawArrows:true,jetArrows,arrowStyle:'arrow'},layers:[{domain:{grid:{type:'regular',nx:360,ny:181,latMin:-90,lonMin:-180,dx:1,dy:1}},data:{values:new Float32Array(360*181).fill(speed),directions:new Float32Array(360*181).fill(direction),scaleFactor:1}}]}});
 const layer=fields(new Uint8Array(reply.tile)).find(field=>field.id===3);
 return fields(layer.value).filter(field=>field.id===2).map(feature=>geometry(fields(feature.value).find(field=>field.id===4).value));
}
const shaft=points=>Math.hypot(points[4][0]-points[3][0],points[4][1]-points[3][1]);
test('jet arrow geometry grows through strong jet speeds, remains compact and is less dense',async()=>{
 const slow=await arrows(10),medium=await arrows(40),fast=await arrows(80),extreme=await arrows(150),upstream=await arrows(80,0,false);
 assert.equal(slow.length,361);assert.ok(slow.length<upstream.length*.6);
 assert.ok(shaft(medium[0])>shaft(slow[0])*1.8);assert.ok(shaft(fast[0])>shaft(medium[0])*1.5);
 assert.ok(shaft(fast[0])<shaft(upstream[0]));assert.ok(shaft(extreme[0])*512/4096<17);
 const head=points=>Math.hypot(points[2][0]-points[0][0],points[2][1]-points[0][1]);
 assert.ok(head(fast[0])>head(slow[0])*3,'Arrowheads shrink with the shafts in weaker winds');
});
test('jet arrows preserve flow direction and suppress calm or missing vectors',async()=>{
 for(const [direction,axis,sign]of [[0,1,1],[90,0,-1],[180,1,-1],[270,0,1]]){
  const [points]=await arrows(40,direction),flow=points[3][axis]-points[4][axis];
  assert.equal(Math.sign(flow),sign);assert.ok(Math.abs(flow)>0);
 }
 for(const speed of [0,1.9,NaN])assert.equal((await arrows(speed)).length,0);
 assert.equal((await arrows(40,NaN)).length,0);
});
test('jet arrow strokes are subtle while other wind overlays keep their previous sizes',()=>{
 const get=key=>overlayGroups({field:{key},url:'wind',isobars:false,contours:false})[0].layers;
 assert.deepEqual(get('wind_speed_300hPa').map(layer=>layer.paint['line-width']),[1.4,.65]);
 assert.deepEqual(get('wind_speed_10m').map(layer=>layer.paint['line-width']),[2.6,1]);
});
