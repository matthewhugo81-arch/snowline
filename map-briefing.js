import {anomalyLegend} from './map-anomaly-scale.js?v=20261023-revised-1c';
import {productField,productChoices,loadProducts} from './map-ensemble-products.js?v=20261023-revised-1c';
import {appearanceKey} from './map-appearance.js?v=20261023-revised-1c';
import {backgroundOptions} from './map-backgrounds.js?v=20261013-map-appearance';
import {forecastValidity,forecastPointTimeLabel as forecastTimeLabel} from './map-validity.js?v=20261023-phase-mechanism2';
import {fixedAccumulationPeriods,periodStart,configurePeriodInterval,fixedPeriodNote} from './map-accumulation-periods.js?v=20261019-12-hour';
import {createPreviousRunAnalysis} from './map-previous-runs.js?v=20261023-phase-mechanism2';
import {accumulationHours} from './map-accumulation.js?v=20261014-interaction-audit';
import {BRIEFING_PRESETS,BRIEFING_AREAS,briefingPresets,briefingOptions,briefingTimes,briefingPage,briefingCaption,briefingKey,BriefingImages} from './map-briefing-data.js?v=20261023-phase-mechanism2';
import {BriefingRenderer} from './map-briefing-renderer.js?v=20261023-phase-mechanism2';
import {forecastInterval} from './map-interval.js?v=20261019-12-hour';
import {runLabel,runAvailability,runSignature,retainRunProgress} from './map-runs.js?v=20261020-run-selector';
import {PRECIPITATION_SCALE} from './map-catalogue.js?v=20261023-phase-mechanism2';
import {displayStops,displayUnit} from './map-wind-units.js?v=20261019-ensemble-extra4';
import {chartScales} from './map-image-export.js?v=20261023-phase-mechanism2';

import {isTypeField} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {mapRunCatalogue,sourceModel,selectedRunKey,selectedReference,renderRunSelector} from './map-run-selection.js?v=20261022-retention-recovery';
const date=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const stamp=time=>date.format(new Date(time))+' UTC';
const option=(value,label)=>{const el=document.createElement('option');el.value=value;el.textContent=label;return el;};

