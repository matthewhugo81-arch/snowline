import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedAccumulationPeriods,periodStart,configurePeriodInterval} from '../map-accumulation-periods.js';
import {briefingTimes,BRIEFING_AREAS,BRIEFING_PRESETS,briefingCaption,briefingPage} from '../map-briefing-data.js';
import {previousRunTimes} from '../map-previous-run-data.js';
import {forecastValidity} from '../map-validity.js';
import {ACCUMULATION_HOURS} from '../map-accumulation.js';
const HOUR=3600000,zero=Date.UTC(2026,9,12);
const time=h=>new Date(zero+h*HOUR).toISOString();
const preset=h=>BRIEFING_PRESETS.find(p=>p.field===`precipitation_total_${h}h`);
const meta=(initial=0,last=144)=>({domain:'ukmo_uk_deterministic_2km',reference_time:time(initial),variables:['precipitation','pressure_msl'],valid_times:Array.from({length:last+1},(_,i)=>time(initial+i))});

for(const hours of ACCUMULATION_HOURS)test(`${hours} h totals advance by ${hours} h, not hourly or 3/6-hourly`,()=>{
 const ends=Array.from({length:hours*3+1},(_,i)=>time(i+hours));
 const actual=fixedAccumulationPeriods(ends,hours,time(0));
 assert.deepEqual(actual.times,[hours,hours*2,hours*3,hours*4].map(time));
 assert.equal(actual.start,time(0));assert.equal(actual.index,0);
 for(let i=1;i<actual.times.length;i++)assert.equal(periodStart(actual.times[i],hours),actual.times[i-1]);
});
test('a chosen 13Z start remains the anchor across midnight and variable time representations',()=>{
 const result=fixedAccumulationPeriods([time(24),time(37),time(61),'2026-10-14T14:00:00+01:00','invalid',time(85)],24,'2026-10-12T14:00:00+01:00');
 assert.deepEqual(result.times,[37,61,85].map(time));assert.equal(result.start,time(13));
});
test('periods can be changed from any valid start, not only initialization or 00Z',()=>{
 const ends=Array.from({length:73},(_,i)=>time(i+24));
 const a=fixedAccumulationPeriods(ends,24,time(6)),b=fixedAccumulationPeriods(ends,24,time(13));
 assert.deepEqual(a.times,[30,54,78].map(time));assert.deepEqual(b.times,[37,61,85].map(time));
 assert.equal(a.starts.length,73);assert.equal(b.starts.length,73);
});
test('a missing interval cannot create a partial chart or change a later period to fill a gap',()=>{
 const m=meta(),p=preset(24);m.valid_times=m.valid_times.filter(t=>t!==time(30));
 const result=fixedAccumulationPeriods(briefingTimes(m,p,{},'native'),24,time(0));
 assert.deepEqual(result.times,[24,72,96,120,144].map(time));
 assert.ok(!result.times.includes(time(48)));
});
test('short run horizons only display the actual complete periods and never fill the six-panel layout',()=>{
 const m=meta(0,54);
 assert.deepEqual(briefingPage(fixedAccumulationPeriods(briefingTimes(m,preset(24),{regional:true}),24,time(0)).times,0,6),[24,48].map(time));
 assert.deepEqual(fixedAccumulationPeriods(briefingTimes(m,preset(48),{regional:true}),48,time(0)).times,[time(48)]);
 assert.deepEqual(fixedAccumulationPeriods(briefingTimes(m,preset(72),{regional:true}),72,time(0)).times,[]);
});
test('global coarse native steps accept exact windows only; display interval does not restrict period-start choice',()=>{
 const m={...meta(0,144),domain:'ecmwf_ifs025',valid_times:Array.from({length:49},(_,i)=>time(i*3))},p=preset(24);
 assert.deepEqual(briefingTimes(m,p,{},'3'),briefingTimes(m,p,{},'6'));
 const result=fixedAccumulationPeriods(briefingTimes(m,p,{},'6'),24,time(3));
 assert.deepEqual(result.times,[27,51,75,99,123].map(time));
});
test('three different initializations share one absolute period rather than three lead-time anchors',()=>{
 const runs=[meta(0,120),meta(6,120),meta(12,120)],p=preset(24);
 const common=previousRunTimes(runs,p,{},'6');
 const result=fixedAccumulationPeriods(common,24,time(13));
 assert.deepEqual(result.times,[37,61,85,109].map(time));
 const captions=runs.map(m=>briefingCaption(m,p,result.times[0]));
 assert.equal(forecastValidity(p.field,result.times[0]),'VALID 12 Oct 13:00 to 13 Oct 13:00 UTC');
 assert.ok(captions.every(c=>/^T\+\d+$/.test(c)),'Lead times do not repeat the valid period');
 assert.equal(new Set(captions.map(c=>c.split(' · ')[0])).size,3);
});
test('fixed-interval label is disabled, ordinary global and regional choices restore without carrying over a rainfall duration',()=>{
 const select={ownerDocument:{createElement:()=>({})},replaceChildren(...os){this.options=os;}};
 configurePeriodInterval(select,24,'6',false);assert.equal(select.disabled,true);assert.deepEqual(select.options.map(o=>o.textContent),['24-hour periods']);
 configurePeriodInterval(select,null,'12',false);assert.equal(select.disabled,false);assert.equal(select.value,'12');assert.equal(select.options.length,4);
 configurePeriodInterval(select,null,'6',true);assert.equal(select.disabled,true);assert.equal(select.value,'native');
});
test('invalid and empty selections fail safely',()=>{
 assert.throws(()=>fixedAccumulationPeriods([],0,time(0)),RangeError);
 assert.deepEqual(fixedAccumulationPeriods([],24,time(0)),{starts:[],times:[],index:0,start:null});
 assert.equal(fixedAccumulationPeriods([time(24)],24,undefined).start,time(0));
});

 test('North Atlantic preset is narrower and farther north, with other areas unchanged',()=>{
 const atlantic=BRIEFING_AREAS.find(a=>a.id==='atlantic');
 assert.deepEqual(atlantic.bounds,[-65,35,35,73]);assert.deepEqual(atlantic.size,[960,660]);
 assert.deepEqual(BRIEFING_AREAS.find(a=>a.id==='uk').bounds,[-12,48,5,61.5]);
 assert.deepEqual(BRIEFING_AREAS.find(a=>a.id==='europe').bounds,[-25,32,35,72]);
});
