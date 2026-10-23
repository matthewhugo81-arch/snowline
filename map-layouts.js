// Layouts contain control choices only, never forecasts or chart-cache data.
export const LAYOUT_PREFIX='snowline-map-layout-v1:';
export const FAVOURITE_PREFIX='snowline-map-favourite-v1:';
export const STARTUP_KEY='snowline-map-startup-v1';
const MIGRATION_KEY='snowline-map-favourites-migrated-v1';
const validId=value=>typeof value==='string'&&/^[\w-]{1,80}$/.test(value);
const text=(value,max=160)=>typeof value==='string'?value.slice(0,max):'';
const number=(value,min,max,fallback)=>Number.isFinite(value)&&value>=min&&value<=max?value:fallback;
const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const interval=value=>['native','3','6','12'].includes(String(value))?String(value):'3';
const bounds=value=>Array.isArray(value)&&value.length===4&&value.every(Number.isFinite)&&value[0]>=-180&&value[2]<=180&&value[1]>=-90&&value[3]<=90&&value[0]<value[2]&&value[1]<value[3]?[...value]:null;
export function cleanLayout(input){
 if(!input||input.version!==1||!Array.isArray(input.panels)||!input.panels.length)return null;
 const panels=input.panels.slice(0,3).map(p=>({model:text(p?.model),field:text(p?.field),followLatest:p?.followLatest!==false,contours:p?.contours===true,isobars:p?.isobars!==false,grid:p?.grid===true,expanded:p?.expanded!==false,
  camera:Array.isArray(p?.camera)&&p.camera.length===3?[number(p.camera[0],-180,180,-3),number(p.camera[1],-85,85,55.3),number(p.camera[2],1,10,4.6)]:null}));
 if(panels.some(p=>!p.model||!p.field))return null;
 const b=input.briefing;
 return {version:1,panels,compare:input.compare===true,comparisonCount:input.comparisonCount===3?3:2,interval:interval(input.interval),time:date(input.time),area:text(input.area,60)||'uk',
  background:input.background==='streets'?'streets':'light',terrain:input.terrain!==false,roads:input.roads===true,opacity:number(input.opacity,.15,.9,.8),speed:[400,700,1200].includes(input.speed)?input.speed:700,sidebarCollapsed:input.sidebarCollapsed===true,
  briefing:b&&typeof b.model==='string'?{model:text(b.model),field:text(b.field),followLatest:b.followLatest!==false,time:date(b.time),interval:interval(b.interval),area:text(b.area,60)||'uk',bounds:bounds(b.bounds),count:b.count===9?9:6,contours:b.contours===true,grid:b.grid===true,controlsHidden:b.controlsHidden===true}:null};
}
export function layoutEntries(storage,prefix=LAYOUT_PREFIX){
 const entries=[];
 for(let i=0;i<storage.length;i++){
  const key=storage.key(i);if(!key?.startsWith(prefix))continue;
  try{const entry=JSON.parse(storage.getItem(key)),layout=cleanLayout(entry.layout);if(layout&&key===prefix+entry.id&&validId(entry.id)&&Number.isFinite(entry.updated))entries.push({id:entry.id,name:text(entry.name,80),title:text(entry.title,240),updated:entry.updated,favouriteId:validId(entry.favouriteId)?entry.favouriteId:null,layout});}catch{}
 }
 return entries.sort((a,b)=>b.updated-a.updated||a.id.localeCompare(b.id));
}
export function writeLayout(storage,entry){
 const layout=cleanLayout(entry.layout);if(!layout)throw Error('Layout is not ready');
 storage.setItem(LAYOUT_PREFIX+entry.id,JSON.stringify({...entry,layout}));
 // Separate keys prevent another window's save from replacing the whole list.
 for(const old of layoutEntries(storage).slice(4))storage.removeItem(LAYOUT_PREFIX+old.id);
}
export const favouriteEntries=storage=>layoutEntries(storage,FAVOURITE_PREFIX);
export function writeFavourite(storage,entry){
 const layout=cleanLayout(entry.layout),name=text(entry.name,80).trim();
 if(!layout||!name||!validId(entry.id))throw Error('A favourite needs a name and a ready layout');
 storage.setItem(FAVOURITE_PREFIX+entry.id,JSON.stringify({id:entry.id,name,title:text(entry.title,240),updated:entry.updated,layout}));
}
export function setStartup(storage,id){
 if(id&&!favouriteEntries(storage).some(entry=>entry.id===id))throw Error('Favourite no longer available');
 if(id)storage.setItem(STARTUP_KEY,id);else storage.removeItem(STARTUP_KEY);
}
export function removeFavourite(storage,id){
 storage.removeItem(FAVOURITE_PREFIX+id);
 if(storage.getItem(STARTUP_KEY)===id)storage.removeItem(STARTUP_KEY);
}
export function migrateNamedLayouts(storage){
 if(storage.getItem(MIGRATION_KEY))return;
 for(const entry of layoutEntries(storage)){
  if(!entry.name.trim())continue;
  // Separate namespaces let the old tab ID be a stable, retry-safe migration ID.
  if(!storage.getItem(FAVOURITE_PREFIX+entry.id))writeFavourite(storage,entry);
 }
 storage.setItem(MIGRATION_KEY,'1');
}
export function initialLayout(storage,{url,tabId,navigation}){
 if(['model','time','lat','lon'].some(key=>url.searchParams.has(key)))return null;
 const favourites=favouriteEntries(storage),recent=layoutEntries(storage);
 const favourite=id=>{const entry=favourites.find(item=>item.id===id);return entry?{...entry,favouriteId:entry.id,fromFavourite:true}:null;};
 // Link migrated copies on read; never rewrite another active tab during upgrade.
 const working=id=>{const entry=recent.find(item=>item.id===id);return entry?{...entry,favouriteId:entry.favouriteId??(favourites.some(item=>item.id===id)?id:null)}:null;};
 // Explicit links (including expired ones) must never be replaced by a default.
 if(url.searchParams.has('favourite'))return favourite(url.searchParams.get('favourite'));
 if(url.searchParams.has('layout'))return working(url.searchParams.get('layout'));
 if(['reload','back_forward'].includes(navigation)){
  const entry=working(tabId);if(entry)return entry;
 }
 return favourite(storage.getItem(STARTUP_KEY));
}

