import {displayStops,displayUnit} from './map-wind-units.js?v=20261019-ensemble-extra';
import {PRECIPITATION_SCALE} from './map-catalogue.js?v=20261019-ensemble-extra';
import {WEATHER_COMPOSITE} from './map-weather-composite.js?v=20261018-rates';
import {isTypeField,NATIVE_PRECIPITATION_TYPE,precipitationTypeScales} from './map-precipitation-type.js?v=20261014-interaction-audit';
const CREDITS='Snowline · Weather: Open-Meteo / model providers · Map: OpenFreeMap / OpenMapTiles / OpenStreetMap · Coastline: Natural Earth';
const FONT='Arial, sans-serif';
// Detached descriptors prevent later model/run changes relabelling a saved image.
export function chartScales(field,interval='',weather=false){
 if(!field)return [];
 if(isTypeField(field.key))return precipitationTypeScales(field.key===NATIVE_PRECIPITATION_TYPE);
 if(weather||field.key===WEATHER_COMPOSITE)return [
  {name:'Modelled total cloud cover (not satellite observations)',colors:['#414141','#e6e6e6'],labels:['Clear · 0%','Overcast · 100%'],bands:false},
  {name:'Mean precipitation · mm/h'+(interval?' · '+interval:''),colors:[...PRECIPITATION_SCALE.colors],labels:PRECIPITATION_SCALE.stops.map((v,i)=>i===0?'<0.5':v+(i===PRECIPITATION_SCALE.stops.length-1?'+':'')),bands:true,note:'Below 0.5 mm/h: cloud remains visible; not necessarily dry.'}
 ];
 const offset=field.legendStart??0,stops=displayStops(field).slice(offset),colors=field.colors.slice(offset);
 const labels=field.categoryLabels?field.categoryLabels.slice(offset):field.bands?stops.map((v,i)=>v+(i===stops.length-1&&!field.categorical?'+':'')):[String(field.temperatureBands?stops[1]:stops[0]),String(stops.at(-1))];
 const notes=interval&&field.legendNote&&interval.startsWith(field.legendNote)?[interval]:[interval,field.legendNote];
 return [{name:field.name+(field.categorical?'':' · '+displayUnit(field)),colors,labels,bands:!!field.bands,discrete:!!field.temperatureBands,positions:stops.map(v=>(v-stops[0])/(stops.at(-1)-stops[0]||1)),note:notes.filter((v,i,a)=>v&&a.indexOf(v)===i).join(' · ')}];
}
export function imageFilename(title){return 'Snowline-'+String(title??'chart').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,175)+'.png';}
function lines(ctx,text,width){
 const out=[];let line='';
 for(const word of String(text??'').split(/\s+/)){if(line&&ctx.measureText(line+' '+word).width>width){out.push(line);line=word;}else line+=(line?' ':'')+word;}
 if(line)out.push(line);return out;
}
function canvasBlob(canvas){return new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>blob?resolve(blob):reject(Error('The chart image could not be prepared.')),'image/png');}catch{reject(Error('The browser could not export this map. Check that its tiles have loaded and try again.'));}});}
// Snapshot WebGL synchronously in its render callback. No persistent drawing
// buffer, extra map, changed zoom or re-fetch of forecast imagery is necessary.
export function captureMapFrame(map,getInfo,{root=document,timeout=8000}={}){
 return new Promise((resolve,reject)=>{
  let timer;
  const cleanup=()=>{clearTimeout(timer);map.off('render',capture);map.off('remove',removed);};
  const removed=()=>{cleanup();reject(Error('This map has been closed.'));};
  const capture=()=>{cleanup();try{
   const info=getInfo();if(info.ready===false)throw Error('Wait for a forecast chart to finish loading before copying or saving it.');
   const source=map.getCanvas();if(!source.width||!source.height)throw Error('There is no displayed map to export.');
   const canvas=root.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image export is unavailable in this browser.');
   ctx.drawImage(source,0,0);resolve({image:canvas,width:source.clientWidth||source.width,...info});
  }catch(error){reject(error);}};
  timer=setTimeout(()=>{cleanup();reject(Error('The map did not finish rendering. Try again once it has loaded.'));},timeout);
  map.on('render',capture);map.on('remove',removed);try{map.triggerRepaint();}catch(error){cleanup();reject(error);}
 });
}
// Weather, isobars, contours and grid labels are already in the map bitmap.
// Add the actual displayed run/time, matching legends and attribution around it.
export async function composeChartImage({image,width,title,subtitle='',scales=[],credits=CREDITS},{root=document}={}){
 const nw=image.naturalWidth||image.width,nh=image.naturalHeight||image.height;if(!nw||!nh)throw Error('This chart image has not loaded yet.');
 width=Math.max(240,Math.round(width||nw));const ratio=Math.max(1,nw/width),height=nh*width/nw,pad=12;
 const output=root.createElement('canvas'),ctx=output.getContext('2d');if(!ctx)throw Error('Image export is unavailable in this browser.');
 ctx.font='600 13px '+FONT;const heading=lines(ctx,title,width-pad*2);ctx.font='11px '+FONT;const sub=lines(ctx,subtitle,width-pad*2);
 const header=pad*2+heading.length*18+sub.length*15;
 const legends=scales.map(scale=>{ctx.font='600 11px '+FONT;const names=lines(ctx,scale.name,width-pad*2);ctx.font='10px '+FONT;const notes=lines(ctx,scale.note,width-pad*2);return {...scale,names,notes,height:44+names.length*15+notes.length*13};});
 ctx.font='10px '+FONT;const creditLines=lines(ctx,credits,width-pad*2),total=header+height+legends.reduce((n,l)=>n+l.height,0)+14+creditLines.length*13;
 output.width=Math.round(width*ratio);output.height=Math.ceil(total*ratio);ctx.scale(ratio,ratio);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,total);ctx.textBaseline='top';
 ctx.fillStyle='#0e2034';ctx.fillRect(0,0,width,header);ctx.fillStyle='#fff';ctx.font='600 13px '+FONT;
 let y=pad;for(const line of heading){ctx.fillText(line,pad,y);y+=18;}ctx.font='11px '+FONT;for(const line of sub){ctx.fillText(line,pad,y);y+=15;}
 ctx.drawImage(image,0,header,width,height);y=header+height;
 for(const scale of legends){
  y+=8;ctx.fillStyle='#0e2034';ctx.font='600 11px '+FONT;for(const line of scale.names){ctx.fillText(line,pad,y);y+=15;}
  const w=width-pad*2,n=scale.colors.length;
  if(scale.bands||scale.discrete){for(let i=0;i<n;i++){ctx.fillStyle=scale.colors[i];ctx.fillRect(pad+w*i/n,y,w/n+.2,12);}}
  else{const gradient=ctx.createLinearGradient(pad,0,pad+w,0);scale.colors.forEach((c,i)=>gradient.addColorStop(scale.positions?.[i]??(n===1?0:i/(n-1)),c));ctx.fillStyle=gradient;ctx.fillRect(pad,y,w,12);}
  ctx.strokeStyle='#cbd5e1';ctx.lineWidth=.5;ctx.strokeRect(pad,y,w,12);y+=15;ctx.fillStyle='#0e2034';ctx.font=(scale.bands?Math.min(10,w/scale.labels.length/3):10)+'px '+FONT;
  scale.labels.forEach((label,i)=>{ctx.textAlign=scale.bands?'center':i===0?'left':i===scale.labels.length-1?'right':'center';const x=scale.bands?pad+w*(i+.5)/scale.labels.length:pad+w*i/Math.max(1,scale.labels.length-1);ctx.fillText(label,x,y);});
  ctx.textAlign='left';y+=17;ctx.fillStyle='#43546a';ctx.font='10px '+FONT;for(const line of scale.notes){ctx.fillText(line,pad,y);y+=13;}y+=4;
 }
 ctx.fillStyle='#43546a';ctx.font='10px '+FONT;y+=5;for(const line of creditLines){ctx.fillText(line,pad,y);y+=13;}
 return {blob:await canvasBlob(output),filename:imageFilename(title)};
}
export function createChartImageMenu({root=document}={}){
 const win=root.defaultView??window,maps=new WeakMap(),images=new WeakMap(),menu=root.createElement('div');menu.className='chart-image-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Chart image');
 const copy=root.createElement('button'),save=root.createElement('button'),message=root.createElement('p');copy.type=save.type='button';copy.textContent='Copy image';save.textContent='Save image';copy.setAttribute('role','menuitem');save.setAttribute('role','menuitem');message.className='chart-image-message';message.setAttribute('role','status');message.hidden=true;menu.append(copy,save,message);
 let job=null,serial=0,focusBack,closeTimer,previewURL=null,preview=null;
 const say=text=>{message.hidden=!text;message.textContent=text;};
 function close(restore=false){serial++;clearTimeout(closeTimer);menu.hidden=true;job=null;if(restore&&focusBack?.isConnected)focusBack.focus({preventScroll:true});}
 function previewImage(result){
  if(!preview){preview=root.createElement('dialog');preview.className='chart-image-preview';preview.setAttribute('aria-label','Chart image preview');
   const note=root.createElement('p');note.textContent='Your browser blocked direct image copying. Right-click this preview to copy the image, or save it.';
   const dismiss=root.createElement('button');dismiss.type='button';dismiss.textContent='Close';dismiss.onclick=()=>preview.close();const image=root.createElement('img');image.alt='Snowline chart with run, valid time and legend';const link=root.createElement('a');link.textContent='Save image';preview.append(dismiss,note,link,image);root.body.append(preview);
   preview.addEventListener('close',()=>{if(previewURL)win.URL.revokeObjectURL(previewURL);previewURL=null;preview.querySelector('img').removeAttribute('src');});}
  if(previewURL)win.URL.revokeObjectURL(previewURL);previewURL=win.URL.createObjectURL(result.blob);preview.querySelector('img').src=previewURL;const link=preview.querySelector('a');link.href=previewURL;link.download=result.filename;if(!preview.open)preview.showModal();
 }
 async function perform(kind){
  if(!job)return;const pending=job,token=serial;copy.disabled=save.disabled=true;say(kind==='copy'?'Copying image…':'Preparing PNG…');
  try{
   if(kind==='copy'){try{
    if(!win.navigator.clipboard?.write||!win.ClipboardItem)throw Error('Image clipboard unavailable');
    // Write starts inside the click gesture; deferred PNG data also supports Safari.
    await win.navigator.clipboard.write([new win.ClipboardItem({'image/png':pending.then(result=>result.blob)})]);
   }catch{const result=await pending;if(token!==serial)return;previewImage(result);close();return;}}
   else{const result=await pending;if(token!==serial)return;const url=win.URL.createObjectURL(result.blob),link=root.createElement('a');link.href=url;link.download=result.filename;root.body.append(link);link.click();link.remove();win.setTimeout(()=>win.URL.revokeObjectURL(url),60000);}
   if(token===serial){say(kind==='copy'?'Image copied.':'PNG download started.');closeTimer=setTimeout(()=>close(true),1000);}
  }catch(error){if(token===serial)say(error.message||'Unable to prepare this chart image.');}
  finally{if(token===serial)copy.disabled=save.disabled=false;}
 }
 copy.addEventListener('click',()=>{void perform('copy');});save.addEventListener('click',()=>{void perform('save');});
 function context(event){
  const target=event.target;if(!target?.closest||target.closest('.chart-image-preview'))return;
  const image=target.closest('img'),mapNode=target.closest('.maplibregl-map'),entry=mapNode&&maps.get(mapNode),info=image&&images.get(image);if(!entry&&!info)return;
  event.preventDefault();event.stopPropagation();close();focusBack=root.activeElement;const token=serial;
  try{
   if(entry){entry.before?.();job=captureMapFrame(entry.map,entry.getInfo,{root}).then(snapshot=>composeChartImage(snapshot,{root}));}
   else{const canvas=root.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;if(!canvas.width||!canvas.height)throw Error('This chart image has not loaded yet.');canvas.getContext('2d').drawImage(image,0,0);job=composeChartImage({image:canvas,...structuredClone(info)},{root});}
  }catch(error){job=Promise.reject(error);}
  job.catch(error=>{if(token===serial)say(error.message||'Chart image unavailable.');});
  (target.closest('dialog[open]')??root.body).append(menu);menu.hidden=false;copy.disabled=save.disabled=false;say('');menu.style.left='0px';menu.style.top='0px';const box=menu.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(event.clientX,win.innerWidth-box.width-8))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,win.innerHeight-box.height-8))+'px';copy.focus({preventScroll:true});
 }
 function outside(event){if(!menu.hidden&&(!event.target?.nodeType||!menu.contains(event.target)))close();}
 function keyboard(event){if(menu.hidden)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();(event.key==='Home'?copy:event.key==='End'?save:root.activeElement===copy?save:copy).focus();}else if(event.key==='Tab')close();}
 root.addEventListener('contextmenu',context,true);root.addEventListener('pointerdown',outside,true);root.addEventListener('keydown',keyboard,true);win.addEventListener('resize',outside);win.addEventListener('scroll',outside,true);
 return {registerMap(map,getInfo,before){maps.set(map.getContainer(),{map,getInfo,before});},registerImage(image,info){if(info)images.set(image,structuredClone(info));},close,
  destroy(){close();root.removeEventListener('contextmenu',context,true);root.removeEventListener('pointerdown',outside,true);root.removeEventListener('keydown',keyboard,true);win.removeEventListener('resize',outside);win.removeEventListener('scroll',outside,true);menu.remove();preview?.close();preview?.remove();}};
}
