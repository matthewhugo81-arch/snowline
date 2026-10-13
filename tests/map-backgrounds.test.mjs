import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundStyle,hideProtectedAreas} from '../map-backgrounds.js';
import {FakeMap} from './frame-fake.mjs';

test('protected-area fills and outlines are hidden without hiding geography or weather',()=>{
 const map=new FakeMap();
 for(const [id,type,source]of [['park','fill','park'],['park_outline','line','park'],['water','fill','water'],['boundary','line','boundary'],['cloud','raster',undefined]])map.addLayer({id,type,'source-layer':source});
 hideProtectedAreas(map);
 assert.equal(map.getLayer('park').layout.visibility,'none');
 assert.equal(map.getLayer('park_outline').layout.visibility,'none');
 for(const id of ['water','boundary','cloud'])assert.notEqual(map.getLayer(id).layout?.visibility,'none');
 assert.match(backgroundStyle('light'),/\/positron$/);
 assert.match(backgroundStyle('streets'),/\/liberty$/);
});
