import {applyMapAppearance,applyRoads as setRoads,drawTerrain as setTerrain,orderForecastBasemap as orderBasemap,rasterResampling,gridLabelLayer} from './map-appearance.js?v=20261013-shared-appearance';
import {MAP_BACKGROUNDS,backgroundStyle} from './map-backgrounds.js?v=20261013-map-appearance';
import {forecastValidity} from './map-validity.js?v=20261014-interaction-audit';
import {ACCUMULATION_KEYS,accumulationHours,accumulationPeriod,accumulationSource,precipitationStepHours} from './map-accumulation.js?v=20261014-interaction-audit';
import {installAccumulations} from './map-accumulation-reader.js?v=20261014-interaction-audit';
import {WEATHER_COMPOSITE,compositeField,compositeSettings,compositeURL,isCompositeURL,compositeUnderlay} from './map-weather-composite.js?v=20261013-map-appearance';
import {MOGREPS_SNOW_DOMAINS} from './map-mogreps.js?v=20261014-clean-symbols';
import {ENSEMBLE_DOMAINS} from './map-ensemble.js?v=20261013-operational-feeds';
import {createValueReader} from './map-values.js?v=20261011-ensemble-statistics';
import {installEnsembleTransport} from './map-ensemble-transport.js?v=20261011-ensemble-transport';
import {installDewPoint} from './map-dew-point.js';
import {PRECIPITATION_TYPE,NATIVE_PRECIPITATION_TYPE,TYPE_KEYS,isTypeField,precipitationTypeScales,installPrecipitationType} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {installDiagnostics} from './map-diagnostics.js?v=20261011-vorticity-purple';
import {setupMobileMap} from './map-mobile.js?v=20261009-controls-fix';
import {ForecastFrames,frameWindow,fullSequence} from './map-frames.js?v=20261014-interaction-audit';
import {ForecastTileCache} from './map-tile-cache.js?v=20261011-parallel-preload';
import {createFramePrefetch} from './map-prefetch.js?v=20261011-parallel-preload';
import {ForecastPlayback} from './map-playback.js?v=20261011-frame-handover';
import {createViewRefresh} from './map-view-refresh.js?v=20261014-interaction-audit';
import {overlayGroups} from './map-overlay-specs.js?v=20261012-chart-style';
import {panelSelection,panelSelections,panelModelIds,panelForecastTimes,fullUKVComparison,createPanelOverlays} from './map-panels.js?v=20261014-interaction-audit';
import {forecastInterval,intervalForecastTimes} from './map-interval.js?v=20261011-forecast-interval';
import {visibleGridPoints,gridValueLabel} from './map-grid.js?v=20261014-clean-symbols';
import {displayUnit,displayValue,displayStops,isWindSpeed} from './map-wind-units.js?v=20261010-wind-mph';
import {loadSpatialRun,fieldSource,hasFieldTime,fieldDataURL,fieldIntervalHours} from './map-sources.js?v=20261014-interaction-audit';
import {runLabel,runAvailability,runSignature,retainRunProgress} from './map-runs.js?v=20261011-live-runs';
import {ukvCoverageText} from './ukv-run-info.js?v=20261013-ukv-retention';
import {sourceVariable,extendCatalogue,availableFields,variableGroup,PRECIPITATION_SCALE,CLOUD_COVER_SCALE} from './map-catalogue.js?v=20261014-interaction-audit';
import * as maplibregl from './vendor/maplibre-gl.mjs';
import * as OM from './vendor/index.mjs?v=20261014-interaction-audit';
import {finite} from './data.js?v=20261010-ukv';
import {MAP_RUN_CHOICES as MODELS} from './map-models.js?v=20261014-interaction-audit';
import {loadMapRun as loadSpatialModel} from './map-ukv-runs.js?v=20261014-interaction-audit';
import {cachedJSON,usageText} from './cache.js?v=20261010-ukv-families';
import {selectEventPoint} from './event-analysis.js';
import {isJetWind,is850Temperature,temperatureContourLevels} from './map-chart-style.js?v=20261012-chart-style';
import {createChartImageMenu,chartScales} from './map-image-export.js?v=20261014-interaction-audit';
import {MAP_AREAS} from './map-areas.js?v=20261013-nw-europe-periods';
import {THETA_SYMBOLS,winterNote} from './map-winter.js?v=20261014-interaction-audit';
import {isSymbolURL,symbolURL,symbolOverlay,precipitationSymbolProtocol} from './map-precipitation-symbols.js?v=20261014-interaction-audit';
const $=id=>document.getElementById(id);
const imageMenu=createChartImageMenu();
setupMobileMap();
const UK=[-11,49,2.7,61.6];
for(const area of MAP_AREAS){const option=document.createElement('option');option.value=area.id;option.textContent=area.name;$('map-area').append(option);}
const currentArea=document.createElement('option');currentArea.value='current';currentArea.textContent='Current map area';$('map-area').append(currentArea);
const selectedAreaBounds=()=>$('map-area').value==='uk'?UK:MAP_AREAS.find(area=>area.id===$('map-area').value)?.bounds;
function fitArea(map,duration=0){const bounds=selectedAreaBounds();if(bounds)map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:25,duration});}
const tempColors=['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643'];
const referenceColors=["#320032","#640064","#960096","#c800c8","#fa00fe","#c800fe","#9600fe","#6400fe","#3200fe","#0032fe","#0064fe","#0096fe","#00c8fe","#00e6f0","#00e6a0","#00e678","#00e650","#00f028","#00fa00","#fefe00","#fee100","#fec800","#feaf00","#fe9600","#e67d00","#e66400","#dc4b1e","#c8321e","#b4191e","#aa001e","#b40032","#c80064","#fe0096","#fe00c8","#fe00e1","#fe00fa"];
const fields=[
 compositeField(PRECIPITATION_SCALE),
 {key:'pressure_msl',overlayOnly:true,name:'Mean sea-level pressure (MSLP)',unit:'hPa',note:'Atmospheric pressure reduced to mean sea level. Isobars are spaced every 4 hPa.',stops:[940,960,980,1000,1010,1020,1040,1060],colors:['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643']},
 {key:'temperature_2m',name:'2 m air temperature',unit:'°C',note:'Near-surface air temperature, not road temperature.',stops:[-1000,...Array.from({length:33},(_,i)=>-45+i*3)],colors:referenceColors.slice(0,34),temperatureBands:3},
 {key:'temperature_850hPa',name:'850 hPa temperature',unit:'°C',note:'Upper-air temperature. This pressure level can lie below high terrain.',stops:[-1000,...Array.from({length:35},(_,i)=>-36+i*2)],colors:referenceColors,temperatureBands:2},
 {key:'dew_point_2m',name:'2 m dew point',unit:'°C',note:'Near-surface dew point. UKMO maps calculate it from 2 m temperature and relative humidity on the same model grid and forecast time.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'soil_temperature_0cm',name:'0 cm soil temperature',unit:'°C',note:'Modelled ground temperature, not a road-surface forecast.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'soil_temperature_0_to_7cm',name:'0–7 cm soil temperature',unit:'°C',note:'Average temperature in a soil layer; not road or grass-minimum temperature.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'precipitation',name:'Precipitation',unit:'mm water',note:'Total precipitation (liquid plus frozen water equivalent) over the native model interval. White means 0 to below 0.5 mm. Check the interval shown with the valid time.',...PRECIPITATION_SCALE},
 {key:'snowfall_water_equivalent',name:'Snowfall · water equivalent',unit:'mm water',note:'Water contained in falling snow over the model interval. This is not snow depth or a D-category amount.',stops:[0,.1,.25,.5,1,2,5,10],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'snow_depth',name:'Snow depth',unit:'m snow',note:'Existing snow on the ground. Kept in the spatial feed’s native metres.',stops:[0,.01,.02,.05,.1,.2,.5,1],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'snow_depth_water_equivalent',name:'Snow cover · water equivalent',unit:'mm water',note:'Water equivalent of existing snow cover, not its physical depth.',stops:[0,1,5,10,25,50,100,200],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'relative_humidity_2m',name:'2 m relative humidity',unit:'%',note:'Near-surface moisture context. Humidity alone does not determine surface wetness.',stops:[0,20,40,60,75,85,95,100],colors:['#f7ecce','#edce9c','#c6d4b1','#98cdbf','#60b7ba','#359ab0','#257ca2','#225987']},
 {key:'cloud_cover',name:'Total cloud cover',unit:'%',note:'Watch for cloud clearance after rain and overnight cooling.',...CLOUD_COVER_SCALE},
 {key:'wind_speed_10m',name:'10 m wind speed',unit:'m/s',note:'Map shading and values displayed in mph; model grid retained in m/s.',stops:[0,2,4,6,8,12,18,25],colors:['#e8f2f6','#b9dede','#80c5c0','#42a7a6','#308caa','#416cad','#7d52a4','#bf4d84']},
 {key:'freezing_level_height',name:'Freezing level',unit:'m ASL',note:'Height of the 0°C level above sea level; not necessarily the snow level.',stops:[0,100,250,500,750,1000,1500,2500],colors:['#6148ae','#3163b5','#368fc1','#77cee1','#b7e2db','#e8f3b2','#ffdc81','#ee9755']}
];
const rgba=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),hex.length===9?parseInt(hex.slice(7,9),16)/255:1];
const settings={...OM.defaultOmProtocolSettings,maxStatesWithData:16,domainOptions:[...(OM.domainOptions??[]),...ENSEMBLE_DOMAINS,...MOGREPS_SNOW_DOMAINS],colorScales:{...OM.defaultOmProtocolSettings.colorScales,...Object.fromEntries(fields.map(f=>[f.key,{type:'breakpoint',unit:f.unit,breakpoints:f.stops,colors:f.colors.map(rgba)}]))}};
installEnsembleTransport(OM,settings);
installDewPoint(OM,settings);
installDiagnostics(OM,settings);
installPrecipitationType(OM,settings);
const accumulationReader=installAccumulations(OM,settings);
const renderMapTile=(params,controller)=>isSymbolURL(params.url)?precipitationSymbolProtocol(params,controller,OM,settings):OM.omProtocol(params,controller,isCompositeURL(params.url)?compositeSettings(settings):settings);
const readMapValue=createValueReader({...OM,omProtocol:renderMapTile},settings);
OM.updateCurrentBounds(UK);
const imageryCache=new ForecastTileCache(async(params,controller)=>{
 const result=await renderMapTile(params,controller);
 if(params.type==='json'&&params.url.includes('/ensemble-data/')){
  const source=params.url.includes('/snowline_gefs_ensemble/')?'NOAA GEFS':'ECMWF ENS (CC BY 4.0)';
  result.data.attribution='Weather: <a href="map-credits.html#ensembles">'+source+'</a> | Renderer: <a href="map-credits.html">Open-Meteo</a>';
 }
 if(params.type==='json'&&/\/(ukmo_uk_ensemble_2km|snowline_mogreps_uk)\//.test(params.url)){
  result.data.attribution='Weather: <a href="map-credits.html#mogreps">Met Office MOGREPS · © Crown copyright · CC BY-SA 4.0</a> | <a href="https://open-meteo.com/">Open-Meteo</a>';
 }
 return result;
},{onLimit:()=>updatePreloadStatus()});
imageryCache.setContext(JSON.stringify(UK));
maplibregl.addProtocol('om',(params,controller)=>imageryCache.protocol(params,controller));
window.addEventListener('pagehide',()=>imageryCache.release());
window.addEventListener('pageshow',event=>{if(event.persisted){imageryCache.context=null;viewportBounds();for(const panel of Object.values(panels))panel.frameCache?.suspend();setTime();}});
const date=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const stamp=t=>date.format(new Date(t));
let roads=false;try{roads=localStorage.getItem('snowline-roads')==='true';}catch{}
$('map-roads').checked=roads;
function applyRoads(map){setRoads(map,roads);}
function drawTerrain(map){setTerrain(map,terrain);}
const backgrounds=MAP_BACKGROUNDS;
let background='light';try{const saved=localStorage.getItem('snowline-background');if(Object.hasOwn(backgrounds,saved))background=saved;else if(saved)localStorage.setItem('snowline-background',background);}catch{}
$('map-background').value=background;
let terrain=true;try{terrain=localStorage.getItem('snowline-terrain')!=='false';}catch{}
$('map-terrain').checked=terrain;
const panels={};
let briefingActive=false,briefingView,briefingScroll=0;
let locationPopup=null,locationMarker=null;
function dismissLocation(){
 const popup=locationPopup;locationPopup=null;
 locationMarker?.remove();locationMarker=null;
 popup?.remove();
}
document.addEventListener('click',event=>{if(!event.target.closest('.maplibregl-map'))dismissLocation();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')dismissLocation();});
const mapsMoving=()=>Object.entries(panels).some(([key,panel])=>(key==='a'||state.compare)&&panel.map.isMoving());
const viewportRefresh=createViewRefresh(()=>{if(!briefingActive&&state.times.length&&!playing)setTime();},mapsMoving);
function queueViewportRefresh(){viewportRefresh.schedule();}
function viewportBounds(){
 if(briefingActive)return;
 const visible=Object.entries(panels).filter(([key])=>key==='a'||state.compare).map(([,p])=>p.map.getBounds());if(!visible.length)return;
 const bounds=[Math.min(...visible.map(b=>b.getWest())),Math.min(...visible.map(b=>b.getSouth())),Math.max(...visible.map(b=>b.getEast())),Math.max(...visible.map(b=>b.getNorth()))];
 OM.updateCurrentBounds(bounds);
 // Renderer clipping depends on the view as well as the URL/zoom. Never reuse a
 // partially clipped tile in a different view, even if its tile coordinates match.
 if(imageryCache.setContext(JSON.stringify(OM.currentBounds??bounds))){
  for(const panel of Object.values(panels))panel.frameCache?.invalidateView();
  updatePreloadStatus();
 }
}
let state={model:'ukmo_uk_deterministic_2km',modelB:'ukmo_uk_deterministic_2km',compare:false,field:'temperature_2m',fieldB:'precipitation',interval:'3',times:[],index:0,metas:{},generation:0,location:null,opacity:.8,overlays:createPanelOverlays()};
$('map-opacity').value=String(state.opacity*100);$('opacity-label').textContent=(state.opacity*100)+'%';
const params=new URLSearchParams(location.search);const initialTime=Date.parse(params.get('time'));let requestedTime=Number.isFinite(initialTime)?initialTime:Date.now();
if(params.get('model')==='ukmo_uk_deterministic_2km_nowcast')params.set('model','ukmo_uk_deterministic_2km');
if(MODELS.some(m=>m.id===params.get('model')))state.model=params.get('model');
const initialLat=Number(params.get('lat')),initialLon=Number(params.get('lon'));
if(params.has('lat')&&params.has('lon')&&Number.isFinite(initialLat)&&Number.isFinite(initialLon)&&Math.abs(initialLat)<=90&&Math.abs(initialLon)<=180){state.location={latitude:initialLat,longitude:initialLon};$('nav-charts').href='./?'+new URLSearchParams({lat:initialLat,lon:initialLon,time:params.get('time')??''});}
function modelName(id){return MODELS.find(m=>m.id===id)?.name??id;}
function panelRunLabel(model){return modelName(model)+' · '+runLabel(state.metas[model])+(state.metas[model]?.completed===false?' · updating':'');}
function forecastLabel(model,field,time){return panelRunLabel(model)+' · '+fields.find(f=>f.key===field).name+' · '+forecastValidity(field,time);}
function status(message){$('map-status').textContent=message;}
function usageUpdate(){$('usage-summary').textContent=usageText();}window.addEventListener('snowline-usage',usageUpdate);usageUpdate();
const modelGroups=[
 ['Short-term models',MODELS.filter(model=>model.regional&&!model.ensemble)],
 ['Medium-term models',MODELS.filter(model=>!model.regional&&!model.ensemble)],
 ['Ensemble models',MODELS.filter(model=>model.ensemble)]
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
 const map=new maplibregl.Map({container:'map-'+key,style:'https://tiles.openfreemap.org/styles/'+backgrounds[background],center:[-3,55.3],zoom:4.6,minZoom:1,maxZoom:10,fadeDuration:0,renderWorldCopies:false,dragRotate:false,touchPitch:false,attributionControl:{compact:true}});
 map.touchZoomRotate.disableRotation();
 map.once('load',()=>{const credits=map.getContainer().querySelector('.maplibregl-compact-show .maplibregl-ctrl-attrib-button');credits?.click();});
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');fitArea(map);
 const panel={key,map,background,ready:new Promise(resolve=>map.once('style.load',resolve)),url:null,sourceId:null,version:0,loaded:false};panels[key]=panel;map.on('moveend',()=>{if(briefingActive)return;++timeGeneration;panel.frameCache?.invalidateView();viewportBounds();$('zoom-'+key).textContent='Zoom '+map.getZoom().toFixed(1);scheduleGridValues(panel);queueViewportRefresh();});map.on('movestart',event=>{if(event.originalEvent)$('map-area').value='current';if(briefingActive)return;viewportRefresh.cancel();pauseAnimation();++timeGeneration;for(const item of Object.values(panels))item.frameCache?.suspend();clearGridValues(panel);});let lastSize='';new ResizeObserver(entries=>{if(briefingActive)return;const r=entries[0].contentRect,size=Math.round(r.width)+'x'+Math.round(r.height);if(size!==lastSize){lastSize=size;map.resize();}}).observe($('map-'+key));
 map.on('style.load',()=>{panel.styleOrdered=false;applyMapAppearance(map,{roads,terrain});if(panel.restyling){panel.restyling=false;panel.sourceId=null;if((key==='a'||state.compare)&&!a.restyling&&(!state.compare||!panels.b.restyling))void restoreMapFrame();}});
 map.on('error',event=>{console.warn('Map rendering:',event.error?.message);if(event.sourceId==='mslp-source'){$('mslp-note-'+key).textContent='MSLP overlay could not be loaded. Try another time or model.';return;}if(event.error?.name==='AbortError'||!event.sourceId||event.sourceId!==panel.sourceId)return;const el=$('map-error-'+key);el.textContent='This layer could not be loaded. Try another field or check the latest run.';el.hidden=false;panel.loaded=false;});
 map.on('sourcedata',event=>{if(event.sourceId===panel.sourceId&&event.isSourceLoaded&&panel.frameCache?.current?.loaded){panel.loaded=true;status('Click a map for a value and local charts.');scheduleGridValues(panel);}});
 map.on('click',async event=>{if(!panel.loaded||panel.displayedTime!==state.times[state.index])return;dismissLocation();const latitude=Number(event.lngLat.lat.toFixed(5)),longitude=Number(event.lngLat.lng.toFixed(5));state.location={latitude,longitude};const div=document.createElement('div');const title=document.createElement('strong');title.textContent=`${Math.abs(latitude).toFixed(3)}° ${latitude<0?'S':'N'}, ${Math.abs(longitude).toFixed(3)}° ${longitude<0?'W':'E'}`;div.append(title);const value=document.createElement('p');value.textContent='Reading model value…';div.append(value);const link=document.createElement('a');const selectedTime=state.times[state.index]??'';const pointParams=new URLSearchParams({lat:latitude.toFixed(5),lon:longitude.toFixed(5),time:selectedTime});link.href='./?'+pointParams;link.textContent='Open location charts';div.append(link);$('nav-charts').href=link.href;const eventButton=document.createElement('button');eventButton.type='button';eventButton.className='event-link';eventButton.textContent='Analyse an event here';eventButton.addEventListener('click',()=>{selectEventPoint({latitude,longitude},selectedTime);$('event-analysis').scrollIntoView({behavior:'smooth',block:'start'});$('event-start').focus({preventScroll:true});});div.append(eventButton);locationMarker=new maplibregl.Marker({color:'#007e84'}).setLngLat(event.lngLat).addTo(map);
const popup=new maplibregl.Popup({closeButton:true,closeOnClick:false,offset:30}).setLngLat(event.lngLat).setDOMContent(div).addTo(map);
locationPopup=popup;popup.on('close',()=>{if(locationPopup===popup)dismissLocation();});try{const result=panel.loaded?await readMapValue(latitude,longitude,panel.url,map.getZoom()):null;const field=fields.find(f=>f.key===panel.displayedField);value.textContent=result&&finite(result.value)?`${field.categoryLabels?(gridValueLabel(result.value,field)??'Unresolved')+' · '+(field.key===NATIVE_PRECIPITATION_TYPE?'native valid-time type':'estimated interval type'):displayValue(result.value,field).toFixed(1)+' '+displayUnit(field)} · ${modelName(key==='a'?state.model:state.modelB)}`:'No value available here for this layer.';}catch{value.textContent='No value available here for this layer.';}});
 imageMenu.registerMap(map,()=>({...panel.imageInfo,subtitle:$('map-error-'+key).hidden?'':$('map-error-'+key).textContent,ready:panel.loaded&&!!panel.displayedTime&&!!panel.imageInfo&&!!map.getLayer(panel.weatherLayer)}),pauseAnimation);
 return panel;
}
const a=makeMap('a');
if(state.location)locationMarker=new maplibregl.Marker({color:'#007e84'}).setLngLat([state.location.longitude,state.location.latitude]).addTo(a.map);
function contourLevels(field){
 if(is850Temperature(field.key))return temperatureContourLevels(field);
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
 for(const {key,model,field}of panelSelections(state)){
  const composite=field===WEATHER_COMPOSITE||field===THETA_SYMBOLS;
  const missing=!hasFieldTime(state.metas[model],'pressure_msl',state.times[state.index]),warnings=state.metas[model]?.sourceWarnings??[];
  $('mslp-note-'+key).textContent=warnings.length?warnings.join(' '):missing?'MSLP is unavailable at this time.':'MSLP isobars every 4 hPa.';
  if(model.startsWith('snowline_')&&!missing&&!warnings.length)$('mslp-note-'+key).textContent='Ensemble-mean MSLP isobars every 4 hPa.';
  if(model==='gfs_global'&&!missing)$('mslp-note-'+key).textContent+=' Uses the GFS 0.25° grid from the same run.';
  $('map-mslp-'+key).disabled=missing||composite;
  $('map-mslp-'+key).checked=composite||state.overlays[key].isobars;
  $('map-mslp-'+key).title=composite?'MSLP is included in this combined layer.':'';
 }
}
const emptyGrid=()=>({type:'FeatureCollection',features:[]});
function clearGridValues(panel){
 clearTimeout(panel.gridTimer);panel.gridVersion=(panel.gridVersion??0)+1;
 panel.map.getSource('grid-values')?.setData(emptyGrid());
 const note=$('grid-note-'+panel.key);note.hidden=!state.overlays[panel.key].grid;
 if(!note.hidden)note.textContent=playing?'Grid values resume when playback is paused.':'Grid values loading…';
}
function scheduleGridValues(panel){
 if(briefingActive||!panel||playing||!state.overlays[panel.key].grid||panel.restyling)return;
 clearTimeout(panel.gridTimer);panel.gridTimer=setTimeout(()=>drawGridValues(panel),150);
}
async function drawGridValues(panel){
 if(briefingActive||playing||!state.overlays[panel.key].grid||!panel.loaded||panel.restyling||panel.displayedTime!==state.times[state.index])return;
 const {key,map}=panel,version=panel.gridVersion=(panel.gridVersion??0)+1;
 const {model,field}=panelSelection(state,key),time=panel.displayedTime;
 if(field!==panel.displayedField||model!==panel.displayedModel)return;
 const source=fieldSource(state.metas[model],field,time),domain=settings.domainOptions.find(item=>item.value===source?.domain);
 const note=$('grid-note-'+key);note.hidden=false;
 if(!domain){note.textContent='Grid values unavailable for this model.';return;}
 try{
  const grid=OM.GridFactory.create(domain.grid),canvas=map.getCanvas(),f=fields.find(item=>item.key===field);
  const points=visibleGridPoints(grid,canvas.clientWidth,canvas.clientHeight,p=>map.unproject(p),p=>map.project(p));
  const valueURL=panel.url.replace(/interpolation=[^&]+/,'interpolation=nearest');
  if(points.length)await readMapValue(points[0].lat,points[0].lon,valueURL,map.getZoom());
  const features=(await Promise.all(points.map(async point=>{
   const result=await OM.getValueFromLatLong(point.lat,point.lon,valueURL,map.getZoom());
   const label=gridValueLabel(result?.value,f);if(label===null)return null;
   return {type:'Feature',id:point.id,properties:{label,value:result.value},geometry:{type:'Point',coordinates:[point.lon,point.lat]}};
  }))).filter(Boolean);
  if(version!==panel.gridVersion||!state.overlays[key].grid||panel.restyling)return;
  const data={type:'FeatureCollection',features};
  if(map.getSource('grid-values'))map.getSource('grid-values').setData(data);else map.addSource('grid-values',{type:'geojson',data});
  if(!map.getLayer('grid-labels'))map.addLayer(gridLabelLayer());else map.moveLayer('grid-labels');
  note.textContent=features.length?'Grid values · '+(field===WEATHER_COMPOSITE?'precipitation · ':'')+displayUnit(f):'No grid values in this area.';
 }catch(error){if(version===panel.gridVersion){note.textContent='Grid values unavailable; try another time.';console.warn('Grid values:',error.message);}}
}
function concreteURL(model,meta,time,field){if(field===THETA_SYMBOLS)return concreteURL(model,meta,time,'wet_bulb_potential_temperature_850hPa')+'&winter_chart=1';if(field===WEATHER_COMPOSITE)return compositeURL(concreteURL(model,meta,time,'precipitation'));const source=fieldSource(meta,field,time);return 'om://'+fieldDataURL(meta,field,time)+'?'+new URLSearchParams({...(field.startsWith('relative_vorticity_')?{diagnostic_style:'20261011-smooth20km-purple'}:{}),...(isJetWind(field)?{wind_style:'20261012-jet60',arrow_profile:'jet'}:{}),...(is850Temperature(field)?{contour_style:'20261012-major850'}:{}),variable:sourceVariable(source,field)??field,interpolation:fields.find(f=>f.key===field)?.categorical?'nearest':'linear',arrows:/^wind_speed_|^ocean_current_speed$/.test(field)?'true':'false',tile_size:'512',color_blend:fields.find(f=>f.key===field)?.bands||fields.find(f=>f.key===field)?.temperatureBands?'false':'true',contours:'true',intervals:contourLevels(fields.find(f=>f.key===field)).join(',')});}
let playing=false,timeGeneration=0,playback,timePending=Promise.resolve(true),failedSelection=null;
function refreshStartingTime(message='No forecast times available'){
 const select=$('map-start-time');if(!select)return;
 select.replaceChildren(...state.times.map(time=>new Option(stamp(time),time)));
 select.disabled=!state.times.length;
 if(state.times.length)select.value=state.times[state.index];
 else select.append(new Option(message,''));
 $('map-start-time-note').textContent=state.compare?'Choose a time for both panels; playback begins here.':'Choose a forecast time; playback begins here.';
}
function syncTimeline(index){
 const time=state.times[index];if(!time)return;
 $('map-time').value=index;$('map-time').setAttribute('aria-valuetext',stamp(time)+' UTC');
 if($('map-start-time'))$('map-start-time').value=time;
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
 return {loop:true,...(state.compare?{ahead:2,behind:1}:matchMedia('(max-width:650px)').matches?{ahead:3,behind:1}:{ahead:4,behind:2})};
}
function updatePreloadStatus(){
 const choices=panelSelections(state),total=choices.reduce((sum,{model,field})=>sum+state.times.filter(time=>hasFieldTime(state.metas[model],field,time)).length,0);
 let loaded=0,failed=0;
 for(const {key}of choices){const panel=panels[key];for(const url of panel?.frameURLs??[]){if(panel.frameCache?.preloaded.has(url))loaded++;else if(panel.frameCache?.failures.has(url))failed++;}}
 const complete=total>0&&loaded===total&&!imageryCache.limited;
 let message='Checking imagery…';
 if(total)message='Loading imagery · '+loaded+'/'+total+' frames'+(failed?' · '+failed+' unavailable':'');
 if(complete)message='All '+total+' frames loaded';
 if(choices.some(({field})=>accumulationHours(field)))message='Accumulations · selected period first; nearby totals cached'+(failed?' · '+failed+' unavailable':'');
 if(imageryCache.limited)message='Storage limited · nearby frames cached';
 const progress=$('preload-status');progress.textContent=message;progress.dataset.complete=String(complete);progress.dataset.loaded=String(loaded);progress.dataset.total=String(total);
 $('retry-preload').hidden=!failedSelection&&(!failed||imageryCache.limited);
 $('retry-preload').textContent=failedSelection?'Retry selected frame':'Retry background loading';
 if($('animation-status').textContent.startsWith('Ready'))$('animation-status').textContent='Ready · '+(complete?'all frames loaded':loaded+'/'+total+' frames loaded');
}
function orderForecastBasemap(panel){
 if(panel.styleOrdered)return;
 Object.assign(panel,orderBasemap(panel.map));panel.styleOrdered=true;
}
function panelCache(panel,model,field){
 const meta=state.metas[model],overlay=state.overlays[panel.key],composite=field===WEATHER_COMPOSITE;
 // Changing the other panel's field can change the shared timeline too.
 const signature=JSON.stringify([model,meta.reference_time,field,overlay.contours,overlay.isobars,state.times,state.times.map(time=>hasFieldTime(meta,field,time)),overlay.isobars?fieldSource(meta,'pressure_msl')?.valid_times:null]);
 if(panel.frameCache&&panel.cacheKey===signature)return panel.frameCache;
 panel.frameCache?.clear();orderForecastBasemap(panel);
 const f=fields.find(item=>item.key===field),descriptors=new Map();
 panel.frameURLs=state.times.map(time=>{
  if(!hasFieldTime(meta,field,time))return null;
  const url=concreteURL(model,meta,time,field);
  descriptors.set(url,{field:f,url,symbolURL:field===THETA_SYMBOLS?symbolURL(concreteURL(model,meta,time,'precipitation'),fieldSource(meta,'precipitation',time)):null,contours:overlay.contours,cloudURL:composite?compositeURL(concreteURL(model,meta,time,'cloud_cover')):null,isobars:composite||field===THETA_SYMBOLS||overlay.isobars,pressureURL:(composite||field===THETA_SYMBOLS||overlay.isobars)&&hasFieldTime(meta,'pressure_msl',time)?concreteURL(model,meta,time,'pressure_msl'):null});
  return url;
 });
 panel.cacheKey=signature;
 const decorate=url=>{const descriptor=descriptors.get(url);return [...(descriptor.symbolURL?[symbolOverlay(descriptor.symbolURL)]:[]),...(descriptor.cloudURL?[compositeUnderlay(descriptor.cloudURL)]:[]),...overlayGroups(descriptor)];};
 panel.frameCache=new ForecastFrames(panel.map,'frame-'+panel.key,{delay:120,rasterBefore:panel.rasterBefore,overlayBefore:panel.overlayBefore,decorate,prefetch:createFramePrefetch(panel.map,imageryCache,decorate),timeout:accumulationHours(field)?120000:25000,preloadConcurrency:accumulationHours(field)?1:state.compare?2:3,onProgress:updatePreloadStatus,canPreload:()=>!imageryCache.limited,isActive:()=>!document.hidden});
 panel.frames=panel.frameCache.frames;return panel.frameCache;
}
function warmUpcoming(panel){
 if(panel.restyling||!panel.frameCache)return;
 const accumulation=accumulationHours(panelSelection(state,panel.key).field);
 const window=frameWindow(panel.frameURLs,state.index,accumulation?{ahead:1,behind:1,loop:false}:frameBudget());
 panel.frameCache.warm({...window,all:accumulation?window.upcoming:fullSequence(panel.frameURLs,state.index),delay:accumulation?250:0});
}
async function prepareSelection(index,valid=()=>true){
 const choices=panelSelections(state),time=state.times[index],metas=state.metas;
 if(!time)return null;
 await Promise.all(choices.map(({key})=>panels[key].ready));
 if(!valid()||metas!==state.metas||choices.some(({key,model,field})=>panels[key].restyling||model!==panelSelection(state,key).model||field!==panelSelection(state,key).field))return null;
 const prepared=await Promise.all(choices.map(async({key,model,field})=>{
  const panel=panels[key],cache=panelCache(panel,model,field),url=panel.frameURLs[index];
  if(!url)return fullUKVComparison(state)?{panel,cache,frame:null,key,model,field,time}:null;
  const frame=await cache.acquire(url,valid);
  return frame?{panel,cache,frame,key,model,field,time}:null;
 }));
 if(prepared.some(item=>!item))return null;
 return valid()?prepared:null;
}
function setTime(){return timePending=loadTime();}
async function loadTime(){
 if(briefingActive)return false;
 // A released slider may overlap an animated zoom. Its selected time is kept;
 // moveend will load it once the final view is known, without a false failure.
 if(mapsMoving()){queueViewportRefresh();return false;}
 failedSelection=null;
 if(!state.times.length)return false;
 const index=Math.max(0,Math.min(state.index,state.times.length-1));state.index=index;
 const time=state.times[index],generation=++timeGeneration;
 const valid=()=>generation===timeGeneration&&state.times[index]===time&&state.index===index&&!mapsMoving();
 dismissLocation();requestedTime=Date.parse(time);
 // The displayed valid-time label does not advance until BOTH panels are ready.
 $('animation-status').textContent='Loading '+stamp(time)+' UTC…';
 for(const {key}of panelSelections(state))$('map-error-'+key).hidden=true;
 try{
  for(const {key,model,field}of panelSelections(state)){
   const panel=panels[key];await panel.ready;if(!valid()||panel.restyling)return false;
   const cache=panelCache(panel,model,field);
   panel.requestedURL=panel.frameURLs[index];
   // Cached stepping can commit immediately without disturbing the download
   // queue. Pause speculative work only when the chosen frame needs loading.
   if(!cache.isReady(panel.requestedURL))cache.warm({...frameWindow(panel.frameURLs,index,frameBudget()),upcoming:[]});
  }
  viewportBounds();
  const prepared=await prepareSelection(index,valid);
  if(!valid())return false;
  if(!prepared||prepared.some(({cache,frame})=>frame&&!cache.isReady(frame.url)))throw new Error('Forecast frame could not load.');
  // Synchronous commit: images, contours, isobars and labels share one valid time.
  for(const {panel,cache,frame,key,model,field}of prepared){
   clearGridValues(panel);
   if(!frame){
    cache.hide();panel.sourceId=null;panel.url=null;panel.loaded=false;panel.weatherLayer=null;panel.imageInfo=null;
    panel.displayedTime=time;panel.displayedField=field;panel.displayedModel=model;
    const meta=state.metas[model],end=meta.valid_times.filter(t=>hasFieldTime(meta,field,t)).at(-1);
    const pending=meta.completed===false&&end&&Date.parse(time)>Date.parse(end);
    $('panel-label-'+key).textContent=forecastLabel(model,field,time)+' · unavailable';
    $('map-error-'+key).textContent=(pending?'Not yet published for this run.':'No forecast for this layer at the selected time.')+(end?' Latest available: '+stamp(end)+' UTC.':'')+' The other UKV run remains available.';
    $('map-error-'+key).hidden=false;
    continue;
   }
   cache.show(frame,state.opacity,rasterResampling(fields.find(f=>f.key===field)));
   panel.sourceId=frame.id;panel.url=frame.url;panel.loaded=true;panel.weatherLayer=frame.layer;
   panel.displayedTime=time;panel.displayedField=field;panel.displayedModel=model;
   $('panel-label-'+key).textContent=forecastLabel(model,field,time);$('map-error-'+key).hidden=true;
   scheduleGridValues(panel);
  }
  syncTimeline(index);setLegend();pressureNote();
  for(const {panel,key,field,frame}of prepared)if(frame)panel.imageInfo={title:$('panel-label-'+key).textContent,scales:chartScales(fields.find(f=>f.key===field),$('legend-interval-'+key).textContent)};
  for(const {panel}of prepared)warmUpcoming(panel);
  $('animation-status').textContent=playing?'Playing · buffered native forecast frames':'Ready';updatePreloadStatus();
  status('Click a map for a value and local charts.');return true;
 }catch(error){
  if(!valid())return false;
  pauseAnimation();
  for(const {key}of panelSelections(state)){
   const panel=panels[key];
   $('map-error-'+key).textContent=panel.loaded&&panel.displayedTime?'Unable to load the requested frame. Showing the forecast labelled '+stamp(panel.displayedTime)+' UTC. Retry or choose another time.':'Unable to load this forecast frame. Retry or check latest runs.';
   $('map-error-'+key).hidden=false;
  }
  const shown=state.times.indexOf(panels.a?.displayedTime);
  if(shown>=0){state.index=shown;syncTimeline(shown);}
  else{$('previous-time').disabled=index===0;$('next-time').disabled=index===state.times.length-1;}
  failedSelection={index,time};
  $('animation-status').textContent='Frame unavailable · playback stopped';status(error.message);updatePreloadStatus();return false;
 }
}
function retrySelectedFrame(){
 const failed=failedSelection;
 if(failed&&state.times[failed.index]===failed.time){state.index=failed.index;return setTime();}
 return timePending;
}
// Returning from a briefing or switching basemaps rebuilds the MapLibre style.
// An in-flight raster request can fail during the handover. Retry the same
// verified forecast frame once; preserve genuine persistent errors.
async function restoreMapFrame(){
 const loaded=await setTime();
 if(loaded||briefingActive||!failedSelection)return;
 const failed=failedSelection;
 for(const {key}of panelSelections(state))panels[key].frameCache?.retryFailures();
 if(failedSelection===failed&&state.times[failed.index]===failed.time)await retrySelectedFrame();
}
playback=new ForecastPlayback({
 length:()=>state.times.length,index:()=>state.index,buffer:2,settle:retrySelectedFrame,
 prepare:async index=>{
  const generation=timeGeneration;
  const ready=panelSelections(state).every(({key,model,field})=>!hasFieldTime(state.metas[model],field,state.times[index])||panels[key].frameCache?.isReady(panels[key].frameURLs?.[index]));
  if(!ready)$('animation-status').textContent='Buffering '+stamp(state.times[index])+' UTC…';
  return !!await prepareSelection(index,()=>generation===timeGeneration);
 },
 show:async index=>{state.index=index;return setTime();},
 onState:(phase,done,total)=>{
  playing=['buffering','playing','next'].includes(phase);
  $('play-map').textContent=playing?'Ⅱ Pause':'▶ Play';$('play-map').setAttribute('aria-pressed',String(playing));
  if(phase==='buffering')$('animation-status').textContent='Preparing smooth playback · '+done+'/'+total+' frames';
  if(phase==='ended')$('animation-status').textContent='Only one forecast frame available';
  if(phase==='failed')$('animation-status').textContent='Buffering failed · press Play to retry';
  if(phase==='paused')for(const {key}of panelSelections(state))scheduleGridValues(panels[key]);
 }
});
$('map-playback-speed')?.addEventListener('change',event=>{playback.interval=Number(event.target.value);});
$('retry-preload').addEventListener('click',()=>{
 for(const {key}of panelSelections(state))panels[key].frameCache?.retryFailures();
 if(failedSelection)retrySelectedFrame();
 else for(const {key}of panelSelections(state))warmUpcoming(panels[key]);
 updatePreloadStatus();
});
function setLegend(){
 for(const {key,model,field} of panelSelections(state)){
  const f=fields.find(f=>f.key===field);if(!f)continue;
  const el=name=>$(name+'-'+key),gradient=el('legend-gradient'),ticks=el('legend-ticks'),bands=el('legend-bands');
  const legendOffset=f.legendStart??0,legendColors=f.colors.slice(legendOffset),displayBreaks=displayStops(f).slice(legendOffset),min=f.temperatureBands?displayBreaks[1]:displayBreaks[0],max=displayBreaks.at(-1);
  if(panels[key].legendField!==field){
  panels[key].legendField=field;
  el('legend-title').textContent=field===WEATHER_COMPOSITE?'Modelled cloud (%) / precipitation (mm)':['precipitation_probability','snowfall_probability'].includes(field)?'Chance (%)':f.categoryLabels?'Precipitation type & intensity':displayUnit(f);
  gradient.hidden=!!f.bands;ticks.hidden=!!f.bands;bands.hidden=!f.bands;ticks.replaceChildren();bands.replaceChildren();
  gradient.style.background='linear-gradient(to right,'+(f.temperatureBands?f.colors.flatMap((c,i)=>[c+' '+100*i/f.colors.length+'%',c+' '+100*(i+1)/f.colors.length+'%']):f.colors.map((c,i)=>c+' '+100*(displayBreaks[i]-min)/(max-min)+'%')).join(',')+')';
  [min,f.temperatureBands?0:(min+max)/2,max].forEach(v=>{const span=document.createElement('span');span.textContent=Number(v.toFixed(2))+(f.unit==='°C'?'°':'');if(f.temperatureBands)span.style.left=100*f.stops.indexOf(v)/f.colors.length+'%';ticks.append(span);});
  ticks.classList.toggle('temperature-ticks',!!f.temperatureBands);
  if(f.bands)displayBreaks.forEach((v,i)=>{const item=document.createElement('div'),swatch=document.createElement('i'),label=document.createElement('span');const range=f.categoryLabels?.[i+legendOffset]??(f.categorical?String(v):i===displayBreaks.length-1?v+'+':v+'–<'+displayBreaks[i+1]);item.title=range+' '+displayUnit(f);item.setAttribute('aria-label',range+' '+displayUnit(f));swatch.style.background=legendColors[i];label.textContent=f.categoryLabels?.[i+legendOffset]??v+(i===displayBreaks.length-1&&!f.categorical?'+':'');item.append(swatch,label);bands.append(item);});
  bands.style.gridTemplateColumns='repeat('+displayBreaks.length+',minmax(0,1fr))';
  if(field===WEATHER_COMPOSITE){
   gradient.hidden=false;ticks.hidden=false;gradient.style.background='linear-gradient(to right,#414141,#e6e6e6)';ticks.replaceChildren();
   for(const text of ['Clear · 0%','Overcast · 100%']){const label=document.createElement('span');label.textContent=text;ticks.append(label);}
   const dry=bands.firstElementChild;if(dry){dry.querySelector('i').style.background='linear-gradient(to right,#414141,#e6e6e6)';dry.title='Below 0.5 mm: modelled cloud remains visible, not necessarily dry';}
  }
  if(isTypeField(field)){bands.replaceChildren();bands.style.gridTemplateColumns='repeat('+ (field===NATIVE_PRECIPITATION_TYPE?6:4)+',minmax(0,1fr))';for(const scale of precipitationTypeScales(field===NATIVE_PRECIPITATION_TYPE)){const cell=document.createElement('div'),swatch=document.createElement('i'),label=document.createElement('span');swatch.style.background='linear-gradient(to right,'+scale.colors.flatMap((c,i)=>[c+' '+i*25+'%',c+' '+(i+1)*25+'%']).join(',')+')';label.textContent=scale.name.split(' · ')[0];cell.title=scale.labels.join(' / ')+' mm/h water equivalent';cell.append(swatch,label);bands.append(cell);}}
  el('legend-winter').hidden=!isTypeField(field)&&field!==THETA_SYMBOLS;el('legend-winter').textContent=isTypeField(field)?'Light → dark: 0.1–<0.5 / 0.5–<2 / 2–<5 / 5+ mm/h water equivalent · below 0.1 unshaded':field===THETA_SYMBOLS?f.legendNote:'';
  el('temperature-scale-note').textContent=isTypeField(field)?'Light → dark: 0.1–<0.5 / 0.5–<2 / 2–<5 / 5+ mm/h water equivalent':field===THETA_SYMBOLS?f.legendNote:f.temperatureBands?f.temperatureBands+'°C colour bands · '+min+' to '+max+'°C; end colours extend beyond this range.':'';
  }
  let note=f.note+' '+winterNote(state.metas[model],field)+(state.metas[model]?.ensembleNote?' '+state.metas[model].ensembleNote:''),interval=accumulationPeriod(field,state.times[state.index])||f.legendNote||'';
  if([WEATHER_COMPOSITE,...TYPE_KEYS,THETA_SYMBOLS,'precipitation','precipitation_probability','snowfall_probability','rain','showers','snowfall_water_equivalent'].includes(field)){
   const hours=fieldIntervalHours(state.metas[model],field,state.times[state.index]);
   interval=hours?hours+' h ending at valid time':'Period unavailable';
   if(['precipitation_probability','snowfall_probability'].includes(field)&&hours)interval='≥'+Number((hours*.1).toFixed(2))+(field==='snowfall_probability'?' mm water / ':' mm / ')+interval;
   note+=' '+(hours?(['precipitation_probability','snowfall_probability'].includes(field)?'Probability threshold: ':'Accumulation: ')+interval+'.':'The model interval is unavailable.');
  }
  if(/^temperature_2m_(max|min)$/.test(field))interval='Native period ending at valid time · duration unspecified';
  el('legend-interval').textContent=f.ensembleStatistic==='spread'?'Standard deviation · higher = more disagreement':f.ensembleStatistic==='mean'?'Ensemble mean':interval;
  el('variable-note').textContent=note;
  el('field-availability').textContent=modelName(model)+' · '+f.name;
  const meta=state.metas[model],source=fieldSource(meta,field);
  if(meta&&source){const end=field===WEATHER_COMPOSITE?meta.valid_times.filter(time=>hasFieldTime(meta,field,time)).at(-1):source.valid_times.at(-1);el('run').textContent='Initialized '+runLabel(meta)+(end?' · layer data ends '+stamp(end)+' UTC':' · awaiting common forecast times');}
  if(meta&&source&&meta.runFamily)el('run').textContent+=' · '+ukvCoverageText(meta,meta.runFamily);
  const step=f.contourLabel??(field.startsWith('geopotential_height_')?(Number(field.match(/_(\d+)hPa/)?.[1])<=100?'120 m':'60 m'):f.unit==='°C'?'2°C':f.unit==='%'?'10%':field==='freezing_level_height'?'250 m':field.startsWith('wind_speed_')?'approximately 11 mph (5 m/s native)':'the positive legend thresholds');
  el('contour-note').textContent=f.categorical?'Discrete categories: contours are disabled.':'Contours: '+step+'.';
 }
 for(const {key,field}of panelSelections(state))$('map-contours-'+key).disabled=!!fields.find(f=>f.key===field)?.categorical;
}
function populateVariables(){
 for(const {key,model,field} of panelSelections(state)){
  const available=availableFields(fields,[state.metas[model]]),select=$(key==='a'?'map-variable':'map-variable-b'),groups=new Map();select.replaceChildren();
  for(const f of available){const group=variableGroup(f.key);if(!groups.has(group)){const element=document.createElement('optgroup');element.label=group;groups.set(group,element);select.append(element);}const option=document.createElement('option');option.value=f.key;option.textContent=f.name;groups.get(group).append(option);}
  if(state.metas[model]?.variables.includes('precipitation')){
   const supported=ACCUMULATION_KEYS.filter(k=>accumulationSource(state.metas[model],k));
   let group=groups.get('Accumulated precipitation');
   if(!group&&(state.metas[model].sources??[state.metas[model]]).some(source=>source.variables?.includes('precipitation')&&precipitationStepHours(source.domain,6))){group=document.createElement('optgroup');group.label='Accumulated precipitation';select.append(group);}
   if(group){for(const k of ACCUMULATION_KEYS.filter(k=>!supported.includes(k))){const o=document.createElement('option');o.value=k;o.disabled=true;o.textContent=accumulationHours(k)+' h total — incomplete window in this run';group.append(o);}
    const sorted=[...group.children].sort((a,b)=>accumulationHours(a.value)-accumulationHours(b.value));group.replaceChildren(...sorted);}
  }
  const selected=available.some(f=>f.key===field)?field:available.find(f=>f.key==='temperature_2m')?.key??available[0]?.key;
  state[key==='a'?'field':'fieldB']=selected;select.value=selected??'';
 }
}
function refreshTimeline(){
 const models=panelModelIds(state).map(id=>MODELS.find(model=>model.id===id));
 const {shortRange,hours}=forecastInterval(models,state.interval);
 state.times=intervalForecastTimes(panelForecastTimes(state),hours);
 $('map-forecast-interval').value=shortRange?'native':state.interval;
 $('map-forecast-interval').disabled=shortRange||!state.times.length;
 $('forecast-interval-note').textContent=fullUKVComparison(state)
  ?'Both UKV runs keep every available hour. A panel is blank where its selected run has no forecast yet.'
  :shortRange
  ?'Short-term models keep every available hour. Comparison uses matching times.'
  :hours?'Only the selected forecast hours load. Coarser model steps are retained.':'Every available forecast hour loads; longer forecasts take more time.';
 if(!state.times.length){
  refreshStartingTime();
  $('map-time').disabled=true;$('play-map').disabled=true;$('previous-time').disabled=true;$('next-time').disabled=true;
  $('map-time').max=0;$('map-time').value=0;$('range-start').textContent='';$('range-end').textContent='';
  throw new Error(state.compare?'The selected panels have no common forecast times. Choose another model or layer.':'The selected layer has no available forecast times for this model run.');
 }
 $('map-time').disabled=false;$('play-map').disabled=false;
 state.index=state.times.reduce((best,t,i)=>Math.abs(Date.parse(t)-requestedTime)<Math.abs(Date.parse(state.times[best])-requestedTime)?i:best,0);
 refreshStartingTime();
 $('map-time').max=state.times.length-1;$('range-start').textContent=stamp(state.times[0]);$('range-end').textContent=stamp(state.times.at(-1));
}
function metadataLoader(force){
 const requests=new Map();
 return url=>{if(!requests.has(url))requests.set(url,cachedJSON(url,{force,kind:'metadata',ttl:60000}));return requests.get(url);};
}
function showRunUpdates(message=''){
 const pairs=panelModelIds(state).filter(id=>state.metas[id]).map(id=>[id,state.metas[id]]);
 $('ukv-run-note').textContent='Selected model runs: '+pairs.map(([id,meta])=>modelName(id)+' '+runLabel(meta)+(meta.selectionWarnings?.length?' · '+meta.selectionWarnings.join(' '):'')).join(' · ');
 $('run-update-status').textContent=message||pairs.map(([id,meta])=>modelName(id)+' · '+runLabel(meta)+' · '+runAvailability(meta)+(meta.sourceWarnings?.length?' · '+meta.sourceWarnings.join(' '):'')).join(' | ')+' · Checks every minute.';
}
let checkingLiveRuns=false;
async function refreshLiveRuns(){
 if(document.hidden||briefingActive||checkingLiveRuns||$('reload-maps').disabled)return;
 if(!state.times.length)return configure(true);
 checkingLiveRuns=true;
 const generation=state.generation,ids=panelModelIds(state);
 try{
  const load=metadataLoader(true);
  const results=await Promise.allSettled(ids.map(id=>loadSpatialModel(id,load)));
  if(generation!==state.generation||briefingActive||document.hidden)return;
  const next={...state.metas};let changed=false,failed=false;
  results.forEach((result,index)=>{
   if(result.status==='rejected'){failed=true;return;}
   const id=ids[index],meta=retainRunProgress(state.metas[id],result.value);
   document.dispatchEvent(new CustomEvent('snowline-model-run-verified',{detail:{model:id,meta}}));
   if(runSignature(meta)!==runSignature(state.metas[id])){next[id]=meta;changed=true;}
  });
  if(changed){
   const resume=playing;pauseAnimation();++timeGeneration;
   requestedTime=Date.parse(state.times[state.index]);state.metas=next;
   extendCatalogue(fields,Object.values(next),OM,settings);populateVariables();refreshTimeline();
   await setTime();if(resume&&generation===state.generation&&!failedSelection&&!briefingActive)playback.start();
  }
  showRunUpdates(failed?'Live check temporarily unavailable. Keeping the displayed run; retrying in one minute.':'');
 }catch(error){showRunUpdates('Live update could not finish: '+error.message+' Retrying in one minute.');}
 finally{checkingLiveRuns=false;}
}

async function configure(force=false){
 failedSelection=null;
 pauseAnimation();++timeGeneration;
 state.times=[];state.index=0;
 refreshStartingTime('Checking forecast times…');
 $('map-time').disabled=true;$('play-map').disabled=true;$('previous-time').disabled=true;$('next-time').disabled=true;$('map-forecast-interval').disabled=true;
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
  const load=metadataLoader(force);
  const pairs=await Promise.all(panelModelIds(state).map(async id=>[id,await loadSpatialModel(id,load)]));if(generation!==state.generation)return;
  state.metas=Object.fromEntries(pairs);const metas=pairs.map(p=>p[1]);
  for(const [model,meta] of pairs)document.dispatchEvent(new CustomEvent('snowline-model-run-verified',{detail:{model,meta}}));
  showRunUpdates();
  extendCatalogue(fields,metas,OM,settings);populateVariables();
  if(panelSelections(state).some(({field})=>!field))throw new Error('No map fields are available for one of these runs.');
  refreshTimeline();
  setLegend();setTime();
 }catch(error){if(generation===state.generation){state.times=[];refreshStartingTime('Forecast unavailable');for(const p of Object.values(panels)){p.frameCache?.clear();p.loaded=false;}$('map-time-label').textContent='Forecast unavailable';status(error.message);}}
 finally{if(generation===state.generation){$('reload-maps').disabled=false;$('map-variable').disabled=!state.field;$('map-variable-b').disabled=!state.fieldB;}}
}
$('map-model').addEventListener('change',e=>{state.model=e.target.value;configure();});
$('map-model-b').addEventListener('change',e=>{state.modelB=e.target.value;configure();});
for(const [id,property]of [['map-variable','field'],['map-variable-b','fieldB'],['map-forecast-interval','interval']])$(id).addEventListener('change',e=>{
 pauseAnimation();failedSelection=null;state[property]=e.target.value;
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
 if(state.compare&&!panels.b)makeMap('b');a.map.resize();panels.b?.map.resize();for(const p of Object.values(panels))fitArea(p.map);await configure();
});
for(const key of ['a','b']){
 for(const [control,setting]of [['contours','contours'],['mslp','isobars']]){
  $('map-'+control+'-'+key).addEventListener('change',event=>{pauseAnimation();state.overlays[key][setting]=event.target.checked;setTime();});
 }
 $('map-grid-'+key).addEventListener('change',event=>{state.overlays[key].grid=event.target.checked;const panel=panels[key];if(panel){clearGridValues(panel);scheduleGridValues(panel);}});
}
$('map-terrain').addEventListener('change',e=>{terrain=e.target.checked;try{localStorage.setItem('snowline-terrain',String(terrain));}catch{}for(const panel of Object.values(panels))if(panel.map.getLayer('terrain-shading')||panel.map.isStyleLoaded())drawTerrain(panel.map);});
$('map-roads').addEventListener('change',e=>{roads=e.target.checked;try{localStorage.setItem('snowline-roads',String(roads));}catch{}for(const panel of Object.values(panels))if(panel.map.isStyleLoaded())applyRoads(panel.map);});
function restyleMaps(){
 const changed=Object.values(panels).filter(panel=>panel.background!==background);
 if(!changed.length)return false;
 pauseAnimation();++timeGeneration;$('animation-status').textContent='Loading map background…';
 for(const panel of changed){clearGridValues(panel);panel.background=background;panel.restyling=true;panel.loaded=false;panel.version++;panel.frameCache?.clear();panel.frameCache=null;panel.frames=new Map();panel.map.setStyle(backgroundStyle(background));}
 return true;
}
function selectBackground(value){background=value;$('map-background').value=value;try{localStorage.setItem('snowline-background',background);}catch{}if(!briefingActive)restyleMaps();}
$('map-background').addEventListener('change',e=>selectBackground(e.target.value));
$('map-start-time')?.addEventListener('change',e=>{
 const index=state.times.indexOf(e.target.value);if(index<0)return;
 pauseAnimation();state.index=index;e.target.value=state.times[index];setTime();
});
$('reload-maps').addEventListener('click',refreshLiveRuns);$('map-time').addEventListener('change',e=>{pauseAnimation();state.index=Number(e.target.value);setTime();});$('map-time').addEventListener('input',e=>{
 const preview=Number(e.target.value);pauseAnimation();++timeGeneration;viewportRefresh.cancel();
 // Dragging supersedes the pending selection immediately, not only on release.
 // Its late success/failure must not reset the thumb or show a stale warning.
 for(const {key}of panelSelections(state)){panels[key].frameCache?.stop();$('map-error-'+key).hidden=true;}
 failedSelection=null;state.index=preview;e.target.value=String(preview);
 if(state.times.length)$('animation-status').textContent='Preview '+stamp(state.times[preview])+' UTC · release to load';
});
$('previous-time').addEventListener('click',()=>{pauseAnimation();state.index--;setTime();});$('next-time').addEventListener('click',()=>{pauseAnimation();state.index++;setTime();});
$('map-opacity').addEventListener('input',e=>{state.opacity=Number(e.target.value)/100;$('opacity-label').textContent=e.target.value+'%';for(const p of Object.values(panels))if(p.weatherLayer&&p.map.getLayer(p.weatherLayer)){p.map.setPaintProperty(p.weatherLayer,'raster-opacity',state.opacity);for(const id of p.frameCache?.current?.underlays??[])p.map.setPaintProperty(id,'raster-opacity',state.opacity);}});
$('map-area').addEventListener('change',()=>{for(const p of Object.values(panels))fitArea(p.map,400);});
$('reset-map').addEventListener('click',()=>{$('map-area').value='uk';for(const p of Object.values(panels))fitArea(p.map,400);});
$('play-map').addEventListener('click',()=>{
 if(playing){pauseAnimation();$('animation-status').textContent='Paused';return;}
 if(!state.times.length)return;
 for(const {key}of panelSelections(state))clearGridValues(panels[key]);
 playback.start();
});
window.addEventListener('pagehide',pauseAnimation);document.addEventListener('visibilitychange',()=>{
 if(briefingActive)return;
 if(document.hidden){pauseAnimation();for(const panel of Object.values(panels))panel.frameCache?.pause();}
 else{
  for(const panel of Object.values(panels))panel.frameCache?.resume();
  if(state.times.length)setTime();
  refreshLiveRuns();
 }
});
async function openBriefing(){
 if(briefingActive)return;
 // Carry explicit area presets; retain the UK briefing default after free panning.
 const bounds=a.map.getBounds(),selection={model:state.model,field:state.field,time:state.times[state.index],interval:state.interval,area:$('map-area').value==='current'?'uk':$('map-area').value,bounds:[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]};
 briefingScroll=window.scrollY;briefingActive=true;pauseAnimation();++timeGeneration;viewportRefresh.cancel();
 if($('expanded-map').open)$('expanded-map').close();
 for(const panel of Object.values(panels)){panel.frameCache?.stop();clearGridValues(panel);}
 try{
  if(!briefingView){
   const {createBriefing}=await import('./map-briefing.js?v=20261014-interaction-audit');
   briefingView=createBriefing({getAppearance:()=>({opacity:state.opacity,terrain,roads}),getBackground:()=>background,onBackgroundChange:selectBackground,host:$('briefing-view'),models:MODELS,fields,imageMenu,maplibre:maplibregl,OM,settings,createURL:concreteURL,
    loadJSON:url=>cachedJSON(url,{kind:'metadata',ttl:60000}),
    loadRun:async (model,reference,load)=>{const meta=await loadSpatialRun(model,reference,load);extendCatalogue(fields,[meta],OM,settings);return meta;},
    loadModel:async (model,force=false)=>{const meta=await loadSpatialModel(model,metadataLoader(force));extendCatalogue(fields,[meta],OM,settings);return meta;},
    onClose:()=>{briefingActive=false;document.body.classList.remove('briefing-open');for(const panel of Object.values(panels)){panel.map.resize();panel.frameCache?.invalidateView();}viewportBounds();if(!restyleMaps())void restoreMapFrame();window.scrollTo(0,briefingScroll);(matchMedia('(max-width:650px)').matches?$('mobile-briefing'):$('open-briefing')).focus({preventScroll:true});}
   });
  }
  document.body.classList.add('briefing-open');briefingView.open(selection);window.scrollTo(0,0);
 }catch(error){briefingActive=false;document.body.classList.remove('briefing-open');status('Briefing could not open. '+error.message);setTime();}
}
$('open-briefing').addEventListener('click',openBriefing);$('mobile-briefing').addEventListener('click',openBriefing);
await configure();
let liveRunTimer=setInterval(refreshLiveRuns,60000);
window.addEventListener('pagehide',()=>clearInterval(liveRunTimer));
window.addEventListener('pageshow',event=>{if(event.persisted){clearInterval(liveRunTimer);liveRunTimer=setInterval(refreshLiveRuns,60000);refreshLiveRuns();}});
if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await document.modelContext.registerTool({name:'select_event_location',title:'Prepare an event analysis at a location',description:'Select latitude and longitude for the visible event analysis form. Does not calculate a hazard or fetch point forecasts; use the visible Calculate event action afterwards.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!finite(input.latitude)||!finite(input.longitude)||Math.abs(input.latitude)>90||Math.abs(input.longitude)>180)throw new Error('Valid latitude and longitude are required.');state.location={latitude:input.latitude,longitude:input.longitude};selectEventPoint(state.location,state.times[state.index]);$('event-analysis').scrollIntoView({block:'start'});return {location:state.location,eventStartUTC:$('event-start').value+'Z',eventEndUTC:$('event-end').value+'Z',calculated:false};}},{signal:lifecycle.signal});}catch(error){console.info('Optional map tool unavailable:',error.message);}}
