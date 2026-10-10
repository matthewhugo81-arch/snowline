import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../maps.js',import.meta.url),'utf8');
test('map integration has one buffered playback and no late overlay rebuilding',()=>{
 assert.match(source,/new ForecastPlayback/);
 assert.match(source,/decorate:url=>overlayGroups/);
 assert.doesNotMatch(source,/function drawPanel|function nextAnimation|function drawPressure|function drawContours/);
 assert.doesNotMatch(source,/clearPressure\(|clearContours\(/);
 assert.match(source,/syncTimeline\(index\);setLegend\(\);pressureNote\(\)/);
 assert.match(source,/legendField!==field/);
});
