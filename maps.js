import {setupMobileMap} from './map-mobile.js?v=20261009-controls-fix';
import {ForecastFrames,frameWindow} from './map-frames.js?v=20261010-buffered-playback';
import {ForecastPlayback} from './map-playback.js?v=20261010-buffered-playback';
import {overlayGroups} from './map-overlay-specs.js?v=20261010-buffered-playback';
import {panelSelection,panelSelections,panelModelIds,panelForecastTimes,createPanelOverlays} from './map-panels.js?v=20261010-valid-frames';
import {visibleGridPoints,gridValueLabel} from './map-grid.js?v=20261010-wind-mph';
import {displayUnit,displayValue,displayStops,isWindSpeed} from './map-wind-units.js?v=20261010-wind-mph';
import {loadSpatialModel,fieldSource,hasFieldTime,fieldDataURL} from './map-sources.js?v=20261010-latest-cycles';
import {runLabel} from './map-runs.js?v=20261010-latest-cycles';
import {sourceVariable,extendCatalogue,availableFields,variableGroup,PRECIPITATION_SCALE} from './map-catalogue.js?v=20261009-white-rain';
import * as maplibregl from './vendor/maplibre-gl.mjs';
import * as OM from './vendor/index.mjs';
import {MODELS,finite} from './data.js';
import {cachedJSON,usageText} from './cache.js';
import {selectEventPoint} from './event-analysis.js';
const $=id=>document.getElementById(id);
setupMobileMap();
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
 {key:'wind_speed_10m',name:'10 m wind speed',unit:'m/s',note:'Map shading and values displayed in mph; model grid retained in m/s.',stops:[0,2,4,6,8,12,18,25],colors:['#e8f2f6','#b9dede','#80c5c0','#42a7a6','#308caa','#416cad','#7d52a4','#bf4d84']},
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
let terrain=true;try{terrain=localStorage.getItem('snowline-terrain')!=='false';}catch{}
$('map-terrain').checked=terrain;
const panels={};
let locationPopup=null,locationMarker=null;
function dismissLocation(){
 const popup=locationPopup;locationPopup=null;
 locationMarker?.remove();locationMarker=null;
 popup?.remove();
}
document.addEventListener('click',event=>{if(!event.target.closest('.maplibregl-map'))dismissLocation();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')dismissLocation();});
let viewportRefreshTimer;
function queueViewportRefresh(){clearTimeout(viewportRefreshTimer);viewportRefreshTimer=setTimeout(()=>{if(state.times.length&&!playing)setTime();},120);}
function viewportBounds(){const visible=Object.entries(panels).filter(([key])=>key==='a'||state.compare).map(([,p])=>p.map.getBounds());if(!visible.length)return;OM.updateCurrentBounds([Math.min(...visible.map(b=>b.getWest())),Math.min(...visible.map(b=>b.getSouth())),Math.max(...visible.map(b=>b.getEast())),Math.max(...visible.map(b=>b.getNorth()))]);}
let state={model:'ukmo_uk_deterministic_2km',modelB:'ukmo_uk_deterministic_2km',compare:false,field:'temperature_2m',fieldB:'precipitation',times:[],index:0,metas:{},generation:0,location:null,opacity:.8,overlays:createPanelOverlays()};
$('map-opacity').value=String(state.opacity*100);$('opacity-label').textContent=(state.opacity*100)+'%';
const params=new URLSearchParams(location.search);const initialTime=Date.parse(params.get('time'));let requestedTime=Number.isFinite(initialTime)?initialTime:Date.now();
if(MODELS.some(m=>m.id===params.get('model')))state.model=params.get('model');
const initialLat=Number(params.get('lat')),initialLon=Number(params.get('lon'));
if(params.has('lat')&&params.has('lon')&&Number.isFinite(initialLat)&&Number.isFinite(initialLon)&&Math.abs(initialLat)<=90&&Math.abs(initialLon)<=180){state.location={latitude:initialLat,longitude:initialLon};$('nav-charts').href='./?'+new URLSearchParams({lat:initialLat,lon:initialLon,time:params.get('time')??''});}
function modelName(id){return MODELS.find(m=>m.id===id)?.name??id;}
function panelRunLabel(model){return modelName(model)+' · '+runLabel(state.metas[model]);}
function forecastLabel(model,field,time){return panelRunLabel(model)+' · '+fields.find(f=>f.key===field).name+' · Valid '+stamp(time)+' UTC';}
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
 const map=new maplibregl.Map({container:'map-'+key,style:'https://tiles.openfreemap.org/styles/'+backgrounds[background],center:[-3,55.3],zoom:4.6,minZoom:2.5,maxZoom:10,fadeDuration:0,renderWorldCopies:false,dragRotate:false,touchPitch:false,attributionControl:{compact:true}});
 map.touchZoomRotate.disableRotation();
 map.once('load',()=>{const credits=map.getContainer().querySelector('.maplibregl-compact-show .maplibregl-ctrl-attrib-button');credits?.click();});
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.fitBounds([[UK[0],UK[1]],[UK[2],UK[3]]],{padding:25,duration:0});
 const panel={key,map,ready:new Promise(resolve=>map.once('style.load',resolve)),url:null,sourceId:null,version:0,loaded:false};panels[key]=panel;map.on('moveend',()=>{viewportBounds();$('zoom-'+key).textContent='Zoom '+map.getZoom().toFixed(1);scheduleGridValues(panel);queueViewportRefresh();});map.on('movestart',()=>{pauseAnimation();panel.frameCache?.suspend(panel.requestedURL);clearGridValues(panel);});let lastSize='';new ResizeObserver(entries=>{const r=entries[0].contentRect,size=Math.round(r.width)+'x'+Math.round(r.height);if(size!==lastSize){lastSize=size;map.resize();}}).observe($('map-'+key));
 map.on('style.load',()=>{panel.styleOrdered=false;applyRoads(map);drawTerrain(map);if(panel.restyling){panel.restyling=false;panel.sourceId=null;if((key==='a'||state.compare)&&!a.restyling&&(!state.compare||!panels.b.restyling))setTime();}});
 map.on('error',event=>{console.warn('Map rendering:',event.error?.message);if(event.sourceId==='mslp-source'){$('mslp-note-'+key).textContent='MSLP overlay could not be loaded. Try another time or model.';return;}if(event.error?.name==='AbortError'||!event.sourceId||event.sourceId!==panel.sourceId)return;const el=$('map-error-'+key);el.textContent='This layer could not be loaded. Try another field or check the latest run.';el.hidden=false;panel.loaded=false;});
 map.on('sourcedata',event=>{if(event.sourceId===panel.sourceId&&event.isSourceLoaded&&panel.frameCache?.current?.loaded){panel.loaded=true;status('Click a map for a value and local charts.');scheduleGridValues(panel);}});
 map.on('click',async event=>{if(panel.displayedTime!==state.times[state.index])return;dismissLocation();const latitude=Number(event.lngLat.lat.toFixed(5)),longitude=Number(event.lngLat.lng.toFixed(5));state.location={latitude,longitude};const div=document.createElement('div');const title=document.createElement('strong');title.textContent=`${Math.abs(latitude).toFixed(3)}° ${latitude<0?'S':'N'}, ${Math.abs(longitude).toFixed(3)}° ${longitude<0?'W':'E'}`;div.append(title);const value=document.createElement('p');value.textContent='Reading model value…';div.append(value);const link=document.createElement('a');const selectedTime=state.times[state.index]??'';const pointParams=new URLSearchParams({lat:latitude.toFixed(5),lon:longitude.toFixed(5),time:selectedTime});link.href='./?'+pointParams;link.textContent='Open location charts';div.append(link);$('nav-charts').href=link.href;const eventButton=document.createElement('button');eventButton.type='button';eventButton.className='event-link';eventButton.textContent='Analyse an event here';eventButton.addEventListener('click',()=>{selectEventPoint({latitude,longitude},selectedTime);$('event-analysis').scrollIntoView({behavior:'smooth',block:'start'});$('event-start').focus({preventScroll:true});});div.append(eventButton);locationMarker=new maplibregl.Marker({color:'#007e84'}).setLngLat(event.lngLat).addTo(map);
const popup=new maplibregl.Popup({closeButton:true,closeOnClick:false,offset:30}).setLngLat(event.lngLat).setDOMContent(div).addTo(map);
locationPopup=popup;popup.on('close',()=>{if(locationPopup===popup)dismissLocation();});try{const result=panel.loaded?await OM.getValueFromLatLong(latitude,longitude,panel.url,map.getZoom()):null;const field=fields.find(f=>f.key===panel.displayedField);value.textContent=result&&finite(result.value)?`${displayValue(result.value,field).toFixed(1)} ${displayUnit(field)} · ${modelName(key==='a'?state.model:state.modelB)}`:'No value available here for this layer.';}catch{value.textContent='No value available here for this layer.';}});
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
function pressureNote(){
 for(const {key,model}of panelSelections(state)){
  const missing=!hasFieldTime(state.metas[model],'pressure_msl',state.times[state.index]),warnings=state.metas[model]?.sourceWarnings??[];
  $('mslp-note-'+key).textContent=warnings.length?warnings.join(' '):missing?'MSLP is unavailable at this time.':'MSLP isobars every 4 hPa.';
  if(model==='gfs_global'&&!missing)$('mslp-note-'+key).textContent+=' Uses the GFS 0.25° grid from the same run.';
  $('map-mslp-'+key).disabled=missing;
 }
}
function drawCoastline(map,before){
 if(!map.getSource('coastline'))map.addSource('coastline',{type:'geojson',data:'coastline.geojson'});
 if(!map.getLayer('coast-line'))map.addLayer({id:'coast-line',type:'line',source:'coastline',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#000000','line-width':['interpolate',['linear'],['zoom'],3,1,6,1.25,10,1.6],'line-opacity':1}},before);
 else map.moveLayer('coast-line',before);
}
function drawTerrain(map){
 if(!terrain){if(map.getLayer('terrain-shading'))map.setLayoutProperty('terrain-shading','visibility','none');return;}
 if(!map.getSource('terrain-dem'))map.addSource('terrain-dem',{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,maxzoom:15,encoding:'terrarium',attribution:'Terrain: <a href="map-credits.html#terrain">Mapzen / terrain sources</a>'});
 if(!map.getLayer('terrain-shading')){
  const water=map.getStyle().layers.find(layer=>layer.type==='fill'&&layer['source-layer']==='water');
  map.addLayer({id:'terrain-shading',type:'hillshade',source:'terrain-dem',paint:{'hillshade-exaggeration':.8,'hillshade-illumination-direction':315,'hillshade-illumination-anchor':'map','hillshade-shadow-color':'#263c32','hillshade-highlight-color':'#ffffff','hillshade-accent-color':'#506658'}},water?.id);
 }else map.setLayoutProperty('terrain-shading','visibility','visible');
}
const emptyGrid=()=>({type:'FeatureCollection',features:[]});
function clearGridValues(panel){
 clearTimeout(panel.gridTimer);panel.gridVersion=(panel.gridVersion??0)+1;
 panel.map.getSource('grid-values')?.setData(emptyGrid());
 const note=$('grid-note-'+panel.key);note.hidden=!state.overlays[panel.key].grid;
 if(!note.hidden)note.textContent=playing?'Grid values resume when playback is paused.':'Grid values loading…';
}
function scheduleGridValues(panel){
 if(!panel||playing||!state.overlays[panel.key].grid||panel.restyling)return;
 clearTimeout(panel.gridTimer);panel.gridTimer=setTimeout(()=>drawGridValues(panel),150);
}
async function drawGridValues(panel){
 if(playing||!state.overlays[panel.key].grid||!panel.loaded||panel.restyling||panel.displayedTime!==state.times[state.index])return;
 const {key,map}=panel,version=panel.gridVersion=(panel.gridVersion??0)+1;
 const {model,field}=panelSelection(state,key),time=panel.displayedTime;
 if(field!==panel.displayedField||model!==panel.displayedModel)return;
 const source=fieldSource(state.metas[model],field,time),domain=OM.domainOptions.find(item=>item.value===source?.domain);
 const note=$('grid-note-'+key);note.hidden=false;
 if(!domain){note.textContent='Grid values unavailable for this model.';return;}
 try{
  const grid=OM.GridFactory.create(domain.grid),canvas=map.getCanvas(),f=fields.find(item=>item.key===field);
  const points=visibleGridPoints(grid,canvas.clientWidth,canvas.clientHeight,p=>map.unproject(p),p=>map.project(p));
  const valueURL=panel.url.replace(/interpolation=[^&]+/,'interpolation=nearest');
  const features=(await Promise.all(points.map(async point=>{
   const result=await OM.getValueFromLatLong(point.lat,point.lon,valueURL,map.getZoom());
   const label=gridValueLabel(result?.value,f);if(label===null)return null;
   return {type:'Feature',id:point.id,properties:{label,value:result.value},geometry:{type:'Point',coordinates:[point.lon,point.lat]}};
  }))).filter(Boolean);
  if(version!==panel.gridVersion||!state.overlays[key].grid||panel.restyling)return;
  const data={type:'FeatureCollection',features};
  if(map.getSource('grid-values'))map.getSource('grid-values').setData(data);else map.addSource('grid-values',{type:'geojson',data});
  if(!map.getLayer('grid-labels'))map.addLayer({id:'grid-labels',type:'symbol',source:'grid-values',layout:{'text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':11,'text-padding':4,'text-allow-overlap':false},paint:{'text-color':'#101820','text-halo-color':'rgba(255,255,255,0.9)','text-halo-width':1.5}});else map.moveLayer('grid-labels');
  note.textContent=features.length?'Grid values · '+displayUnit(f):'No grid values in this area.';
 }catch(error){if(version===panel.gridVersion){note.textContent='Grid values unavailable; try another time.';console.warn('Grid values:',error.message);}}
}
function concreteURL(model,meta,time,field){const source=fieldSource(meta,field,time);return 'om://'+fieldDataURL(meta,field,time)+'?'+new URLSearchParams({variable:sourceVariable(source,field)??field,interpolation:fields.find(f=>f.key===field)?.categorical?'nearest':'linear',arrows:/^wind_speed_|^ocean_current_speed$/.test(field)?'true':'false',tile_size:'512',color_blend:fields.find(f=>f.key===field)?.bands||fields.find(f=>f.key===field)?.temperatureBands?'false':'true',contours:'true',intervals:contourLevels(fields.find(f=>f.key===field)).join(',')});}
let playing=false,timeGeneration=0,playback;
function syncTimeline(index){
 const time=state.times[index];if(!time)return;
 $('map-time').value=index;$('map-time').setAttribute('aria-valuetext',stamp(time)+' UTC');
 $('map-time-label').textContent=stamp(time);
 $('previous-time').disabled=index===0;$('next-time').disabled=index===state.times.length-1;
}
function pauseAnimation(){
 const active=playing;playback?.pause();playing=false;
 if(active){
  ++timeGeneration;
  const shown=state.times.indexOf(panels.a?.displayedTime);
  if(shown>=0){state.index=shown;syncTimeline(shown);}
 }
 $('play-map').textContent='▶ Play';$('play-map').setAttribute('aria-pressed','false');
}
function frameBudget(){
 return state.compare?{ahead:2,behind:1}:matchMedia('(max-width:650px)').matches?{ahead:3,behind:1}:{ahead:4,behind:2};
}
function orderForecastBasemap(panel){
 if(panel.styleOrdered)return;
 const map=panel.map;
 // One reorder per style, not dozens of source/layer mutations per forecast hour.
 const base=map.getStyle().layers.filter(layer=>['line','symbol'].includes(layer.type)&&layer.id!=='coast-line');
 for(const layer of base)map.moveLayer(layer.id);
 panel.rasterBefore=base[0]?.id;panel.overlayBefore=base.find(layer=>layer.type==='symbol')?.id;
 drawCoastline(map,panel.overlayBefore);panel.styleOrdered=true;
}
function panelCache(panel,model,field){
 const meta=state.metas[model],overlay=state.overlays[panel.key];
 const signature=JSON.stringify([model,meta.reference_time,field,overlay.contours,overlay.isobars]);
 if(panel.frameCache&&panel.cacheKey===signature)return panel.frameCache;
 panel.frameCache?.clear();orderForecastBasemap(panel);
 const f=fields.find(item=>item.key===field),descriptors=new Map();
 panel.frameURLs=state.times.map(time=>{
  if(!hasFieldTime(meta,field,time))return null;
  const url=concreteURL(model,meta,time,field);
  descriptors.set(url,{field:f,url,contours:overlay.contours,isobars:overlay.isobars,pressureURL:overlay.isobars&&hasFieldTime(meta,'pressure_msl',time)?concreteURL(model,meta,time,'pressure_msl'):null});
  return url;
 });
 panel.cacheKey=signature;
 panel.frameCache=new ForecastFrames(panel.map,'frame-'+panel.key,{delay:120,rasterBefore:panel.rasterBefore,overlayBefore:panel.overlayBefore,decorate:url=>overlayGroups(descriptors.get(url))});
 panel.frames=panel.frameCache.frames;return panel.frameCache;
}
function warmUpcoming(panel){
 if(panel.restyling||!panel.frameCache)return;
 panel.frameCache.warm(frameWindow(panel.frameURLs,state.index,frameBudget()));
}
async function prepareSelection(index,valid=()=>true){
 const choices=panelSelections(state),time=state.times[index],metas=state.metas;
 if(!time)return null;
 await Promise.all(choices.map(({key})=>panels[key].ready));
 if(!valid()||metas!==state.metas||choices.some(({key,model,field})=>panels[key].restyling||model!==panelSelection(state,key).model||field!==panelSelection(state,key).field))return null;
 const prepared=choices.map(({key,model,field})=>{
  const panel=panels[key],cache=panelCache(panel,model,field),url=panel.frameURLs[index];
  if(!url)return null;
  return {panel,cache,frame:cache.prepare(url),key,model,field,time};
 });
 if(prepared.some(item=>!item))return null;
 const ready=await Promise.all(prepared.map(item=>item.frame.ready));
 return ready.every(Boolean)&&valid()?prepared:null;
}
async function setTime(){
 if(!state.times.length)return false;
 const index=Math.max(0,Math.min(state.index,state.times.length-1));state.index=index;
 const time=state.times[index],generation=++timeGeneration;
 const valid=()=>generation===timeGeneration&&state.times[index]===time&&state.index===index;
 dismissLocation();requestedTime=Date.parse(time);
 // The displayed valid-time label does not advance until BOTH panels are ready.
 $('animation-status').textContent='Loading '+stamp(time)+' UTC…';
 try{
  for(const {key,model,field}of panelSelections(state)){
   const panel=panels[key];await panel.ready;if(!valid()||panel.restyling)return false;
   const cache=panelCache(panel,model,field);
   cache.warm(frameWindow(panel.frameURLs,index,frameBudget()));
   panel.requestedURL=panel.frameURLs[index];
  }
  viewportBounds();
  const prepared=await prepareSelection(index,valid);
  if(!valid())return false;
  if(!prepared||prepared.some(({cache,frame})=>!cache.isReady(frame.url)))throw new Error('Forecast frame could not load.');
  // Synchronous commit: images, contours, isobars and labels share one valid time.
  for(const {panel,cache,frame,key,model,field}of prepared){
   clearGridValues(panel);
   cache.show(frame,state.opacity,fields.find(f=>f.key===field)?.bands?'nearest':'linear');
   panel.sourceId=frame.id;panel.url=frame.url;panel.loaded=true;panel.weatherLayer=frame.layer;
   panel.displayedTime=time;panel.displayedField=field;panel.displayedModel=model;
   $('panel-label-'+key).textContent=forecastLabel(model,field,time);$('map-error-'+key).hidden=true;
   scheduleGridValues(panel);
  }
  syncTimeline(index);setLegend();pressureNote();
  for(const {panel}of prepared)warmUpcoming(panel);
  $('animation-status').textContent=playing?'Playing · buffered native forecast frames':'Ready · upcoming frames buffering';
  status('Click a map for a value and local charts.');return true;
 }catch(error){
  if(!valid())return false;
  pauseAnimation();
  for(const {key}of panelSelections(state)){
   const panel=panels[key];
   $('map-error-'+key).textContent=panel.displayedTime?'Unable to load the requested frame. Showing the forecast labelled '+stamp(panel.displayedTime)+' UTC. Retry or choose another time.':'Unable to load this forecast frame. Retry or check latest runs.';
   $('map-error-'+key).hidden=false;
  }
  const shown=state.times.indexOf(panels.a?.displayedTime);
  if(shown>=0){state.index=shown;syncTimeline(shown);}
  $('animation-status').textContent='Frame unavailable · playback stopped';status(error.message);return false;
 }
}
playback=new ForecastPlayback({
 length:()=>state.times.length,index:()=>state.index,buffer:2,
 prepare:async index=>{
  const generation=timeGeneration;
  const ready=panelSelections(state).every(({key})=>panels[key].frameCache?.isReady(panels[key].frameURLs?.[index]));
  if(!ready)$('animation-status').textContent='Buffering '+stamp(state.times[index])+' UTC…';
  return !!await prepareSelection(index,()=>generation===timeGeneration);
 },
 show:async index=>{state.index=index;return setTime();},
 onState:(phase,done,total)=>{
  playing=['buffering','playing','next'].includes(phase);
  $('play-map').textContent=playing?'Ⅱ Pause':'▶ Play';$('play-map').setAttribute('aria-pressed',String(playing));
  if(phase==='buffering')$('animation-status').textContent='Preparing smooth playback · '+done+'/'+total+' frames';
  if(phase==='ended')$('animation-status').textContent='End of available forecast';
  if(phase==='failed')$('animation-status').textContent='Buffering failed · press Play to retry';
  if(phase==='paused')for(const {key}of panelSelections(state))scheduleGridValues(panels[key]);
 }
});
$('map-playback-speed')?.addEventListener('change',event=>{playback.interval=Number(event.target.value);});
function setLegend(){
 for(const {key,model,field} of panelSelections(state)){
  const f=fields.find(f=>f.key===field);if(!f)continue;
  const el=name=>$(name+'-'+key),gradient=el('legend-gradient'),ticks=el('legend-ticks'),bands=el('legend-bands');
  const displayBreaks=displayStops(f),min=f.temperatureBands?displayBreaks[1]:displayBreaks[0],max=displayBreaks.at(-1);
  if(panels[key].legendField!==field){
  panels[key].legendField=field;
  el('legend-title').textContent=displayUnit(f);
  gradient.hidden=!!f.bands;ticks.hidden=!!f.bands;bands.hidden=!f.bands;ticks.replaceChildren();bands.replaceChildren();
  gradient.style.background='linear-gradient(to right,'+(f.temperatureBands?f.colors.flatMap((c,i)=>[c+' '+100*i/f.colors.length+'%',c+' '+100*(i+1)/f.colors.length+'%']):f.colors.map((c,i)=>c+' '+100*(displayBreaks[i]-min)/(max-min)+'%')).join(',')+')';
  [min,f.temperatureBands?0:(min+max)/2,max].forEach(v=>{const span=document.createElement('span');span.textContent=Number(v.toFixed(2))+(f.unit==='°C'?'°':'');if(f.temperatureBands)span.style.left=100*f.stops.indexOf(v)/f.colors.length+'%';ticks.append(span);});
  ticks.classList.toggle('temperature-ticks',!!f.temperatureBands);
  if(f.bands)f.stops.forEach((v,i)=>{const item=document.createElement('div'),swatch=document.createElement('i'),label=document.createElement('span');const range=f.categorical?String(v):i===f.stops.length-1?v+'+':v+'–<'+f.stops[i+1];item.title=range+' '+f.unit;item.setAttribute('aria-label',range+' '+f.unit);swatch.style.background=f.colors[i];label.textContent=v+(i===f.stops.length-1&&!f.categorical?'+':'');item.append(swatch,label);bands.append(item);});
  bands.style.gridTemplateColumns='repeat('+f.stops.length+',minmax(0,1fr))';
  el('temperature-scale-note').textContent=f.temperatureBands?f.temperatureBands+'°C colour bands · '+min+' to '+max+'°C; end colours extend beyond this range.':'';
  }
  let note=f.note,interval='';
  if(['precipitation','rain','showers','snowfall_water_equivalent'].includes(field)){
   const times=fieldSource(state.metas[model],field)?.valid_times??[],idx=times.findIndex(t=>Date.parse(t)===Date.parse(state.times[state.index]));
   interval=idx>0?(Date.parse(times[idx])-Date.parse(times[idx-1]))/3600000+' h ending at valid time':'Initial model time';
   note+=' '+(idx>0?'Accumulation: '+interval+'.':'An accumulation interval is not defined at the initial model time.');
  }
  el('legend-interval').textContent=interval;
  el('variable-note').textContent=note;
  el('field-availability').textContent=modelName(model)+' · '+f.name;
  const meta=state.metas[model],source=fieldSource(meta,field);
  if(meta&&source)el('run').textContent='Initialized '+runLabel(meta)+' · layer data ends '+stamp(source.valid_times.at(-1))+' UTC';
  const step=field.startsWith('geopotential_height_')?(Number(field.match(/_(\d+)hPa/)?.[1])<=100?'120 m':'60 m'):f.unit==='°C'?'2°C':f.unit==='%'?'10%':field==='freezing_level_height'?'250 m':field.startsWith('wind_speed_')?'approximately 11 mph (5 m/s native)':'the positive legend thresholds';
  el('contour-note').textContent=f.categorical?'Discrete categories: contours are disabled.':'Contours: '+step+'.';
 }
 for(const {key,field}of panelSelections(state))$('map-contours-'+key).disabled=!!fields.find(f=>f.key===field)?.categorical;
}
function populateVariables(){
 for(const {key,model,field} of panelSelections(state)){
  const available=availableFields(fields,[state.metas[model]]),select=$(key==='a'?'map-variable':'map-variable-b'),groups=new Map();select.replaceChildren();
  for(const f of available){const group=variableGroup(f.key);if(!groups.has(group)){const element=document.createElement('optgroup');element.label=group;groups.set(group,element);select.append(element);}const option=document.createElement('option');option.value=f.key;option.textContent=f.name;groups.get(group).append(option);}
  const selected=available.some(f=>f.key===field)?field:available.find(f=>f.key==='temperature_2m')?.key??available[0]?.key;
  state[key==='a'?'field':'fieldB']=selected;select.value=selected??'';
 }
}
function refreshTimeline(){
 state.times=panelForecastTimes(state);
 if(!state.times.length){
  $('map-time').disabled=true;$('play-map').disabled=true;$('previous-time').disabled=true;$('next-time').disabled=true;
  $('map-time').max=0;$('map-time').value=0;$('range-start').textContent='';$('range-end').textContent='';
  throw new Error(state.compare?'The selected panels have no common forecast times. Choose another model or layer.':'The selected layer has no available forecast times for this model run.');
 }
 $('map-time').disabled=false;$('play-map').disabled=false;
 state.index=state.times.reduce((best,t,i)=>Math.abs(Date.parse(t)-requestedTime)<Math.abs(Date.parse(state.times[best])-requestedTime)?i:best,0);
 $('map-time').max=state.times.length-1;$('range-start').textContent=stamp(state.times[0]);$('range-end').textContent=stamp(state.times.at(-1));
}
async function loadModelRun(id,force){
 const load=url=>cachedJSON(url,{force,kind:'metadata',ttl:60000});
 return loadSpatialModel(id,load);
}

async function configure(force=false){
 pauseAnimation();++timeGeneration;
 state.times=[];state.index=0;
 $('map-time').disabled=true;$('play-map').disabled=true;$('previous-time').disabled=true;$('next-time').disabled=true;
 $('map-time-label').textContent='Checking model run…';$('range-start').textContent='';$('range-end').textContent='';
 $('animation-status').textContent='Checking available forecast hours…';
 for(const p of Object.values(panels)){
  p.frameCache?.clear();p.frameCache=null;p.frames=new Map();p.version++;p.loaded=false;p.url=null;p.sourceId=null;p.weatherLayer=null;p.displayedTime=null;
  if(p.map.isStyleLoaded()){}
  clearGridValues(p);$('panel-label-'+p.key).textContent='Checking model run…';$('map-error-'+p.key).hidden=true;
 }
 const generation=++state.generation;$('reload-maps').disabled=true;$('map-variable').disabled=true;$('map-variable-b').disabled=true;
 status('Checking model runs…');
 try{
  const pairs=await Promise.all(panelModelIds(state).map(async id=>[id,await loadModelRun(id,force)]));if(generation!==state.generation)return;
  state.metas=Object.fromEntries(pairs);const metas=pairs.map(p=>p[1]);
  $('ukv-run-note').textContent='Latest published cycles: '+pairs.map(([id,meta])=>modelName(id)+' '+runLabel(meta)).join(' · ');
  extendCatalogue(fields,metas,OM,settings);populateVariables();
  if(panelSelections(state).some(({field})=>!field))throw new Error('No map fields are available for one of these runs.');
  refreshTimeline();
  setLegend();setTime();
 }catch(error){if(generation===state.generation){state.times=[];for(const p of Object.values(panels)){p.frameCache?.clear();p.loaded=false;}$('map-time-label').textContent='Forecast unavailable';status(error.message);}}
 finally{if(generation===state.generation){$('reload-maps').disabled=false;$('map-variable').disabled=!state.field;$('map-variable-b').disabled=!state.fieldB;}}
}
$('map-model').addEventListener('change',e=>{state.model=e.target.value;configure();});
$('map-model-b').addEventListener('change',e=>{state.modelB=e.target.value;configure();});
for(const [id,property]of [['map-variable','field'],['map-variable-b','fieldB']])$(id).addEventListener('change',e=>{
 pauseAnimation();state[property]=e.target.value;
 try{refreshTimeline();setTime();}
 catch(error){
  status(error.message);$('map-time-label').textContent='Forecast unavailable';$('animation-status').textContent=error.message;
  for(const p of Object.values(panels)){p.frameCache?.clear();p.frameCache=null;p.loaded=false;p.url=null;p.sourceId=null;p.displayedTime=null;if(p.map.isStyleLoaded()){}}
 }
});
let comparisonInitialized=false;
$('compare-maps').addEventListener('change',async e=>{
 state.compare=e.target.checked;
 if(state.compare&&!comparisonInitialized){state.modelB=state.model;$('map-model-b').value=state.modelB;comparisonInitialized=true;}
 $('panel-b').hidden=!state.compare;$('layer-notes-b').hidden=!state.compare;
 if(state.compare&&!panels.b)makeMap('b');a.map.resize();panels.b?.map.resize();await configure();
});
for(const key of ['a','b']){
 for(const [control,setting]of [['contours','contours'],['mslp','isobars']]){
  $('map-'+control+'-'+key).addEventListener('change',event=>{pauseAnimation();state.overlays[key][setting]=event.target.checked;setTime();});
 }
 $('map-grid-'+key).addEventListener('change',event=>{state.overlays[key].grid=event.target.checked;const panel=panels[key];if(panel){clearGridValues(panel);scheduleGridValues(panel);}});
}
$('map-terrain').addEventListener('change',e=>{terrain=e.target.checked;try{localStorage.setItem('snowline-terrain',String(terrain));}catch{}for(const panel of Object.values(panels))if(panel.map.getLayer('terrain-shading')||panel.map.isStyleLoaded())drawTerrain(panel.map);});
$('map-roads').addEventListener('change',e=>{roads=e.target.checked;try{localStorage.setItem('snowline-roads',String(roads));}catch{}for(const panel of Object.values(panels))if(panel.map.isStyleLoaded())applyRoads(panel.map);});
$('map-background').addEventListener('change',e=>{pauseAnimation();++timeGeneration;$('animation-status').textContent='Loading map background…';background=e.target.value;try{localStorage.setItem('snowline-background',background);}catch{}for(const panel of Object.values(panels)){clearGridValues(panel);panel.restyling=true;panel.loaded=false;panel.version++;panel.frameCache?.clear();panel.frameCache=null;panel.frames=new Map();panel.map.setStyle('https://tiles.openfreemap.org/styles/'+backgrounds[background]);}});
$('reload-maps').addEventListener('click',()=>configure(true));$('map-time').addEventListener('change',e=>{pauseAnimation();state.index=Number(e.target.value);setTime();});$('map-time').addEventListener('input',e=>{const preview=Number(e.target.value);pauseAnimation();e.target.value=String(preview);if(state.times.length)$('animation-status').textContent='Preview '+stamp(state.times[preview])+' UTC · release to load';});
$('previous-time').addEventListener('click',()=>{pauseAnimation();state.index--;setTime();});$('next-time').addEventListener('click',()=>{pauseAnimation();state.index++;setTime();});
$('map-opacity').addEventListener('input',e=>{state.opacity=Number(e.target.value)/100;$('opacity-label').textContent=e.target.value+'%';for(const p of Object.values(panels))if(p.weatherLayer&&p.map.getLayer(p.weatherLayer))p.map.setPaintProperty(p.weatherLayer,'raster-opacity',state.opacity);});
$('reset-map').addEventListener('click',()=>{for(const p of Object.values(panels))p.map.fitBounds([[UK[0],UK[1]],[UK[2],UK[3]]],{padding:25,duration:400});});
$('play-map').addEventListener('click',()=>{
 if(playing){pauseAnimation();$('animation-status').textContent='Paused';return;}
 if(!state.times.length)return;
 for(const {key}of panelSelections(state))clearGridValues(panels[key]);
 playback.start();
});
window.addEventListener('pagehide',pauseAnimation);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAnimation();});
await configure();
if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await document.modelContext.registerTool({name:'select_event_location',title:'Prepare an event analysis at a location',description:'Select latitude and longitude for the visible event analysis form. Does not calculate a hazard or fetch point forecasts; use the visible Calculate event action afterwards.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!finite(input.latitude)||!finite(input.longitude)||Math.abs(input.latitude)>90||Math.abs(input.longitude)>180)throw new Error('Valid latitude and longitude are required.');state.location={latitude:input.latitude,longitude:input.longitude};selectEventPoint(state.location,state.times[state.index]);$('event-analysis').scrollIntoView({block:'start'});return {location:state.location,eventStartUTC:$('event-start').value+'Z',eventEndUTC:$('event-end').value+'Z',calculated:false};}},{signal:lifecycle.signal});}catch(error){console.info('Optional map tool unavailable:',error.message);}}