export async function createLayoutRestore(){
 const $=id=>document.getElementById(id);
 const host=$('layout-restore'),list=$('layout-list'),notice=$('layout-notice'),name=$('layout-name'),favourites=$('layout-favourites'),startup=$('layout-startup'),actionStatus=$('layout-action-status');
 let storage;try{storage=localStorage;}catch{}
 const entries=()=>{try{return storage?layoutEntries(storage):[];}catch{return [];}};
 const favouritesNow=()=>{try{return storage?favouriteEntries(storage):[];}catch{return [];}};
 let migrationFailed=false;try{if(storage)migrateNamedLayouts(storage);}catch{migrationFailed=true;}
 const url=new URL(location.href);
 let tabId;try{tabId=sessionStorage.getItem('snowline-layout-tab');}catch{}
 const navigation=performance.getEntriesByType('navigation')[0]?.type;
 let saved;try{if(storage)saved=initialLayout(storage,{url,tabId,navigation});}catch{}
 let id=tabId??(!saved?.fromFavourite?saved?.id:null)??crypto.randomUUID(),release;
 // Duplicated browser tabs can inherit sessionStorage. A lifetime lock gives
 // each active tab its own slot without polling or sharing mutable UI state.
 if(navigator.locks){
  for(;;){
   const claimed=await new Promise(resolve=>{navigator.locks.request('snowline-layout-tab:'+id,{ifAvailable:true},lock=>{
    if(!lock){resolve(false);return;}
    return new Promise(done=>{release=done;resolve(true);});
   }).catch(()=>resolve(null));});
   if(claimed===true)break;
   id=crypto.randomUUID();if(claimed===null)break;
  }
 }else if(performance.getEntriesByType('navigation')[0]?.type!=='reload')id=crypto.randomUUID();
 try{sessionStorage.setItem('snowline-layout-tab',id);}catch{}
 let capture,describe,timer,ready=false,last='',customName=saved?.name??'',dirty=false,favouriteId=saved?.favouriteId??null;
 const link=(entry,favourite=false)=>{const target=new URL(location.href);for(const key of ['model','time','lat','lon','layout','favourite'])target.searchParams.delete(key);target.searchParams.set(favourite?'favourite':'layout',entry.id);return target.href;};
 const report=(message,error=false)=>{actionStatus.textContent=message;actionStatus.classList.toggle('layout-error',error);};
 const fail=()=>report('Could not save this change. Check that site storage is allowed and has space.',true);
 const button=(label,action)=>{const el=document.createElement('button');el.type='button';el.textContent=label;el.addEventListener('click',action);return el;};
 function rowFor(entry,isFavourite,startupId){
  const row=document.createElement('li'),anchor=document.createElement('a'),sub=document.createElement('span'),newTab=document.createElement('a'),actions=document.createElement('div');
  anchor.href=link(entry,isFavourite);anchor.textContent=entry.name||entry.title||'Map layout';anchor.className='layout-choice';
  sub.textContent=isFavourite?(entry.id===startupId?'Startup layout':'Saved favourite'):new Date(entry.updated).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+(entry.id===id?' · this tab':'');anchor.append(sub);
  newTab.href=anchor.href;newTab.target='_blank';newTab.rel='noopener';newTab.textContent='Open new tab';newTab.className='layout-new-tab';newTab.setAttribute('aria-label','Open '+(entry.name||entry.title||'layout')+' in a new tab');
  actions.className='layout-actions';actions.append(newTab);
  if(isFavourite){
   const rename=button('Rename',()=>{
    const form=document.createElement('form'),input=document.createElement('input');form.className='layout-name-row';input.value=entry.name;input.maxLength=80;input.required=true;input.setAttribute('aria-label','New favourite name');
    const submit=button('Save name',()=>{});submit.type='submit';
    form.append(input,submit,button('Cancel',()=>{form.remove();rename.hidden=false;rename.focus();}));rename.hidden=true;row.append(form);input.focus();input.select();
    form.addEventListener('submit',event=>{
     event.preventDefault();const value=input.value.trim();if(!value){input.setCustomValidity('Enter a favourite name.');input.reportValidity();return;}
     try{const current=favouritesNow().find(item=>item.id===entry.id);if(!current){report('This favourite was removed in another tab.',true);render();return;}
      writeFavourite(storage,{...current,name:value,updated:Date.now()});report('Favourite renamed.');render();startup.focus();
     }catch{fail();}
    });input.addEventListener('input',()=>input.setCustomValidity(''));
   });
   actions.append(rename,button('Remove',()=>{
    if(!confirm('Remove the favourite “'+entry.name+'”? Open tabs and recent layouts will stay available.'))return;
    try{removeFavourite(storage,entry.id);report('Favourite removed.');render();startup.focus();}catch{fail();}
   }));
  }
  row.append(anchor,actions);return row;
 }
 function renderRecent(){
  list.replaceChildren();
  for(const entry of entries().slice(0,4))list.append(rowFor(entry,false));
  if(!list.children.length){const empty=document.createElement('li');empty.textContent='Your layouts appear here as you use the charts.';list.append(empty);}
 }
 function render(){renderRecent();renderFavourites();}
 function renderFavourites(){
  const all=favouritesNow();let startupId;try{startupId=storage?.getItem(STARTUP_KEY);}catch{}
  favourites.replaceChildren();startup.replaceChildren(new Option('Standard single-panel view',''));
  for(const entry of all){favourites.append(rowFor(entry,true,startupId));startup.append(new Option(entry.name,entry.id));}
  startup.value=all.some(entry=>entry.id===startupId)?startupId:'';
  if(!all.length){const empty=document.createElement('li');empty.textContent='Save a named favourite to keep a setup here.';favourites.append(empty);}
  const current=all.find(entry=>entry.id===favouriteId);
  $('layout-update-favourite').hidden=!current;$('layout-favourite-copy').hidden=!current;
  $('layout-favourite-copy').textContent=current?'Working copy of “'+current.name+'”. Update favourite replaces its saved setup with this tab’s current setup.':'';
 }
 function currentLayout(){
  const layout=ready?cleanLayout(capture()):null;
  if(!layout)report('Wait for the map setup to finish loading, then try again.',true);
  return layout;
 }
 function save(){
  clearTimeout(timer);if(!ready||!dirty)return;
  const layout=cleanLayout(capture());if(!layout)return;
  const serial=JSON.stringify([customName,favouriteId,layout]);if(serial===last){dirty=false;return;}
  try{
   if(!storage)throw Error('Unavailable');writeLayout(storage,{id,name:customName,title:describe(layout),updated:Date.now(),favouriteId,layout});last=serial;dirty=false;
   const target=new URL(location.href);for(const key of ['model','time','lat','lon','favourite'])target.searchParams.delete(key);target.searchParams.set('layout',id);history.replaceState(history.state,'',target);notice.textContent='Saved automatically on this browser. Refresh keeps this tab’s setup.';
   // Autosaving a moving timeline must not replace a favourite rename form.
   renderRecent();
  }catch{notice.textContent='This browser could not save the layout. Check that site storage is allowed.';}
 }
 function changed(){if(!ready)return;dirty=true;clearTimeout(timer);timer=setTimeout(save,500);}
 // Native details toggle events are queued. Never reset text that the user
 // may already have started entering while the menu opens.
 name.value=customName;
 name.addEventListener('input',()=>name.setCustomValidity(''));
 host.addEventListener('toggle',()=>{if(host.open){save();render();}});
 document.getElementById('layout-save-name').addEventListener('click',()=>{customName=name.value.trim().slice(0,80);dirty=true;save();});
 $('layout-save-favourite').addEventListener('click',()=>{
  const value=name.value.trim();if(!value){name.setCustomValidity('Enter a name before saving a favourite.');name.reportValidity();return;}
  const layout=currentLayout();if(!layout)return;
  try{const entry={id:crypto.randomUUID(),name:value,title:describe(layout),updated:Date.now(),layout};writeFavourite(storage,entry);favouriteId=entry.id;customName=value;dirty=true;save();renderFavourites();report('Favourite saved. It stays here until you remove it.');}catch{fail();}
 });
 $('layout-update-favourite').addEventListener('click',()=>{
  const layout=currentLayout();if(!layout)return;
  try{const current=favouritesNow().find(entry=>entry.id===favouriteId);if(!current){report('This favourite was removed in another tab.',true);renderFavourites();return;}
   writeFavourite(storage,{...current,title:describe(layout),updated:Date.now(),layout});renderFavourites();report('Favourite updated from this tab’s setup.');
  }catch{fail();}
 });
 startup.addEventListener('change',()=>{try{setStartup(storage,startup.value);report(startup.value?'Startup layout set. It will open when you visit UK maps.':'UK maps will open with the standard single-panel view.');renderFavourites();}catch{fail();renderFavourites();}});
 document.addEventListener('pointerdown',event=>{if(!host.contains(event.target))host.open=false;});
 host.addEventListener('keydown',event=>{if(event.key==='Escape'){host.open=false;host.querySelector('summary').focus();}});
 window.addEventListener('storage',event=>{
  if(!host.open)return;
  if(!event.key||event.key.startsWith(LAYOUT_PREFIX))renderRecent();
  // Keep typing intact even when another monitor saves or renames a layout.
  if((!event.key||event.key.startsWith(FAVOURITE_PREFIX)||event.key===STARTUP_KEY)&&!favourites.querySelector('form'))renderFavourites();
 });
 document.addEventListener('snowline-layout-ready',changed);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
 window.addEventListener('pagehide',event=>{if(ready){dirty=true;save();}if(!event.persisted)release?.();});
 render();
 if(migrationFailed)report('Existing named layouts could not be copied to favourites. They are still in recent layouts; check site storage.',true);
 if(!saved&&(url.searchParams.has('layout')||url.searchParams.has('favourite')))report('That saved layout is unavailable in this browser. Choose a favourite or recent layout.',true);
 return {initial:saved?.layout,changed,save,start(getState,getTitle){capture=getState;describe=getTitle;ready=true;dirty=true;save();}};
}
