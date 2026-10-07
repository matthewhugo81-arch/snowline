import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise, VARIABLES, forecastURL, windMph} from '../data.js';
import {FROST_BANDS, RAIN_BANDS, frostBand, rainBand, buildDataset, datasetCSV, datasetHTML, datasetTable, formatValue} from '../export.js';

const variable = VARIABLES.find(v => v.key === 'soil_temperature_0cm');
const times = ['2026-10-07T00:00:00Z','2026-10-07T01:00:00Z','2026-10-07T02:00:00Z'];
const defs = [{id:'one',name:'Model One'},{id:'two',name:'Model "Two"'},{id:'missing',name:'Unavailable'}];
const modelOne = normalise({hourly:{time:times,soil_temperature_0cm:[0,-2,-15]},_retrievedAt:1791331200000},defs[0]);
const modelTwo = normalise({hourly:{time:[times[2],times[0]],soil_temperature_0cm:[-5.123,null]}},defs[1]);
const models = new Map([['one',modelOne],['two',modelTwo]]);
const options = {variable,modelDefinitions:defs,models,times,full:false,location:{name:'Test, "Place"',latitude:53.9,longitude:-2.1},loading:false,errors:new Map([['missing','No coverage']])};

test('all model values align by UTC timestamp, retaining zero and missing values',() => {
  const data = buildDataset(options);
  assert.deepEqual(data.rows.map(row => row.values), [[0,null,null],[-2,null,null],[-15,-5.123,null]]);
  assert.equal(data.hasData,true);
});

test('chart window and full model dataset respect the chosen model scope',() => {
  assert.equal(buildDataset({...options,times:times.slice(1)}).rows.length,2);
  const full = buildDataset({...options,modelDefinitions:[defs[1]],times:[],full:true});
  assert.deepEqual(full.rows.map(row => row.time),[times[0],times[2]]);
  assert.deepEqual(full.rows.map(row => row.values),[[null],[-5.123]]);
  assert.equal(buildDataset({...options,modelDefinitions:[]}).hasData,false);
  assert.deepEqual(buildDataset({...options,modelDefinitions:[defs[2]],full:true}).rows,[]);
});

test('Celsius colour bands have exact boundaries and exclude zero, missing and other units',() => {
  for(const [value,index] of [[-0.01,0],[-1.99,0],[-2,1],[-4.99,1],[-5,2],[-9.99,2],[-10,3],[-14.99,3],[-15,4],[-30,4]]){
    assert.equal(frostBand(value,'°C'),FROST_BANDS[index]);
  }
  for(const value of [null,undefined,NaN,Infinity,-Infinity,0,0.1,'-2']) assert.equal(frostBand(value,'°C'),null);
  assert.equal(frostBand(-2,'cm'),null);
  assert.equal(formatValue(-0.01,variable),'-0.01');
});

test('CSV includes units and location, escapes text, preserves precision, negative values and blanks',() => {
  const csv = datasetCSV(buildDataset(options));
  assert.ok(csv.startsWith('\ufeff"Location"'));
  assert.ok(csv.includes('"Model ""Two"" — 0 cm soil temperature (°C)"'));
  assert.ok(csv.includes('"Test, ""Place""","53.9","-2.1","2026-10-07T02:00:00Z","-15","-5.123",,"-10.0615"\r\n'));
  assert.ok(csv.includes('"2026-10-07T00:00:00Z","0",,,"0"\r\n'));
  const guarded = datasetCSV(buildDataset({...options,location:{...options.location,name:'=1+1'}}));
  assert.ok(guarded.includes('"\'=1+1"'));
});

test('HTML table preserves frost colours, escapes location and states coverage',() => {
  const data = buildDataset({...options,location:{...options.location,name:'<script>alert(1)</script>'}});
  const html = datasetHTML(data);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('background-color:#6b21a8;color:#ffffff'));
  assert.ok(html.includes('Unavailable</strong>: No coverage'));
  assert.ok(html.includes('retrieved 2026-10-07T00:00:00.000Z'));
  assert.ok(datasetTable(data).includes('<td >0.0</td>'));
  assert.ok(datasetTable(data).includes('<td >—</td>'));
});

test('exports use the same normalised centimetres as snow-depth charts',() => {
  const snow = VARIABLES.find(v => v.key === 'snow_depth');
  const model = normalise({hourly:{time:[times[0]],snow_depth:[0.12]},hourly_units:{snow_depth:'m'}},defs[0]);
  const data = buildDataset({...options,variable:snow,modelDefinitions:[defs[0]],models:new Map([['one',model]]),times:[times[0]]});
  assert.deepEqual(data.rows[0].values,[12]);
  assert.ok(datasetCSV(data).includes('Snow depth (cm)'));
  assert.ok(!datasetHTML(data).includes('Sub-zero scale'));
});

test('hourly averages use available displayed models, count zeroes and omit missing values',() => {
  const data = buildDataset(options);
  assert.deepEqual(data.rows.map(row => row.average),[0,-2,-10.0615]);
  assert.deepEqual(data.rows.map(row => row.averageCount),[1,1,2]);
  const single = buildDataset({...options,modelDefinitions:[defs[1]]});
  assert.deepEqual(single.rows.map(row => row.average),[null,null,-5.123]);
  assert.deepEqual(single.rows.map(row => row.averageCount),[0,0,1]);
  assert.ok(buildDataset({...options,modelDefinitions:[]}).rows.every(row => row.average === null));
  assert.ok(buildDataset({...options,modelDefinitions:[defs[2]]}).rows.every(row => row.average === null));
  const html = datasetTable(data);
  assert.match(html, /class="average-column">Average<br><small>°C<\/small><\/th><\/tr><\/thead>/);
  assert.match(html, /class="average-column frost-value"[^>]+Mean of 2 available models[^>]*>-10\.1<\/td><\/tr>/);
  assert.ok(datasetCSV(data).split('\r\n')[0].endsWith('"Average — 0 cm soil temperature (°C)"'));
  assert.ok(datasetCSV(single).split('\r\n')[1].endsWith(',,'));
});