export function createBriefing({host,models,loadModel,loadRun,loadJSON,fields,imageMenu,onClose,onMetadata=()=>{},getAppearance=()=>({}),getBackground=()=>'light',onBackgroundChange=()=>{},...renderOptions}){
 host.innerHTML=`<div class="briefing-mode-row" role="group" aria-label="Briefing mode"><button type="button" id="briefing-sequence-mode" aria-pressed="true">Forecast sequence</button><button type="button" class="secondary" id="briefing-history-mode" aria-pressed="false">Previous Run Analysis</button></div><div id="briefing-sequence"><div class="briefing-heading"><div><h2>Forecast briefing</h2><p id="briefing-run">Choose a model and chart.</p></div><div class="briefing-heading-actions"><button type="button" id="briefing-toggle-controls" class="secondary" aria-expanded="true" aria-controls="briefing-control-section">Hide controls</button><button type="button" id="briefing-close" class="secondary">Back to maps</button></div></div>
 <div id="briefing-control-section"><div class="briefing-controls">
 <label>Forecast model<select id="briefing-model"></select></label>
 <label>Run<select id="briefing-run-select" disabled><option>Checking runs…</option></select></label>
 <label>Chart<select id="briefing-preset"></select></label>
 <label>Area<select id="briefing-area"></select></label>
 <label><span id="briefing-time-heading">Valid time · UTC</span><select id="briefing-time"></select></label>
 <label>Forecast interval<select id="briefing-interval"><option value="native">Hourly / all available</option><option value="3" selected>3 hourly</option><option value="6">6 hourly</option><option value="12">12 hourly</option></select></label>
 <label>Layout<select id="briefing-count"><option value="6">6 panels</option><option value="9">9 panels</option></select></label>
 <div class="briefing-overlays" role="group" aria-label="Briefing chart overlays"><label class="briefing-background">Map background<select id="briefing-background">${backgroundOptions}</select></label><label class="check-row"><input id="briefing-contours" type="checkbox" autocomplete="off"> Contours</label><label class="check-row"><input id="briefing-grid-values" type="checkbox" autocomplete="off"> Grid values</label></div>
 <div id="briefing-legend" class="briefing-legend" role="group" aria-label="Chart colour scale"></div></div></div>
 <div class="briefing-navigation"><button id="briefing-previous" class="secondary">Earlier charts</button><p id="briefing-status" role="status" aria-live="polite"></p><button id="briefing-retry" class="secondary" hidden>Retry charts</button><button id="briefing-next" class="secondary">Later charts</button></div>
 <div id="briefing-grid" class="briefing-grid" aria-label="Forecast chart sequence"></div>
 <p class="small-note briefing-credits">Charts show one model run with matching fields. Blank areas are outside available model coverage. Weather: Open-Meteo / model providers. Map: OpenFreeMap / OpenMapTiles / OpenStreetMap; coastline: Natural Earth. <a href="map-credits.html?v=20261020-run-selector">Data and map credits</a>.</p>
 <dialog id="briefing-enlarged"><div class="briefing-heading"><strong id="briefing-enlarged-title"></strong></div><img id="briefing-enlarged-image" alt="" role="button" tabindex="0" aria-label="Minimise chart" title="Click to minimise chart" style="cursor:zoom-out"><p id="briefing-enlarged-note"></p><p class="small-note">Weather: Open-Meteo / model providers. Map: OpenFreeMap / OpenMapTiles / OpenStreetMap. <a href="map-credits.html?v=20261020-run-selector">Credits</a>.</p></dialog></div><section id="previous-run-view" hidden aria-label="Previous Run Analysis"></section>`;
 const $=id=>host.querySelector('#briefing-'+id);
 const choices=models;
 for(const [label,items] of [['Short-term models',choices.filter(model=>model.regional&&!model.ensemble)],['Medium-term models',choices.filter(model=>!model.regional&&!model.ensemble)],['Ensemble models',choices.filter(model=>model.ensemble)]] ){
  if(!items.length)continue;
  const group=document.createElement('optgroup');group.label=label;
  for(const model of items)group.append(option(model.id,model.name));
  $('model').append(group);
 }
 document.dispatchEvent(new CustomEvent('snowline-model-menu-ready'));
 for(const area of BRIEFING_AREAS)$('area').append(option(area.id,area.name));
 $('area').append(option('current','Current map area'));
 for(const preset of BRIEFING_PRESETS)$('preset').append(option(preset.id,preset.name));
 const images=new BriefingImages();
 let renderer,active=false,generation=0,controller,work=Promise.resolve(),model,meta,preset,times=[],start=0,interval='3',currentBounds,requestedTime,requestedStart=null,requestedChart=null,presets=[],runKey=null;
 const normalMenus=new Map();
 const modelName=()=>meta?.productOnly?model.name.split(' · ')[0]:model.name;
 const menuPresets=()=>briefingPresets(meta?.productOnly?(normalMenus.get(model.id)??meta):meta,fields,model.id);
 async function selectedMetadata(force){
  const load=url=>loadJSON(url,{force});
  const key=requestedChart??$('preset').value;
  if(productChoices(model.id).some(f=>f.key===key)){
   const [product,normal]=await Promise.all([loadProducts(model.id,load,runKey?selectedReference(runKey):null),normalMenus.has(model.id)?null:mapRunCatalogue.select(model.id,load).catch(()=>null)]);
   if(normal)normalMenus.set(sourceModel(normal.key),normal.meta);
   if(!product.variables.includes(key))throw Error('This chart is not yet published for this ensemble run. Choose another chart or retry after publication.');
   return {meta:product,key:selectedRunKey(model.id,product)};
  }
  return mapRunCatalogue.select(runKey??model.id,load);
 }
 const count=()=>Number($('count').value);
 const bounds=()=>$('area').value==='current'?currentBounds:BRIEFING_AREAS.find(area=>area.id===$('area').value).bounds;
 const chartSize=()=>BRIEFING_AREAS.find(area=>area.id===$('area').value)?.size??[960,660];
 const overlays=()=>({contours:$('contours').checked,grid:$('grid-values').checked});
 function configureOverlays(){const field=fields.find(field=>field.key===preset?.field);$('contours').disabled=!!field?.categorical;if(field?.categorical)$('contours').checked=false;}
 function cancel(){controller?.abort();renderer?.cancel();generation++;}
 function controlsDisabled(disabled){for(const id of ['preset','time','interval','previous','next','contours','grid-values'])$(id).disabled=disabled;}
 function navigation(){
  $('previous').disabled=!times.length||start===0;
  $('next').disabled=!times.length||start+count()>=times.length;
  const hours=accumulationHours(preset?.field);
  $('time').value=hours&&times[start]?periodStart(times[start],hours):String(start);
 }
 function legend(){
  $('legend').replaceChildren();
  const field=fields.find(field=>field.key===preset.field);
  if(isTypeField(field.key)){for(const scale of chartScales(field)){const item=document.createElement('div'),heading=document.createElement('strong'),gradient=document.createElement('div'),labels=document.createElement('div');item.className='briefing-scale';heading.textContent=scale.name;gradient.className='briefing-gradient';gradient.style.background='linear-gradient(to right,'+scale.colors.flatMap((c,i)=>[c+' '+i*25+'%',c+' '+(i+1)*25+'%']).join(',')+')';labels.className='briefing-scale-labels briefing-band-labels';for(const text of scale.labels){const span=document.createElement('span');span.textContent=text;labels.append(span);}item.append(heading,gradient,labels);$('legend').append(item);}return;}
  const item=document.createElement('div'),title=document.createElement('strong'),gradient=document.createElement('div'),labels=document.createElement('div');
  item.className='briefing-scale';item.setAttribute('role','group');item.setAttribute('aria-label',field.name+' colour scale');gradient.className='briefing-gradient';labels.className='briefing-scale-labels';
  const anomaly=anomalyLegend(field);
  if(anomaly){title.textContent='°C · 1°C bands';gradient.style.background=anomaly.gradient;gradient.style.borderLeft='3px solid '+anomaly.endColors[0];gradient.style.borderRight='3px solid '+anomaly.endColors[1];gradient.title=field.legendNote;for(const v of anomaly.ticks){const label=document.createElement('span');label.textContent=(v>0?'+':'')+v+'°';labels.append(label);}item.append(title,gradient,labels);$('legend').append(item);return;}
  if(preset.id==='weather'){
   title.textContent='Cloud cover';gradient.style.background='linear-gradient(to right,#414141,#e6e6e6)';labels.innerHTML='<span>Clear · 0%</span><span>Overcast · 100%</span>';
  }else{
   const colors=field.colors.slice(field.legendStart??0),scale=displayStops(field).slice(field.legendStart??0),unit=displayUnit(field),min=field.temperatureBands?scale[1]:scale[0],max=scale.at(-1);
   // Continuous scales already label their units at the endpoints.
   title.textContent=field.bands&&!field.categorical?unit:'';
   const stops=field.temperatureBands||field.bands?colors.flatMap((color,index)=>[color+' '+100*index/colors.length+'%',color+' '+100*(index+1)/colors.length+'%']):colors.map((color,index)=>color+' '+100*(scale[index]-min)/(max-min)+'%');
   gradient.style.background='linear-gradient(to right,'+stops.join(',')+')';
   if(field.bands){
    labels.classList.add('briefing-band-labels');
    for(const text of chartScales(field)[0].labels){const label=document.createElement('span');label.textContent=text;labels.append(label);}
   }else{
    const low=document.createElement('span'),high=document.createElement('span');low.textContent=min+' '+unit;high.textContent=max+' '+unit;labels.append(low,high);
   }
  }
  if(title.textContent)item.append(title);item.append(gradient,labels);$('legend').append(item);
  if(preset.id==='weather'){
   const rain=document.createElement('div');rain.className='briefing-rain-scale';
   const heading=document.createElement('strong');heading.textContent='Precipitation · mm/h';rain.append(heading);
   const bands=document.createElement('div');bands.className='briefing-rain-bands';
   PRECIPITATION_SCALE.stops.slice(1).forEach((value,index)=>{const band=document.createElement('span');band.style.borderTopColor=PRECIPITATION_SCALE.colors[index+1];band.textContent=value+(index===PRECIPITATION_SCALE.stops.length-2?'+':'');bands.append(band);});
   rain.append(bands);$('legend').append(rain);
  }
 }
 function timeline(){
  preset=presets.find(item=>item.id===$('preset').value);
  const native=briefingTimes(meta,preset,model,interval),hours=accumulationHours(preset.field);
  const regional=forecastInterval([model],interval).shortRange;
  configurePeriodInterval($('interval'),hours,interval,regional);
  $('time-heading').textContent=hours?'Period start · UTC':'Valid time · UTC';
  $('previous').textContent=hours?'Earlier periods':'Earlier charts';$('next').textContent=hours?'Later periods':'Later charts';
  if(hours){
   const periods=fixedAccumulationPeriods(native,hours,requestedStart??requestedTime);
   times=periods.times;start=periods.index;requestedStart=periods.start??requestedStart;
   $('time').replaceChildren(...periods.starts.map(time=>option(time,stamp(time))));
  }else{
   times=native;
   $('time').replaceChildren(...times.map((time,index)=>option(String(index),forecastTimeLabel(preset.field,time,meta))));
   start=times.reduce((best,time,index)=>Math.abs(Date.parse(time)-requestedTime)<Math.abs(Date.parse(times[best])-requestedTime)?index:best,0);
  }
  $('time').disabled=!times.length;legend();navigation();configureOverlays();
 }
 function periodTitle(time){const stamp='VALID '+forecastTimeLabel(preset.field,time,meta)+' UTC';const validity=forecastValidity(preset.field,time,meta);return validity.startsWith('24 hr ')?validity.replace(/VALID .*/,stamp):stamp;}
 function chartTitle(time){const title=periodTitle(time);return title.startsWith('24 hr ')?title:preset.name+' · '+title;}
 function rememberTime(){if(times[start]){requestedTime=Date.parse(times[start]);const hours=accumulationHours(preset?.field);if(hours)requestedStart=periodStart(times[start],hours);}}
 function enlarge(src,time,exportInfo){
  const title=exportInfo.title;
  const [width,height]=chartSize();$('enlarged-image').width=width;$('enlarged-image').height=height;
  $('enlarged-title').textContent=title;$('enlarged-image').src=src;$('enlarged-image').alt=title;
  $('enlarged-note').hidden=preset.field==='theta_w_precipitation_symbols';
  $('enlarged-note').textContent=briefingCaption(meta,preset,time)+'. '+(accumulationHours(preset.field)?fixedPeriodNote(accumulationHours(preset.field)):preset.note);
  $('enlarged').classList.toggle('briefing-square',chartSize()[0]===chartSize()[1]);
  imageMenu?.registerImage($('enlarged-image'),exportInfo);
  $('enlarged').showModal();$('enlarged-image').focus();
 }
 function renderPage(){
  if(!active||!meta||!preset)return;cancel();
  document.dispatchEvent(new Event('snowline-layout-ready'));
  if(!times.length){$('grid').replaceChildren();$('status').textContent='No common forecast times for this chart.';navigation();return;}
  const token=generation;controller=new AbortController();const signal=controller.signal;
  const selection={model:model.id,meta,preset,bounds:[...bounds()],size:[...chartSize()],background:$('background').value,appearance:getAppearance(),overlays:overlays()};
  $('grid').style.setProperty('--briefing-aspect',selection.size[0]+'/'+selection.size[1]);
  const visible=briefingPage(times,start,count()),upcoming=accumulationHours(preset.field)?[]:briefingPage(times,start+count(),count());
  const key=time=>briefingKey(selection.model,selection.meta,selection.preset,selection.bounds,time,selection.size,selection.overlays,selection.background,selection.appearance);
  const cards=new Map();let loaded=0,failed=0,prepared=0;
  $('grid').replaceChildren();$('retry').hidden=true;
  const progress=()=>{if(token===generation)$('status').textContent=loaded+'/'+visible.length+' charts ready'+(failed?' · '+failed+' unavailable':loaded===visible.length&&upcoming.length?' · '+prepared+'/'+upcoming.length+' next charts prepared':'');};
  for(const time of visible){
   const card=document.createElement('article'),title=document.createElement('h3'),caption=document.createElement('p'),button=document.createElement('button'),placeholder=document.createElement('span');
   card.className='briefing-card';card.dataset.time=time;
   title.textContent=modelName()+' · '+periodTitle(time);caption.textContent=briefingCaption(meta,preset,time);
   button.type='button';button.className='briefing-chart';button.disabled=true;button.setAttribute('aria-label','Enlarge chart · '+periodTitle(time));
   placeholder.textContent='Preparing chart…';button.append(placeholder);card.append(title,caption,button);$('grid').append(card);
   const exportInfo={title:modelName()+' · '+runLabel(selection.meta)+' · '+chartTitle(time),subtitle:briefingCaption(selection.meta,selection.preset,time),scales:chartScales(fields.find(f=>f.key===selection.preset.field),briefingCaption(selection.meta,selection.preset,time),selection.preset.id==='weather')};
   const show=src=>{const image=document.createElement('img');image.src=src;image.alt=exportInfo.title;image.decoding='async';button.replaceChildren(image);button.disabled=false;card.dataset.ready='true';imageMenu?.registerImage(image,exportInfo);button.onclick=()=>enlarge(src,time,exportInfo);loaded++;};
   const cached=images.get(key(time));if(cached)show(cached);
   cards.set(time,{show,card,placeholder});
  }
  navigation();progress();
  const task=async()=>{
   if(signal.aborted)return;
   if(renderer&&(renderer.background!==selection.background||renderer.appearanceKey!==appearanceKey(selection.appearance))){renderer.destroy();renderer=null;}
   renderer??=new BriefingRenderer({...renderOptions,fields,background:selection.background,appearance:selection.appearance});
   for(const time of [...visible,...upcoming]){
    if(signal.aborted||!active)return;
    const card=cards.get(time),cached=images.get(key(time));
    try{
     const sequence=[...visible,...upcoming],nextTime=sequence[sequence.indexOf(time)+1];
     const src=cached??await renderer.render({...selection,time,signal,nextFrame:nextTime&&!images.get(key(nextTime))?{time:nextTime}:null});
     if(signal.aborted){if(!cached)URL.revokeObjectURL(src);return;}
     if(!cached)images.set(key(time),src);
     if(card&&!card.card.dataset.ready)card.show(src);
     if(!card)prepared++;
    }catch(error){
     if(signal.aborted)return;
     if(card){card.placeholder.textContent='Chart unavailable. Use Retry charts.';card.card.dataset.failed='true';failed++;$('retry').hidden=false;}
    }
    progress();
   }
  };
  work=work.catch(()=>{}).then(task).catch(error=>{if(token===generation){$('status').textContent=error.message;$('retry').hidden=false;}});
 }
 async function configure(force=false){
  cancel();const token=generation;
  model=choices.find(item=>item.id===$('model').value);meta=null;times=[];controlsDisabled(true);$('run-select').disabled=true;
  if(runKey&&sourceModel(runKey)!==model.id)runKey=null;
  $('grid').replaceChildren();$('legend').replaceChildren();$('run').textContent='Checking model run…';$('status').textContent='Checking available chart fields…';$('retry').hidden=true;
  try{
   const selected=await selectedMetadata(force);if(token!==generation||!active)return;
   meta=selected.meta;if(!meta.productOnly)normalMenus.set(model.id,meta);if(runKey)runKey=selected.key;renderRunSelector($('run-select'),model.id,selected,meta,{followLatest:!runKey,product:!!meta.productOnly});
   onMetadata(meta);
   document.dispatchEvent(new CustomEvent('snowline-model-run-verified',{detail:{model:model.id,meta}}));
   const available=presets=menuPresets(),previous=requestedChart??$('preset').value;
   requestedChart=null;briefingOptions($('preset'),available);
   if(!available.length)throw Error('This run does not supply the fields for these briefing charts. Choose another model.');
   $('preset').value=(available.find(item=>item.id===previous||item.key===previous)??available[0]).id;
   $('run').textContent=modelName()+' · initialized '+runLabel(meta)+' · '+runAvailability(meta)+' · Checks every minute.';
   controlsDisabled(false);timeline();renderPage();
  }catch(error){if(token===generation){meta=null;$('run').textContent=model.name;$('status').textContent=error.message;controlsDisabled(true);$('preset').disabled=false;$('retry').hidden=false;}}
 }
 let refreshing=false;
 async function refreshRun(){
  if(!active||document.hidden||refreshing)return;
  if(!meta)return configure(true);
  refreshing=true;const selected=model.id,previous=meta,selectionKey=runKey;
  try{
   const result=await selectedMetadata(true),incoming=result.meta;
   if(!active||document.hidden||model.id!==selected||meta!==previous||runKey!==selectionKey)return;
   const next=retainRunProgress(previous,incoming);if(!next.productOnly)normalMenus.set(model.id,next);
   onMetadata(next);
   renderRunSelector($('run-select'),model.id,result,next,{followLatest:!runKey,product:!!meta.productOnly});
   document.dispatchEvent(new CustomEvent('snowline-model-run-verified',{detail:{model:selected,meta:next}}));
   if(runSignature(next)!==runSignature(previous)){
    rememberTime();meta=next;
    const available=presets=menuPresets(),selection=$('preset').value;
    briefingOptions($('preset'),available);
    if(!available.length){cancel();times=[];controlsDisabled(true);$('grid').replaceChildren();$('run').textContent=modelName()+' · initialized '+runLabel(meta)+' · Updating';$('status').textContent='New run arriving; awaiting the fields for this chart.';return;}
    $('preset').value=available.some(item=>item.id===selection)?selection:available[0].id;
    controlsDisabled(false);timeline();renderPage();
   }
   $('run').textContent=modelName()+' · initialized '+runLabel(meta)+' · '+runAvailability(meta)+' · Checks every minute.';
  }catch{if(active&&model.id===selected&&meta===previous&&runKey===selectionKey)$('run').textContent=modelName()+' · initialized '+runLabel(meta)+' · Live check unavailable; retrying in one minute.';}
  finally{refreshing=false;}
 }
 let refreshTimer=setInterval(refreshRun,60000);
 window.addEventListener('pageshow',event=>{if(event.persisted){clearInterval(refreshTimer);refreshTimer=setInterval(refreshRun,60000);refreshRun();}});
 $('background').addEventListener('change',()=>{onBackgroundChange($('background').value);renderPage();});
 $('model').addEventListener('change',()=>{rememberTime();runKey=null;configure();});
 $('run-select').addEventListener('change',()=>{rememberTime();const select=$('run-select');runKey=select.value===select.dataset.preferredRun?null:select.value;configure();});
 for(const id of ['preset','interval'])$(id).addEventListener('change',()=>{
  if(id==='preset')requestedChart=null;
  if(id==='preset'&&(productField($('preset').value)||meta?.productOnly||!meta)){rememberTime();configure();return;}
  if(!meta)return;rememberTime();
  if(id==='interval')interval=$('interval').value;
  timeline();renderPage();
 });
 for(const id of ['area','count','contours','grid-values'])$(id).addEventListener('change',()=>renderPage());
 $('time').addEventListener('change',()=>{
  if(accumulationHours(preset?.field)){requestedStart=$('time').value;timeline();}
  else start=Number($('time').value);
  rememberTime();renderPage();
 });
 $('previous').addEventListener('click',()=>{start=Math.max(0,start-count());rememberTime();renderPage();});
 $('next').addEventListener('click',()=>{start=Math.min(times.length-1,start+count());rememberTime();renderPage();});
 $('retry').addEventListener('click',()=>{cancel();renderer?.destroy();renderer=null;meta?renderPage():configure();});
 $('enlarged-image').addEventListener('click',()=>$('enlarged').close());
 $('enlarged-image').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('enlarged').close();}});
 $('enlarged').addEventListener('click',event=>{if(event.target===$('enlarged'))$('enlarged').close();});
 let history;
 function close(){
  history?.close();
  active=false;cancel();if($('enlarged').open)$('enlarged').close();
  renderer?.destroy();renderer=null;host.hidden=true;onClose();
 }
 function mode(historyMode){
  $('sequence-mode').setAttribute('aria-pressed',String(!historyMode));$('history-mode').setAttribute('aria-pressed',String(historyMode));$('sequence').hidden=historyMode;
  if(historyMode){
   active=false;cancel();renderer?.destroy();renderer=null;
   history??=createPreviousRunAnalysis({host:host.querySelector('#previous-run-view'),models,fields,loadModel,loadRun,loadJSON,imageMenu,onClose:close,getAppearance,getBackground,onBackgroundChange,...renderOptions});
   history.open({model:model?.id??$('model').value,time:times[start]??new Date(requestedTime).toISOString(),periodStart:accumulationHours(preset?.field)&&times[start]?periodStart(times[start],accumulationHours(preset.field)):null,preset:preset?.id,area:$('area').value,bounds:currentBounds});
  }else{const selection=history?.selection();history?.close();if(selection){$('model').value=selection.model;requestedChart=selection.preset;requestedTime=Date.parse(selection.time)||requestedTime;requestedStart=selection.periodStart??null;}$('background').value=getBackground();active=true;configure(true);}
 }
 $('sequence-mode').addEventListener('click',()=>{if($('sequence').hidden)mode(false);});
 $('history-mode').addEventListener('click',()=>{if(!$('sequence').hidden)mode(true);});
 $('close').addEventListener('click',close);
 $('toggle-controls').addEventListener('click',()=>{
  const hidden=!$('control-section').hidden;
  $('control-section').hidden=hidden;
  $('toggle-controls').textContent=hidden?'Show controls':'Hide controls';
  $('toggle-controls').setAttribute('aria-expanded',String(!hidden));
 });
 document.addEventListener('visibilitychange',()=>{if(!active)return;if(document.hidden)cancel();else if(meta){renderPage();refreshRun();}else configure();});
 window.addEventListener('pagehide',()=>{clearInterval(refreshTimer);cancel();images.clear();renderer?.destroy();renderer=null;});
 return {snapshot(){
  if(!active||!meta||!preset||!times[start])return null;
  return {model:runKey??model.id,followLatest:!runKey,field:preset.id,time:times[start],interval,area:$('area').value,bounds:currentBounds,count:count(),contours:$('contours').checked,grid:$('grid-values').checked,controlsHidden:$('control-section').hidden};
 },open(selection){$('background').value=getBackground();
  if(selection.menuMeta&&!selection.menuMeta.productOnly)normalMenus.set(sourceModel(selection.model),selection.menuMeta);
  history?.close();$('sequence').hidden=false;$('sequence-mode').setAttribute('aria-pressed','true');$('history-mode').setAttribute('aria-pressed','false');
  active=true;host.hidden=false;document.dispatchEvent(new CustomEvent('snowline-model-menu-ready'));currentBounds=selection.bounds;requestedTime=Date.parse(selection.time)||Date.now();interval=selection.interval??'3';requestedStart=accumulationHours(selection.field)&&selection.time?periodStart(selection.time,accumulationHours(selection.field)):null;requestedChart=selection.field??selection.preset??null;
  $('model').value=choices.some(item=>item.id===sourceModel(selection.model))?sourceModel(selection.model):choices[0].id;
  runKey=selection.followLatest===true?null:selection.model.includes('@')?selection.model:null;
  $('area').value=selection.area??'uk';
  if(selection.count)$('count').value=String(selection.count);
  if(selection.contours!==undefined)$('contours').checked=selection.contours;
  if(selection.grid!==undefined)$('grid-values').checked=selection.grid;
  if(selection.controlsHidden!==undefined){$('control-section').hidden=selection.controlsHidden;$('toggle-controls').textContent=selection.controlsHidden?'Show controls':'Hide controls';$('toggle-controls').setAttribute('aria-expanded',String(!selection.controlsHidden));}
  $('close').focus({preventScroll:true});return configure();
 },close};
}
