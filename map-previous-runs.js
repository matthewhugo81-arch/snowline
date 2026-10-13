import {UKV_PREVIOUS,isUKVChoice} from './map-ukv-runs.js?v=20261013-ukv-retention';
import {UKV} from './ukv-run-selection.js?v=20261011-live-runs';
import {fixedAccumulationPeriods,periodStart,configurePeriodInterval,fixedPeriodNote} from './map-accumulation-periods.js?v=20261013-fixed-periods';
import {discoverPreviousRuns,previousRunPresets,previousRunTimes,newerRunAvailable} from './map-previous-run-data.js?v=20261013-ukv-retention';
import {BRIEFING_AREAS,BRIEFING_PRESETS,briefingCaption,briefingKey,BriefingImages} from './map-briefing-data.js?v=20261013-ukv-retention';
import {BriefingRenderer} from './map-briefing-renderer.js?v=20261013-ukv-retention';
import {runLabel,runAvailability} from './map-runs.js?v=20261011-live-runs';
import {chartScales} from './map-image-export.js?v=20261012-accum-history';
import {accumulationHours,accumulationPeriod} from './map-accumulation.js?v=20261012-accum-history';
const stamp=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const utc=time=>stamp.format(new Date(time))+' UTC';
function option(value,label){const el=document.createElement('option');el.value=value;el.textContent=label;return el;}

