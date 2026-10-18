import {MODELS} from './data.js?v=20261018-pressure-total';
import {loadPointForecasts} from './point-forecasts.js?v=20261018-pressure-total';
import {analyseEvent,eventHours} from './hazards.js';
const $=id=>document.getElementById(id);let point=null,controller=null,revision=0;const results=new Map();
const stamp=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
function busy(active){for(const id of ['calculate-event','event-start','event-end'])$(id).disabled=active;}
export function selectEventPoint(location,time){controller?.abort();revision++;point=location;results.clear();$('event-point').textContent=`${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;$('event-results').replaceChildren();$('event-status').textContent='Choose the whole event period, then calculate the point forecasts.';busy(false);$('event-analysis').hidden=false;const start=Number.isFinite(Date.parse(time))?Date.parse(time):Math.ceil(Date.now()/3600000)*3600000;$('event-start').value=new Date(start).toISOString().slice(0,16);$('event-end').value=new Date(start+24*3600000).toISOString().slice(0,16);}
function render(){let times;try{times=eventHours($('event-start').value+'Z',$('event-end').value+'Z');}catch(e){$('event-status').textContent=e.message;return;}const body=$('event-results');body.replaceChildren();for(const model of MODELS){if(!results.has(model.id))continue;const row=document.createElement('tr'),data=results.get(model.id);const cell=value=>{const td=document.createElement('td');td.textContent=value;row.append(td);};cell(model.name);if(data.error){const td=document.createElement('td');td.colSpan=7;td.textContent=data.error;row.append(td);}else{const r=analyseEvent(data,$('event-start').value+'Z',$('event-end').value+'Z');cell(r.snowMm===null?'—':r.snowMm.toFixed(2));cell(r.category??'Incomplete');cell(r.precipitation===null?'—':r.precipitation.toFixed(1));cell(r.minAir===null?'—':r.minAir.toFixed(1));cell(r.minGround===null?'—':r.minGround.toFixed(1));cell(r.assessedHours===0?'Insufficient data':r.signalHours?`${r.signalHours} h flagged`:`None in ${r.assessedHours} assessed h`);cell(`${r.snowHours}/${r.hours} snow hours; ${r.assessedHours}/${r.hours} ice-screen hours`);if(r.reasons.length)row.title='Cold/wet signal: '+r.reasons.join('; ');}body.append(row);}}
$('event-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!point)return;
 try{eventHours($('event-start').value+'Z',$('event-end').value+'Z');}catch(error){$('event-status').textContent=error.message;return;}
 controller?.abort();controller=new AbortController();const current=++revision,signal=controller.signal,selectedPoint={...point};
 busy(true);results.clear();let failure;
 try{await loadPointForecasts(selectedPoint,{signal,
  onModel:model=>{if(current===revision)results.set(model.id,model);},
  onError:(model,error)=>{if(current===revision)results.set(model.id,{error:error.message});},
  onProgress:done=>{if(current===revision){$('event-status').textContent=`${done} of ${MODELS.length} model forecasts checked.`;render();}}
 });}catch(error){if(!signal.aborted)failure=error.message;}
 if(current!==revision)return;busy(false);render();
 const loaded=[...results.values()].filter(data=>!data.error),stale=loaded.some(data=>data.stale),retrieved=loaded.length?Math.min(...loaded.map(data=>data.fetchedAt)):null;
 const availability=loaded.length?`${stale?'Cached forecasts — live refresh unavailable':'Point forecasts'} · retrieved ${stamp.format(retrieved)} UTC.`:'No point forecasts available. '+(failure??'See each model’s status.');
 $('event-status').textContent=`Event: ${stamp.format(new Date($('event-start').value+'Z'))} to ${stamp.format(new Date($('event-end').value+'Z'))} UTC. ${availability} Totals require every hour. Point data may differ from the map run.`;
});
for(const id of ['event-start','event-end'])$(id).addEventListener('change',()=>{if(results.size){try{eventHours($('event-start').value+'Z',$('event-end').value+'Z');render();$('event-status').textContent='Recalculated for the edited event from the loaded point forecasts; no extra requests.';}catch(error){$('event-results').replaceChildren();$('event-status').textContent=error.message;}}});
