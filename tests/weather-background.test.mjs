import test from 'node:test';
import assert from 'node:assert/strict';
import {setWeatherBackground,cloudOpacity,MAX_CLOUD_OPACITY,WEATHER_LAND,WEATHER_SEA,cloudLegendRows} from '../map-weather-background.js';
import {FakeMap} from './frame-fake.mjs';
test('weather geography reuses the real water mask below forecasts and restores the original base',()=>{
 const map=new FakeMap(),water={id:'water',type:'fill',source:'tiles','source-layer':'water',filter:['!=',['get','brunnel'],'tunnel'],paint:{'fill-color':'#abcdef'}};
 map.addLayer(water);map.addLayer({id:'coast',type:'line'});map.addLayer({id:'labels',type:'symbol'});
 const original=structuredClone(map.layers);
 setWeatherBackground(map,true,'coast');setWeatherBackground(map,true,'coast');
 const geography=map.layers.filter(l=>l.id.startsWith('weather-geography-'));
 assert.equal(geography.length,2);assert.equal(geography[0].paint['background-color'],WEATHER_LAND);
 assert.equal(geography[1].paint['fill-color'],WEATHER_SEA);assert.deepEqual(geography[1].filter,water.filter);assert.equal(geography[1].source,'tiles');
 assert.ok(map.layers.indexOf(geography[1])<map.layers.findIndex(l=>l.id==='coast'));
 setWeatherBackground(map,false,'coast');assert.ok(geography.every(l=>l.layout.visibility==='none'));
 assert.deepEqual(map.layers.filter(l=>!l.id.startsWith('weather-geography-')),original);
 // A background/style reload can recreate the two layers without stale state.
 map.layers=structuredClone(original);setWeatherBackground(map,true,'coast');assert.equal(map.layers.filter(l=>l.id.startsWith('weather-geography-')).length,2);
});
test('overcast is capped at 80% and retains different land/sea colours in screen/export legends',()=>{
 assert.equal(MAX_CLOUD_OPACITY,.8);assert.equal(cloudOpacity(1),.8);assert.equal(cloudOpacity(.75),.75);assert.equal(cloudOpacity(0),0);
 const rows=cloudLegendRows();assert.notEqual(rows[0][1],rows[1][1]);
 for(const row of rows)for(const start of [1,3,5])assert.equal(parseInt(row[1].slice(start,start+2),16),Math.round(parseInt(row[0].slice(start,start+2),16)*.2+255*.8));
});
