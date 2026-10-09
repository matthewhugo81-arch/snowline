import {forecastTimes} from './map-runs.js';
import {loadSpatialModel,fieldSource,hasFieldTime,fieldDataURL} from './map-sources.js?v=20261009-white-rain';
import {sourceVariable,extendCatalogue,availableFields,variableGroup,PRECIPITATION_SCALE} from './map-catalogue.js?v=20261009-white-rain';
import * as maplibregl from './vendor/maplibre-gl.mjs';
import * as OM from './vendor/index.mjs';
import {MODELS,finite} from './data.js';
import {cachedJSON,usageText} from './cache.js';
import {selectEventPoint} from './event-analysis.js';
const $=id=>document.getElementById(id);
const UK=[-11,49,2.7,61.6];
const tempColors=['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643'];
const referenceColors=["#320032","#640064","#960096","#c800c8","#fa00fe","#c800fe","#9600fe","#6400fe","#3200fe","#0032fe","#0064fe","#0096fe","#00c8fe","#00e6f0","#00e6a0","#00e678","#00e650","#00f028","#00fa00","#fefe00","#fee100","#fec800","#feaf00","#fe9600","#e67d00","#e66400","#dc4b1e","#c8321e","#b4191e","#aa001e","#b40032","#c80064","#fe0096","#fe00c8","#fe00e1","#fe00fa"];
const fields=[
 {key:'pressure_msl',overlayOnly:true,name:'Mean sea-level pressure (MSLP)',unit:'hPa',note:'Atmospheric pressure reduced to mean sea level. Isobars are spaced every 4 hPa.',stops:[940,960,980,1000,1010,1020,1040,1060],colors:['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643']},
 {key:'temperature_2m',name:'2 m air temperature',unit:'°C',note:'Near-surface air temperature, not road temperature.',stops:[-1000,...Array.from({length:33},(_,i)=>-45+i*3)],colors:referenceColors.slice(0,34),temperatureBands:3},
 {key:'temperature_850hPa',name:'850 hPa temperature',unit:'°C',note:'Upper-air temperature. This pressure level can lie below high terrain.',stops:[-1000,...Array.from({length:35},(_,i)=>-36+i*2)],colors:referenceColors,temperatureBands:2},
 {key:'dew_point_2m',name:'2 m dew point',unit:'°C',note:'Available where the spatial model feed includes dew point.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'soil_temperature_0cm',name:'0 cm soil temperature',unit:'°C',note:'Modelled ground temperature, not a road-surface forecast.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'soil_temperature_0_to_7cm',name:'0–7 cm soil temperature',unit:'°C',note:'Average temperature in a soil layer; not road or grass-minimum temperature.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'precipitation',name:'Precipitation',unit:'mm water',note:'Precipitation over the native model interval. White means 0 to below 0.5 mm. Check the interval shown with the valid time.',...PRECIPITATION_SCALE},
 {key:'snowfall_water_equivalent',name:'Snowfall · water equivalent',unit:'mm water',note:'Water contained in falling snow over the model interval. This is not snow depth or a D-category amount.',stops:[0,.1,.25,.5,1,2,5,10],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'snow_depth',name:'Snow depth',unit:'m snow',note:'Existing snow on the ground. Kept in the spatial feed’s native metres.',stops:[0,.01,.02,.05,.1,.2,.5,1],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'snow_depth_water_equivalent',name:'Snow cover · water equivalent',unit:'mm water',note:'Water equivalent of existing snow cover, not its physical depth.',stops:[0,1,5,10,25,50,100,200],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'relative_humidity_2m',name:'2 m relative humidity',unit:'%',note:'Near-surface moisture context. Humidity alone does not determine surface wetness.',stops:[0,20,40,60,75,85,95,100],colors:['#f7ecce','#edce9c','#c6d4b1','#98cdbf','#60b7ba','#359ab0','#257ca2','#225987']},
 {key:'cloud_cover',name:'Total cloud cover',unit:'%',note:'Watch for cloud clearance after rain and overnight cooling.',stops:[0,20,40,60,75,85,95,100],colors:['#eaf6ff','#dce9f1','#bdcfdf','#96b1c7','#7391ac','#56738e','#3b5573','#263c55']},
 {key:'wind_speed_10m',name:'10 m wind speed',unit:'m/s',note:'Native spatial wind speed in m/s. The location charts use mph (multiply m/s by 2.23694).',stops:[0,2,4,6,8,12,18,25],colors:['#e8f2f6','#b9dede','#80c5c0','#42a7a6','#308caa','#416cad','#7d52a4','#bf4d84']},
 {key:'freezing_level_height',name:'Freezing level',unit:'m ASL',note:'Height of the 0°C level above sea level; not necessarily the snow level.',stops:[0,100,250,500,750,1000,1500,2500],colors:['#6148ae','#3163b5','#368fc1','#77cee1','#b7e2db','#e8f3b2','#ffdc81','#ee9755']}
];
const rgba=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),hex.length===9?parseInt(hex.slice(7,9),16)/255:1];
const settings={...OM.defaultOmProtocolSettings,maxStatesWithData:16,colorScales:{...OM.defaultOmProtocolSettings.colorScales,...Object.fromEntries(fields.map(f=>[f.key,{type:'breakpoint',unit:f.unit,breakpoints:f.stops,colors:f.colors.map(rgba)}]))}};
OM.updateCurrentBounds(UK);
maplibregl.addProtocol('om',(params,controller)=>OM.omProtocol(params,controller,settings));
const date=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const stamp=t=>date.format(new Date(t));
let roads=false;try{roads=localStorage.getItem('snowline-roads')==='true';}catch{}
$('map-roads').checked=roads;
function applyRoads(map){for(const layer of map.getStyle().layers)if(['transportation','transportation_name'].includes(layer['source-layer']))map.setLayoutProperty(layer.id,'visibility',roads?'visible':'none');}
const backgrounds={light:'positron',streets:'liberty'};
let background='light';try{const saved=localStorage.getItem('snowline-background');if(Object.hasOwn(backgrounds,saved))background=saved;else if(saved)localStorage.setItem('snowline-background',background);}catch{}
$('map-background').value=background;
const panels={};
let locationPopup=null,locationMarker=null;
function dismissLocation(){
 const popup=locationPopup;locationPopup=null;
 locationMarker?.remove();locationMarker=null;
 popup?.remove();
}
document.addEventListener('click',event=>{if(!event.target.closest('.maplibregl-map'))dismissLocation();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')dismissLocation();});
function viewportBounds(){const visible=Object.entries(panels).filter(([key])=>key==='a'||state.compare).map(([,p])=>p.map.getBounds());if(!visible.length)return;OM.updateCurrentBounds([Math.min(...visible.map(b=>b.getWest())),Math.min(...visible.map(b=>b.getSouth())),Math.max(...visible.map(b=>b.getEast())),Math.max(...visible.map(b=>b.getNorth()))]);}
let state={model:'ukmo_uk_deterministic_2km',modelB:'icon_eu',compare:false,field:'temperature_2m',times:[],index:0,metas:{},generation:0,location:null,opacity:.8,contours:true,isobars:true};
$('map-opacity').value=String(state.opacity*100);$('opacity-label').textContent=(state.opacity*100)+'%';$('map-mslp').checked=state.isobars;
const params=new URLSearchParams(location.search);const initialTime=Date.parse(params.get('time'));let requestedTime=Number.isFinite(initialTime)?initialTime:Date.now();
if(MODELS.some(m=>m.id===params.get('model')))state.model=params.get('model');
const initialLat=Number(params.get('lat')),initialLon=Number(params.get('lon'));
if(params.has('lat')&&params.has('lon')&&Number.isFinite(initialLat)&&Number.isFinite(initialLon)&&Math.abs(initialLat)<=90&&Math.abs(initialLon)<=180){state.location={latitude:initialLat,longitude:initialLon};$('nav-charts').href='./?'+new URLSearchParams({lat:initialLat,lon:initialLon,time:params.get('time')??''});}
function modelName(id){return MODELS.find(m=>m.id===id)?.name??id;}
function status(message){$('map-status').textContent=message;}
function usageUpdate(){$('usage-summary').textContent=usageText();}window.addEventListener('snowline-usage',usageUpdate);usageUpdate();
const modelGroups=[
 ['Short-term models',MODELS.filter(model=>model.regional)],
 ['Medium-term models',MODELS.filter(model=>!model.regional)]
];
for(const id of ['map-model','map-model-b']){
 for(const [label,models] of modelGroups){
  const group=document.createElement('optgroup');group.label=label;
  for(const model of models){const option=document.createElement('option');option.value=model.id;option.textContent=model.name;group.append(option);}
  $(id).append(group);
 }
}
$('map-model').value=state.model;$('map-model-b').value=state.modelB;
function makeMap(key){
 const map=new maplibregl.Map({container:'map-'+key,style:'https://tiles.openfreemap.org/styles/'+backgrounds[background],center:[-3,55.3],zoom:4.6,minZoom:2.5,maxZoom:10,renderWorldCopies:false,dragRotate:false,touchPitch:false,attributionControl:true});
 map.touchZoomRotate.disableRotation();
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.fitBounds([[UK[0],UK[1]],[UK[2],UK[3]]],{padding:25,duration:0});
 const panel={map,ready:new Promise(resolve=>map.on('load',resolve)),url:null,sourceId:null,version:0,loaded:false};panels[key]=panel;map.on('dataloading',viewportBounds);map.on('moveend',()=>{viewportBounds();$('zoom-'+key).textContent='Zoom '+map.getZoom().toFixed(1);});new ResizeObserver(()=>map.resize()).observe($('map-'+key));
 map.on('style.load',()=>{applyRoads(map);if(panel.restyling){panel.restyling=false;panel.sourceId=null;if((key==='a'||state.compare)&&!a.restyling&&(!state.compare||!panels.b.restyling))setTime();}});
 map.on('error',event=>{console.warn('Map rendering:',event.error?.message);if(event.sourceId==='mslp-source'){$('mslp-note').textContent='MSLP overlay could not be loaded. Try another time or model.';return;}if(event.error?.name==='AbortError'||(event.sourceId&&event.sourceId!==panel.sourceId))return;const el=$('map-error-'+key);el.textContent='This layer could not be loaded. Try another field or check the latest run.';el.hidden=false;panel.loaded=false;});
 map.on('sourcedata',event=>{if(event.sourceId===panel.sourceId&&event.isSourceLoaded){panel.loaded=true;status('Click the map for a value and local charts.');}});
 map.on('click',async event=>{if(panel.displayedTime!==state.times[state.index])return;dismissLocation();const latitude=Number(event.lngLat.lat.toFixed(5)),longitude=Number(event.lngLat.lng.toFixed(5));state.location={latitude,longitude};const div=document.createElement('div');const title=document.createElement('strong');title.textContent=`${Math.abs(latitude).toFixed(3)}° ${latitude<0?'S':'N'}, ${Math.abs(longitude).toFixed(3)}° ${longitude<0?'W':'E'}`;div.append(title);const value=document.createElement('p');value.textContent='Reading model value…';div.append(value);const link=document.createElement('a');const selectedTime=state.times[state.index]??'';const pointParams=new URLSearchParams({lat:latitude.toFixed(5),lon:longitude.toFixed(5),time:selectedTime});link.href='./?'+pointParams;link.textContent='Open location charts';div.append(link);$('nav-charts').href=link.href;const eventButton=document.createElement('button');eventButton.type='button';eventButton.className='event-link';eventButton.textContent='Analyse an event here';eventButton.addEventListener('click',()=>{selectEventPoint({latitude,longitude},selectedTime);$('event-analysis').scrollIntoView({behavior:'smooth',block:'start'});$('event-start').focus({preventScroll:true});});div.append(eventButton);locationMarker=new maplibregl.Marker({color:'#007e84'}).setLngLat(event.lngLat).addTo(map);
const popup=new maplibregl.Popup({closeButton:true,closeOnClick:false,offset:30}).setLngLat(event.lngLat).setDOMContent(div).addTo(map);
locationPopup=popup;popup.on('close',()=>{if(locationPopup===popup)dismissLocation();});try{const result=panel.loaded?await OM.getValueFromLatLong(latitude,longitude,panel.url,map.getZoom()):null;const field=fields.find(f=>f.key===state.field);value.textContent=result&&finite(result.value)?`${result.value.toFixed(2)} ${field.unit} · ${modelName(key==='a'?state.model:state.modelB)}`:'No value available here for this layer.';}catch{value.textContent='No value available here for this layer.';}});
 return panel;
}
const a=makeMap('a');
if(state.location)locationMarker=new maplibregl.Marker({color:'#007e84'}).setLngLat([state.location.longitude,state.location.latitude]).addTo(a.map);
function contourLevels(field){
 if(field.contourValues)return field.contourValues;
 if(/hPa$/.test(field.key)&&field.unit==='°C')return Array.from({length:71},(_,i)=>-100+i*2);
 if(field.key.startsWith('geopotential_height_')){const min=field.stops[0],max=field.stops.at(-1),step=Number(field.key.match(/_(\d+)hPa/)?.[1])<=100?120:60;return Array.from({length:Math.ceil((max-min)/step)+2},(_,i)=>Math.floor(min/step)*step+i*step);}
 // Spatial feeds contain MSLP in either hPa (UKMO/ICON) or Pa (IFS).
 if(field.key==='pressure_msl'){const hpa=Array.from({length:61},(_,i)=>880+i*4);return [...hpa,...hpa.map(v=>v*100)];}
 if(field.unit==='°C')return Array.from({length:51},(_,i)=>i*2-50);
 if(field.unit==='%')return Array.from({length:11},(_,i)=>i*10);
 if(field.key==='freezing_level_height')return Array.from({length:25},(_,i)=>i*250);
 if(field.key.startsWith('wind_speed_'))return Array.from({length:21},(_,i)=>i*5);
 return field.stops.filter(v=>v>0);
}
function clearContours(panel){for(const id of ['wind-arrows','wind-halo','contour-labels','contour-lines'])if(panel.map.getLayer(id))panel.map.removeLayer(id);if(panel.map.getSource('contour-source'))panel.map.removeSource('contour-source');}
function drawContours(panel,before){
 const field=fields.find(f=>f.key===state.field);const url=panel.url;if(field.categorical)return;
 panel.map.addSource('contour-source',{type:'vector',url,maxzoom:10});
 if(/^wind_speed_|^ocean_current_speed$/.test(field.key))for(const [id,color,width]of [['wind-halo','#ffffff',2.6],['wind-arrows','#111111',1]])panel.map.addLayer({id,type:'line',source:'contour-source','source-layer':'wind-arrows',paint:{'line-color':color,'line-width':width}},before);
 const visibility=state.contours||(state.field==='pressure_msl'&&state.isobars)?'visible':'none';
 panel.map.addLayer({id:'contour-lines',type:'line',source:'contour-source','source-layer':'contours',layout:{visibility,'line-join':'round'},paint:{'line-color':'#000000','line-width':0.7,'line-opacity':0.8}},before);
 panel.map.addLayer({id:'contour-labels',type:'symbol',source:'contour-source','source-layer':'contours',layout:{visibility,'symbol-placement':field.key==='pressure_msl'?'point':'line','symbol-spacing':140,'text-max-angle':85,'text-font':['Noto Sans Regular'],'text-field':['to-string',['get','value']],'text-size':10,'text-padding':field.key==='pressure_msl'?24:6,'text-offset':[0,-0.5]},paint:{'text-color':'#000000','text-halo-color':'rgba(255,255,255,0.8)','text-halo-width':1}},before);
}
function clearPressure(panel){
 for(const id of ['mslp-labels','mslp-lines'])if(panel.map.getLayer(id))panel.map.removeLayer(id);
 if(panel.map.getSource('mslp-source'))panel.map.removeSource('mslp-source');
}
function pressureNote(){
 const ids=state.compare?[state.model,state.modelB]:[state.model];
 const missing=ids.filter(id=>!hasFieldTime(state.metas[id],'pressure_msl',state.times[state.index]));
 const warnings=ids.flatMap(id=>state.metas[id]?.sourceWarnings??[]);
 $('mslp-note').textContent=warnings.length?warnings.join(' '):missing.length?'MSLP not available for '+missing.map(modelName).join(', ')+' at this forecast time.':'Isobars every 4 hPa, from each model at the displayed time.';
 if(ids.includes('gfs_global')&&!missing.includes('gfs_global'))$('mslp-note').textContent+=' GFS isobars use its 0.25° grid from the same run.';
 $('map-mslp').disabled=missing.length===ids.length;
}
function drawPressure(panel,model,before){
 clearPressure(panel);
 if(!state.isobars||state.field==='pressure_msl'||!sourceVariable(state.metas[model],'pressure_msl'))return;
 const time=state.times[state.index];if(!time||!hasFieldTime(state.metas[model],'pressure_msl',time))return;
 panel.map.addSource('mslp-source',{type:'vector',url:concreteURL(model,state.metas[model],time,'pressure_msl'),maxzoom:10});
 panel.map.addLayer({id:'mslp-lines',type:'line',source:'mslp-source','source-layer':'contours',layout:{'line-join':'round'},paint:{'line-color':'#000000','line-width':0.8,'line-opacity':1}},before);
 panel.map.addLayer({id:'mslp-labels',type:'symbol',source:'mslp-source','source-layer':'contours',layout:{'symbol-placement':'point','text-allow-overlap':false,'text-font':['Noto Sans Regular'],'text-field':['to-string',['case',['>', ['to-number',['get','value']],2000],['/', ['to-number',['get','value']],100],['to-number',['get','value']]]],'text-size':12,'text-padding':24,'text-offset':[0,-0.6]},paint:{'text-color':'#000000','text-halo-width':0}},before);
}
function drawCoastline(map,before){
 if(!map.getSource('coastline'))map.addSource('coastline',{type:'geojson',data:'coastline.geojson'});
 for(const [id,color,width] of [['coast-halo','#ffffff',2.5],['coast-line','#455464',1.1]]){
  if(!map.getLayer(id))map.addLayer({id,type:'line',source:'coastline',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':color,'line-width':width,'line-opacity':id==='coast-halo'?0.75:1}},before);
  else map.moveLayer(id,before);
 }
}
function concreteURL(model,meta,time,field){const source=fieldSource(meta,field,time);return 'om://'+fieldDataURL(meta,field,time)+'?'+new URLSearchParams({variable:sourceVariable(source,field)??field,interpolation:fields.find(f=>f.key===field)?.categorical?'nearest':'linear',arrows:/^wind_speed_|^ocean_current_speed$/.test(field)?'true':'false',tile_size:'512',color_blend:fields.find(f=>f.key===field)?.bands||fields.find(f=>f.key===field)?.temperatureBands?'false':'true',contours:'true',intervals:contourLevels(fields.find(f=>f.key===field)).join(',')});}
let playing=false,playTimer=null,timeGeneration=0,frameSequence=0;
function pauseAnimation(){playing=false;clearTimeout(playTimer);$('play-map').textContent='▶ Play';$('play-map').setAttribute('aria-pressed','false');}
function nextAnimation(){clearTimeout(playTimer);if(!playing)return;playTimer=setTimeout(()=>{if(!playing)return;if(state.index>=state.times.length-1){pauseAnimation();return;}state.index++;setTime();},900);}
function discardFrame(panel,frame){frame.cancel?.();if(panel.map.getLayer(frame.layer))panel.map.removeLayer(frame.layer);if(frame.id!==panel.sourceId&&panel.map.getSource(frame.id))panel.map.removeSource(frame.id);panel.frames.delete(frame.url);}
function prepareFrame(panel,url){
 panel.frames??=new Map();let frame=panel.frames.get(url);if(frame&&panel.map.getSource(frame.id))return frame;
 const id='frame-'+(++frameSequence),layer=id+'-warm';frame={id,layer,url};panel.frames.set(url,frame);
 panel.map.addSource(id,{type:'raster',url,maxzoom:10,tileSize:512,attribution:'Weather © Open-Meteo'});
 // A covered layer loads tiles without painting over the visible map.
 panel.map.addLayer({id:layer,type:'raster',source:id,paint:{'raster-opacity':1,'raster-fade-duration':0}},panel.map.getStyle().layers[0]?.id);
 frame.ready=new Promise(resolve=>{let done=false;const finish=ok=>{if(done)return;done=true;clearTimeout(timer);panel.map.off('sourcedata',check);panel.map.off('error',failed);resolve(ok);};const check=()=>{if(panel.map.getSource(id)&&panel.map.isSourceLoaded(id))finish(true);};const failed=e=>{if(e.sourceId===id)finish(false);};const timer=setTimeout(()=>finish(false),25000);frame.cancel=()=>finish(false);panel.map.on('sourcedata',check);panel.map.on('error',failed);check();});
 return frame;
}
function warmUpcoming(panel,model){
 if(panel.restyling||!state.metas[model]||!sourceVariable(state.metas[model],state.field))return;const upcoming=state.times.slice(state.index+1,state.index+3).filter(t=>hasFieldTime(state.metas[model],state.field,t)).map(t=>concreteURL(model,state.metas[model],t,state.field));if(state.isobars&&sourceVariable(state.metas[model],'pressure_msl'))upcoming.push(...state.times.slice(state.index,state.index+3).filter(t=>hasFieldTime(state.metas[model],'pressure_msl',t)).map(t=>concreteURL(model,state.metas[model],t,'pressure_msl')));
 for(const frame of [...(panel.frames?.values()??[])])if(frame.id!==panel.sourceId&&!upcoming.includes(frame.url))discardFrame(panel,frame);
 for(const url of upcoming)prepareFrame(panel,url);
}

async function drawPanel(key,model){
 const panel=panels[key];await panel.ready;if(panel.restyling)return false;const version=++panel.version;const meta=state.metas[model],time=state.times[state.index],field=state.field;if(!meta||!time)return false;
 if(!sourceVariable(meta,field)||!hasFieldTime(meta,field,time)){
  clearPressure(panel);clearContours(panel);if(panel.map.getLayer('weather'))panel.map.removeLayer('weather');
  panel.sourceId=null;panel.url=null;panel.loaded=false;panel.displayedTime=null;
  for(const frame of [...(panel.frames?.values()??[])])discardFrame(panel,frame);
  $('panel-label-'+key).textContent=modelName(model)+' · '+stamp(time)+' UTC';
  $('map-error-'+key).textContent=!sourceVariable(meta,field)?fields.find(f=>f.key===field).name+' is not supplied in this model’s map feed.':'No forecast for this layer at this time. Its data ends '+stamp(fieldSource(meta,field).valid_times.at(-1))+' UTC.';$('map-error-'+key).hidden=false;
  drawPressure(panel,model,panel.map.getStyle().layers.find(l=>l.type==='symbol')?.id);return true;
 }
 const url=concreteURL(model,meta,time,field);$('map-error-'+key).hidden=true;
 const frame=prepareFrame(panel,url);const ready=await frame.ready;
 if(version!==panel.version||panel.restyling||time!==state.times[state.index]||field!==state.field)return false;
 if(!ready){discardFrame(panel,frame);$('map-error-'+key).textContent='Next frame could not load. The previous forecast remains visible; try again.';$('map-error-'+key).hidden=false;return false;}
 clearPressure(panel);clearContours(panel);if(panel.map.getLayer('weather'))panel.map.removeLayer('weather');
 panel.sourceId=frame.id;panel.url=url;panel.loaded=true;
 panel.map.addLayer({id:'weather',type:'raster',source:frame.id,paint:{'raster-opacity':state.opacity,'raster-fade-duration':0,'raster-resampling':fields.find(f=>f.key===field)?.bands?'nearest':'linear'}});
 if(panel.map.getLayer(frame.layer))panel.map.removeLayer(frame.layer);
 for(const layer of panel.map.getStyle().layers)if(['line','symbol'].includes(layer.type)&&!['coast-halo','coast-line'].includes(layer.id))panel.map.moveLayer(layer.id);
 const before=panel.map.getStyle().layers.find(l=>l.type==='symbol')?.id;
 drawContours(panel,before);drawPressure(panel,model,before);drawCoastline(panel.map,before);
 $('panel-label-'+key).textContent=modelName(model)+' · '+stamp(time)+' UTC';panel.displayedTime=time;warmUpcoming(panel,model);return true;
}
async function setTime(){
 if(!state.times.length)return;const generation=++timeGeneration;state.index=Math.max(0,Math.min(state.index,state.times.length-1));const time=state.times[state.index];requestedTime=Date.parse(time);
 $('map-time').value=state.index;$('map-time').setAttribute('aria-valuetext',stamp(time)+' UTC');$('map-time-label').textContent=stamp(time);$('previous-time').disabled=state.index===0;$('next-time').disabled=state.index===state.times.length-1;setLegend();pressureNote();dismissLocation();$('animation-status').textContent='Loading frame…';
 const targets=state.compare?[['a',state.model],['b',state.modelB]]:[['a',state.model]];
 await Promise.all(targets.map(async([key,model])=>{const p=panels[key];await p.ready;if(p.restyling||generation!==timeGeneration||!hasFieldTime(state.metas[model],state.field,time)||!sourceVariable(state.metas[model],state.field))return;return prepareFrame(p,concreteURL(model,state.metas[model],time,state.field)).ready;}));
 if(generation!==timeGeneration)return;
 const loaded=await Promise.all([drawPanel('a',state.model),...(state.compare?[drawPanel('b',state.modelB)]:[])]);
 if(generation!==timeGeneration)return;
 if(loaded.every(Boolean)){$('animation-status').textContent='Next frames loading in background';status('Click the map for a value and local charts.');nextAnimation();}else{pauseAnimation();$('animation-status').textContent='Frame unavailable — previous image retained';}
}
function setLegend(){const f=fields.find(f=>f.key===state.field);const min=f.stops[0],max=f.stops.at(-1);$('legend-title').textContent=f.unit;$('legend-gradient').style.background=`linear-gradient(to right,${f.colors.map((c,i)=>c+' '+100*(f.stops[i]-min)/(max-min)+'%').join(',')})`;$('legend-ticks').replaceChildren();$('legend-ticks').style.cssText='';[min,(min+max)/2,max].forEach(v=>{const span=document.createElement('span');span.textContent=Number(v.toFixed(2));$('legend-ticks').append(span);});$('legend-gradient').hidden=!!f.bands;$('legend-ticks').hidden=!!f.bands;$('legend-bands').hidden=!f.bands;$('legend-bands').replaceChildren();if(f.bands)f.stops.forEach((v,i)=>{const item=document.createElement('div');const swatch=document.createElement('i');swatch.style.background=f.colors[i];const label=document.createElement('span');label.textContent=f.categorical?String(v):i===f.stops.length-1?v+'+':v+'–<'+f.stops[i+1];item.append(swatch,label);$('legend-bands').append(item);});if(f.temperatureBands){
 const colors=f.colors;const gradient=$('legend-gradient');
 gradient.style.background='linear-gradient(to right,'+colors.flatMap((c,i)=>[c+' '+100*i/colors.length+'%',c+' '+100*(i+1)/colors.length+'%']).join(',')+')';
 gradient.title=f.stops.slice(1).join(', ')+' °C';
 $('legend-ticks').replaceChildren();$('legend-ticks').style.cssText='';$('legend-ticks').style.cssText='display:block;position:relative;height:16px';[f.stops[1],0,f.stops.at(-1)].forEach(v=>{const span=document.createElement('span');span.textContent=v+'°';span.style.cssText='position:absolute;transform:translateX(-50%);left:'+100*f.stops.indexOf(v)/f.colors.length+'%';$('legend-ticks').append(span);});
 }else $('legend-gradient').removeAttribute('title');
 $('temperature-scale-note').textContent=f.temperatureBands?f.temperatureBands+'°C colour bands · '+f.stops[1]+' to '+f.stops.at(-1)+'°C; end colours extend beyond this range.':'';
 let note=f.note;const ids=state.compare?[state.model,state.modelB]:[state.model];$('field-availability').textContent=ids.map(id=>modelName(id)+': '+(sourceVariable(state.metas[id],f.key)?'available':'not supplied')).join(' · ');$('map-contours').disabled=!!f.categorical;if(['precipitation','rain','showers','snowfall_water_equivalent'].includes(f.key)){const times=fieldSource(state.metas[state.model],f.key)?.valid_times??[];const idx=times.indexOf(state.times[state.index]);note+=' '+(idx>0?`First model interval: ${(Date.parse(times[idx])-Date.parse(times[idx-1]))/3600000} hours ending at the displayed time.`:'Initial model time: an accumulation interval is not defined.');if(state.compare){const other=fieldSource(state.metas[state.modelB],f.key)?.valid_times??[];const j=other.indexOf(state.times[state.index]);note+=' '+(j>0?`Second model interval: ${(Date.parse(other[j])-Date.parse(other[j-1]))/3600000} hours.`:'Second model is at its initial time.');}}$('variable-note').textContent=note;const interval=f.key==='pressure_msl'?'4 hPa':f.key.startsWith('geopotential_height_')?(Number(f.key.match(/_(\d+)hPa/)?.[1])<=100?'120 m':'60 m'):f.unit==='°C'?'2°C':f.unit==='%'?'10%':f.key==='freezing_level_height'?'250 m':f.key.startsWith('wind_speed_')?'5 m/s':'the positive legend thresholds';$('contour-note').textContent=f.categorical?'Discrete categories: contours are disabled.':'Contours: '+interval+'. Labels use the displayed units.';}
function populateVariables(){
 const metas=(state.compare?[state.model,state.modelB]:[state.model]).map(id=>state.metas[id]).filter(Boolean);
 const available=availableFields(fields,metas);
 $('map-variable').replaceChildren();
 const groups=new Map();
 for(const f of available){
  const group=variableGroup(f.key);
  if(!groups.has(group)){const element=document.createElement('optgroup');element.label=group;groups.set(group,element);$('map-variable').append(element);}
  const option=document.createElement('option');option.value=f.key;
  const only=state.compare&&!metas.every(m=>sourceVariable(m,f.key));
  option.textContent=f.name+(only?' · one model':'');groups.get(group).append(option);
 }
 if(!available.some(f=>f.key===state.field))state.field=available[0]?.key;
 $('map-variable').value=state.field;
}
async function loadModelRun(id,force){
 const load=url=>cachedJSON(url,{force,kind:'metadata',ttl:600000});
 return loadSpatialModel(id,load,$('map-run-mode').value);
}
$('map-run-mode').addEventListener('change',()=>configure());
async function configure(force=false){pauseAnimation();++timeGeneration;for(const p of Object.values(panels))p.version++;const generation=++state.generation;$('reload-maps').disabled=true;status('Checking available variables and forecast times…');const ids=state.compare?[state.model,state.modelB]:[state.model];try{const pairs=await Promise.all(ids.map(async id=>[id,await loadModelRun(id,force)]));if(generation!==state.generation)return;state.metas=Object.fromEntries(pairs);$('ukv-run-note').textContent=$('map-run-mode').value==='extended'?'Uses the recent completed run reaching furthest ahead for each model.':'Uses the newest published run for each model.';pressureNote();const metas=pairs.map(p=>p[1]);
 extendCatalogue(fields,metas,OM,settings);populateVariables();
 if(!fields.some(f=>f.key===state.field&&metas.some(m=>sourceVariable(m,f.key))))throw new Error('No map fields are available for these runs.');

 state.times=forecastTimes(metas);if(!state.times.length)throw new Error('These runs have no available forecast times.');state.index=state.times.reduce((best,t,i)=>Math.abs(Date.parse(t)-requestedTime)<Math.abs(Date.parse(state.times[best])-requestedTime)?i:best,0);
 $('map-time').max=state.times.length-1;$('range-start').textContent=stamp(state.times[0]);$('range-end').textContent=stamp(state.times.at(-1));$('run-a').textContent=modelName(state.model)+' · '+stamp(metas[0].reference_time)+' · ends '+stamp(metas[0].valid_times.at(-1));$('run-b').textContent=state.compare?modelName(state.modelB)+' · '+stamp(metas[1].reference_time)+' · ends '+stamp(metas[1].valid_times.at(-1)):'';setLegend();setTime();
 }catch(error){if(generation===state.generation){state.times=[];for(const [key,p]of Object.entries(panels)){clearPressure(p);clearContours(p);if(p.map.getLayer('weather'))p.map.removeLayer('weather');p.loaded=false;}$('map-time-label').textContent='Forecast unavailable';status(error.message);}}finally{if(generation===state.generation)$('reload-maps').disabled=false;}}
$('map-model').addEventListener('change',e=>{state.model=e.target.value;configure();});$('map-model-b').addEventListener('change',e=>{state.modelB=e.target.value;configure();});
$('map-variable').addEventListener('change',e=>{pauseAnimation();state.field=e.target.value;setLegend();setTime();});
$('compare-maps').addEventListener('change',async e=>{state.compare=e.target.checked;$('panel-b').hidden=!state.compare;$('second-model-control').hidden=!state.compare;if(state.compare&&!panels.b)makeMap('b');a.map.resize();panels.b?.map.resize();await configure();});
$('map-contours').addEventListener('change',e=>{state.contours=e.target.checked;for(const p of Object.values(panels))for(const id of ['contour-lines','contour-labels'])if(p.map.getLayer(id))p.map.setLayoutProperty(id,'visibility',state.contours||(state.field==='pressure_msl'&&state.isobars)?'visible':'none');});
$('map-mslp').addEventListener('change',e=>{state.isobars=e.target.checked;for(const [key,panel]of Object.entries(panels)){if(panel.restyling||!state.metas[key==='a'?state.model:state.modelB])continue;const before=panel.map.getStyle().layers.find(l=>l.type==='symbol'&&!['contour-labels','mslp-labels'].includes(l.id))?.id;drawPressure(panel,key==='a'?state.model:state.modelB,before);}pressureNote();});
$('map-roads').addEventListener('change',e=>{roads=e.target.checked;try{localStorage.setItem('snowline-roads',String(roads));}catch{}for(const panel of Object.values(panels))if(panel.map.isStyleLoaded())applyRoads(panel.map);});
$('map-background').addEventListener('change',e=>{pauseAnimation();++timeGeneration;$('animation-status').textContent='Loading map background…';background=e.target.value;try{localStorage.setItem('snowline-background',background);}catch{}for(const panel of Object.values(panels)){panel.restyling=true;panel.loaded=false;panel.version++;for(const frame of panel.frames?.values()??[])frame.cancel?.();panel.frames=new Map();panel.map.setStyle('https://tiles.openfreemap.org/styles/'+backgrounds[background]);}});
$('reload-maps').addEventListener('click',()=>configure(true));$('map-time').addEventListener('change',e=>{pauseAnimation();state.index=Number(e.target.value);setTime();});$('map-time').addEventListener('input',e=>{if(state.times.length)$('map-time-label').textContent=stamp(state.times[Number(e.target.value)]);});
$('previous-time').addEventListener('click',()=>{pauseAnimation();state.index--;setTime();});$('next-time').addEventListener('click',()=>{pauseAnimation();state.index++;setTime();});
$('map-opacity').addEventListener('input',e=>{state.opacity=Number(e.target.value)/100;$('opacity-label').textContent=e.target.value+'%';for(const p of Object.values(panels))if(p.map.getLayer('weather'))p.map.setPaintProperty('weather','raster-opacity',state.opacity);});
$('reset-map').addEventListener('click',()=>{for(const p of Object.values(panels))p.map.fitBounds([[UK[0],UK[1]],[UK[2],UK[3]]],{padding:25,duration:400});});
$('play-map').addEventListener('click',()=>{if(playing){pauseAnimation();return;}if(!state.times.length)return;playing=true;$('play-map').textContent='Ⅱ Pause';$('play-map').setAttribute('aria-pressed','true');if(state.index>=state.times.length-1)state.index=0;setTime();});
window.addEventListener('pagehide',pauseAnimation);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAnimation();});
await configure();
if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await document.modelContext.registerTool({name:'select_event_location',title:'Prepare an event analysis at a location',description:'Select latitude and longitude for the visible event analysis form. Does not calculate a hazard or fetch point forecasts; use the visible Calculate event action afterwards.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!finite(input.latitude)||!finite(input.longitude)||Math.abs(input.latitude)>90||Math.abs(input.longitude)>180)throw new Error('Valid latitude and longitude are required.');state.location={latitude:input.latitude,longitude:input.longitude};selectEventPoint(state.location,state.times[state.index]);$('event-analysis').scrollIntoView({block:'start'});return {location:state.location,eventStartUTC:$('event-start').value+'Z',eventEndUTC:$('event-end').value+'Z',calculated:false};}},{signal:lifecycle.signal});}catch(error){console.info('Optional map tool unavailable:',error.message);}}
