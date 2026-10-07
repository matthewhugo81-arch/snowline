import {MODELS,VARIABLES,finite,parseCoordinates,normalise,valueAt,agreement,fetchJSON,forecastURL} from './data.js';
import {averageSeries} from './average.js';
import {createDatasetDialog} from './dataset-dialog.js';
import {temperatureAttributes, frostLegend, formatValue} from './export.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const shortDate=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const clock=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const fmt=(v,dec=1)=>finite(v)?v.toFixed(dec):'—';
const state={location:{latitude:53.9239,longitude:-2.1949,name:'Starting location'},selected:new Set(MODELS.map(m=>m.id)),models:new Map(),errors:new Map(),hours:168,index:0,times:[],loading:false,controller:null,generation:0,fetched:null};
const cache=new Map();
const datasetDialog=createDatasetDialog(state);
const linkParams=new URLSearchParams(location.search);let requestedTime=Date.parse(linkParams.get('time'));
try{if(linkParams.has('lat')&&linkParams.has('lon')){const point=parseCoordinates(linkParams.get('lat')+','+linkParams.get('lon'));if(point)state.location=point;}}catch{}

let chartLayouts=new Map(),renderPending=false;
function selectedModels(){return MODELS.filter(m=>state.selected.has(m.id)&&state.models.has(m.id)).map(m=>state.models.get(m.id));}
function setStatus(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function scheduleRender(){if(renderPending)return;renderPending=true;requestAnimationFrame(()=>{renderPending=false;render();});}
function populate(){
 $('model-list').innerHTML=MODELS.map(m=>`<label class="model-chip" style="--color:${m.color}"><input type="checkbox" value="${m.id}" checked><span class="swatch"></span>${m.name}</label>`).join('');
 $('model-list').addEventListener('change',e=>{if(e.target.checked)state.selected.add(e.target.value);else state.selected.delete(e.target.value);scheduleRender();});
 $('charts').innerHTML=VARIABLES.map(v=>`<article class="chart-card"><div class="chart-heading"><h2>${v.title}</h2><div class="chart-tools"><span class="unit">${v.unit}</span><button type="button" class="data-button secondary" data-variable="${v.key}" aria-label="View and download ${v.title} data" aria-haspopup="dialog" title="View hourly data and download"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/></svg>Data</button></div></div><p class="chart-note">${v.note}</p><p class="chart-time">Inspecting <time id="time-${v.key}"></time></p><div id="plot-${v.key}" class="plot"></div><div id="values-${v.key}" class="chart-values"></div><div id="frost-${v.key}" class="chart-frost"></div></article>`).join('');
 $('charts').addEventListener('click',e=>{const button=e.target.closest('[data-variable]');if(button)datasetDialog.open(button.dataset.variable,button);});
 $('data-table').previousElementSibling.innerHTML='<tr><th>Model</th>'+VARIABLES.map(v=>`<th>${v.title}<br>${v.unit}</th>`).join('')+'<th>Coverage / status</th></tr>';
}
async function loadLocation(location,force=false){
 datasetDialog.close();
 state.controller?.abort();state.controller=new AbortController();const signal=state.controller.signal;const generation=++state.generation;
 state.location=location;state.models.clear();state.errors.clear();state.index=0;state.fetched=null;state.loading=true;
 $('place').textContent=location.name;$('coordinates').textContent=`${Math.abs(location.latitude).toFixed(4)}° ${location.latitude<0?'S':'N'} · ${Math.abs(location.longitude).toFixed(4)}° ${location.longitude<0?'W':'E'}`;
 $('altitude').textContent='Altitude: loading…';
 fetchJSON('https://api.open-meteo.com/v1/elevation?'+new URLSearchParams({latitude:location.latitude,longitude:location.longitude}),signal).then(result=>{
  if(generation!==state.generation)return;
  const altitude=result.elevation?.[0];
  $('altitude').textContent=finite(altitude)?'Altitude: approximately '+Math.round(altitude).toLocaleString('en-GB')+' m above sea level':'Altitude unavailable';
 }).catch(()=>{if(generation===state.generation)$('altitude').textContent='Altitude unavailable';});
 $('refresh').disabled=true;$('refresh').textContent='Loading…';
 let start=Math.floor(Date.now()/3600000)*3600000;state.timeNote='';
 const today=Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z');
 if(Number.isFinite(requestedTime)&&requestedTime>=today&&requestedTime<start)start=requestedTime;
 state.times=Array.from({length:168},(_,i)=>new Date(start+i*3600000).toISOString().replace('.000Z','Z'));
 if(Number.isFinite(requestedTime)){const idx=state.times.findIndex(t=>Date.parse(t)===requestedTime);if(idx>=0)state.index=idx;else state.timeNote='The selected map time is outside this point-forecast window. ';requestedTime=NaN;}
 const cacheKey=`${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
 const saved=cache.get(cacheKey);
 if(!force&&saved&&Date.now()-saved.at<20*60*1000){state.models=new Map(saved.models);state.errors=new Map(saved.errors);state.fetched=saved.at;state.loading=false;finishStatus();render();return;}
 setStatus('Loading forecasts for this location…');render();
 let done=0,next=0;
 async function worker(){while(next<MODELS.length&&!signal.aborted){const model=MODELS[next++];try{const json=await fetchJSON(forecastURL(location,model),signal,{force});if(generation!==state.generation)return;const parsed=normalise(json,model);if(!VARIABLES.some(v=>parsed.values[v.key].some(finite)))throw new Error('No forecast data for this location.');state.models.set(model.id,parsed);}catch(error){if(generation!==state.generation)return;if(!signal.aborted)state.errors.set(model.id,error.name==='TimeoutError'?'Request timed out. Try Refresh.':error.message);}finally{if(generation===state.generation){done++;setStatus(`Loading forecasts · ${done} of ${MODELS.length} models checked`);scheduleRender();}}}}
 await Promise.all([worker(),worker(),worker()]);if(generation!==state.generation)return;
 state.loading=false;state.fetched=state.models.size?Math.min(...[...state.models.values()].map(m=>m.fetchedAt??Date.now())):Date.now();if(state.models.size)cache.set(cacheKey,{at:state.fetched,models:new Map(state.models),errors:new Map(state.errors)});
 finishStatus();render();
}
function finishStatus(){
 $('refresh').disabled=false;$('refresh').textContent='Refresh';
 const suffix=state.errors.size?` · ${state.errors.size} unavailable (see data availability)`:'';
 setStatus(state.models.size?`${state.timeNote??''}Latest available forecasts · retrieved ${date.format(state.fetched)} UTC${suffix}`:'Unable to load forecasts. Check your connection and try Refresh. Details are in data availability.',!state.models.size);
}
function pathFrom(values,x,y){let drawing=false,d='';for(let i=0;i<values.length;i++){if(!finite(values[i])){drawing=false;continue;}d+=`${drawing?'L':'M'}${x(i).toFixed(1)},${y(values[i]).toFixed(1)} `;drawing=true;}return d;}
function plot(container,series,config,times){
 const width=Math.max(280,container.clientWidth),height=container.id==='agreement-chart'?140:225,left=43,right=12,top=15,bottom=33,inner=width-left-right,n=times.length;
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
 const ticks=Math.max(2,Math.min(6,Math.floor(inner/95)));
 for(let j=0;j<ticks;j++){const i=Math.round(j*(n-1)/(ticks-1));html+=`<text x="${x(i)}" y="${height-8}" text-anchor="${j===0?'start':j===ticks-1?'end':'middle'}">${shortDate.format(new Date(times[i]))} ${state.hours<=72?clock.format(new Date(times[i])):''}</text>`;}
 for(const s of series){if(s.average)html+=`<path d="${pathFrom(s.values,x,y)}" fill="none" stroke="white" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round"/>`;html+=`<path d="${pathFrom(s.values,x,y)}" fill="none" stroke="${s.color}" stroke-width="${s.average?3.2:s.ensemble?1.7:2}" stroke-linejoin="round" stroke-linecap="round" ${s.ensemble?'stroke-dasharray="5 4"':''} opacity=".9"/>`;}
 html+=`<line class="cursor-line" x1="${x(state.index)}" x2="${x(state.index)}" y1="${top}" y2="${height-bottom}"/>`;
 for(const s of series){const v=s.values[state.index];if(finite(v))html+=`<circle cx="${x(state.index)}" cy="${y(v)}" r="3" fill="${s.color}"/>`;}
 html+='</svg>';container.innerHTML=html;chartLayouts.set(container.id,{width,left,inner,n});
}
function render(){
 const models=selectedModels(),times=state.times.slice(0,state.hours);if(!times.length)return;state.index=Math.min(state.index,times.length-1);
 const time=times[state.index];for(const v of VARIABLES){const label=$('time-'+v.key);label.dateTime=time;label.textContent=date.format(new Date(time))+' UTC';}$('time-slider').max=times.length-1;$('time-slider').value=state.index;$('selected-time').textContent=date.format(new Date(time))+' UTC';$('time-slider').setAttribute('aria-valuetext',date.format(new Date(time))+' UTC');
 const available=models.filter(m=>VARIABLES.some(v=>times.some(t=>finite(valueAt(m,v.key,t)))));
 $('models-count').textContent=`${available.length} / ${state.selected.size}`;$('models-detail').textContent=state.loading?'Forecasts are still loading':'Selected models with data in this window';
 const votes=times.map(t=>agreement(models,t));const validVotes=votes.filter(v=>v.valid);const peak=validVotes.length?validVotes.reduce((a,b)=>b.percent>a.percent?b:a):null;
 $('peak-agreement').textContent=peak?`${Math.round(peak.percent)}%`:'—';$('peak-detail').textContent=peak?`${peak.snow} of ${peak.valid} forecasts at the peak hour`:'No eligible snowfall forecasts';
 let maxSnow=null,minTemp=null;
 for(const m of models)for(const t of times){const s=valueAt(m,'snowfall',t),temp=valueAt(m,'temperature_2m',t);if(finite(s)&&(!maxSnow||s>maxSnow.value))maxSnow={value:s,model:m.name};if(finite(temp)&&(!minTemp||temp<minTemp.value))minTemp={value:temp,model:m.name};}
 $('snow-max').textContent=maxSnow?`${fmt(maxSnow.value,2)} cm`:'—';$('snow-detail').textContent=maxSnow?(maxSnow.value>0?maxSnow.model:'All available snowfall values are zero'):'No snowfall data';
 $('temp-min').textContent=minTemp?`${fmt(minTemp.value)}°C`:'—';$('temp-detail').textContent=minTemp?minTemp.model:'No temperature data';
 plot($('agreement-chart'),[{values:votes.map(v=>v.percent),color:'#6ce1d6'}],{title:'Hourly snowfall model agreement',floor:0,ceiling:100,minRange:100},times);
 const vote=votes[state.index];$('agreement-detail').textContent=vote.valid?`${date.format(new Date(time))} UTC · ${vote.snow} of ${vote.valid} available forecasts indicate ≥0.1 cm snowfall (${Math.round(vote.percent)}%).`:'No eligible snowfall forecasts for the inspected hour.';
 for(const v of VARIABLES){
 const series=models.map(m=>({...m,values:times.map(t=>valueAt(m,v.key,t))}));
 const average=averageSeries(series,times.length);
 plot($('plot-'+v.key),[...series,{name:'Average',color:'#102235',average:true,values:average.values}],v,times);
 const current=models.filter(m=>finite(valueAt(m,v.key,time)));
 const mean=average.values[state.index],count=average.counts[state.index];
 const meanLabel=finite(mean)?`<span class="average-value"><i class="average-swatch"></i>Average <b ${temperatureAttributes(mean,v.unit)}>${formatValue(mean,v)}</b> <small>(${count} models)</small></span>`:'';
 $('values-'+v.key).innerHTML=current.length?meanLabel+current.map(m=>{const value=valueAt(m,v.key,time);return `<span><i class="swatch" style="--color:${m.color}"></i>${m.name} <b ${temperatureAttributes(value,v.unit)}>${formatValue(value,v)}</b></span>`;}).join(''):'<span>No values for this hour.</span>';
 $('frost-'+v.key).innerHTML=v.unit==='°C'&&series.some(s=>s.values.some(value=>finite(value)&&value<0))?frostLegend():'';
 }

 $('data-table').innerHTML=MODELS.filter(m=>state.selected.has(m.id)).map(m=>{const data=state.models.get(m.id);const validTimes=data?data.time.filter(t=>VARIABLES.some(v=>finite(valueAt(data,v.key,t)))):[];let coverage=state.errors.get(m.id)??(state.loading?'Loading…':'No data');if(validTimes.length)coverage=`Ends ${date.format(new Date(validTimes.at(-1)))} UTC; grid ${finite(data.elevation)?Math.round(data.elevation)+' m':'elevation unavailable'}`;return `<tr><td><i class="swatch" style="--color:${m.color}"></i>${m.name}${m.ensemble?' (ensemble mean)':''}</td>${VARIABLES.map(v=>{const value=data?valueAt(data,v.key,time):null;return `<td ${temperatureAttributes(value,v.unit)}>${formatValue(value,v)}</td>`;}).join('')}<td>${esc(coverage)}</td></tr>`}).join('');
 datasetDialog.render();
}
let searchController=null;
async function searchLocations(query){const coords=parseCoordinates(query);if(coords)return [coords];if(query.trim().length<2)throw new Error('Enter at least two characters.');const data=await fetchJSON('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query,count:'8',language:'en',format:'json'}),searchController?.signal);return (data.results??[]).sort((a,b)=>Number(b.country_code==='GB')-Number(a.country_code==='GB')).map(r=>({latitude:r.latitude,longitude:r.longitude,name:[r.name,r.admin2,r.admin1,r.country].filter(Boolean).join(', ')}));}
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
$('horizon').addEventListener('change',e=>{state.hours=Number(e.target.value);scheduleRender();});
$('time-slider').addEventListener('input',e=>{state.index=Number(e.target.value);scheduleRender();});
for(const [id,filter] of [['select-all',()=>true],['select-global',m=>!m.regional],['select-none',()=>false]])$(id).addEventListener('click',()=>{state.selected=new Set(MODELS.filter(filter).map(m=>m.id));document.querySelectorAll('.model-chip input').forEach(input=>input.checked=state.selected.has(input.value));scheduleRender();});
$('focus').addEventListener('change',e=>{const group=e.target.value;const snow=['snowfall','snow_depth','temperature_2m','dew_point_2m','temperature_850hPa','precipitation'];const ice=['temperature_2m','dew_point_2m','soil_temperature_0cm','relative_humidity_2m','precipitation','snow_depth','cloud_cover','wind_speed_10m'];for(const v of VARIABLES){const card=$('plot-'+v.key).closest('article');const order=group==='snow'?snow:ice;card.hidden=group!=='all'&&!order.includes(v.key);card.style.order=group==='all'?0:order.indexOf(v.key);}scheduleRender();});
document.addEventListener('click',e=>{const plotEl=e.target.closest('.plot');const layout=plotEl&&chartLayouts.get(plotEl.id);if(!layout)return;const x=e.clientX-plotEl.getBoundingClientRect().left;state.index=Math.max(0,Math.min(layout.n-1,Math.round((x-layout.left)/layout.inner*(layout.n-1))));scheduleRender();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(scheduleRender,120);});
populate();await loadLocation(state.location);
if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await document.modelContext.registerTool({name:'set_forecast_location',title:'Compare forecasts at a location',description:'Load the model comparison for latitude and longitude and update the visible dashboard. Makes requests to Open-Meteo.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){if(!input||!finite(input.latitude)||!finite(input.longitude)||Math.abs(input.latitude)>90||Math.abs(input.longitude)>180)throw new Error('Valid latitude and longitude are required.');await loadLocation({latitude:input.latitude,longitude:input.longitude,name:`${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`});return {location:state.location,modelsLoaded:state.models.size,unavailable:state.errors.size};}},{signal:lifecycle.signal});}catch(error){console.info('Optional browser tool unavailable:',error.message);}}