// Separate controller: no changes to the forecast-sequence state or main maps.
// Runs remain pinned until the user explicitly chooses/reloads them.
export function createPreviousRunAnalysis({host,models,fields,loadModel,loadRun,loadJSON,imageMenu,onClose,...renderOptions}){
 host.innerHTML=`<div class="briefing-heading"><div><h2>Previous Run Analysis</h2><p id="previous-status" role="status">Choose a model to compare three runs.</p></div><div class="briefing-heading-actions"><button type="button" class="secondary" id="previous-toggle-controls" aria-expanded="true" aria-controls="previous-control-section">Hide controls</button><button type="button" class="secondary" id="previous-close">Back to maps</button></div></div>
 <div id="previous-control-section"><div class="previous-controls">
 <label>Forecast model<select id="previous-model"></select></label>
 <label>Chart<select id="previous-preset" disabled></select></label>
 <label>Area<select id="previous-area"></select></label>
 <label><span id="previous-time-heading">Shared valid time · UTC</span><select id="previous-time" disabled></select></label>
 <label>Forecast interval<select id="previous-interval"><option value="native">Hourly / all available</option><option value="3" selected>3 hourly</option><option value="6">6 hourly</option></select></label>
 <button type="button" class="secondary" id="previous-refresh">Load latest three runs</button></div>
 <div class="briefing-overlays"><label class="check-row"><input type="checkbox" id="previous-contours"> Contours</label><label class="check-row"><input type="checkbox" id="previous-grid-values"> Grid values</label><span class="small-note">Same area, chart, colour scale and valid time. Each panel retains its own initialization and lead time.</span></div>
 <p id="previous-note" class="small-note"></p></div>
 <p id="previous-new" class="previous-notice" hidden>A newer run is available. Your comparison is unchanged. Show controls and use Load latest three runs to update it.</p>
 <div id="previous-legend" class="briefing-legend"></div>
 <div class="briefing-navigation"><button type="button" class="secondary" id="previous-back">Earlier valid time</button><p id="previous-progress" role="status"></p><button type="button" class="secondary" id="previous-retry" hidden>Retry charts</button><button type="button" class="secondary" id="previous-forward">Later valid time</button></div>
 <div id="previous-grid" class="previous-grid"></div>
 <p class="small-note">Recent run availability depends on the provider archive. No model cycles or missing hours are substituted. Weather: Open-Meteo / model providers. Map: OpenFreeMap / OpenMapTiles / OpenStreetMap; coastline: Natural Earth.</p>
 <dialog id="previous-enlarged"><div class="briefing-heading"><strong id="previous-enlarged-title"></strong><button type="button" class="secondary" id="previous-enlarged-close">Close chart</button></div><img id="previous-enlarged-image" alt=""><p id="previous-enlarged-note" class="small-note"></p><p class="small-note">Snowline · Weather: Open-Meteo / model providers · OpenFreeMap / OpenStreetMap · Natural Earth</p></dialog>`;
 const $=name=>host.querySelector('#previous-'+name),choices=models.filter(m=>!m.ensemble&&m.id!==UKV_PREVIOUS);
 for(const [label,items]of [['Short-term models',choices.filter(m=>m.regional)],['Medium-term models',choices.filter(m=>!m.regional)]]){const group=document.createElement('optgroup');group.label=label;for(const m of items)group.append(option(m.id,m.name));$('model').append(group);}
 for(const area of BRIEFING_AREAS)$('area').append(option(area.id,area.name));$('area').append(option('current','Current map area'));
 const cards=Array.from({length:3},(_,i)=>{
  const card=document.createElement('article');card.className='briefing-card';
  const label=document.createElement('label');label.className='previous-run-label';label.textContent='Panel '+(i+1)+' · initialization';
  const select=document.createElement('select');select.id='previous-run-'+i;select.setAttribute('aria-label','Panel '+(i+1)+' initialization');select.disabled=true;label.append(select);
  const title=document.createElement('h3'),caption=document.createElement('p'),button=document.createElement('button');button.className='briefing-chart';button.disabled=true;button.type='button';button.textContent='Select three available model runs.';
  card.append(label,title,caption,button);$('grid').append(card);select.addEventListener('change',()=>configureTimeline());
  return {card,select,title,caption,button};
 });
 document.dispatchEvent(new CustomEvent('snowline-model-menu-ready'));
 let active=false,generation=0,controller,renderController,renderer,work=Promise.resolve(),model,runs=[],times=[],index=0,requestedTime=Date.now(),currentBounds,requestedStart=null,interval='3';
 const runCount=()=>model?.id===UKV?2:3;
 const visibleCards=()=>cards.slice(0,runCount());
 const images=new BriefingImages(18),selected=()=>visibleCards().map(c=>runs.find(meta=>meta.reference_time===c.select.value)).filter(Boolean);
 const preset=()=>BRIEFING_PRESETS.find(p=>p.id===$('preset').value);
 const area=()=>BRIEFING_AREAS.find(a=>a.id===$('area').value);
 const bounds=()=>area()?.bounds??currentBounds,size=()=>area()?.size??[960,660];
 function cancel(){generation++;controller?.abort();renderController?.abort();renderer?.cancel();}
 function disable(value){for(const id of ['preset','time','back','forward','refresh'])$(id).disabled=value;for(const c of cards)c.select.disabled=value;}
 function navigation(){const empty=!times.length;$('back').disabled=empty||index===0;$('forward').disabled=empty||index===times.length-1;$('time').disabled=empty;$('time').value=accumulationHours(preset()?.field)&&times[index]?periodStart(times[index],accumulationHours(preset().field)):String(index);}
 function legend(){
  const p=preset(),field=fields.find(f=>f.key===p?.field);$('legend').replaceChildren();if(!p||!field)return;
  for(const scale of chartScales(field,'',p.id==='weather')){
   const item=document.createElement('div');item.className='briefing-scale';const heading=document.createElement('strong');heading.textContent=scale.name;
   const gradient=document.createElement('div');gradient.className='briefing-gradient';const colors=scale.colors;
   const stops=scale.bands||scale.discrete?colors.flatMap((c,i)=>[c+' '+100*i/colors.length+'%',c+' '+100*(i+1)/colors.length+'%']):colors;
   gradient.style.background='linear-gradient(to right,'+stops.join(',')+')';const labels=document.createElement('div');labels.className='briefing-scale-labels'+(scale.bands?' briefing-band-labels':'');
   for(const text of scale.labels){const span=document.createElement('span');span.textContent=text;labels.append(span);}item.append(heading,gradient,labels);$('legend').append(item);
  }
 }
 function configureTimeline(){
  renderController?.abort();renderer?.cancel();const chosen=selected(),previous=$('preset').value;
  const available=previousRunPresets(chosen,runCount());$('preset').replaceChildren(...available.map(p=>option(p.id,p.name)));$('preset').disabled=!available.length;
  $('preset').value=available.some(p=>p.id===previous)?previous:available[0]?.id??'';
  const hours=accumulationHours(preset()?.field),native=previousRunTimes(chosen,preset(),model,interval);
  configurePeriodInterval($('interval'),hours,interval,!!model?.regional);
  $('time-heading').textContent=hours?'Shared period start · UTC':'Shared valid time · UTC';
  $('back').textContent=hours?'Earlier period':'Earlier valid time';$('forward').textContent=hours?'Later period':'Later valid time';
  if(hours){
   const periods=fixedAccumulationPeriods(native,hours,requestedStart??requestedTime);
   times=periods.times;index=periods.index;requestedStart=periods.start??requestedStart;
   $('time').replaceChildren(...periods.starts.map(time=>option(time,utc(time))));
  }else{
   times=native;$('time').replaceChildren(...times.map((time,i)=>option(String(i),utc(time))));
   index=times.reduce((best,t,i)=>Math.abs(Date.parse(t)-requestedTime)<Math.abs(Date.parse(times[best])-requestedTime)?i:best,0);
  }
  $('note').textContent=hours?fixedPeriodNote(hours)+' All selected runs cover the identical start/end period.':preset()?.note??'Choose '+runCount()+' distinct runs that supply the same chart.';
  legend();navigation();render();
 }
 function render(){
  if(!active)return;renderController?.abort();renderer?.cancel();
  const token=++generation;renderController=new AbortController();const signal=renderController.signal;
  const chosen=selected(),p=preset(),time=times[index];$('retry').hidden=true;
  $('grid').style.setProperty('--briefing-aspect',size().join('/'));
  if(!time||chosen.length!==runCount()||!p){
   for(const c of cards){c.title.textContent='No comparable chart';c.caption.textContent='';c.button.replaceChildren('No common valid time or chart for the selected runs.');c.button.disabled=true;delete c.card.dataset.ready;}
   $('progress').textContent='Choose '+runCount()+' different runs with overlapping coverage. No missing data is substituted.';return;
  }
  requestedTime=Date.parse(time);if(accumulationHours(p.field))requestedStart=periodStart(time,accumulationHours(p.field));navigation();
  const opts={model:model.id,preset:p,bounds:[...bounds()],size:[...size()],overlays:{contours:$('contours').checked,grid:$('grid-values').checked}};
  let loaded=0,failed=0;const started=performance.now();
  const progress=()=>{if(token===generation)$('progress').textContent=loaded+'/'+runCount()+' charts ready'+(failed?' · '+failed+' unavailable':loaded===runCount()?' · '+((performance.now()-started)/1000).toFixed(1)+' s':'')+(accumulationHours(p.field)?' · Shared period: '+accumulationPeriod(p.field,time):' · Shared valid time: '+utc(time));};
  const show=(c,src,meta)=>{
   const description=model.name+' · Run '+runLabel(meta)+' · '+p.name+' · Valid '+utc(time),subtitle=briefingCaption(meta,p,time);
   const info={title:description,subtitle,scales:chartScales(fields.find(f=>f.key===p.field),subtitle,p.id==='weather')};
   const img=document.createElement('img');img.src=src;img.alt=description;img.decoding='async';c.button.replaceChildren(img);c.button.disabled=false;c.card.dataset.ready='true';imageMenu?.registerImage(img,info);
   c.button.onclick=()=>{$('enlarged-title').textContent=description;$('enlarged-note').textContent=subtitle;$('enlarged-image').src=src;$('enlarged-image').alt=description;imageMenu?.registerImage($('enlarged-image'),info);$('enlarged').showModal();};loaded++;
  };
  const tasks=chosen.map((meta,i)=>{
   const c=cards[i];delete c.card.dataset.ready;delete c.card.dataset.failed;c.card.dataset.run=meta.reference_time;c.card.dataset.time=time;
   c.title.textContent='Run '+runLabel(meta)+(meta.completed===false?' · updating':'');c.caption.textContent='Valid '+utc(time)+' · '+briefingCaption(meta,p,time);c.button.replaceChildren(accumulationHours(p.field)?'Queued · waiting to prepare this total…':'Preparing this run…');c.button.disabled=true;
   const key=briefingKey(model.id,meta,p,opts.bounds,time,opts.size,opts.overlays),cached=images.get(key);if(cached)show(c,cached,meta);
   return {c,meta,key,cached};
  });progress();
  work=work.catch(()=>{}).then(async()=>{
   if(signal.aborted)return;renderer??=new BriefingRenderer({...renderOptions,fields});
   for(const item of tasks){
    if(signal.aborted||!active)return;if(item.cached)continue;
    try{const src=await renderer.render({...opts,meta:item.meta,time,signal,onProgress:({done,total})=>{
     if(signal.aborted)return;item.c.button.textContent=done<total?'Preparing '+accumulationHours(p.field)+' h total · '+done+'/'+total+' native intervals':'Drawing map and grid values…';
    }});if(signal.aborted){URL.revokeObjectURL(src);return;}images.set(item.key,src);show(item.c,src,item.meta);}
    catch(error){if(signal.aborted)return;item.c.button.textContent='This run/time is unavailable. Use Retry charts.';item.c.card.dataset.failed='true';failed++;$('retry').hidden=false;}
    progress();
   }
   // Do not download an entire archive or pre-render all historical hours.
   // One next valid time (three images) is enough to make stepping responsive.
   const next=times[index+1];if(failed||!next||accumulationHours(p.field))return;
   for(const meta of chosen){
    if(signal.aborted||!active||document.hidden)return;
    const key=briefingKey(model.id,meta,p,opts.bounds,next,opts.size,opts.overlays);if(images.get(key))continue;
    try{const src=await renderer.render({...opts,meta,time:next,signal});if(signal.aborted){URL.revokeObjectURL(src);return;}images.set(key,src);}catch{if(signal.aborted)return;}
   }
  }).catch(error=>{if(token===generation)$('progress').textContent=error.message;});
 }
 async function loadLatest(){
  cancel();const token=generation;controller=new AbortController();const signal=controller.signal;disable(true);$('new').hidden=true;
  model=choices.find(m=>m.id===$('model').value);
  cards.forEach((c,i)=>{c.card.hidden=i>=runCount();});
  $('grid').style.setProperty('--previous-columns',runCount());
  $('refresh').textContent=model.id===UKV?'Check latest UKV runs':'Load latest three runs';
  runs=[];times=[];$('status').textContent='Checking published run and recent archive…';$('progress').textContent='Metadata only; no historical imagery is preloaded.';
  for(const c of cards){c.select.replaceChildren();c.button.replaceChildren('Checking archived runs…');c.button.disabled=true;delete c.card.dataset.ready;}
  try{
   const latest=await loadModel(model.id,true);if(token!==generation||!active)return;
   const archive=await discoverPreviousRuns({model:model.id,latest,load:loadJSON,loadRun,signal});if(token!==generation||!active)return;runs=archive.runs;
   for(const [i,c]of cards.entries()){
    c.select.replaceChildren(...runs.map(meta=>option(meta.reference_time,runLabel(meta)+' · '+runAvailability(meta))));c.select.value=runs[Math.max(0,runCount()-1-i)]?.reference_time??'';
   }
   $('status').textContent=model.name+' · '+(model.id===UKV?'Latest main run and one previous completed main run · checks every minute.':runs.length+' published runs found in the previous 48 hours. Runs are pinned until you change them.')+(archive.unavailable.length?' '+archive.unavailable.length+' archive cycles unavailable.':'')+(archive.errors.length?' '+archive.errors.length+' archive checks failed; use Load latest three runs to retry.':'');
   disable(false);if(runs.length<runCount()){$('progress').textContent='Fewer than '+runCount()+' verified runs are available. No substitute runs have been used.';return;}
   configureTimeline();
  }catch(error){if(token===generation&&active){$('status').textContent=error.message;$('refresh').disabled=false;$('progress').textContent='Archive unavailable. The main maps and forecast sequence are unchanged.';}}
 }
 $('model').addEventListener('change',loadLatest);$('refresh').addEventListener('click',loadLatest);
 $('preset').addEventListener('change',configureTimeline);$('interval').addEventListener('change',()=>{interval=$('interval').value;configureTimeline();});
 for(const name of ['area','contours','grid-values'])$(name).addEventListener('change',render);
 $('time').addEventListener('change',()=>{if(accumulationHours(preset()?.field)){requestedStart=$('time').value;configureTimeline();}else{index=Number($('time').value);render();}});
 $('back').addEventListener('click',()=>{index=Math.max(0,index-1);render();});$('forward').addEventListener('click',()=>{index=Math.min(times.length-1,index+1);render();});$('retry').addEventListener('click',render);
 $('toggle-controls').addEventListener('click',()=>{
  const hidden=!$('control-section').hidden;$('control-section').hidden=hidden;
  for(const c of cards)c.select.closest('.previous-run-label').hidden=hidden;
  $('toggle-controls').textContent=hidden?'Show controls':'Hide controls';
  $('toggle-controls').setAttribute('aria-expanded',String(!hidden));
 });
 $('close').addEventListener('click',onClose);$('enlarged-close').addEventListener('click',()=>$('enlarged').close());
 let ukvRefreshing=false;
 const available=async event=>{
  if(!active||event.detail?.model!==model?.id)return;
  if(model.id===UKV){
   const incoming=event.detail.meta,retained=incoming.previousCompletedRun;
   const signature=items=>JSON.stringify(items.map(m=>[m.reference_time,m.completed,m.valid_times]));
   if(ukvRefreshing||signature(runs)===signature([incoming,...(retained?[retained]:[])]))return;
   ukvRefreshing=true;try{await loadLatest();}finally{ukvRefreshing=false;}
  }else if(newerRunAvailable(selected(),event.detail.meta))$('new').hidden=false;
 };
 document.addEventListener('snowline-model-run-available',available);
 document.addEventListener('visibilitychange',()=>{if(!active)return;if(document.hidden){renderController?.abort();renderer?.cancel();}else if(runs.length>=runCount())render();});
 const close=()=>{active=false;cancel();renderer?.destroy();renderer=null;host.hidden=true;if($('enlarged').open)$('enlarged').close();};
 window.addEventListener('pagehide',()=>{close();images.clear();});
 return {open(selection){active=true;host.hidden=false;currentBounds=selection.bounds;requestedTime=Date.parse(selection.time)||Date.now();requestedStart=selection.periodStart??null;if(selection.preset)$('preset').replaceChildren(option(selection.preset,selection.preset));$('model').value=isUKVChoice(selection.model)?UKV:choices.some(m=>m.id===selection.model)?selection.model:choices.find(m=>m.id==='ukmo_uk_deterministic_2km')?.id??choices[0].id;$('area').value='uk';document.dispatchEvent(new CustomEvent('snowline-model-menu-ready'));loadLatest();},close};
}
