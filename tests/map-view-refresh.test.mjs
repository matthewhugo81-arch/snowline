import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewRefresh} from '../map-view-refresh.js';
import {ForecastFrames} from '../map-frames.js';
import {FakeMap} from './frame-fake.mjs';

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
