import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanLayout,layoutEntries,writeLayout,LAYOUT_PREFIX,favouriteEntries,writeFavourite,removeFavourite,setStartup,initialLayout,migrateNamedLayouts,FAVOURITE_PREFIX,STARTUP_KEY} from '../map-layouts.js';
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
test('Permanent favourites survive recent-tab eviction and change only on explicit update',()=>{
 const s=storage();
 for(let i=0;i<6;i++)writeFavourite(s,{id:'fav'+i,name:'Monitor '+i,updated:i,layout});
 for(let i=0;i<10;i++)writeLayout(s,{id:'tab'+i,favouriteId:'fav0',updated:10+i,layout:{...layout,interval:'12'}});
 assert.equal(layoutEntries(s).length,4);assert.equal(favouriteEntries(s).length,6);
 assert.equal(favouriteEntries(s).find(e=>e.id==='fav0').layout.interval,'6');
 const saved=favouriteEntries(s).find(e=>e.id==='fav0');
 writeFavourite(s,{...saved,layout:{...layout,interval:'3'},updated:30});
 assert.equal(favouriteEntries(s).find(e=>e.id==='fav0').layout.interval,'3');
});
test('Startup preference yields to explicit links and a refreshed working tab',()=>{
 const s=storage();writeFavourite(s,{id:'fav',name:'Daily maps',updated:1,layout});
 writeFavourite(s,{id:'other',name:'Other',updated:1,layout:{...layout,interval:'3'}});
 writeLayout(s,{id:'tab',updated:2,layout:{...layout,interval:'12'}});setStartup(s,'fav');
 const open=(query='',navigation='navigate')=>initialLayout(s,{url:new URL('https://example.org/maps.html'+query),tabId:'tab',navigation});
 assert.equal(open().favouriteId,'fav');assert.equal(open('?v=release').favouriteId,'fav');
 assert.equal(open('', 'reload').layout.interval,'12');assert.equal(open('', 'back_forward').layout.interval,'12');
 assert.equal(open('?layout=tab').layout.interval,'12');assert.equal(open('?favourite=other').layout.interval,'3');
 for(const query of ['?layout=missing','?favourite=missing','?model=gfs','?time=2026-10-22','?lat=55','?lon=-4','?model=gfs&favourite=fav'])assert.equal(open(query),null);
 setStartup(s,'');assert.equal(open(),null);assert.throws(()=>setStartup(s,'missing'));
});
test('Removing the startup favourite clears the default without changing recent tabs',()=>{
 const s=storage();writeFavourite(s,{id:'fav',name:'Daily',updated:1,layout});writeLayout(s,{id:'tab',favouriteId:'fav',updated:2,layout});setStartup(s,'fav');
 removeFavourite(s,'fav');assert.equal(s.getItem(STARTUP_KEY),null);assert.equal(favouriteEntries(s).length,0);assert.equal(layoutEntries(s).length,1);
 s.setItem(STARTUP_KEY,'missing');assert.equal(initialLayout(s,{url:new URL('https://example.org/maps.html')}),null);
});
test('Existing named recent layouts migrate once, retain old URLs and never overwrite favourites',()=>{
 const s=storage();writeLayout(s,{id:'named',name:'Monitor 2 and 3',updated:1,layout});writeLayout(s,{id:'plain',updated:2,layout});
 const original=s.getItem(LAYOUT_PREFIX+'named');
 migrateNamedLayouts(s);assert.deepEqual(favouriteEntries(s).map(e=>e.id),['named']);assert.equal(s.getItem(LAYOUT_PREFIX+'named'),original,'Migration must not write to an open tab’s recent record');
 assert.equal(initialLayout(s,{url:new URL('https://example.org/maps.html?layout=named')}).favouriteId,'named');
 const saved=favouriteEntries(s)[0];writeFavourite(s,{...saved,name:'Renamed',layout:{...layout,interval:'12'}});migrateNamedLayouts(s);
 assert.equal(favouriteEntries(s)[0].name,'Renamed');assert.equal(favouriteEntries(s)[0].layout.interval,'12');
 assert.equal(initialLayout(s,{url:new URL('https://example.org/maps.html?layout=named')}).layout.interval,'6');
 removeFavourite(s,'named');migrateNamedLayouts(s);assert.equal(favouriteEntries(s).length,0);
});
test('Favourite storage failures preserve saved templates, and interrupted migration is retryable',()=>{
 const s=storage();writeLayout(s,{id:'old',name:'Existing',updated:1,layout});const put=s.setItem;let writes=0;
 s.setItem=(...args)=>{if(++writes===2)throw Error('Quota');put(...args);};assert.throws(()=>migrateNamedLayouts(s));
 s.setItem=put;migrateNamedLayouts(s);assert.equal(favouriteEntries(s).length,1);assert.equal(initialLayout(s,{url:new URL('https://example.org/maps.html?layout=old')}).favouriteId,'old');
 const before=s.getItem(FAVOURITE_PREFIX+'old');s.setItem=()=>{throw Error('Quota');};
 assert.throws(()=>writeFavourite(s,{id:'old',name:'Changed',updated:9,layout}));assert.equal(s.getItem(FAVOURITE_PREFIX+'old'),before);
});
