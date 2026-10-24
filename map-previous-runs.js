import {appearanceKey} from './map-appearance.js?v=20261024-loading-verified1';
import {backgroundOptions} from './map-backgrounds.js?v=20261013-map-appearance';
import {forecastValidity,forecastChartTitle,forecastTimeLabel} from './map-validity.js?v=20261024-rain-colours1';
import {UKV_PREVIOUS,isUKVChoice} from './map-ukv-runs.js?v=20261024-rain-colours1';
import {UKV} from './ukv-run-selection.js?v=20261011-live-runs';
import {fixedAccumulationPeriods,periodStart,configurePeriodInterval,fixedPeriodNote} from './map-accumulation-periods.js?v=20261019-12-hour';
import {discoverPreviousRuns,previousRunPresets,previousRunTimes,previousRunHasChart,previousRunPeriodNote,newerRunAvailable,refreshPinnedRun} from './map-previous-run-data.js?v=20261024-rain-colours1';
import {BRIEFING_AREAS,briefingTimes,briefingOptions,briefingCaption,briefingKey,BriefingImages} from './map-briefing-data.js?v=20261024-rain-colours1';
import {BriefingRenderer} from './map-briefing-renderer.js?v=20261024-rain-colours1';
import {runLabel,runAvailability} from './map-runs.js?v=20261020-run-selector';
import {chartScales} from './map-image-export.js?v=20261024-rain-colours1';
import {accumulationHours,accumulationPeriod} from './map-accumulation.js?v=20261014-interaction-audit';
const stamp=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const utc=time=>stamp.format(new Date(time))+' UTC';
function option(value,label){const el=document.createElement('option');el.value=value;el.textContent=label;return el;}

