// Collapse only the desktop sidebar; the phone's Map settings drawer stays independent.
export function setupMapSidebar(){
 const workspace=document.querySelector('.map-workspace'),button=document.getElementById('toggle-map-sidebar'),content=document.getElementById('map-settings-content');
 if(!workspace||!button||!content)return;
 const desktop=matchMedia('(min-width:651px)');
 let collapsed=false;
 try{collapsed=localStorage.getItem('snowline-map-sidebar-collapsed')==='true';}catch{}
 function update(){
  const hidden=desktop.matches&&collapsed;
  workspace.classList.toggle('map-sidebar-collapsed',hidden);
  content.hidden=hidden;
  button.textContent=hidden?'›':'‹';
  button.setAttribute('aria-expanded',String(!hidden));
  button.setAttribute('aria-label',hidden?'Expand map settings':'Collapse map settings');
  button.title=hidden?'Expand map settings':'Collapse map settings';
 }
 button.addEventListener('click',()=>{
  collapsed=!collapsed;
  try{localStorage.setItem('snowline-map-sidebar-collapsed',String(collapsed));}catch{}
  update();
 });
 desktop.addEventListener('change',update);
 update();
}
