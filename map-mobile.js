// Keep the phone layout separate from forecast state and the desktop controls.
export function setupMobileMap(){
 const mobile=matchMedia('(max-width:650px)');
 const workspace=document.querySelector('.map-workspace');
 const stage=document.querySelector('.map-stage');
 const settings=document.getElementById('mobile-map-settings');
 const returnToMap=document.getElementById('mobile-return-map');
 const expand=document.getElementById('mobile-expand-map');
 const dialog=document.getElementById('expanded-map');
 const anchor=document.createComment('Map position');
 stage.before(anchor);
 let scrollY=0;
 function setSettings(open){
  workspace.classList.toggle('mobile-settings-open',open);
  settings.setAttribute('aria-expanded',String(open));
 }
 settings.addEventListener('click',()=>{
  const open=settings.getAttribute('aria-expanded')!=='true';
  setSettings(open);
  if(open){returnToMap.focus({preventScroll:true});document.getElementById('map-settings').scrollIntoView({block:'start'});}
 });
 returnToMap.addEventListener('click',()=>{setSettings(false);settings.focus({preventScroll:true});stage.scrollIntoView({block:'start'});});
 expand.addEventListener('click',()=>{
  if(dialog.open){dialog.close();return;}
  if(!mobile.matches)return;
  setSettings(false);scrollY=window.scrollY;
  dialog.append(stage);document.body.classList.add('expanded-map-open');
  expand.textContent='Close map';expand.setAttribute('aria-expanded','true');
  dialog.showModal();expand.focus({preventScroll:true});
 });
 function restoreMap(restorePosition=true){
  if(stage.parentNode!==dialog)return;
  anchor.after(stage);document.body.classList.remove('expanded-map-open');
  expand.textContent='Expand map';expand.setAttribute('aria-expanded','false');
  if(restorePosition){window.scrollTo(0,scrollY);if(mobile.matches)expand.focus({preventScroll:true});}
 }
 dialog.addEventListener('close',()=>restoreMap());
 // Event analysis lives below the map, so leave the expanded view before opening it.
 document.addEventListener('click',event=>{if(dialog.open&&event.target.closest('.event-link')){dialog.close();restoreMap(false);}},true);
 mobile.addEventListener('change',()=>{setSettings(false);if(!mobile.matches&&dialog.open)dialog.close();});
}
