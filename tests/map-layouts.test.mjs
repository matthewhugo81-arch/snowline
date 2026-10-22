import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanLayout,layoutEntries,writeLayout,LAYOUT_PREFIX} from '../map-layouts.js';
const layout={version:1,panels:[{model:'ukmo_uk_ensemble_2km',field:'ens_rain_ge10mm_6h',followLatest:true}],compare:false,time:'2026-10-22T12:00:00Z',interval:'6'};
const storage=()=>{const data=new Map();return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
test('Layout serialization keeps selections, run intent and bounded display settings, not forecast data',()=>{
 const value=cleanLayout({...layout,metas:{huge:true},opacity:100,panels:[{...layout.panels[0],followLatest:false,model:'ukmo_uk_ensemble_2km@2026-10-22T00:00:00Z',camera:[999,NaN,200]}],briefing:{model:'ukmo_uk_ensemble_2km',field:'ens_rain_ge10mm_6h',count:9,bounds:[-11,49,2,61],controlsHidden:true}});
 assert.equal(value.metas,undefined);assert.equal(value.opacity,.8);assert.equal(value.panels[0].followLatest,false);assert.deepEqual(value.panels[0].camera,[-3,55.3,4.6]);assert.equal(value.briefing.count,9);assert.equal(value.briefing.controlsHidden,true);
 assert.equal(cleanLayout({version:2,panels:layout.panels}),null);assert.equal(cleanLayout({version:1,panels:[null]}),null);
});
test('Four recent tab slots update independently without destroying unrelated browser storage',()=>{
 const s=storage();s.setItem('other','untouched');
 for(let i=0;i<4;i++)writeLayout(s,{id:'tab'+i,updated:i,name:'Monitor '+i,layout});
 writeLayout(s,{id:'tab0',updated:10,layout:{...layout,interval:'12'}});
 assert.equal(layoutEntries(s).length,4);assert.equal(layoutEntries(s)[0].layout.interval,'12');
 writeLayout(s,{id:'tab4',updated:11,layout});
 assert.deepEqual(layoutEntries(s).map(e=>e.id),['tab4','tab0','tab3','tab2']);assert.equal(s.getItem('other'),'untouched');
});
test('Damaged and old-version records do not prevent restoring valid layouts',()=>{
 const s=storage();s.setItem(LAYOUT_PREFIX+'broken','{');s.setItem(LAYOUT_PREFIX+'old',JSON.stringify({id:'old',updated:3,layout:{...layout,version:2}}));writeLayout(s,{id:'valid',updated:1,layout});assert.deepEqual(layoutEntries(s).map(e=>e.id),['valid']);
});
test('A storage quota error leaves the previously saved layout readable',()=>{
 const s=storage();writeLayout(s,{id:'old',updated:1,layout});s.setItem=()=>{throw new Error('Quota exceeded');};assert.throws(()=>writeLayout(s,{id:'new',updated:2,layout}),/Quota/);assert.equal(layoutEntries(s)[0].id,'old');
});
