// Catch module-loading and renderer initialization failures before leaving a
// permanent loading screen. Successful startup keeps the existing map flow.
export function showStartupFailure(error,doc=document,reload=()=>location.reload()){
 const graphics=/webgl|GPUInitializationError/i.test(String(error?.name)+' '+String(error?.message));
 const message=graphics?'The map could not start because WebGL2 graphics are unavailable. Enable hardware acceleration or try another browser, then reload.':'The map could not start. Check your connection and reload the page.';
 for(const id of ['map-status','preload-status','map-time-label','animation-status','panel-label-a']){
  const element=doc.getElementById(id);if(element)element.textContent=id==='map-time-label'?'Map unavailable':message;
 }
 const panel=doc.getElementById('map-error-a');
 if(panel){panel.hidden=false;panel.textContent=message;panel.setAttribute('role','alert');}
 for(const element of doc.querySelectorAll('.map-main select, .map-main input, #play-map, #previous-time, #next-time'))element.disabled=true;
 const retry=doc.getElementById('reload-maps');
 if(retry){retry.disabled=false;retry.textContent='Reload map';retry.addEventListener('click',reload,{once:true});}
 return message;
}
export async function startMapPage({load=()=>import('./maps.js?v=20261022-retention-recovery'),doc=globalThis.document,reload}={}){
 try{await load();return true;}
 catch(error){showStartupFailure(error,doc,reload);console.error('Snowline map startup:',error);return false;}
}
if(typeof document!=='undefined')void startMapPage();
