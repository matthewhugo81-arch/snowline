import test from 'node:test';
import assert from 'node:assert/strict';
import {normalise, VARIABLES} from '../data.js';
import {FROST_BANDS, frostBand, buildDataset, datasetCSV, datasetHTML, datasetTable, formatValue} from '../export.js';

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
  assert.ok(csv.includes('"Test, ""Place""","53.9","-2.1","2026-10-07T02:00:00Z","-15","-5.123",\r\n'));
  assert.ok(csv.includes('"2026-10-07T00:00:00Z","0",,\r\n'));
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
