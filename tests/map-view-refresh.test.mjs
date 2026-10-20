import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewRefresh,layoutForecastBounds} from '../map-view-refresh.js';
import {ForecastFrames} from '../map-frames.js';
import {FakeMap} from './frame-fake.mjs';

test('menu layout bounds cover both sizes without changing the clipping context',()=>{
 const box={clientWidth:400,clientHeight:500};
 let longitude=-3;
 const map={getContainer:()=>box,unproject:([x,y])=>({lng:longitude+(x-box.clientWidth/2)/10,lat:55-(y-box.clientHeight/2)/10})};
 const available={width:620,height:700},before=layoutForecastBounds(map,available);
 box.clientWidth=580;box.clientHeight=650;
 assert.deepEqual(layoutForecastBounds(map,available),before);
 assert.ok(before[0]<=map.unproject([0,650]).lng&&before[2]>=map.unproject([580,0]).lng);
 assert.ok(before[1]<=map.unproject([0,650]).lat&&before[3]>=map.unproject([580,0]).lat);
 longitude+=20;
 assert.notDeepEqual(layoutForecastBounds(map,available),before,'A real pan gets a new clipping context');
 box.clientWidth=800;
 assert.equal(layoutForecastBounds(map,available)[2]-layoutForecastBounds(map,available)[0],80,'Never clip a canvas larger than the reserved layout');
});

test('rapid zoom sequences render only the final stationary view',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let moving=false,renders=0;
 const refresh=createViewRefresh(()=>renders++,()=>moving);
 refresh.schedule();t.mock.timers.tick(100);moving=true;refresh.cancel();
 t.mock.timers.tick(1000);assert.equal(renders,0);
 moving=false;refresh.schedule();t.mock.timers.tick(100);refresh.schedule();
 t.mock.timers.tick(100);assert.equal(renders,0);t.mock.timers.tick(20);assert.equal(renders,1);
 refresh.schedule();moving=true;t.mock.timers.tick(120);assert.equal(renders,1);
 moving=false;refresh.schedule();t.mock.timers.tick(120);assert.equal(renders,2);
});

test('late source errors from a replaced selection cannot fail the new frame',async()=>{
 const map=new FakeMap(),old=new ForecastFrames(map,'a'),before=old.prepare('old');old.clear();await before.ready;
 const next=new ForecastFrames(map,'a'),after=next.prepare('new');
 map.emit('error',{sourceId:before.id,error:Error('Old request failed after cancellation')});
 assert.equal(after.pending,true);assert.notEqual(after.id,before.id);assert.equal(next.failures.size,0);
 map.load(after);assert.equal(await after.ready,true);next.clear();
});