test('rainfall colour boundaries exclude dry, missing and non-precipitation values',() => {
  for(const [value,index] of [[0.001,0],[0.49,0],[0.5,1],[1.99,1],[2,2],[4.99,2],[5,3],[9.99,3],[10,4],[30,4]]){
    assert.equal(rainBand(value,'precipitation'),RAIN_BANDS[index]);
  }
  for(const value of [null,undefined,NaN,Infinity,-Infinity,0,-0.1,'2']) assert.equal(rainBand(value,'precipitation'),null);
  assert.equal(rainBand(2,'snowfall'),null);
  assert.equal(rainBand(2,'temperature_2m'),null);
});

test('rainfall averages and saved tables retain green shading without rounding small rain to zero',() => {
  const rain = VARIABLES.find(v => v.key === 'precipitation');
  const wet = normalise({hourly:{time:times,precipitation:[0,0.1,12]}},defs[0]);
  const dry = normalise({hourly:{time:times,precipitation:[null,0,4]}},defs[1]);
  const data = buildDataset({...options,variable:rain,models:new Map([['one',wet],['two',dry]])});
  assert.deepEqual(data.rows.map(row => row.average),[0,0.05,8]);
  const html = datasetHTML(data);
  assert.ok(html.includes('Precipitation · mm/h'));
  assert.ok(html.includes('background-color:#14532d;color:#ffffff'));
  assert.match(html,/class="average-column rain-value" style="background-color:#15803d;color:#ffffff"[^>]*>8\.00<\/td>/);
  assert.ok(datasetCSV(data).split('\r\n')[3].endsWith(',"8"'));
  assert.equal(formatValue(0.05,rain),'0.05');
  assert.equal(formatValue(0.001,rain),'0.001');
});

test('forecasts request both wind variables in mph with a distinct cache URL',() => {
  const url = new URL(forecastURL(options.location, defs[0]));
  assert.equal(url.searchParams.get('wind_speed_unit'),'mph');
  const keys = url.searchParams.get('hourly').split(',');
  assert.ok(keys.includes('wind_speed_10m'));
  assert.ok(keys.includes('wind_gusts_10m'));
  assert.ok(VARIABLES.filter(v => v.key.startsWith('wind_')).every(v => v.unit === 'mph'));
});

test('wind units are converted once, preserving calm and missing values',() => {
  assert.equal(windMph(16.09344,'km/h'),10);
  assert.ok(Math.abs(windMph(4.4704,'m/s')-10) < 1e-10);
  assert.ok(Math.abs(windMph(10,'kn')-11.507794480235425) < 1e-10);
  assert.equal(windMph(10,'mp/h'),10);
  assert.equal(windMph(10,'mph'),10);
  assert.equal(windMph(0,'mp/h'),0);
  for(const value of [null,undefined,NaN,Infinity,'10']) assert.equal(windMph(value,'mp/h'),null);
  assert.equal(windMph(10,undefined),null);
  assert.equal(windMph(10,'unknown'),null);
});

test('gust datasets, averages and downloads use mph and omit unavailable models',() => {
  const units = {wind_speed_10m:'mp/h',wind_gusts_10m:'mp/h'};
  const gusts = VARIABLES.find(v => v.key === 'wind_gusts_10m');
  const first = normalise({hourly:{time:times,wind_speed_10m:[0,10,12],wind_gusts_10m:[0,20,null]},hourly_units:units},defs[0]);
  const second = normalise({hourly:{time:times,wind_speed_10m:[5,9,10],wind_gusts_10m:[10,30,40]},hourly_units:units},defs[1]);
  const unavailable = normalise({hourly:{time:times,wind_speed_10m:[1,2,3]},hourly_units:units},defs[2]);
  assert.deepEqual(unavailable.values.wind_speed_10m,[1,2,3]);
  assert.deepEqual(unavailable.values.wind_gusts_10m,[null,null,null]);
  const data = buildDataset({...options,variable:gusts,models:new Map([['one',first],['two',second],['missing',unavailable]])});
  assert.deepEqual(data.rows.map(row => row.average),[5,25,40]);
  assert.deepEqual(data.rows.map(row => row.averageCount),[2,2,1]);
  assert.ok(datasetTable(data).includes('10 m wind gusts (mph)'));
  assert.ok(datasetCSV(data).split('\r\n')[0].endsWith('"Average — 10 m wind gusts (mph)"'));
  assert.ok(datasetHTML(data).includes('Maximum gust in the preceding hour'));
  const converted = normalise({hourly:{time:[times[0]],wind_speed_10m:[16.09344],wind_gusts_10m:[32.18688]},hourly_units:{wind_speed_10m:'km/h',wind_gusts_10m:'km/h'}},defs[0]);
  assert.deepEqual(converted.values.wind_speed_10m,[10]);
  assert.deepEqual(converted.values.wind_gusts_10m,[20]);
});
