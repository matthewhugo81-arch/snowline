import {MODELS,VARIABLES,finite,parseCoordinates,valueAt,agreement,fetchJSON} from './data.js?v=20261015-shared-cache';
import {loadPointForecasts} from './point-forecasts.js?v=20261015-shared-cache-live';
import {averageSeries} from './average.js';
import {chartWindow} from './chart-window.js?v=20261015-touch-zoom';
import {createChartZoom} from './chart-zoom.js?v=20261015-compact-reset';
import {setupChartPanels} from './chart-panels.js?v=20261014-panels';
import {createDatasetDialog} from './dataset-dialog.js?v=20261013-compact-tables';
import {valueAttributes, variableLegend, formatValue} from './export.js?v=20261013-compact-tables';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const shortDate=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const clock=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const fmt=(v,dec=1)=>finite(v)?v.toFixed(dec):'—';
const state={location:{latitude:53.9239,longitude:-2.1949,name:'Starting location'},selected:new Set(MODELS.map(m=>m.id)),models:new Map(),errors:new Map(),hours:168,index:0,zoom:null,times:[],loading:false,controller:null,generation:0,fetched:null};
const datasetDialog=createDatasetDialog(state);
const linkParams=new URLSearchParams(location.search);let requestedTime=Date.parse(linkParams.get('time'));
try{if(linkParams.has('lat')&&linkParams.has('lon')){const point=parseCoordinates(linkParams.get('lat')+','+linkParams.get('lon'));if(point)state.location=point;}}catch{}

let chartLayouts=new Map(),renderPending=false,fullRenderPending=false,inspection=null;
const chartZoom=createChartZoom({root:document.querySelector('main'),getLayout:id=>chartLayouts.get(id),
 getWindow:()=>{const {start,end}=chartWindow(state);return {start,end,length:Math.min(state.times.length,state.hours)};},
 onZoom:range=>{state.zoom=range.start===0&&range.end===Math.min(state.times.length,state.hours)-1?null:range;state.index=Math.max(range.start,Math.min(range.end,state.index));scheduleRender();},
 onInspect:index=>{if(index!==null){state.index=index;scheduleRender(true);}},
 onReset:()=>{chartZoom.cancel();state.zoom=null;scheduleRender();},onFinish:scheduleRender});
