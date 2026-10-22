// Layouts contain control choices only, never forecasts or chart-cache data.
export const LAYOUT_PREFIX='snowline-map-layout-v1:';
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
export function layoutEntries(storage){
 const entries=[];
 for(let i=0;i<storage.length;i++){
  const key=storage.key(i);if(!key?.startsWith(LAYOUT_PREFIX))continue;
  try{const entry=JSON.parse(storage.getItem(key)),layout=cleanLayout(entry.layout);if(layout&&key===LAYOUT_PREFIX+entry.id&&/^[\w-]{1,80}$/.test(entry.id)&&Number.isFinite(entry.updated))entries.push({id:entry.id,name:text(entry.name,80),title:text(entry.title,240),updated:entry.updated,layout});}catch{}
 }
 return entries.sort((a,b)=>b.updated-a.updated||a.id.localeCompare(b.id));
}
export function writeLayout(storage,entry){
 const layout=cleanLayout(entry.layout);if(!layout)throw Error('Layout is not ready');
 storage.setItem(LAYOUT_PREFIX+entry.id,JSON.stringify({...entry,layout}));
 // Separate keys prevent another window's save from replacing the whole list.
 for(const old of layoutEntries(storage).slice(4))storage.removeItem(LAYOUT_PREFIX+old.id);
}

export async function createLayoutRestore(){
 const host=document.getElementById('layout-restore'),list=document.getElementById('layout-list'),notice=document.getElementById('layout-notice'),name=document.getElementById('layout-name');
 let storage;try{storage=localStorage;}catch{}
 const entries=()=>{try{return storage?layoutEntries(storage):[];}catch{return [];}};
 const url=new URL(location.href),explicit=['model','time','lat','lon'].some(key=>url.searchParams.has(key));
 let tabId;try{tabId=sessionStorage.getItem('snowline-layout-tab');}catch{}
 const navigation=performance.getEntriesByType('navigation')[0]?.type;
 const sourceId=url.searchParams.get('layout')??(!explicit&&['reload','back_forward'].includes(navigation)?tabId:null),saved=entries().find(e=>e.id===sourceId);
 let id=tabId??saved?.id??crypto.randomUUID(),release;
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
 let capture,describe,timer,ready=false,last='',customName=saved?.name??'',dirty=false;
 const link=entry=>{const target=new URL(location.href);for(const key of ['model','time','lat','lon'])target.searchParams.delete(key);target.searchParams.set('layout',entry.id);return target.href;};
 function render(){
  list.replaceChildren();
  for(const entry of entries().slice(0,4)){
   const row=document.createElement('li'),anchor=document.createElement('a'),sub=document.createElement('span'),newTab=document.createElement('a');
   anchor.href=link(entry);anchor.textContent=entry.name||entry.title||'Map layout';anchor.className='layout-choice';
   sub.textContent=new Date(entry.updated).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+(entry.id===id?' · this tab':'');anchor.append(sub);
   newTab.href=anchor.href;newTab.target='_blank';newTab.rel='noopener';newTab.textContent='Open new tab';newTab.className='layout-new-tab';newTab.setAttribute('aria-label','Open '+(entry.name||entry.title||'layout')+' in a new tab');
   row.append(anchor,newTab);list.append(row);
  }
  if(!list.children.length){const empty=document.createElement('li');empty.textContent='Your layouts appear here as you use the charts.';list.append(empty);}
 }
 function save(){
  clearTimeout(timer);if(!ready||!dirty)return;
  const layout=cleanLayout(capture());if(!layout)return;
  const serial=JSON.stringify([customName,layout]);if(serial===last){dirty=false;return;}
  try{
   if(!storage)throw Error('Unavailable');writeLayout(storage,{id,name:customName,title:describe(layout),updated:Date.now(),layout});last=serial;dirty=false;
   const target=new URL(location.href);for(const key of ['model','time','lat','lon'])target.searchParams.delete(key);target.searchParams.set('layout',id);history.replaceState(history.state,'',target);notice.textContent='Saved automatically on this browser. Your four most recent tab layouts are kept.';render();
  }catch{notice.textContent='This browser could not save the layout. Check that site storage is allowed.';}
 }
 function changed(){if(!ready)return;dirty=true;clearTimeout(timer);timer=setTimeout(save,500);}
 // Native details toggle events are queued. Never reset text that the user
 // may already have started entering while the menu opens.
 name.value=customName;
 host.addEventListener('toggle',()=>{if(host.open){save();render();}});
 document.getElementById('layout-save-name').addEventListener('click',()=>{customName=name.value.trim().slice(0,80);dirty=true;save();});
 document.addEventListener('pointerdown',event=>{if(!host.contains(event.target))host.open=false;});
 host.addEventListener('keydown',event=>{if(event.key==='Escape'){host.open=false;host.querySelector('summary').focus();}});
 window.addEventListener('storage',event=>{if(event.key?.startsWith(LAYOUT_PREFIX)&&host.open)render();});
 document.addEventListener('snowline-layout-ready',changed);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
 window.addEventListener('pagehide',event=>{if(ready){dirty=true;save();}if(!event.persisted)release?.();});
 render();
 return {initial:explicit?null:saved?.layout,changed,save,start(getState,getTitle){capture=getState;describe=getTitle;ready=true;if(saved&&!explicit)dirty=true;if(dirty)save();}};
}
