import test from 'node:test';
import assert from 'node:assert/strict';
import {chartScales,imageFilename,captureMapFrame,composeChartImage} from '../map-image-export.js';
import {describeVariable} from '../map-catalogue.js';
import * as OM from '../vendor/index.mjs';
import {WEATHER_COMPOSITE} from '../map-weather-composite.js';
class FakeMap{listeners=new Map();on(n,f){if(!this.listeners.has(n))this.listeners.set(n,new Set());this.listeners.get(n).add(f);}off(n,f){this.listeners.get(n)?.delete(f);}fire(n){for(const f of [...this.listeners.get(n)??[]])f();}getCanvas(){return {width:800,height:600,clientWidth:400};}triggerRepaint(){this.requested=true;}}
function doc(){const ops=[],ctx={measureText:t=>({width:t.length*6}),drawImage:(...a)=>ops.push(['image',...a]),fillText:(...a)=>ops.push(['text',...a]),fillRect(){},strokeRect(){},scale(){},createLinearGradient:()=>({addColorStop:(...a)=>ops.push(['stop',...a])})};return {ops,createElement:()=>({width:0,height:0,getContext:()=>ctx,toBlob:f=>f(new Blob(['PNG'],{type:'image/png'}))})};}
test('capture waits for render and snapshots actual pixels and metadata synchronously',async()=>{
 const map=new FakeMap(),root=doc();let title='old';const pending=captureMapFrame(map,()=>({ready:true,title}),{root});assert.equal(map.requested,true);assert.equal(root.ops.length,0);
 title='visible run and time';map.fire('render');const snap=await pending;assert.equal(snap.title,title);assert.equal(snap.image.width,800);assert.equal(snap.width,400);assert.equal(root.ops[0][0],'image');assert.equal(map.listeners.get('render').size,0);
});
test('unready, removed or timed-out maps cannot produce misleading blank exports',async()=>{
 const root=doc(),map=new FakeMap();let pending=captureMapFrame(map,()=>({ready:false}),{root});map.fire('render');await assert.rejects(pending,/finish loading/);
 pending=captureMapFrame(map,()=>({ready:true}),{root});map.fire('remove');await assert.rejects(pending,/closed/);
 await assert.rejects(captureMapFrame(map,()=>({ready:true}),{root,timeout:2}),/rendering/);assert.equal(map.listeners.get('render').size,0);
});
test('jet export legends start at 60 and identify the white under-range and 180+ top band',()=>{
 for(const level of [300,200]){const [s]=chartScales(describeVariable(`wind_speed_${level}hPa`,OM));assert.deepEqual(s.labels,['60','75','90','105','120','135','150','165','180+']);assert.equal(s.colors.length,9);assert.match(s.note,/below 60 mph/);}
});
test('composites retain both legends and native reporting period, not satellite observations',()=>{
 const s=chartScales({key:WEATHER_COMPOSITE},'1 h ending at valid time');assert.equal(s.length,2);assert.match(s[0].name,/not satellite/);assert.match(s[1].name,/1 h ending/);assert.match(s[1].note,/not necessarily dry/);
});
test('legends detach from mutable fields and preserve non-uniform colour positions',()=>{
 const f={key:'dew_point_2m',name:'Dew point',unit:'°C',stops:[-10,0,30],colors:['#123456','#234567','#345678']};const [s]=chartScales(f);f.colors[0]='#ffffff';assert.equal(s.colors[0],'#123456');assert.deepEqual(s.positions,[0,.25,1]);
});
test('PNG composition retains bitmap density, actual run/time, matching legends and attribution',async()=>{
 const root=doc(),image={width:800,height:600};const r=await composeChartImage({image,width:400,title:'UKV · 12 Oct 06Z · Valid 12 Oct 17:00 UTC',subtitle:'T+011',scales:chartScales(describeVariable('wind_speed_300hPa',OM))},{root});assert.equal(r.blob.type,'image/png');assert.match(r.filename,/UKV.*12-Oct-06Z.*17-00-UTC\.png$/);
 const op=root.ops.find(a=>a[0]==='image');assert.equal(op[1],image);assert.equal(op[4],400);assert.equal(op[5],300);const text=root.ops.filter(a=>a[0]==='text').map(a=>a[1]).join(' ');for(const term of ['T+011','180+','below 60','OpenStreetMap'])assert.ok(text.includes(term));
});
test('filenames remain safe and bounded',()=>{assert.match(imageFilename('../<script>: MODEL? *| / 300 hPa'),/^Snowline-[a-zA-Z0-9-]+\.png$/);assert.ok(imageFilename('a'.repeat(1000)).length<200);});
