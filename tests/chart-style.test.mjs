import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as OM from '../vendor/index.mjs';
import {describeVariable,extendCatalogue} from '../map-catalogue.js';
import {displayStops,MPH_PER_MS} from '../map-wind-units.js';
import {isJetWind,JET_MIN_MS,is850Temperature,MAJOR_850_TEMPERATURES,temperatureContourLevels,contourLineWidth} from '../map-chart-style.js';
import {gridValueLabel} from '../map-grid.js';
import {overlayGroups} from '../map-overlay-specs.js';
const majors=[-25,-20,-15,-10,-5,0,5,10,15,20,25],jetStops=[60,75,90,105,120,135,150,165,180];
for(const level of [300,200])test(`${level} hPa wind uses 60–180+ mph for speed/direction and u/v feeds`,()=>{
 const key=`wind_speed_${level}hPa`,u=`wind_u_component_${level}hPa`,v=`wind_v_component_${level}hPa`,fields=[],settings={colorScales:{}};
 extendCatalogue(fields,[{variables:[key,`wind_direction_${level}hPa`]},{variables:[u,v]}],OM,settings);
 const field=fields[0],scale=settings.colorScales[key];
 assert.deepEqual(displayStops(field).slice(field.legendStart),jetStops);assert.deepEqual(field.contourValues.map(n=>Math.round(n*MPH_PER_MS)),jetStops);
 assert.deepEqual(scale,settings.colorScales[u]);
 for(const mph of [0,10,40,59,59.999])assert.deepEqual(OM.getColor(scale,mph/MPH_PER_MS,false),[255,255,255,1]);
 for(const mph of [...jetStops,250])assert.notDeepEqual(OM.getColor(scale,mph/MPH_PER_MS,false),[255,255,255,1]);
 assert.deepEqual(OM.getColor(scale,250/MPH_PER_MS,false),scale.colors.at(-1));
 assert.equal(gridValueLabel(59.999/MPH_PER_MS,field),null);assert.equal(gridValueLabel(JET_MIN_MS,field),'60');
 const groups=overlayGroups({field,url:'wind',pressureURL:'pressure',isobars:true,contours:true});
 for(const arrow of groups[0].layers.filter(l=>l['source-layer']==='wind-arrows'))assert.deepEqual(arrow.filter,['>=',['to-number',['get','value']],JET_MIN_MS]);
 for(const layer of groups.at(-1).layers)assert.equal(layer.filter,undefined,'MSLP is not masked by the wind cutoff');
});
test('other wind levels, temperature scales and point values are not redefined',()=>{
 for(const key of ['wind_speed_1000hPa','wind_speed_500hPa','wind_speed_250hPa','wind_speed_100m']){
  const field=describeVariable(key,OM);assert.equal(isJetWind(key),false);assert.deepEqual(field.stops,OM.getColorScale('wind',false).breakpoints);assert.equal(field.displayMinimum,undefined);assert.equal(gridValueLabel(10/MPH_PER_MS,field),'10');
 }
 assert.equal(isJetWind('temperature_300hPa'),false);assert.equal(isJetWind('wind_speed_300hPa_spread'),false);
});
for(const key of ['temperature_850hPa','temperature_850hPa_mean'])test(`${key}: explicitly generate all requested 5°C contours and retain intermediates`,()=>{
 const field=describeVariable(key,OM),levels=temperatureContourLevels(field),original=field.contourValues??Array.from({length:71},(_,i)=>-100+i*2);
 assert.deepEqual(MAJOR_850_TEMPERATURES,majors);assert.ok(majors.every(v=>levels.includes(v)));assert.ok(original.every(v=>levels.includes(v)));
 assert.equal(levels.length,new Set(levels).size);assert.deepEqual(levels,[...levels].sort((a,b)=>a-b));
 assert.deepEqual(contourLineWidth(field),['match',['to-number',['get','value']],majors,1.8,.7]);
 const groups=overlayGroups({field,url:'temperature',pressureURL:'pressure',contours:true,isobars:true});
 assert.deepEqual(groups[0].layers.find(l=>l.id==='contour-lines').paint['line-width'],contourLineWidth(field));
 assert.equal(groups.at(-1).layers[0].paint['line-width'],.8);
 assert.equal(overlayGroups({field,url:'temperature',pressureURL:'pressure',contours:false,isobars:true}).length,1,'Contours checkbox still controls isotherms');
});
test('850 hPa spread, other temperature levels, theta-w and MSLP retain their line weights',()=>{
 for(const key of ['temperature_850hPa_spread','temperature_500hPa','temperature_2m','wet_bulb_potential_temperature_850hPa','pressure_msl']){
  assert.equal(is850Temperature(key),false);assert.equal(contourLineWidth({key}),.7);
 }
 const maps=readFileSync(new URL('../maps.js',import.meta.url),'utf8');assert.match(maps,/if\(is850Temperature\(field.key\)\)return temperatureContourLevels\(field\)/);assert.match(maps,/contour_style:'20261012-major850'/);
});
