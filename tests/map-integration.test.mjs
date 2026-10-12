import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../maps.js',import.meta.url),'utf8');
test('map integration has one buffered playback and no late overlay rebuilding',()=>{
 assert.match(source,/new ForecastPlayback/);
 assert.match(source,/const decorate=url=>/);
 assert.match(source,/compositeUnderlay\(descriptor.cloudURL\)/);
 assert.match(source,/overlayGroups\(descriptor\)/);
 assert.match(source,/prefetch:createFramePrefetch\(panel.map,imageryCache,decorate\)/);
 assert.doesNotMatch(source,/function drawPanel|function nextAnimation|function drawPressure|function drawContours/);
 assert.doesNotMatch(source,/clearPressure\(|clearContours\(/);
 assert.match(source,/syncTimeline\(index\);setLegend\(\);pressureNote\(\)/);
 assert.match(source,/legendField!==field/);
});
