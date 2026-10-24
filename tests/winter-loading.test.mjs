import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {arrowFrameWindow,fullSequence} from '../map-frames.js';
const source=await readFile(new URL('../maps.js',import.meta.url),'utf8');
const body=source.match(/function warmUpcoming\(panel\)\{[\s\S]*?\r?\n\}/)[0];
for(const field of ['surface_temperature_min_24h','surface_freezing_hours_24h','snowfall_total_24h','temperature_2m'])test(field+' preloads the complete sequence like a normal panel',()=>{
 let plan;const urls=Array.from({length:18},(_,i)=>'frame-'+i),panel={key:'b',frameURLs:urls,frameCache:{warm:x=>plan=x}};
 const warm=vm.runInNewContext(body+';warmUpcoming',{state:{index:6},panelSelection:()=>({field}),panelVisible:()=>true,accumulationHours:()=>null,arrowFrameWindow,fullSequence,frameBudget:()=>({ahead:3,behind:1,loop:true})});
 warm(panel);assert.deepEqual([...plan.all],fullSequence(urls,6));assert.equal(plan.delay,0);
});