// Separate controller: no changes to the forecast-sequence state or main maps.
// Runs remain pinned until the user explicitly chooses/reloads them.
export function createPreviousRunAnalysis({host,models,fields,loadModel,loadRun,loadJSON,imageMenu,onClose,getAppearance=()=>({}),getBackground=()=>'light',onBackgroundChange=()=>{},...renderOptions}){
 host.innerHTML=`<div class="briefing-heading"><div><h2>Previous Run Analysis</h2><p id="previous-status" role="status">Choose a model to compare three runs.</p></div><div class="briefing-heading-actions"><button type="button" class="secondary" id="previous-toggle-controls" aria-expanded="true" aria-controls="previous-control-section">Hide controls</button><button type="button" class="secondary" id="previous-close">Back to maps</button></div></div>
 <div id="previous-control-section"><div class="previous-controls">
 <label>Forecast model<select id="previous-model"></select></label>
 <label>Chart<select id="previous-preset" disabled></select></label>
 <label>Area<select id="previous-area"></select></label>
 <label><span id="previous-time-heading">Shared valid time · UTC</span><select id="previous-valid-time" disabled></select></label>
 <label>Forecast interval<select id="previous-interval"><option value="native">Hourly / all available</option><option value="3" selected>3 hourly</option><option value="6">6 hourly</option><option value="12">12 hourly</option></select></label>
 <button type="button" class="secondary" id="previous-refresh">Load latest three runs</button></div>
 <div class="briefing-overlays"><label class="briefing-background">Map background<select id="previous-background">${backgroundOptions}</select></label><label class="check-row"><input type="checkbox" id="previous-contours"> Contours</label><label class="check-row"><input type="checkbox" id="previous-grid-values"> Grid values</label><span class="small-note">Same area, chart, colour scale and valid time. Each panel retains its own initialization and lead time.</span></div>
 <p id="previous-note" class="small-note"></p></div>
 <p id="previous-new" class="previous-notice" hidden>A newer run is available. Your comparison is unchanged. Show controls and use Load latest three runs to update it.</p>
 <div id="previous-legend" class="briefing-legend"></div>
 <div class="briefing-navigation"><button type="button" class="secondary" id="previous-back">Earlier valid time</button><p id="previous-progress" role="status"></p><button type="button" class="secondary" id="previous-retry" hidden>Retry charts</button><button type="button" class="secondary" id="previous-forward">Later valid time</button></div>
 <div id="previous-grid" class="previous-grid"></div>
 <p class="small-note">Recent run availability depends on the provider archive. No model cycles or missing hours are substituted. Weather: Open-Meteo / model providers. Map: OpenFreeMap / OpenMapTiles / OpenStreetMap; coastline: Natural Earth.</p>
 <dialog id="previous-enlarged"><div class="briefing-heading"><strong id="previous-enlarged-title"></strong></div><img id="previous-enlarged-image" alt="" role="button" tabindex="0" aria-label="Minimise chart" title="Click to minimise chart" style="cursor:zoom-out"><p id="previous-enlarged-note" class="small-note"></p><p class="small-note">Snowline · Weather: Open-Meteo / model providers · OpenFreeMap / OpenStreetMap · Natural Earth</p></dialog>`;
 const $=name=>host.querySelector('#previous-'+name),choices=models.filter(m=>m.id!==UKV_PREVIOUS).map(m=>m.id===UKV?{...m,name:'UKV'}:m);
 for(const [label,items]of [['Short-term models',choices.filter(m=>m.regional&&!m.ensemble)],['Medium-term models',choices.filter(m=>!m.regional&&!m.ensemble)],['Ensemble models',choices.filter(m=>m.ensemble)]]){const group=document.createElement('optgroup');group.label=label;for(const m of items)group.append(option(m.id,m.name));$('model').append(group);}
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
 let active=false,generation=0,controller,renderController,renderer,work=Promise.resolve(),model,runs=[],times=[],index=0,requestedTime=Date.now(),currentBounds,requestedStart=null,interval='3',historyCheckFailed=false,presets=[];
 const runCount=()=>3;
 const visibleCards=()=>cards.slice(0,runCount());
 const images=new BriefingImages(18),selected=()=>visibleCards().map(c=>runs.find(meta=>meta.reference_time===c.select.value)).filter(Boolean);
 const preset=()=>presets.find(p=>p.id===$('preset').value);
 const area=()=>BRIEFING_AREAS.find(a=>a.id===$('area').value);
 const bounds=()=>area()?.bounds??currentBounds,size=()=>area()?.size??[960,660];
 function cancel(){generation++;controller?.abort();renderController?.abort();renderer?.cancel();}
 function disable(value){for(const id of ['preset','valid-time','back','forward','refresh','background'])$(id).disabled=value;for(const c of cards)c.select.disabled=value;}
 function navigation(){const empty=!times.length;$('back').disabled=empty||index===0;$('forward').disabled=empty||index===times.length-1;$('valid-time').disabled=empty;$('valid-time').value=accumulationHours(preset()?.field)&&times[index]?periodStart(times[index],accumulationHours(preset().field)):String(index);}
 function legend(){
  const p=preset(),field=fields.find(f=>f.key===p?.field);$('legend').replaceChildren();if(!p||!field)return;
  $('contours').disabled=!!field.categorical;if(field.categorical)$('contours').checked=false;
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
  const available=presets=previousRunPresets(chosen,runCount(),fields);briefingOptions($('preset'),available);$('preset').disabled=!available.length;
  for(const el of $('preset').options){const p=available.find(p=>p.id===el.value);if(p.availableRunCount<runCount())el.textContent+=' · '+p.availableRunCount+'/'+runCount()+' runs';}
  $('preset').value=available.some(p=>p.id===previous)?previous:available[0]?.id??'';
  const hours=accumulationHours(preset()?.field),native=previousRunTimes(chosen,preset(),model,interval);
  configurePeriodInterval($('interval'),hours,interval,!!model?.regional);
  $('time-heading').textContent=hours?'Shared period start · UTC':'Shared valid time · UTC';
  $('back').textContent=hours?'Earlier period':'Earlier valid time';$('forward').textContent=hours?'Later period':'Later valid time';
  if(hours){
   const periods=fixedAccumulationPeriods(native,hours,requestedStart??requestedTime);
   times=periods.times;index=periods.index;requestedStart=periods.start??requestedStart;
   $('valid-time').replaceChildren(...periods.starts.map(time=>option(time,timeLabel(new Date(Date.parse(time)+hours*3600000).toISOString(),time))));
  }else{
   times=native;$('valid-time').replaceChildren(...times.map((time,i)=>option(String(i),timeLabel(time))));
   index=times.reduce((best,t,i)=>Math.abs(Date.parse(t)-requestedTime)<Math.abs(Date.parse(times[best])-requestedTime)?i:best,0);
  }
  legend();navigation();render();
 }
 function timeLabel(time,labelTime=time){
  const count=selected().filter(meta=>previousRunHasChart(meta,preset(),time)).length;
  return (labelTime!==time?utc(labelTime):[...new Set(selected().map(m=>forecastTimeLabel(preset().field,time,m)))].join(' / '))+(count<runCount()?' · '+count+'/'+runCount()+' runs':'');
 }
 function unavailableMessage(meta,p,time){
  const available=briefingTimes(meta,p,model,'native');
  if(!available.length)return 'This chart is not available in this run. Choose another initialization to compare it.';
  if(Date.parse(time)>Date.parse(available.at(-1)))return 'This run’s available '+(accumulationHours(p.field)?'complete periods end':'charts end')+' '+utc(available.at(-1))+'. Other runs continue; choose another initialization for this panel.';
  if(Date.parse(time)<Date.parse(available[0]))return 'This run’s available '+(accumulationHours(p.field)?'complete periods begin':'charts begin')+' '+utc(available[0])+'. Choose a later time or another initialization.';
  return accumulationHours(p.field)?'This run does not cover the complete selected period. No partial total is shown.':'This chart is not published at the selected time in this run. Its available times remain selectable.';
 }
 function render(){
  if(!active)return;renderController?.abort();renderer?.cancel();
  const token=++generation;renderController=new AbortController();const signal=renderController.signal;
  const chosen=selected(),p=preset(),time=times[index];$('retry').hidden=true;
  $('grid').style.setProperty('--briefing-aspect',size().join('/'));
  if(!time||chosen.length!==runCount()||!p){
   for(const c of cards){c.title.textContent='No available chart';c.caption.textContent='';c.button.replaceChildren('No available time or chart for the selected runs.');c.button.disabled=true;delete c.card.dataset.ready;delete c.card.dataset.failed;delete c.card.dataset.unavailable;}
   $('note').textContent='Choose '+runCount()+' distinct published runs.';
   $('progress').textContent='Choose '+runCount()+' different runs and an available chart. No missing data is substituted.';return;
  }
  requestedTime=Date.parse(time);if(accumulationHours(p.field))requestedStart=periodStart(time,accumulationHours(p.field));navigation();
  const opts={model:model.id,preset:p,bounds:[...bounds()],size:[...size()],background:$('background').value,appearance:getAppearance(),overlays:{contours:$('contours').checked,grid:$('grid-values').checked}};
  const hours=accumulationHours(p.field);
  $('note').hidden=p.field==='theta_w_precipitation_symbols';
  $('note').textContent=[hours?fixedPeriodNote(hours)+' Each displayed chart covers the identical start/end period.':p.note,'The full available range is shown; panels without data are marked individually.',previousRunPeriodNote(chosen,p,time)].filter(Boolean).join(' ');
  let loaded=0,failed=0,unavailable=0;const started=performance.now();
  const progress=()=>{if(token===generation)$('progress').textContent=loaded+'/'+(runCount()-unavailable)+' available charts ready'+(unavailable?' · '+unavailable+' run'+(unavailable===1?'':'s')+' without data at this time':'')+(failed?' · '+failed+' failed to load':loaded+unavailable===runCount()?' · '+((performance.now()-started)/1000).toFixed(1)+' s':'')+(hours?' · Shared period: '+accumulationPeriod(p.field,time):' · Valid time / periods: '+selected().map(m=>forecastTimeLabel(p.field,time,m)).filter((v,i,a)=>a.indexOf(v)===i).join(' / '));};
  const show=(c,src,meta)=>{
   const description=model.name+' · Run '+runLabel(meta)+' · '+forecastChartTitle(p.field,p.name,time,meta),subtitle=briefingCaption(meta,p,time);
   const info={title:description,subtitle,scales:chartScales(fields.find(f=>f.key===p.field),subtitle,p.id==='weather')};
   const img=document.createElement('img');img.src=src;img.alt=description;img.decoding='async';c.button.replaceChildren(img);c.button.disabled=false;c.card.dataset.ready='true';imageMenu?.registerImage(img,info);
   c.button.onclick=()=>{$('enlarged-title').textContent=description;$('enlarged-note').hidden=p.field==='theta_w_precipitation_symbols';$('enlarged-note').textContent=subtitle;$('enlarged-image').src=src;$('enlarged-image').alt=description;imageMenu?.registerImage($('enlarged-image'),info);$('enlarged').showModal();$('enlarged-image').focus();};loaded++;
  };
  const tasks=chosen.map((meta,i)=>{
   const c=cards[i];delete c.card.dataset.ready;delete c.card.dataset.failed;delete c.card.dataset.unavailable;c.card.dataset.run=meta.reference_time;c.card.dataset.time=time;c.button.onclick=null;
   c.title.textContent=model.name+' · '+forecastValidity(p.field,time,meta);c.caption.textContent='Run '+runLabel(meta)+(meta.completed===false?' · updating':'')+' · '+briefingCaption(meta,p,time);c.button.replaceChildren(accumulationHours(p.field)?'Queued · waiting to prepare this total…':'Preparing this run…');c.button.disabled=true;
   if(!previousRunHasChart(meta,p,time)){
    c.card.dataset.unavailable='true';c.caption.textContent='Run '+runLabel(meta)+' · No chart for this '+(hours?'period':'time');c.button.replaceChildren(unavailableMessage(meta,p,time));unavailable++;return null;
   }
   const key=briefingKey(model.id,meta,p,opts.bounds,time,opts.size,opts.overlays,opts.background,opts.appearance),cached=images.get(key);if(cached)show(c,cached,meta);
   return {c,meta,key,cached};
  }).filter(Boolean);progress();
  work=work.catch(()=>{}).then(async()=>{
   if(signal.aborted)return;if(renderer&&(renderer.background!==opts.background||renderer.appearanceKey!==appearanceKey(opts.appearance))){renderer.destroy();renderer=null;}
   renderer??=new BriefingRenderer({...renderOptions,fields,background:opts.background,appearance:opts.appearance});
   for(const [position,item]of tasks.entries()){
    if(signal.aborted||!active)return;if(item.cached)continue;
    const nextTask=tasks.slice(position+1).find(task=>!task.cached);
    try{const src=await renderer.render({...opts,meta:item.meta,time,signal,nextFrame:nextTask?{meta:nextTask.meta,time}:null,onProgress:({done,total})=>{
     if(signal.aborted)return;item.c.button.textContent=done<total?'Preparing '+accumulationHours(p.field)+' h total · '+done+'/'+total+' native intervals':'Drawing map and grid values…';
    }});if(signal.aborted){URL.revokeObjectURL(src);return;}images.set(item.key,src);show(item.c,src,item.meta);}
    catch(error){
     if(signal.aborted)return;
     const message=error?.message||'This run/time is unavailable.';
     console.warn('Previous-run chart could not render:',{run:item.meta.reference_time,time,field:p.field,message,error});
     item.c.button.textContent=message+' Use Retry charts.';item.c.card.dataset.failed='true';failed++;$('retry').hidden=false;
    }
    progress();
   }
   // Do not download an entire archive or pre-render all historical hours.
   // One next valid time (three images) is enough to make stepping responsive.
   const next=times[index+1];if(failed||!next||accumulationHours(p.field))return;
   for(const meta of chosen){
    if(signal.aborted||!active||document.hidden)return;
    if(!previousRunHasChart(meta,p,next))continue;
    const key=briefingKey(model.id,meta,p,opts.bounds,next,opts.size,opts.overlays,opts.background,opts.appearance);if(images.get(key))continue;
    try{const src=await renderer.render({...opts,meta,time:next,signal});if(signal.aborted){URL.revokeObjectURL(src);return;}images.set(key,src);}catch{if(signal.aborted)return;}
   }
  }).catch(error=>{if(token===generation)$('progress').textContent=error.message;});
 }
 async function loadLatest(){
  cancel();const token=generation;controller=new AbortController();const signal=controller.signal;disable(true);$('new').hidden=true;
  const previousModel=model?.id,retainedRuns=runs;
  model=choices.find(m=>m.id===$('model').value);
  cards.forEach((c,i)=>{c.card.hidden=i>=runCount();});
  $('grid').style.setProperty('--previous-columns',runCount());
  $('refresh').textContent=model.id===UKV?'Check latest UKV runs':'Load latest three runs';
  runs=[];times=[];$('status').textContent='Checking published run and recent archive…';$('progress').textContent='Metadata only; no historical imagery is preloaded.';
  for(const c of cards){c.select.replaceChildren();c.button.replaceChildren('Checking archived runs…');c.button.disabled=true;delete c.card.dataset.ready;}
  try{
   const latest=await loadModel(model.id,true);if(token!==generation||!active)return;
   const archive=await discoverPreviousRuns({model:model.id,latest,load:loadJSON,loadRun,signal,retainedRuns:previousModel===model.id?retainedRuns:[]});if(token!==generation||!active)return;runs=archive.runs;historyCheckFailed=archive.errors.length>0;
   for(const [i,c]of cards.entries()){
    c.select.replaceChildren(...runs.map(meta=>option(meta.reference_time,runLabel(meta)+' · '+runAvailability(meta))));c.select.value=runs[Math.max(0,runCount()-1-i)]?.reference_time??'';
   }
   $('status').textContent=model.name+' · '+(model.id===UKV?'Latest main run and two previous completed main runs · checks every minute.':runs.length+' published runs found in the previous 48 hours. Runs are pinned until you change them.')+(archive.unavailable.length?' '+archive.unavailable.length+' archive cycles unavailable.':'')+(archive.errors.length?' '+archive.errors.length+' archive checks failed; use the run-check button to retry.':'');
   disable(false);if(runs.length<runCount()){
    $('preset').replaceChildren();presets=[];$('preset').disabled=true;$('legend').replaceChildren();navigation();
    for(const c of cards){c.title.textContent=model.name+' · Comparison unavailable';c.caption.textContent='';c.button.replaceChildren('Three archived runs are needed for this comparison.');}
    $('note').textContent=archive.notice??'';$('progress').textContent=archive.notice??'Fewer than '+runCount()+' verified runs are available. No substitute runs have been used.';return;
   }
   configureTimeline();
  }catch(error){if(token===generation&&active){$('status').textContent=error.message;$('refresh').disabled=false;$('progress').textContent='Archive unavailable. The main maps and forecast sequence are unchanged.';}}
 }
 $('background').addEventListener('change',()=>{onBackgroundChange($('background').value);render();});
 $('model').addEventListener('change',loadLatest);$('refresh').addEventListener('click',loadLatest);
 $('preset').addEventListener('change',configureTimeline);$('interval').addEventListener('change',()=>{interval=$('interval').value;configureTimeline();});
 for(const name of ['area','contours','grid-values'])$(name).addEventListener('change',render);
 $('valid-time').addEventListener('change',()=>{if(accumulationHours(preset()?.field)){requestedStart=$('valid-time').value;configureTimeline();}else{index=Number($('valid-time').value);render();}});
 $('back').addEventListener('click',()=>{index=Math.max(0,index-1);render();});$('forward').addEventListener('click',()=>{index=Math.min(times.length-1,index+1);render();});$('retry').addEventListener('click',render);
 $('toggle-controls').addEventListener('click',()=>{
  const hidden=!$('control-section').hidden;$('control-section').hidden=hidden;
  for(const c of cards)c.select.closest('.previous-run-label').hidden=hidden;
  $('toggle-controls').textContent=hidden?'Show controls':'Hide controls';
  $('toggle-controls').setAttribute('aria-expanded',String(!hidden));
 });
 $('close').addEventListener('click',onClose);$('enlarged-image').addEventListener('click',()=>$('enlarged').close());
 $('enlarged-image').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('enlarged').close();}});
 let ukvRefreshing=false;
 const available=async event=>{
  if(!active||event.detail?.model!==model?.id)return;
  if(model.id===UKV){
   const incoming=event.detail.meta,retained=incoming.previousCompletedRun;
   const signature=items=>JSON.stringify(items.map(m=>[m.reference_time,m.completed,m.valid_times]));
   if(ukvRefreshing||(runs.length===3&&!historyCheckFailed&&signature(runs.slice(0,2))===signature([incoming,...(retained?[retained]:[])])))return;
   ukvRefreshing=true;try{await loadLatest();}finally{ukvRefreshing=false;}
  }else{
   const incoming=event.detail.meta,next=refreshPinnedRun(runs,incoming);
   if(next!==runs){
    const shown=selected().some(meta=>Date.parse(meta.reference_time)===Date.parse(incoming.reference_time));
    runs=next;
    for(const card of cards)for(const el of card.select.options){const meta=runs.find(m=>m.reference_time===el.value);if(meta)el.textContent=runLabel(meta)+' · '+runAvailability(meta);}
    // Pin initialization, not an incomplete snapshot of its arriving data.
    if(shown){images.clear();configureTimeline();}
   }
   if(newerRunAvailable(selected(),incoming))$('new').hidden=false;
  }
 };
 document.addEventListener('snowline-model-run-available',available);
 document.addEventListener('visibilitychange',()=>{if(!active)return;if(document.hidden){renderController?.abort();renderer?.cancel();}else if(runs.length>=runCount())render();});
 const close=()=>{active=false;cancel();renderer?.destroy();renderer=null;host.hidden=true;if($('enlarged').open)$('enlarged').close();};
 window.addEventListener('pagehide',()=>{close();images.clear();});
 return {open(selection){$('background').value=getBackground();active=true;host.hidden=false;currentBounds=selection.bounds;requestedTime=Date.parse(selection.time)||Date.now();requestedStart=selection.periodStart??null;if(selection.preset)$('preset').replaceChildren(option(selection.preset,selection.preset));$('model').value=isUKVChoice(selection.model)?UKV:choices.some(m=>m.id===selection.model)?selection.model:choices.find(m=>m.id==='ukmo_uk_deterministic_2km')?.id??choices[0].id;$('area').value=selection.area??'uk';document.dispatchEvent(new CustomEvent('snowline-model-menu-ready'));loadLatest();},selection:()=>({model:model?.id,preset:preset()?.id,time:times[index],periodStart:accumulationHours(preset()?.field)&&times[index]?periodStart(times[index],accumulationHours(preset().field)):null}),close};
}
