import {BRIEFING_PRESETS,BRIEFING_AREAS,briefingPresets,briefingTimes,briefingPage,briefingCaption,briefingKey,BriefingImages} from './map-briefing-data.js?v=20261011-diagnostics';
import {BriefingRenderer} from './map-briefing-renderer.js?v=20261011-diagnostics';
import {forecastInterval} from './map-interval.js?v=20261011-forecast-interval';
import {runLabel,runAvailability,runSignature,retainRunProgress} from './map-runs.js?v=20261011-live-runs';
import {PRECIPITATION_SCALE} from './map-catalogue.js?v=20261011-diagnostics';

const date=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const stamp=time=>date.format(new Date(time))+' UTC';
const option=(value,label)=>{const el=document.createElement('option');el.value=value;el.textContent=label;return el;};

export function createBriefing({host,models,loadModel,fields,onClose,...renderOptions}){
 host.innerHTML=`<div class="briefing-heading"><div><h2>Forecast briefing</h2><p id="briefing-run">Choose a model and chart.</p></div><button type="button" id="briefing-close" class="secondary">Back to maps</button></div>
 <div class="briefing-controls">
 <label>Forecast model<select id="briefing-model"></select></label>
 <label>Chart<select id="briefing-preset"></select></label>
 <label>Area<select id="briefing-area"></select></label>
 <label>Starting time<select id="briefing-time"></select></label>
 <label>Forecast interval<select id="briefing-interval"><option value="native">Hourly / all available</option><option value="3" selected>3 hourly</option><option value="6">6 hourly</option></select></label>
 <label>Layout<select id="briefing-count"><option value="6">6 panels</option><option value="9">9 panels</option></select></label></div>
 <p id="briefing-note" class="small-note"></p><div id="briefing-legend" class="briefing-legend"></div>
 <div class="briefing-navigation"><button id="briefing-previous" class="secondary">Earlier charts</button><p id="briefing-status" role="status" aria-live="polite"></p><button id="briefing-retry" class="secondary" hidden>Retry charts</button><button id="briefing-next" class="secondary">Later charts</button></div>
 <div id="briefing-grid" class="briefing-grid" aria-label="Forecast chart sequence"></div>
 <p class="small-note briefing-credits">Charts show one model run with matching fields. Blank areas are outside available model coverage. Weather: Open-Meteo / model providers. Map: OpenFreeMap / OpenMapTiles / OpenStreetMap; coastline: Natural Earth. <a href="map-credits.html">Data and map credits</a>.</p>
 <dialog id="briefing-enlarged"><div class="briefing-heading"><strong id="briefing-enlarged-title"></strong><button id="briefing-enlarged-close" class="secondary">Close chart</button></div><img id="briefing-enlarged-image" alt=""><p id="briefing-enlarged-note"></p><p class="small-note">Weather: Open-Meteo / model providers. Map: OpenFreeMap / OpenMapTiles / OpenStreetMap. <a href="map-credits.html">Credits</a>.</p></dialog>`;
 const $=id=>host.querySelector('#briefing-'+id);
 const choices=models.filter(model=>!model.ensemble);
 for(const model of choices)$('model').append(option(model.id,model.name));
 for(const area of BRIEFING_AREAS)$('area').append(option(area.id,area.name));
 $('area').append(option('current','Current map area'));
 for(const preset of BRIEFING_PRESETS)$('preset').append(option(preset.id,preset.name));
 const images=new BriefingImages();
 let renderer,active=false,generation=0,controller,work=Promise.resolve(),model,meta,preset,times=[],start=0,interval='3',currentBounds,requestedTime;
 const count=()=>Number($('count').value);
 const bounds=()=>$('area').value==='current'?currentBounds:BRIEFING_AREAS.find(area=>area.id===$('area').value).bounds;
 const chartSize=()=>BRIEFING_AREAS.find(area=>area.id===$('area').value)?.size??[960,660];
 function cancel(){controller?.abort();renderer?.cancel();generation++;}
 function controlsDisabled(disabled){for(const id of ['preset','time','interval','previous','next'])$(id).disabled=disabled;}
 function navigation(){
  $('previous').disabled=!times.length||start===0;
  $('next').disabled=!times.length||start+count()>=times.length;
  $('time').value=String(start);
 }
 function legend(){
  $('legend').replaceChildren();
  const field=fields.find(field=>field.key===preset.field);
  const item=document.createElement('div'),title=document.createElement('strong'),gradient=document.createElement('div'),labels=document.createElement('div');
  item.className='briefing-scale';gradient.className='briefing-gradient';labels.className='briefing-scale-labels';
  if(preset.id==='weather'){
   title.textContent='Cloud cover';gradient.style.background='linear-gradient(to right,#414141,#ffffff)';labels.innerHTML='<span>Clear · 0%</span><span>Overcast · 100%</span>';
  }else{
   const min=field.temperatureBands?field.stops[1]:field.stops[0],max=field.stops.at(-1);
   title.textContent=field.name+' · '+field.unit;
   const stops=field.temperatureBands?field.colors.flatMap((color,index)=>[color+' '+100*index/field.colors.length+'%',color+' '+100*(index+1)/field.colors.length+'%']):field.colors.map((color,index)=>color+' '+100*(field.stops[index]-min)/(max-min)+'%');
   gradient.style.background='linear-gradient(to right,'+stops.join(',')+')';
   const low=document.createElement('span'),high=document.createElement('span');low.textContent=min+' '+field.unit;high.textContent=max+' '+field.unit;labels.append(low,high);
  }
  item.append(title,gradient,labels);$('legend').append(item);
  if(preset.id==='weather'){
   const rain=document.createElement('div');rain.className='briefing-rain-scale';
   const heading=document.createElement('strong');heading.textContent='Precipitation · mm water';rain.append(heading);
   const bands=document.createElement('div');bands.className='briefing-rain-bands';
   PRECIPITATION_SCALE.stops.slice(1).forEach((value,index)=>{const band=document.createElement('span');band.style.borderTopColor=PRECIPITATION_SCALE.colors[index+1];band.textContent=value+(index===PRECIPITATION_SCALE.stops.length-2?'+':'');bands.append(band);});
   rain.append(bands);$('legend').append(rain);
  }
 }
 function timeline(){
  preset=BRIEFING_PRESETS.find(item=>item.id===$('preset').value);
  times=briefingTimes(meta,preset,model,interval);
  const regional=forecastInterval([model],interval).shortRange;
  $('interval').value=regional?'native':interval;$('interval').disabled=regional;
  $('note').textContent=preset.note+(regional?' Short-term models retain every available hour.':' Only the selected forecast intervals are prepared.');
  $('time').replaceChildren(...times.map((time,index)=>option(String(index),stamp(time))));
  start=times.reduce((best,time,index)=>Math.abs(Date.parse(time)-requestedTime)<Math.abs(Date.parse(times[best])-requestedTime)?index:best,0);
  $('time').disabled=!times.length;legend();navigation();
 }
 function enlarge(src,time){
  const title=model.name+' · '+preset.name+' · '+stamp(time);
  const [width,height]=chartSize();$('enlarged-image').width=width;$('enlarged-image').height=height;
  $('enlarged-title').textContent=title;$('enlarged-image').src=src;$('enlarged-image').alt=title;
  $('enlarged-note').textContent=briefingCaption(meta,preset,time)+'. '+preset.note;
  $('enlarged').classList.toggle('briefing-square',chartSize()[0]===chartSize()[1]);
  $('enlarged').showModal();$('enlarged-close').focus();
 }
 function renderPage(){
  if(!active||!meta||!preset)return;cancel();
  if(!times.length){$('grid').replaceChildren();$('status').textContent='No common forecast times for this chart.';navigation();return;}
  const token=generation;controller=new AbortController();const signal=controller.signal;
  const selection={model:model.id,meta,preset,bounds:[...bounds()],size:[...chartSize()]};
  $('grid').style.setProperty('--briefing-aspect',selection.size[0]+'/'+selection.size[1]);
  const visible=briefingPage(times,start,count()),upcoming=briefingPage(times,start+count(),count());
  const key=time=>briefingKey(selection.model,selection.meta,selection.preset,selection.bounds,time,selection.size);
  const cards=new Map();let loaded=0,failed=0,prepared=0;
  $('grid').replaceChildren();$('retry').hidden=true;
  const progress=()=>{if(token===generation)$('status').textContent=loaded+'/'+visible.length+' charts ready'+(failed?' · '+failed+' unavailable':loaded===visible.length&&upcoming.length?' · '+prepared+'/'+upcoming.length+' next charts prepared':'');};
  for(const time of visible){
   const card=document.createElement('article'),title=document.createElement('h3'),caption=document.createElement('p'),button=document.createElement('button'),placeholder=document.createElement('span');
   card.className='briefing-card';card.dataset.time=time;
   title.textContent=stamp(time);caption.textContent=briefingCaption(meta,preset,time);
   button.type='button';button.className='briefing-chart';button.disabled=true;button.setAttribute('aria-label','Enlarge chart for '+stamp(time));
   placeholder.textContent='Preparing chart…';button.append(placeholder);card.append(title,caption,button);$('grid').append(card);
   const show=src=>{const image=document.createElement('img');image.src=src;image.alt=selection.preset.name+' · '+stamp(time);image.decoding='async';button.replaceChildren(image);button.disabled=false;card.dataset.ready='true';button.onclick=()=>enlarge(src,time);loaded++;};
   const cached=images.get(key(time));if(cached)show(cached);
   cards.set(time,{show,card,placeholder});
  }
  navigation();progress();
  const task=async()=>{
   if(signal.aborted)return;
   renderer??=new BriefingRenderer({...renderOptions,fields});
   for(const time of [...visible,...upcoming]){
    if(signal.aborted||!active)return;
    const card=cards.get(time),cached=images.get(key(time));
    try{
     const src=cached??await renderer.render({...selection,time,signal});
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
  model=choices.find(item=>item.id===$('model').value);meta=null;times=[];controlsDisabled(true);
  $('grid').replaceChildren();$('legend').replaceChildren();$('run').textContent='Checking model run…';$('status').textContent='Checking available chart fields…';$('retry').hidden=true;
  try{
   const data=await loadModel(model.id,force);if(token!==generation||!active)return;meta=data;
   const available=briefingPresets(meta),previous=$('preset').value;
   $('preset').replaceChildren(...available.map(item=>option(item.id,item.name)));
   if(!available.length)throw Error('This run does not supply the fields for these briefing charts. Choose another model.');
   $('preset').value=available.some(item=>item.id===previous)?previous:available[0].id;
   $('run').textContent=model.name+' · initialized '+runLabel(meta)+' · '+runAvailability(meta)+' · Checks every minute.';
   controlsDisabled(false);timeline();renderPage();
  }catch(error){if(token===generation){meta=null;$('run').textContent=model.name;$('status').textContent=error.message;controlsDisabled(true);$('retry').hidden=false;}}
 }
 let refreshing=false;
 async function refreshRun(){
  if(!active||document.hidden||refreshing)return;
  if(!meta)return configure(true);
  refreshing=true;const selected=model.id,previous=meta;
  try{
   const incoming=await loadModel(selected,true);
   if(!active||model.id!==selected||meta!==previous)return;
   const next=retainRunProgress(previous,incoming);
   if(runSignature(next)!==runSignature(previous)){
    requestedTime=Date.parse(times[start])||requestedTime;meta=next;
    const available=briefingPresets(meta),selection=$('preset').value;
    $('preset').replaceChildren(...available.map(item=>option(item.id,item.name)));
    if(!available.length){cancel();times=[];controlsDisabled(true);$('grid').replaceChildren();$('run').textContent=model.name+' · initialized '+runLabel(meta)+' · Updating';$('status').textContent='New run arriving; awaiting the fields for this chart.';return;}
    $('preset').value=available.some(item=>item.id===selection)?selection:available[0].id;
    controlsDisabled(false);timeline();renderPage();
   }
   $('run').textContent=model.name+' · initialized '+runLabel(meta)+' · '+runAvailability(meta)+' · Checks every minute.';
  }catch{if(active&&model.id===selected)$('run').textContent=model.name+' · initialized '+runLabel(meta)+' · Live check unavailable; retrying in one minute.';}
  finally{refreshing=false;}
 }
 let refreshTimer=setInterval(refreshRun,60000);
 window.addEventListener('pageshow',event=>{if(event.persisted){clearInterval(refreshTimer);refreshTimer=setInterval(refreshRun,60000);refreshRun();}});
 $('model').addEventListener('change',()=>{requestedTime=Date.parse(times[start])||requestedTime;configure();});
 for(const id of ['preset','interval'])$(id).addEventListener('change',()=>{
  if(!meta)return;requestedTime=Date.parse(times[start]??meta.reference_time);
  if(id==='interval')interval=$('interval').value;
  timeline();renderPage();
 });
 for(const id of ['area','count'])$(id).addEventListener('change',()=>renderPage());
 $('time').addEventListener('change',()=>{start=Number($('time').value);requestedTime=Date.parse(times[start]);renderPage();});
 $('previous').addEventListener('click',()=>{start=Math.max(0,start-count());renderPage();});
 $('next').addEventListener('click',()=>{start=Math.min(times.length-1,start+count());renderPage();});
 $('retry').addEventListener('click',()=>{cancel();renderer?.destroy();renderer=null;meta?renderPage():configure();});
 $('enlarged-close').addEventListener('click',()=>$('enlarged').close());
 $('enlarged').addEventListener('click',event=>{if(event.target===$('enlarged'))$('enlarged').close();});
 function close(){
  active=false;cancel();if($('enlarged').open)$('enlarged').close();
  renderer?.destroy();renderer=null;host.hidden=true;onClose();
 }
 $('close').addEventListener('click',close);
 document.addEventListener('visibilitychange',()=>{if(!active)return;if(document.hidden)cancel();else if(meta){renderPage();refreshRun();}else configure();});
 window.addEventListener('pagehide',()=>{clearInterval(refreshTimer);cancel();images.clear();renderer?.destroy();renderer=null;});
 return {open(selection){
  active=true;host.hidden=false;currentBounds=selection.bounds;requestedTime=Date.parse(selection.time)||Date.now();interval=selection.interval??'3';
  $('model').value=choices.some(item=>item.id===selection.model)?selection.model:choices[0].id;
  $('area').value='uk';$('close').focus({preventScroll:true});configure();
 },close};
}