function selectedModels(){return MODELS.filter(m=>state.selected.has(m.id)&&state.models.has(m.id)).map(m=>state.models.get(m.id));}
function setStatus(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
// Data, range and size changes take precedence over cursor-only updates in the same frame.
function scheduleRender(inspectOnly=false){fullRenderPending ||= inspectOnly!==true;if(renderPending)return;renderPending=true;requestAnimationFrame(()=>{const full=fullRenderPending;renderPending=false;fullRenderPending=false;if(full||!inspection)render();else renderInspection();});}
// CSS variables recolour existing SVGs immediately without resetting chart state.
const modelColour = model => model.average ? 'var(--chart-average, #102235)' : model.id ? `var(--model-${model.id}, ${model.color})` : model.color;
function populate(){
 $('model-list').innerHTML=MODELS.map(m=>`<label class="model-chip" style="--color:${modelColour(m)}"><input type="checkbox" value="${m.id}" checked><span class="swatch"></span>${m.name}</label>`).join('');
 $('model-list').addEventListener('change',e=>{if(e.target.checked)state.selected.add(e.target.value);else state.selected.delete(e.target.value);scheduleRender();});
 $('charts').innerHTML=VARIABLES.map(v=>`<article class="chart-card"><div class="chart-heading"><h2>${v.title}</h2><div class="chart-tools"><span class="unit">${v.unit}</span><button type="button" class="zoom-reset secondary" data-reset-zoom hidden title="Restore the selected 1–7 day view on all charts">Reset zoom</button><button type="button" class="data-button secondary" data-variable="${v.key}" aria-label="View and download ${v.title} data" aria-haspopup="dialog" title="View hourly data and download"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/></svg>Data</button></div></div><p class="chart-note">${v.note}</p><p class="chart-time">Inspecting <time id="time-${v.key}"></time></p><div id="plot-${v.key}" class="plot"></div><div id="values-${v.key}" class="chart-values"></div><div id="frost-${v.key}" class="chart-frost"></div></article>`).join('');
 $('charts').addEventListener('click',e=>{const button=e.target.closest('[data-variable]');if(button)datasetDialog.open(button.dataset.variable,button);});
 setupChartPanels(document.querySelector('main'),()=>{chartZoom.cancel();scheduleRender();});
 document.querySelectorAll('.plot').forEach(el=>{el.tabIndex=0;el.title='Pinch with two fingers to zoom; move two fingers sideways to pan. Right-drag (or Shift + left-drag) to zoom all charts. Double-click or press Escape here to reset.';});
 $('data-table').previousElementSibling.innerHTML='<tr><th>Model</th>'+VARIABLES.map(v=>`<th>${v.title}<br>${v.unit}</th>`).join('')+'<th>Coverage / status</th></tr>';
}
async function loadLocation(location,force=false){
 datasetDialog.close();chartZoom.cancel();state.zoom=null;
 state.controller?.abort();state.controller=new AbortController();const signal=state.controller.signal;const generation=++state.generation;
 state.location=location;state.models.clear();state.errors.clear();state.index=0;state.fetched=null;state.loading=true;state.limit=null;
 $('place').textContent=location.name;$('coordinates').textContent=`${Math.abs(location.latitude).toFixed(4)}° ${location.latitude<0?'S':'N'} · ${Math.abs(location.longitude).toFixed(4)}° ${location.longitude<0?'W':'E'}`;
 let altitude=location.elevation;
 const showAltitude=()=>{$('altitude').textContent=finite(altitude)?'Altitude: approximately '+Math.round(altitude).toLocaleString('en-GB')+' m above sea level':'Altitude: loading…';};
 showAltitude();
 $('refresh').disabled=true;$('refresh').textContent='Loading…';
 let start=Math.floor(Date.now()/3600000)*3600000;state.timeNote='';
 const today=Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z');
 if(Number.isFinite(requestedTime)&&requestedTime>=today&&requestedTime<start)start=requestedTime;
 state.times=Array.from({length:168},(_,i)=>new Date(start+i*3600000).toISOString().replace('.000Z','Z'));
 if(Number.isFinite(requestedTime)){const idx=state.times.findIndex(t=>Date.parse(t)===requestedTime);if(idx>=0)state.index=idx;else state.timeNote='The selected map time is outside this point-forecast window. ';requestedTime=NaN;}
 setStatus('Loading forecasts for this location…');render();
 try{await loadPointForecasts(location,{signal,force,
  onModel:model=>{if(generation!==state.generation)return;state.models.set(model.id,model);if(!finite(altitude)&&finite(model.elevation)){altitude=model.elevation;showAltitude();}if(model.retryAt)state.limit={retryAt:model.retryAt};},
  onError:(model,error)=>{if(generation!==state.generation)return;state.errors.set(model.id,error.name==='TimeoutError'?'Request timed out. Try Refresh.':error.message);if(error.status===429)state.limit=error;},
  onProgress:done=>{if(generation===state.generation){setStatus(`Loading forecasts · ${done} of ${MODELS.length} models checked`);scheduleRender();}}
 });}catch(error){if(signal.aborted||generation!==state.generation)return;setStatus(error.message,true);}
 if(generation!==state.generation)return;
 // Forecast responses already include elevation; avoid a separate API call on every visit.
 if(!finite(altitude)){
  try{const result=await fetchJSON('https://api.open-meteo.com/v1/elevation?'+new URLSearchParams({latitude:location.latitude,longitude:location.longitude}),signal,{ttl:30*86400000,staleTtl:365*86400000});altitude=result.elevation?.[0];}catch{}
  if(generation!==state.generation)return;
  if(finite(altitude))showAltitude();else $('altitude').textContent='Altitude unavailable';
 }
 state.loading=false;state.fetched=state.models.size?Math.min(...[...state.models.values()].map(m=>m.fetchedAt)):null;
 finishStatus();render();
}
function finishStatus(){
 $('refresh').disabled=false;$('refresh').textContent='Refresh';
 const suffix=state.errors.size?` · ${state.errors.size} unavailable (see data availability)`:'';
 const models=[...state.models.values()],stale=models.some(m=>m.stale),shared=models.some(m=>m.source==='shared cache');
 const retry=state.limit?.retryAt?` Open-Meteo's request limit was reached; live API requests resume after ${date.format(state.limit.retryAt)} UTC.`:'';
 setStatus(state.models.size?`${state.timeNote??''}${stale?'Cached forecasts — live refresh unavailable':shared?'Shared forecasts':'Latest available forecasts'} · retrieved ${date.format(state.fetched)} UTC${suffix}${retry}`:state.limit?`Forecasts temporarily unavailable: Open-Meteo's request limit was reached. No usable cached forecast exists for this location. Try Refresh after ${date.format(state.limit.retryAt)} UTC.`:'Unable to load forecasts. Try Refresh. Details are in data availability.',!state.models.size||stale);
}
function pathFrom(values,x,y){let drawing=false,d='';for(let i=0;i<values.length;i++){if(!finite(values[i])){drawing=false;continue;}d+=`${drawing?'L':'M'}${x(i).toFixed(1)},${y(values[i]).toFixed(1)} `;drawing=true;}return d;}
function plot(container,series,config,times){
 // Reopening redraws at the current width, time window and inspected hour.
 if(container.closest('[hidden]')){chartLayouts.delete(container.id);return;}
 const shortView=times.length<120;
 const start=chartWindow(state).start,index=state.index-start;
 const width=Math.max(280,container.clientWidth),height=container.id==='agreement-chart'?140:225,left=43,right=12,top=15,bottom=shortView?46:33,inner=width-left-right,n=times.length;
 const valid=series.flatMap(s=>s.values).filter(finite);
 if(!valid.length){container.innerHTML=`<div class="plot-empty">${state.loading?'Loading available forecasts…':state.selected.size?'No data available for the selected models.':'Select a model to see its forecast.'}</div>`;chartLayouts.delete(container.id);return;}
 let min=config.floor??Math.min(...valid),max=config.ceiling??Math.max(...valid);
 if(config.floor===undefined){min=Math.min(min,0);max=Math.max(max,0);}
 if(max-min<config.minRange){if(config.floor!==undefined)max=min+config.minRange;else{const mid=(min+max)/2;min=mid-config.minRange/2;max=mid+config.minRange/2;}}
 if(config.ceiling===undefined)max+=(max-min)*.08;
 const x=i=>left+inner*i/Math.max(1,n-1),y=v=>top+(height-bottom-top)*(1-(v-min)/(max-min));
 let html=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(config.title)}. Values for the inspected hour appear below and in the data table.">`;
 for(let j=0;j<=4;j++){const v=min+(max-min)*j/4,yy=y(v);html+=`<line class="gridline" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"/><text x="${left-8}" y="${yy+4}" text-anchor="end">${Math.abs(v)<.0001?'0':v.toFixed(max-min<=2?2:max-min<=8?1:0)}</text>`;}
 if(min<0&&max>0)html+=`<line class="zero-line" x1="${left}" x2="${width-right}" y1="${y(0)}" y2="${y(0)}"/>`;
 // The forecast begins at the current hour; day boundaries must follow UTC midnight.
 const dayStarts=times.flatMap((time,i)=>new Date(time).getUTCHours()===0?[i]:[]);
 for(const i of dayStarts)html+=`<line class="day-boundary" x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${height-bottom}" stroke="#000" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`;
 if(shortView){
  // Use a fixed cadence aligned to UTC, independent of the forecast's first hour.
  const tickHours=[1,2,3,6,12,24].find(hours=>inner*hours/Math.max(1,n-1)>=38)??24;
  for(let i=0;i<n;i++){const time=new Date(times[i]);if(i!==0&&i!==n-1&&(time.getUTCHours()%tickHours!==0||x(i)-left<52||width-right-x(i)<52))continue;html+=`<text class="time-tick" x="${x(i)}" y="${height-23}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}">${clock.format(time).replace(':','')}</text>`;}
 }
 const dayTicks=!state.zoom&&dayStarts.length&&x(dayStarts[0])-left<74?dayStarts:[0,...dayStarts];
 let labelEnd=-Infinity;
 for(const i of new Set(dayTicks)){const xx=x(i),anchor=i===0?'start':i===n-1?'end':'middle',labelWidth=44,labelStart=xx-(anchor==='start'?0:anchor==='end'?labelWidth:labelWidth/2);if(labelStart<labelEnd+8)continue;html+=`<text class="date-tick" x="${xx}" y="${height-8}" text-anchor="${anchor}">${shortDate.format(new Date(times[i]))}</text>`;labelEnd=labelStart+labelWidth;}
 for(const s of series){if(s.average)html+=`<path d="${pathFrom(s.values,x,y)}" fill="none" stroke="var(--chart-halo, white)" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round"/>`;html+=`<path d="${pathFrom(s.values,x,y)}" fill="none" stroke="${modelColour(s)}" stroke-width="${s.average?3.2:s.ensemble?1.7:2}" stroke-linejoin="round" stroke-linecap="round" ${s.ensemble?'stroke-dasharray="5 4"':''} opacity=".9"/>`;}
 html+=`<line class="cursor-line" x1="${x(index)}" x2="${x(index)}" y1="${top}" y2="${height-bottom}"/>`;
 for(const s of series){const v=s.values[index];html+=`<circle class="cursor-point" cx="${x(index)}" cy="${finite(v)?y(v):top}" r="3" fill="${modelColour(s)}"${finite(v)?'':' display="none"'}/>`;}
 html+='</svg>';container.innerHTML=html;chartLayouts.set(container.id,{width,height,left,inner,top,bottom,n,start,times,x,y,series,cursor:container.querySelector('.cursor-line'),points:[...container.querySelectorAll('.cursor-point')]});
}
function render(){
 if(chartZoom.active)return; // Keep the drag geometry stable while model responses arrive.
 const models=selectedModels(),{times,start,end}=chartWindow(state);if(!times.length)return;state.index=Math.max(start,Math.min(state.index,end));
 document.querySelectorAll('[data-reset-zoom]').forEach(button=>button.hidden=!state.zoom);
 $('zoom-window').hidden=!state.zoom;
 $('zoom-period').textContent=state.zoom?`Zoomed: ${date.format(new Date(times[0]))} – ${date.format(new Date(times.at(-1)))} UTC · all charts, summary and chart-window data`:'';
 $('time-slider').min=start;$('time-slider').max=end;
 const available=models.filter(m=>VARIABLES.some(v=>times.some(t=>finite(valueAt(m,v.key,t)))));
 $('models-count').textContent=`${available.length} / ${state.selected.size}`;$('models-detail').textContent=state.loading?'Forecasts are still loading':'Selected models with data in this window';
 const votes=times.map(t=>agreement(models,t));const validVotes=votes.filter(v=>v.valid);const peak=validVotes.length?validVotes.reduce((a,b)=>b.percent>a.percent?b:a):null;
 $('peak-agreement').textContent=peak?`${Math.round(peak.percent)}%`:'—';$('peak-detail').textContent=peak?`${peak.snow} of ${peak.valid} forecasts at the peak hour`:'No eligible snowfall forecasts';
 let maxSnow=null,minTemp=null;
 for(const m of models)for(const t of times){const s=valueAt(m,'snowfall',t),temp=valueAt(m,'temperature_2m',t);if(finite(s)&&(!maxSnow||s>maxSnow.value))maxSnow={value:s,model:m.name};if(finite(temp)&&(!minTemp||temp<minTemp.value))minTemp={value:temp,model:m.name};}
 $('snow-max').textContent=maxSnow?`${fmt(maxSnow.value,2)} cm`:'—';$('snow-detail').textContent=maxSnow?(maxSnow.value>0?maxSnow.model:'All available snowfall values are zero'):'No snowfall data';
 $('temp-min').textContent=minTemp?`${fmt(minTemp.value)}°C`:'—';$('temp-detail').textContent=minTemp?minTemp.model:'No temperature data';
 plot($('agreement-chart'),[{values:votes.map(v=>v.percent),color:'#6ce1d6'}],{title:'Hourly snowfall model agreement',floor:0,ceiling:100,minRange:100},times);
 const averages=new Map();
 for(const v of VARIABLES){
 const series=models.map(m=>({...m,values:times.map(t=>valueAt(m,v.key,t))}));
 const average=averageSeries(series,times.length);
 averages.set(v.key,average);
 plot($('plot-'+v.key),[...series,{name:'Average',color:'#102235',average:true,values:average.values}],v,times);
 $('frost-'+v.key).innerHTML=series.some(s=>s.values.some(value=>finite(value)&&(v.unit==='°C'?value<0:v.key==='precipitation'&&value>0)))?variableLegend(v):'';
 }
 const coverage=new Map(MODELS.filter(m=>state.selected.has(m.id)).map(m=>{const data=state.models.get(m.id);const validTimes=data?data.time.filter(t=>VARIABLES.some(v=>finite(valueAt(data,v.key,t)))):[];let text=state.errors.get(m.id)??(state.loading?'Loading…':'No data');if(validTimes.length)text=`Ends ${date.format(new Date(validTimes.at(-1)))} UTC; grid ${finite(data.elevation)?Math.round(data.elevation)+' m':'elevation unavailable'}`;if(data)text+=`; retrieved ${date.format(data.fetchedAt)} UTC${data.source?' · '+data.source:''}${data.stale?' · cached; '+(data.refreshError??'live refresh unavailable'):''}`;return [m.id,text];}));
 inspection={models,times,start,end,votes,averages,coverage};
 renderInspection();
 datasetDialog.render();
}
function renderInspection(){
 if(chartZoom.active)return;
 const {models,times,start,end,votes,averages,coverage}=inspection;
 state.index=Math.max(start,Math.min(state.index,end));
 const index=state.index-start,time=times[index],labelText=date.format(new Date(time))+' UTC';
 for(const v of VARIABLES){const label=$('time-'+v.key);label.dateTime=time;label.textContent=labelText;}
 $('time-slider').value=state.index;$('selected-time').textContent=labelText;$('time-slider').setAttribute('aria-valuetext',labelText);
 if($('nav-maps'))$('nav-maps').href='maps.html?'+new URLSearchParams({lat:state.location.latitude,lon:state.location.longitude,time});
 for(const layout of chartLayouts.values()){
  const xx=layout.x(index);layout.cursor.setAttribute('x1',xx);layout.cursor.setAttribute('x2',xx);
  layout.points.forEach((point,i)=>{const value=layout.series[i].values[index];point.setAttribute('display',finite(value)?'inline':'none');if(finite(value)){point.setAttribute('cx',xx);point.setAttribute('cy',layout.y(value));}});
 }
 const vote=votes[index];$('agreement-detail').textContent=vote.valid?`${labelText} · ${vote.snow} of ${vote.valid} available forecasts indicate ≥0.1 cm snowfall (${Math.round(vote.percent)}%).`:'No eligible snowfall forecasts for the inspected hour.';
 for(const v of VARIABLES){
 const average=averages.get(v.key);
 const current=models.filter(m=>finite(valueAt(m,v.key,time)));
 const mean=average.values[index],count=average.counts[index];
 const meanLabel=finite(mean)?`<span class="average-value"><i class="average-swatch"></i>Average <b ${valueAttributes(mean,v)}>${formatValue(mean,v)}</b> <small>(${count} models)</small></span>`:'';
 $('values-'+v.key).innerHTML=current.length?meanLabel+current.map(m=>{const value=valueAt(m,v.key,time);return `<span><i class="swatch" style="--color:${modelColour(m)}"></i>${m.name} <b ${valueAttributes(value,v)}>${formatValue(value,v)}</b></span>`;}).join(''):'<span>No values for this hour.</span>';
 }

 $('data-table').innerHTML=MODELS.filter(m=>state.selected.has(m.id)).map(m=>{const data=state.models.get(m.id);return `<tr><td><i class="swatch" style="--color:${modelColour(m)}"></i>${m.name}${m.ensemble?' (ensemble mean)':''}</td>${VARIABLES.map(v=>{const value=data?valueAt(data,v.key,time):null;return `<td ${valueAttributes(value,v)}>${formatValue(value,v)}</td>`;}).join('')}<td>${esc(coverage.get(m.id))}</td></tr>`}).join('');
}
let searchController=null;
async function searchLocations(query){const coords=parseCoordinates(query);if(coords)return [coords];if(query.trim().length<2)throw new Error('Enter at least two characters.');const data=await fetchJSON('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query,count:'8',language:'en',format:'json'}),searchController?.signal);return (data.results??[]).sort((a,b)=>Number(b.country_code==='GB')-Number(a.country_code==='GB')).map(r=>({latitude:r.latitude,longitude:r.longitude,elevation:r.elevation,name:[r.name,r.admin2,r.admin1,r.country].filter(Boolean).join(', ')}));}
const recentKey='snowline-recent-locations-v1';
let recentLocations=[];
try{const saved=JSON.parse(localStorage.getItem(recentKey)||'[]');if(Array.isArray(saved))recentLocations=saved.filter(p=>p&&finite(p.latitude)&&finite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&typeof p.name==='string').slice(0,5);}catch{}
function closeSearch(){searchController?.abort();searchController=null;$('search-results').replaceChildren();$('search-results').className='';}
function chooseLocation(location){
 closeSearch();$('location-search').value='';
 recentLocations=[location,...recentLocations.filter(p=>Math.abs(p.latitude-location.latitude)>.0001||Math.abs(p.longitude-location.longitude)>.0001)].slice(0,5);
 try{localStorage.setItem(recentKey,JSON.stringify(recentLocations));}catch{}
 renderRecents();loadLocation(location);
}
function renderRecents(){
 const container=$('recent-locations');container.replaceChildren();container.hidden=!recentLocations.length;
 if(!recentLocations.length)return;
 const label=document.createElement('span');label.textContent='Recent';container.append(label);
 for(const location of recentLocations){const button=document.createElement('button');button.type='button';button.textContent=location.name;button.title=location.name;button.addEventListener('click',()=>chooseLocation(location));container.append(button);}
}
renderRecents();
$('search-form').addEventListener('submit',async e=>{e.preventDefault();searchController?.abort();searchController=new AbortController();const current=searchController;const box=$('search-results');box.className='search-results-open';box.textContent='Searching…';try{const locations=await searchLocations($('location-search').value);if(current!==searchController)return;if(!locations.length){box.textContent='No matches. Try another name or enter latitude, longitude.';return;}box.replaceChildren();for(const location of locations){const button=document.createElement('button');button.type='button';button.textContent=location.name;button.addEventListener('click',()=>chooseLocation(location));box.append(button);}}catch(error){if(current===searchController)box.textContent=error.message;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSearch();});
document.addEventListener('click',e=>{if(!e.target.closest('#search-form'))closeSearch();});
$('refresh').addEventListener('click',()=>loadLocation(state.location,true));
$('horizon').addEventListener('change',e=>{chartZoom.cancel();state.zoom=null;state.hours=Number(e.target.value);scheduleRender();});
$('time-slider').addEventListener('input',e=>{state.index=Number(e.target.value);scheduleRender(true);});
for(const [id,filter] of [['select-all',()=>true],['select-global',m=>!m.regional],['select-none',()=>false]])$(id).addEventListener('click',()=>{state.selected=new Set(MODELS.filter(filter).map(m=>m.id));document.querySelectorAll('.model-chip input').forEach(input=>input.checked=state.selected.has(input.value));scheduleRender();});
$('focus').addEventListener('change',e=>{const group=e.target.value;const snow=['snowfall','snow_depth','temperature_2m','dew_point_2m','temperature_850hPa','precipitation'];const ice=['temperature_2m','dew_point_2m','soil_temperature_0cm','relative_humidity_2m','precipitation','snow_depth','cloud_cover','wind_speed_10m','wind_gusts_10m'];const wind=['wind_speed_10m','wind_gusts_10m'];for(const v of VARIABLES){const card=$('plot-'+v.key).closest('article');const order=group==='snow'?snow:group==='wind'?wind:ice;card.hidden=group!=='all'&&!order.includes(v.key);card.style.order=group==='all'?0:order.indexOf(v.key);}scheduleRender();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(scheduleRender,120);});
populate();await loadLocation(state.location);
if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await document.modelContext.registerTool({name:'set_forecast_location',title:'Compare forecasts at a location',description:'Load the model comparison for latitude and longitude and update the visible dashboard. Makes requests to Open-Meteo.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){if(!input||!finite(input.latitude)||!finite(input.longitude)||Math.abs(input.latitude)>90||Math.abs(input.longitude)>180)throw new Error('Valid latitude and longitude are required.');await loadLocation({latitude:input.latitude,longitude:input.longitude,name:`${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`});return {location:state.location,modelsLoaded:state.models.size,unavailable:state.errors.size};}},{signal:lifecycle.signal});}catch(error){console.info('Optional browser tool unavailable:',error.message);}}

