import {PRODUCT_FIELDS,PRODUCT_DOMAINS,productField,productChoices,loadProducts,retainProductSources} from './map-ensemble-products.js';
import {installPrecipitationRates,precipitationRateVariable,isPrecipitationRate} from './map-precipitation-rate.js?v=20261018-rates';
import {DIRECT_VERTICAL_DOMAINS,directVerticalNote} from './map-direct-vertical.js?v=20261020-native-levels';
import {UKMO_EARLY_DOMAINS} from './map-ukmo-early.js?v=20261021-early';
import {VERTICAL_MOTION,installVerticalMotion,verticalMotionOverlayURLs} from './map-vertical-motion.js?v=20261020-native-levels';
import {installRangeReads} from './map-range-reads.js?v=20261015-range-reads';
import {applyMapAppearance,applyRoads as setRoads,drawTerrain as setTerrain,orderForecastBasemap as orderBasemap,rasterResampling,gridLabelLayer,coastlineController} from './map-appearance.js?v=20261019-coastline3';
import {MAP_BACKGROUNDS,backgroundStyle} from './map-backgrounds.js?v=20261013-map-appearance';
import {forecastValidity} from './map-validity.js?v=20261014-interaction-audit';
import {ACCUMULATION_KEYS,accumulationHours,accumulationPeriod,accumulationSource,precipitationStepHours} from './map-accumulation.js?v=20261014-interaction-audit';
import {installAccumulations} from './map-accumulation-reader.js?v=20261014-interaction-audit';
import {WEATHER_COMPOSITE,compositeField,compositeSettings,compositeURL,isCompositeURL,compositeUnderlay} from './map-weather-composite.js?v=20261018-rates';
import {MOGREPS_SNOW_DOMAINS} from './map-mogreps.js?v=20261014-clean-symbols';
import {ENSEMBLE_DOMAINS} from './map-ensemble.js?v=20261020-native-levels';
import {ENSEMBLE_EXTRA_DOMAINS,ensemblePeriodLabel} from './map-ensemble-extra.js?v=20261020-native-levels';
import {createValueReader} from './map-values.js?v=20261011-ensemble-statistics';
import {installEnsembleTransport} from './map-ensemble-transport.js?v=20261020-ens-loading';
import {installDewPoint} from './map-dew-point.js';
import {installSurfaceDerived} from './map-surface-derived.js?v=20261020-ifs-coverage';
import {PRECIPITATION_TYPE,NATIVE_PRECIPITATION_TYPE,TYPE_KEYS,isTypeField,precipitationTypeScales,installPrecipitationType} from './map-precipitation-type.js?v=20261014-interaction-audit';
import {installDiagnostics} from './map-diagnostics.js?v=20261011-vorticity-purple';
import {setupMobileMap} from './map-mobile.js?v=20261009-controls-fix';
import {setupMapSidebar} from './map-sidebar.js?v=20261020-layout-playback';
import {ForecastFrames,frameWindow,fullSequence} from './map-frames.js?v=20261021-zoom-cache';
import {ForecastTileCache,forecastRenderBudget} from './map-tile-cache.js?v=20261021-zoom-cache';
import {createFramePrefetch} from './map-prefetch.js?v=20261020-selection-priority';
import {ForecastPlayback} from './map-playback.js?v=20261015-loading-performance';
import {ForecastNavigation} from './map-navigation.js?v=20261020-rapid-navigation';
import {createViewRefresh,layoutForecastBounds,forecastViewKey} from './map-view-refresh.js?v=20261021-stable-tiles';
import {overlayGroups} from './map-overlay-specs.js?v=20261019-ensemble-extra4';
import {panelSelection,panelSelections,panelModelIds,panelForecastTimes,createPanelOverlays} from './map-panels.js?v=20261020-run-selector';
import {forecastInterval} from './map-interval.js?v=20261019-panel-interval';
import {visibleGridPoints,gridValueLabel} from './map-grid.js?v=20261020-ifs-coverage';
import {displayUnit,displayValue,displayStops,isWindSpeed} from './map-wind-units.js?v=20261019-ensemble-extra4';
import {loadSpatialRun,fieldSource,hasFieldTime,fieldDataURL,fieldIntervalHours} from './map-sources.js?v=20261020-run-selector';
import {runLabel,runAvailability,runSignature,retainRunProgress} from './map-runs.js?v=20261020-run-selector';
import {ukvCoverageText} from './ukv-run-info.js?v=20261013-ukv-retention';
import {sourceVariable,extendCatalogue,availableFields,variableGroup,PRECIPITATION_SCALE,CLOUD_COVER_SCALE} from './map-catalogue.js?v=20261020-compact-controls';
import * as maplibregl from './vendor/maplibre-gl.mjs';
import * as OM from './vendor/index.mjs?v=20261021-stable-tiles';
import {finite} from './data.js?v=20261019-mogreps-uk';
import {MAP_MODELS as MODELS} from './map-models.js?v=20261020-run-selector';
import {mapRunCatalogue,sourceModel,selectedRunKey,renderRunSelector} from './map-run-selection.js?v=20261021-run-menu';
import {loadMapRun as loadSpatialModel} from './map-ukv-runs.js?v=20261020-run-selector';
import {cachedJSON,usageText} from './cache.js?v=20261010-ukv-families';
import {selectEventPoint} from './event-analysis.js?v=20261019-mogreps-uk';
import {isJetWind,is850Temperature,temperatureContourLevels,isSurfaceWind,SURFACE_WIND_SCALE} from './map-chart-style.js?v=20261020-surface-wind110';
import {createChartImageMenu,chartScales} from './map-image-export.js?v=20261020-ifs-coverage';
import {MAP_AREAS} from './map-areas.js?v=20261013-nw-europe-periods';
import {THETA_SYMBOLS,winterNote} from './map-winter.js?v=20261014-interaction-audit';
import {isSymbolURL,symbolURL,symbolOverlay,precipitationSymbolProtocol} from './map-precipitation-symbols.js?v=20261021-stable-tiles';
const $=id=>document.getElementById(id);
const imageMenu=createChartImageMenu();
setupMobileMap();
setupMapSidebar({onLayoutChange:resizeMapLayout});
const UK=[-11,49,2.7,61.6];
for(const area of MAP_AREAS){const option=document.createElement('option');option.value=area.id;option.textContent=area.name;$('map-area').append(option);}
const currentArea=document.createElement('option');currentArea.value='current';currentArea.textContent='Current map area';$('map-area').append(currentArea);
const selectedAreaBounds=()=>$('map-area').value==='uk'?UK:MAP_AREAS.find(area=>area.id===$('map-area').value)?.bounds;
function fitArea(map,duration=0){const bounds=selectedAreaBounds();if(bounds)map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:25,duration});}
const tempColors=['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643'];
const referenceColors=["#320032","#640064","#960096","#c800c8","#fa00fe","#c800fe","#9600fe","#6400fe","#3200fe","#0032fe","#0064fe","#0096fe","#00c8fe","#00e6f0","#00e6a0","#00e678","#00e650","#00f028","#00fa00","#fefe00","#fee100","#fec800","#feaf00","#fe9600","#e67d00","#e66400","#dc4b1e","#c8321e","#b4191e","#aa001e","#b40032","#c80064","#fe0096","#fe00c8","#fe00e1","#fe00fa"];
const fields=[
 ...PRODUCT_FIELDS,
 compositeField(PRECIPITATION_SCALE),
 {key:'pressure_msl',overlayOnly:true,name:'Mean sea-level pressure (MSLP)',unit:'hPa',note:'Atmospheric pressure reduced to mean sea level. Isobars are spaced every 4 hPa.',stops:[940,960,980,1000,1010,1020,1040,1060],colors:['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643']},
 {key:'temperature_2m',name:'2 m air temperature',unit:'°C',note:'Near-surface air temperature, not road temperature.',stops:[-1000,...Array.from({length:33},(_,i)=>-45+i*3)],colors:referenceColors.slice(0,34),temperatureBands:3},
 {key:'temperature_850hPa',name:'850 hPa temperature',unit:'°C',note:'Upper-air temperature. This pressure level can lie below high terrain.',stops:[-1000,...Array.from({length:35},(_,i)=>-36+i*2)],colors:referenceColors,temperatureBands:2},
 {key:'dew_point_2m',name:'2 m dew point',unit:'°C',note:'Near-surface dew point. UKMO maps calculate it from 2 m temperature and relative humidity on the same model grid and forecast time.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'soil_temperature_0cm',name:'0 cm soil temperature',unit:'°C',note:'Modelled ground temperature, not a road-surface forecast.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'soil_temperature_0_to_7cm',name:'0–7 cm soil temperature',unit:'°C',note:'Average temperature in a soil layer; not road or grass-minimum temperature.',stops:[-15,-10,-5,0,3,7,12,18],colors:tempColors},
 {key:'precipitation',name:'Precipitation',unit:'mm/h',note:'Mean total precipitation rate (liquid plus frozen water equivalent) over the stated native model interval. White means below 0.5 mm/h, not necessarily dry. Longer intervals show an average, not hourly detail. Use accumulation layers for period totals.',...PRECIPITATION_SCALE},
 {key:'snowfall_water_equivalent',name:'Snowfall · water equivalent',unit:'mm/h',note:'Mean snowfall water-equivalent rate over the stated native model interval. Longer intervals show an average, not hourly detail. This is not snow depth or a D-category amount.',stops:[0,.1,.25,.5,1,2,5,10],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'snow_depth',name:'Snow depth',unit:'m snow',note:'Existing snow on the ground. Kept in the spatial feed’s native metres.',stops:[0,.01,.02,.05,.1,.2,.5,1],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'snow_depth_water_equivalent',name:'Snow cover · water equivalent',unit:'mm water',note:'Water equivalent of existing snow cover, not its physical depth.',stops:[0,1,5,10,25,50,100,200],colors:['#ffffff','#e6e9ff','#c7c9fb','#a29ae9','#7963d3','#6440b9','#8c2d9e','#bc3b83']},
 {key:'relative_humidity_2m',name:'2 m relative humidity',unit:'%',note:'Near-surface moisture context. Humidity alone does not determine surface wetness.',stops:[0,20,40,60,75,85,95,100],colors:['#f7ecce','#edce9c','#c6d4b1','#98cdbf','#60b7ba','#359ab0','#257ca2','#225987']},
 {key:'cloud_cover',name:'Total cloud cover',unit:'%',note:'Watch for cloud clearance after rain and overnight cooling.',...CLOUD_COVER_SCALE},
 {key:'wind_speed_10m',name:'10 m wind speed',unit:'m/s',note:'Map shading and values displayed in mph; model grid retained in m/s.',...SURFACE_WIND_SCALE},
 {key:'freezing_level_height',name:'Freezing level',unit:'m ASL',note:'Height of the 0°C level above sea level; not necessarily the snow level.',stops:[0,100,250,500,750,1000,1500,2500],colors:['#6148ae','#3163b5','#368fc1','#77cee1','#b7e2db','#e8f3b2','#ffdc81','#ee9755']}
];
const rgba=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),hex.length===9?parseInt(hex.slice(7,9),16)/255:1];
const settings={...OM.defaultOmProtocolSettings,maxStatesWithData:16,domainOptions:[...(OM.domainOptions??[]),...ENSEMBLE_DOMAINS,...ENSEMBLE_EXTRA_DOMAINS,...PRODUCT_DOMAINS,...MOGREPS_SNOW_DOMAINS,...DIRECT_VERTICAL_DOMAINS,...UKMO_EARLY_DOMAINS],colorScales:{...OM.defaultOmProtocolSettings.colorScales,...Object.fromEntries(fields.map(f=>[f.key,{type:'breakpoint',unit:f.unit,breakpoints:f.stops,colors:f.colors.map(rgba)}]))}};
installRangeReads(OM,settings);
installEnsembleTransport(OM,settings);
installDewPoint(OM,settings);
installSurfaceDerived(OM,settings);
installDiagnostics(OM,settings);
installVerticalMotion(OM,settings);
installPrecipitationType(OM,settings);
installPrecipitationRates(OM,settings);
const accumulationReader=installAccumulations(OM,settings);
const renderMapTile=(params,controller)=>isSymbolURL(params.url)?precipitationSymbolProtocol(params,controller,OM,settings):OM.omProtocol(params,controller,isCompositeURL(params.url)?compositeSettings(settings):settings);
const readMapValue=createValueReader({...OM,omProtocol:renderMapTile},settings);
OM.updateCurrentBounds(UK);
const imageryCache=new ForecastTileCache(async(params,controller)=>{
 const result=await renderMapTile(params,controller);
 if(params.type==='json'&&params.url.includes('/ensemble-data/')){
  const source=params.url.includes('/snowline_gefs_ensemble/')?'NOAA GEFS':'ECMWF ENS (CC BY 4.0)';
  result.data.attribution='Weather: <a href="map-credits.html#ensembles">'+source+'</a> | Renderer: <a href="map-credits.html?v=20261020-run-selector">Open-Meteo</a>';
 }
 if(params.type==='json'&&/\/(ukmo_uk_ensemble_2km|snowline_mogreps_uk|snowline_mogreps_global)\//.test(params.url)){
  result.data.attribution='Weather: <a href="map-credits.html#mogreps">Met Office MOGREPS · © Crown copyright · CC BY-SA 4.0</a> | <a href="https://open-meteo.com/">Open-Meteo</a>';
 }
 return result;
},{persistent:true,...forecastRenderBudget(navigator),onLimit:()=>updatePreloadStatus()});
imageryCache.setContext('complete-geographic-tiles');
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
let briefingActive=false,briefingView,briefingScroll=0,briefingOpening=0,briefingModule;
let locationPopup=null,locationMarker=null;
function dismissLocation(){
 const popup=locationPopup;locationPopup=null;
 locationMarker?.remove();locationMarker=null;
 popup?.remove();
}
document.addEventListener('click',event=>{if(!event.target.closest('.maplibregl-map'))dismissLocation();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')dismissLocation();});
const panelVisible=key=>panelSelections(state).some(item=>item.key===key);
const mapsMoving=()=>Object.entries(panels).some(([key,panel])=>panelVisible(key)&&panel.map.isMoving());
const viewportRefresh=createViewRefresh(()=>{if(!briefingActive&&state.times.length&&!playing)setTime();},mapsMoving);
function queueViewportRefresh(){viewportRefresh.schedule();}
function resizeMapLayout(){
 for(const {key}of panelSelections(state))panels[key]?.resize({layoutOnly:true});
}
function viewportBounds(){
 if(briefingActive)return;
 const visible=Object.entries(panels).filter(([key])=>panelVisible(key));if(!visible.length)return;
 const sideBySide=matchMedia('(min-width:1051px)').matches;
 const width=document.querySelector('.map-workspace').clientWidth/(sideBySide?visible.length:1);
 const boundsByPanel=visible.map(([key,p])=>layoutForecastBounds(p.map,{
  width,
  height:sideBySide||!state.compare&&matchMedia('(min-width:651px)').matches?$('panel-'+key).clientHeight:p.map.getContainer().clientHeight
 }));
 const bounds=[Math.min(...boundsByPanel.map(b=>b[0])),Math.min(...boundsByPanel.map(b=>b[1])),Math.max(...boundsByPanel.map(b=>b[2])),Math.max(...boundsByPanel.map(b=>b[3]))];
 OM.updateCurrentBounds(bounds);
 // Pixels depend on run/style/tile coordinates, never a shared viewport.
 // Keep this bound only for point/grid-value reads.
 imageryCache.setContext('complete-geographic-tiles');
 for(const [,panel]of visible)panel.frameCache?.setView(forecastViewKey(panel.map));
}
let state={model:'ukmo_uk_deterministic_2km',modelB:'ukmo_uk_deterministic_2km',modelC:'icon_global',comparisonCount:2,compare:false,fieldC:'temperature_2m',field:'temperature_2m',fieldB:'precipitation',interval:null,times:[],index:0,metas:{},generation:0,location:null,opacity:.8,overlays:createPanelOverlays()};
$('map-opacity').value=String(state.opacity*100);$('opacity-label').textContent=(state.opacity*100)+'%';
const params=new URLSearchParams(location.search);const initialTime=Date.parse(params.get('time'));let requestedTime=Number.isFinite(initialTime)?initialTime:Date.now();
if(params.get('model')==='ukmo_uk_deterministic_2km_nowcast')params.set('model','ukmo_uk_deterministic_2km');
if(params.get('model')&&MODELS.some(m=>m.id===sourceModel(params.get('model'))))state.model=params.get('model');
// Resolved metadata has a dated identity; following the latest complete run is
// a separate user choice. Only a deliberate dated selection is pinned.
const followLatest={a:!state.model.includes('@')&&!state.model.endsWith('_previous'),b:true,c:true};
const requestedRun=({key,model})=>followLatest[key]?sourceModel(model):model;
$('compare-maps').checked=state.compare;$('map-comparison-count').value=String(state.comparisonCount);$('comparison-count-control').hidden=!state.compare;
for(const key of ['b','c']){$('panel-'+key).hidden=!panelVisible(key);$('layer-notes-'+key).hidden=!panelVisible(key);}
const initialLat=Number(params.get('lat')),initialLon=Number(params.get('lon'));
if(params.has('lat')&&params.has('lon')&&Number.isFinite(initialLat)&&Number.isFinite(initialLon)&&Math.abs(initialLat)<=90&&Math.abs(initialLon)<=180){state.location={latitude:initialLat,longitude:initialLon};$('nav-charts').href='./?'+new URLSearchParams({lat:initialLat,lon:initialLon,time:params.get('time')??''});}
function modelName(id){return MODELS.find(m=>m.id===sourceModel(id))?.name??id;}
function panelRunLabel(model){return modelName(model)+' · '+runLabel(state.metas[model])+(state.metas[model]?.completed===false?' · updating':'');}
function forecastLabel(model,field,time){return panelRunLabel(model)+' · '+fields.find(f=>f.key===field).name+' · '+forecastValidity(field,time);}
function status(message){$('map-status').textContent=message;}
function usageUpdate(){$('usage-summary').textContent=usageText();}window.addEventListener('snowline-usage',usageUpdate);usageUpdate();
const modelGroups=[
 ['Short-term models',MODELS.filter(model=>model.regional&&!model.ensemble)],
 ['Medium-term models',MODELS.filter(model=>!model.regional&&!model.ensemble)],
 ['Ensemble models',MODELS.filter(model=>model.ensemble)]
];
for(const id of ['map-model','map-model-b','map-model-c']){
 for(const [label,models] of modelGroups){
  const group=document.createElement('optgroup');group.label=label;
  for(const model of models){const option=document.createElement('option');option.value=model.id;option.textContent=model.name;group.append(option);}
  $(id).append(group);
 }
}
$('map-model').value=sourceModel(state.model);$('map-model-b').value=sourceModel(state.modelB);$('map-model-c').value=sourceModel(state.modelC);
function makeMap(key){
 const map=new maplibregl.Map({container:'map-'+key,style:'https://tiles.openfreemap.org/styles/'+backgrounds[background],center:[-3,55.3],zoom:4.6,minZoom:1,maxZoom:10,fadeDuration:0,trackResize:false,renderWorldCopies:false,dragRotate:false,touchPitch:false,attributionControl:false});
 map.touchZoomRotate.disableRotation();
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');fitArea(map);
 const panel={key,map,background,ready:new Promise(resolve=>map.once('style.load',resolve)),url:null,sourceId:null,version:0,loaded:false};panels[key]=panel;map.on('moveend',event=>{if(briefingActive||event.snowlineLayoutResize)return;++timeGeneration;viewportBounds();scheduleGridValues(panel);queueViewportRefresh();});map.on('movestart',event=>{if(event.originalEvent)$('map-area').value='current';if(briefingActive||event.snowlineLayoutResize)return;viewportRefresh.cancel();pauseAnimation();++timeGeneration;panel.frameCache?.moveStart();clearGridValues(panel);});
 // Geography starts with the map, independently of model metadata or frames.
 panel.coastline=coastlineController(map,{onState:()=>queueMicrotask(()=>updateOutlineStatus(panel))});
 // One resize owner avoids duplicate movement events invalidating the buffer.
 let pixelRatio=map.getPixelRatio();
 panel.resize=({layoutOnly=false}={})=>{if(briefingActive)return;const container=map.getContainer(),canvas=map.getCanvas(),ratio=map.getPixelRatio();if(container.clientWidth!==canvas.clientWidth||container.clientHeight!==canvas.clientHeight||pixelRatio!==ratio){pixelRatio=ratio;map.resize(layoutOnly?{snowlineLayoutResize:true}:undefined);if(layoutOnly)scheduleGridValues(panel);}};
 new ResizeObserver(panel.resize).observe($('map-'+key));window.addEventListener('resize',panel.resize);
 map.on('style.load',()=>{panel.styleOrdered=false;applyMapAppearance(map,{roads,terrain});if(panel.restyling){panel.restyling=false;panel.sourceId=null;if(panelVisible(key)&&panelSelections(state).every(({key})=>!panels[key]?.restyling))void restoreMapFrame();}});
 map.on('error',event=>{console.warn('Map rendering:',event.error?.message);if(event.sourceId==='mslp-source'){$('mslp-note-'+key).textContent='MSLP overlay could not be loaded. Try another time or model.';return;}if(event.error?.name==='AbortError'||!event.sourceId||event.sourceId!==panel.sourceId)return;const el=$('map-error-'+key);el.textContent='This layer could not be loaded. Try another field or check the latest run.';el.hidden=false;panel.loaded=false;});
 map.on('sourcedata',event=>{if(event.sourceId===panel.sourceId&&event.isSourceLoaded&&panel.frameCache?.current?.loaded&&panel.coastline.isReady()){panel.loaded=true;status('Click a map for a value and local charts.');scheduleGridValues(panel);}});
 map.on('click',async event=>{if(!panel.loaded||panel.displayedTime!==state.times[state.index])return;dismissLocation();const latitude=Number(event.lngLat.lat.toFixed(5)),longitude=Number(event.lngLat.lng.toFixed(5));state.location={latitude,longitude};const div=document.createElement('div');const title=document.createElement('strong');title.textContent=`${Math.abs(latitude).toFixed(3)}° ${latitude<0?'S':'N'}, ${Math.abs(longitude).toFixed(3)}° ${longitude<0?'W':'E'}`;div.append(title);const value=document.createElement('p');value.textContent='Reading model value…';div.append(value);const link=document.createElement('a');const selectedTime=state.times[state.index]??'';const pointParams=new URLSearchParams({lat:latitude.toFixed(5),lon:longitude.toFixed(5),time:selectedTime});link.href='./?'+pointParams;link.textContent='Open location charts';div.append(link);$('nav-charts').href=link.href;const eventButton=document.createElement('button');eventButton.type='button';eventButton.className='event-link';eventButton.textContent='Analyse an event here';eventButton.addEventListener('click',()=>{selectEventPoint({latitude,longitude},selectedTime);$('event-analysis').scrollIntoView({behavior:'smooth',block:'start'});$('event-start').focus({preventScroll:true});});div.append(eventButton);locationMarker=new maplibregl.Marker({color:'#007e84'}).setLngLat(event.lngLat).addTo(map);
const popup=new maplibregl.Popup({closeButton:true,closeOnClick:false,offset:30}).setLngLat(event.lngLat).setDOMContent(div).addTo(map);
locationPopup=popup;popup.on('close',()=>{if(locationPopup===popup)dismissLocation();});try{const result=panel.loaded?await readMapValue(latitude,longitude,panel.url,map.getZoom()):null;const field=fields.find(f=>f.key===panel.displayedField);value.textContent=result&&finite(result.value)?`${field.categoryLabels?(gridValueLabel(result.value,field)??'Unresolved')+' · '+(field.key===NATIVE_PRECIPITATION_TYPE?'native valid-time type':'estimated interval type'):displayValue(result.value,field).toFixed(1)+' '+displayUnit(field)} · ${modelName(panelSelection(state,key).model)}`:'No value available here for this layer.';}catch{value.textContent='No value available here for this layer.';}});
 imageMenu.registerMap(map,()=>({...panel.imageInfo,subtitle:$('map-error-'+key).hidden?'':$('map-error-'+key).textContent,ready:panel.loaded&&panel.coastline.isReady()&&!!panel.displayedTime&&!!panel.imageInfo&&!!map.getLayer(panel.weatherLayer)}),()=>pauseAnimation({cancelNavigation:false}));
 return panel;
}
const a=makeMap('a');
for(const {key} of panelSelections(state))if(key!=='a')makeMap(key);
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
  if(field===VERTICAL_MOTION){
   $('mslp-note-'+key).textContent='Black: 700 hPa heights every 4 dam · blue: 700 hPa wind barbs in knots. MSLP is not part of this chart.';
   $('map-mslp-'+key).disabled=true;$('map-mslp-'+key).checked=false;$('map-mslp-'+key).title='This chart includes 700 hPa heights and winds.';continue;
  }
  const composite=field===WEATHER_COMPOSITE||field===THETA_SYMBOLS;
  const missing=!hasFieldTime(state.metas[model],'pressure_msl',state.times[state.index]),warnings=state.metas[model]?.sourceWarnings??[];
  $('mslp-note-'+key).textContent=warnings.length?warnings.join(' '):missing?'MSLP is unavailable at this time.':'MSLP isobars every 4 hPa.';
  if(model.startsWith('snowline_')&&!missing&&!warnings.length)$('mslp-note-'+key).textContent='Ensemble-mean MSLP isobars every 4 hPa.';
  if(sourceModel(model)==='gfs_global'&&!missing)$('mslp-note-'+key).textContent+=' Uses the GFS 0.25° grid from the same run.';
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
function concreteURL(model,meta,time,field){if(field===THETA_SYMBOLS)return concreteURL(model,meta,time,'wet_bulb_potential_temperature_850hPa')+'&winter_chart=1';if(field===WEATHER_COMPOSITE)return compositeURL(concreteURL(model,meta,time,'precipitation'));const source=fieldSource(meta,field,time);return 'om://'+fieldDataURL(meta,field,time)+'?'+new URLSearchParams({...(field.startsWith('relative_vorticity_')?{diagnostic_style:'20261011-smooth20km-purple'}:{}),...(isSurfaceWind(field)?{wind_style:'20261020-surface-wind110'}:{}),...(isJetWind(field)?{wind_style:'20261012-jet60',arrow_profile:'jet'}:{}),...(is850Temperature(field)?{contour_style:'20261012-major850'}:{}),variable:precipitationRateVariable(sourceVariable(source,field)??field),interpolation:fields.find(f=>f.key===field)?.categorical?'nearest':'linear',arrows:!fields.find(f=>f.key===field)?.ensembleStatistic&&/^wind_speed_|^ocean_current_speed$/.test(field)?'true':'false',tile_size:'512',color_blend:fields.find(f=>f.key===field)?.bands||fields.find(f=>f.key===field)?.temperatureBands?'false':'true',contours:'true',intervals:contourLevels(fields.find(f=>f.key===field)).join(',')});}
let playing=false,timeGeneration=0,playback,timePending=Promise.resolve(true),failedSelection=null,outlineWait,navigationDirection=1;
const arrowNavigation=new ForecastNavigation({select:()=>setTime()});
function updateOutlineStatus(panel){
 if(!panelVisible(panel.key)||briefingActive||panel.restyling)return;
 const outline=panel.coastline.state.status;
 if(panel.loaded&&outline!=='ready'){
  pauseAnimation({cancelNavigation:false});panel.outlineWarning=true;
  $('animation-status').textContent=outline==='error'?'Map outline unavailable · retry loading':'Loading map outline…';
  if(outline==='error'){$('map-error-'+panel.key).textContent='The map outline could not load. Use Retry map outline to restore the coastline.';$('map-error-'+panel.key).hidden=false;}
  status(outline==='error'?'The coastline could not finish loading. Retry the map outline.':'Loading the map outline…');
 }else if(panel.outlineWarning&&outline==='ready'&&!failedSelection){
  panel.outlineWarning=false;$('map-error-'+panel.key).hidden=true;
  if(panelSelections(state).every(({key,model,field})=>{const p=panels[key];return p?.loaded&&p.coastline.isReady()&&p.displayedTime===state.times[state.index]&&p.displayedModel===model&&p.displayedField===field&&p.frameCache?.isReady(p.url);})){
   $('animation-status').textContent='Ready';status('Click a map for a value and local charts.');
  }
 }
 updatePreloadStatus();
}
function refreshStartingTime(message='No forecast times available'){
 const select=$('map-start-time');if(!select)return;
 select.replaceChildren(...state.times.map(time=>new Option(stamp(time),time)));
 select.disabled=!state.times.length;
 if(state.times.length)select.value=state.times[state.index];
 else select.append(new Option(message,''));
 $('map-start-time-note').textContent=state.compare?'Choose a time for all panels; playback begins here.':'Choose a forecast time; playback begins here.';
}
function syncArrowButtons(index){
 $('previous-time').disabled=index<=0;$('next-time').disabled=index>=state.times.length-1;
}
function syncTimeline(index){
 const time=state.times[index];if(!time)return;
 $('map-time').value=index;$('map-time').setAttribute('aria-valuetext',stamp(time)+' UTC');
 if($('map-start-time'))$('map-start-time').value=time;
 $('map-time-label').textContent=stamp(time);
 syncArrowButtons(index);
}
function pauseAnimation({cancelNavigation=true}={}){
 if(cancelNavigation)arrowNavigation.cancel();
 const active=playing;playback?.pause();playing=false;
 if(active){
  ++timeGeneration;
  const shown=state.times.indexOf(panels.a?.displayedTime);
  if(shown>=0){state.index=shown;syncTimeline(shown);}
 }
 $('play-map').textContent='▶ Play';$('play-map').setAttribute('aria-pressed','false');
}
function frameBudget(){
 return {loop:true,direction:navigationDirection,...(state.compare?{ahead:2,behind:1}:matchMedia('(max-width:650px)').matches?{ahead:3,behind:1}:{ahead:4,behind:2})};
}
function updatePreloadStatus(){
 const choices=panelSelections(state),total=choices.reduce((sum,{model,field})=>sum+state.times.filter(time=>hasFieldTime(state.metas[model],field,time)).length,0);
 let loaded=0,failed=0,cached=0;
 for(const {key}of choices){const panel=panels[key],saved=panel?.frameCache?.cachedFrames();for(const url of panel?.frameURLs??[]){if(saved?.has(url))cached++;if(panel.frameCache?.preloaded.has(url))loaded++;else if(panel.frameCache?.failures.has(url))failed++;}}
 const complete=total>0&&loaded===total&&!imageryCache.limited;
 let message='Checking imagery…';
 if(total)message='Loading imagery · '+loaded+'/'+total+' frames'+(failed?' · '+failed+' unavailable':'');
 if(cached>loaded)message=cached+'/'+total+' frames cached · '+loaded+'/'+total+' ready for this view'+(failed?' · '+failed+' unavailable':'');
 if(complete)message='All '+total+' frames loaded';
 if(choices.some(({field})=>accumulationHours(field)))message='Accumulations · selected period first; nearby totals cached'+(failed?' · '+failed+' unavailable':'');
 if(imageryCache.limited)message='Storage limited · nearby frames cached';
 const progress=$('preload-status');progress.textContent=message;progress.dataset.complete=String(complete);progress.dataset.loaded=String(loaded);progress.dataset.cached=String(cached);progress.dataset.total=String(total);
 const outlineFailed=choices.some(({key})=>panels[key]?.coastline.state.status==='error');
 $('retry-preload').hidden=!failedSelection&&!outlineFailed&&(!failed||imageryCache.limited);
 $('retry-preload').textContent=outlineFailed||failedSelection?.outline?'Retry map outline':failedSelection?'Retry selected frame':'Retry background loading';
 if($('animation-status').textContent.startsWith('Ready'))$('animation-status').textContent='Ready · '+(imageryCache.limited?'storage limited; selected and nearby frames available':complete?'all frames loaded':cached>loaded?cached+'/'+total+' cached · '+loaded+'/'+total+' ready for view':loaded+'/'+total+' frames loaded');
}
function orderForecastBasemap(panel){
 if(panel.styleOrdered)return;
 Object.assign(panel,orderBasemap(panel.map));panel.styleOrdered=true;
}
function panelCache(panel,model,field){
 const meta=state.metas[model],overlay=state.overlays[panel.key],composite=field===WEATHER_COMPOSITE;
 // Changing the other panel's field can change the shared timeline too.
 // Dated URLs isolate runs. Keep the displayed complete frame during an
 // automatic cycle handover; retain() retires it only when its replacement shows.
 const signature=JSON.stringify([sourceModel(model),field,overlay.contours,overlay.isobars]);
 const reusable=panel.frameCache&&panel.cacheKey===signature;
 if(reusable&&panel.cacheTimes===state.times&&panel.cacheMeta===meta)return panel.frameCache;
 if(!reusable){panel.frameCache?.clear();orderForecastBasemap(panel);}
 const f=fields.find(item=>item.key===field),descriptors=new Map();
 panel.frameURLs=state.times.map(time=>{
  if(!hasFieldTime(meta,field,time))return null;
  const url=concreteURL(model,meta,time,field);
  descriptors.set(url,{field:f,url,...verticalMotionOverlayURLs(field,key=>concreteURL(model,fieldSource(meta,field,time),time,key)),symbolURL:field===THETA_SYMBOLS?symbolURL(concreteURL(model,meta,time,'precipitation'),fieldSource(meta,'precipitation',time)):null,contours:overlay.contours,cloudURL:composite?compositeURL(concreteURL(model,meta,time,'cloud_cover')):null,isobars:composite||field===THETA_SYMBOLS||overlay.isobars,pressureURL:(composite||field===THETA_SYMBOLS||overlay.isobars)&&hasFieldTime(meta,'pressure_msl',time)?concreteURL(model,meta,time,'pressure_msl'):null});
  return url;
 });
 if(reusable){
  // Appending hours keeps complete, unchanged frames. If a companion overlay
  // becomes available for an old hour, rebuild only that hour's full chart.
  const unchanged=new Set([...descriptors].filter(([url,descriptor])=>JSON.stringify(panel.frameDescriptors.get(url))===JSON.stringify(descriptor)).map(([url])=>url));
  panel.frameCache.retain(unchanged);
  panel.frameDescriptors.clear();for(const [url,descriptor]of descriptors)panel.frameDescriptors.set(url,descriptor);
  panel.cacheTimes=state.times;panel.cacheMeta=meta;return panel.frameCache;
 }
 panel.cacheKey=signature;
 panel.cacheTimes=state.times;panel.cacheMeta=meta;panel.frameDescriptors=descriptors;
 const decorate=url=>{const descriptor=descriptors.get(url);return [...(descriptor.symbolURL?[symbolOverlay(descriptor.symbolURL)]:[]),...(descriptor.cloudURL?[compositeUnderlay(descriptor.cloudURL)]:[]),...overlayGroups(descriptor)];};
 panel.frameCache=new ForecastFrames(panel.map,'frame-'+panel.key,{delay:120,rasterBefore:panel.rasterBefore,overlayBefore:panel.overlayBefore,decorate,prefetch:createFramePrefetch(panel.map,imageryCache,decorate),timeout:accumulationHours(field)?120000:25000,preloadConcurrency:accumulationHours(field)?1:state.compare?2:3,onProgress:updatePreloadStatus,canPreload:()=>!imageryCache.limited,cacheRevision:()=>imageryCache.retentionRevision,isActive:()=>!document.hidden});
 panel.frameCache.setView(forecastViewKey(panel.map));panel.frames=panel.frameCache.frames;return panel.frameCache;
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
 // Reserve native rendering capacity for every selected panel and its overlays.
 // Nearby hidden MapLibre sources use the same background budget as disk preloads.
 imageryCache.setForeground(choices.flatMap(({key,model,field})=>{
  const panel=panels[key],cache=panelCache(panel,model,field),url=panel.frameURLs[index];
  return url?[url,...cache.decorate(url).map(group=>group.source.url)]:[];
 }));
 imageryCache.setSequence(choices.flatMap(({key})=>{
  const panel=panels[key],cache=panel.frameCache;
  return panel.frameURLs.filter(Boolean).flatMap(url=>[url,...cache.decorate(url).map(group=>group.source.url)]);
 }));
 const prepared=await Promise.all(choices.map(async({key,model,field})=>{
  const panel=panels[key],cache=panelCache(panel,model,field),url=panel.frameURLs[index];
  if(!url)return state.compare?{panel,cache,frame:null,key,model,field,time}:null;
  const frame=await cache.acquire(url,valid);
  return frame?{panel,cache,frame,key,model,field,time}:null;
 }));
 if(prepared.some(item=>!item))return null;
 return valid()?prepared:null;
}
function setTime(){arrowNavigation.cancel();outlineWait?.abort();outlineWait=new AbortController();return timePending=loadTime(outlineWait.signal);}
function stepTime(direction){
 if(!state.times.length)return;
 const shown=playing?state.times.indexOf(panels.a?.displayedTime):-1;
 const from=shown>=0?shown:state.index,index=Math.max(0,Math.min(from+direction,state.times.length-1));
 if(index===from)return;
 pauseAnimation();navigationDirection=direction;state.index=index;requestedTime=Date.parse(state.times[index]);
 // Remember every click immediately, including a reversal at either end. Keep
 // the image and its valid-time label together until the requested panels commit.
 syncArrowButtons(index);++timeGeneration;outlineWait?.abort();viewportRefresh.cancel();
 failedSelection=null;for(const {key}of panelSelections(state))$('map-error-'+key).hidden=true;
 const ready=panelSelections(state).every(({key,model,field})=>!hasFieldTime(state.metas[model],field,state.times[index])||panels[key].frameCache?.isReady(panels[key].frameURLs?.[index]));
 $('animation-status').textContent='Loading '+stamp(state.times[index])+' UTC…';
 return timePending=arrowNavigation.request({ready});
}
async function loadTime(outlineSignal){
 if(briefingActive)return false;
 prepareLegendLayout();
 // A released slider may overlap an animated zoom. Its selected time is kept;
 // moveend will load it once the final view is known, without a false failure.
 if(mapsMoving()){queueViewportRefresh();return false;}
 viewportRefresh.cancel(); // This selection already handles the settled view.
 failedSelection=null;
 if(!state.times.length)return false;
 const index=Math.max(0,Math.min(state.index,state.times.length-1));state.index=index;syncArrowButtons(index);
 const time=state.times[index],generation=++timeGeneration;
 const valid=()=>generation===timeGeneration&&state.times[index]===time&&state.index===index&&!mapsMoving();
 dismissLocation();requestedTime=Date.parse(time);
 // Advance the shared label only when each panel has its chart or an explicit gap.
 $('animation-status').textContent='Loading '+stamp(time)+' UTC…';
 for(const {key}of panelSelections(state))$('map-error-'+key).hidden=true;
 try{
  for(const {key,model,field}of panelSelections(state)){
   const panel=panels[key];await panel.ready;if(!valid()||panel.restyling)return false;
   const cache=panelCache(panel,model,field);
   panel.requestedURL=panel.frameURLs[index];
   // Give a cold selection priority without throwing away valid downloads.
   // Only a changed model, layer or viewport cancels obsolete prefetch jobs.
   if(!cache.isReady(panel.requestedURL))cache.focus(panel.requestedURL,frameWindow(panel.frameURLs,index,frameBudget()).keep);
  }
  viewportBounds();
  const prepared=await prepareSelection(index,valid);
  if(!valid())return false;
  if(!prepared||prepared.some(({cache,frame})=>frame&&!cache.isReady(frame.url)))throw new Error('Forecast frame could not load.');
  // Selected weather and static geography load in parallel. Future weather
  // preloads never block this gate, and an empty/errored coast is not complete.
  const coastlines=prepared.filter(({frame})=>frame).map(({panel})=>panel.coastline);
  if(coastlines.some(coast=>!coast.isReady()))$('animation-status').textContent='Loading map outline…';
  try{await Promise.all(coastlines.map(coast=>coast.wait({signal:outlineSignal})));}
  catch(cause){if(cause.name==='AbortError')return false;const error=new Error('The map outline could not load. Retry map outline to restore it.',{cause});error.outline=true;throw error;}
  if(!valid())return false;
  if(prepared.some(({cache,frame})=>frame&&!cache.isReady(frame.url)))throw new Error('Forecast frame could not load.');
  // Synchronous commit: images, contours, isobars and labels share one valid time.
  for(const {panel,cache,frame,key,model,field}of prepared){
   clearGridValues(panel);
   if(!frame){
    cache.hide();panel.sourceId=null;panel.url=null;panel.loaded=false;panel.weatherLayer=null;panel.imageInfo=null;panel.outlineWarning=false;
    if(state.overlays[key].grid)$('grid-note-'+key).textContent='Grid values unavailable at this time.';
    panel.displayedTime=time;panel.displayedField=field;panel.displayedModel=model;
    const meta=state.metas[model],available=meta.valid_times.filter(t=>hasFieldTime(meta,field,t)),first=available[0],end=available.at(-1);
    const beforeFirst=first&&Date.parse(time)<Date.parse(first);
    const pending=meta.completed===false&&end&&Date.parse(time)>Date.parse(end);
    const initialPrecipitation=field===WEATHER_COMPOSITE&&Date.parse(time)===Date.parse(meta.reference_time)&&
     hasFieldTime(meta,'cloud_cover',time)&&hasFieldTime(meta,'pressure_msl',time)&&!hasFieldTime(meta,'precipitation',time);
    $('panel-label-'+key).textContent=forecastLabel(model,field,time)+' · unavailable';
    $('map-error-'+key).textContent=(initialPrecipitation?'This combined chart needs precipitation, which is not supplied at initialization.':pending?'Not yet published for this run.':'No forecast for this layer at the selected time.')+
     (beforeFirst?' First available: '+stamp(first)+' UTC.':end?' Latest available: '+stamp(end)+' UTC.':'')+' Other panels continue where forecasts are available.';
    $('map-error-'+key).hidden=false;
    continue;
   }
   cache.show(frame,state.opacity,rasterResampling(fields.find(f=>f.key===field)));
   panel.sourceId=frame.id;panel.url=frame.url;panel.loaded=true;panel.outlineWarning=false;panel.weatherLayer=frame.layer;
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
   const selected=panelSelection(state,key);
   if(!error.outline&&panel.loaded&&panel.displayedTime===time&&panel.displayedModel===selected.model&&panel.displayedField===selected.field)continue;
   $('map-error-'+key).textContent=error.outline?'The map outline could not load. Use Retry map outline to restore the coastline.':panel.loaded&&panel.displayedTime?'Unable to load the requested frame. Showing the forecast labelled '+stamp(panel.displayedTime)+' UTC. Retry or choose another time.':'Unable to load this forecast frame. Retry or check latest runs.';
   $('map-error-'+key).hidden=false;
  }
  const shown=state.times.indexOf(panels.a?.displayedTime);
  if(shown>=0){state.index=shown;syncTimeline(shown);}
  else{$('previous-time').disabled=index===0;$('next-time').disabled=index===state.times.length-1;}
  failedSelection={index,time,outline:!!error.outline};
  $('animation-status').textContent=error.outline?'Map outline unavailable · retry loading':'Frame unavailable · playback stopped';status(error.message);updatePreloadStatus();return false;
 }
}
function retrySelectedFrame(){
 for(const {key}of panelSelections(state))if(panels[key].coastline.state.status==='error')panels[key].coastline.retry();
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
 const outlineFailed=panelSelections(state).some(({key})=>panels[key].coastline.state.status==='error');
 for(const {key}of panelSelections(state))panels[key].frameCache?.retryFailures();
 if(failedSelection)retrySelectedFrame();
 else if(outlineFailed){for(const {key}of panelSelections(state))if(panels[key].coastline.state.status==='error')panels[key].coastline.retry();setTime();}
 else for(const {key}of panelSelections(state))warmUpcoming(panels[key]);
 updatePreloadStatus();
});
function prepareLegendLayout(){
 // Reserve the selected scales before fetching tiles. Changing legend height
 // after committing a frame used to resize the map and discard that very frame.
 // Keep the displayed legend text with the displayed image until commit.
 const choices=panelSelections(state),host=document.querySelector('.map-canvases');
 const composite=choices.some(({field})=>field===WEATHER_COMPOSITE);
 const winter=choices.some(({field})=>isTypeField(field)||field===THETA_SYMBOLS);
 host.classList.toggle('composite-legend',composite);host.classList.toggle('winter-legend',winter);
 for(const {key}of choices)panels[key]?.resize();
}
function setLegend(){
 for(const {key,model,field} of panelSelections(state)){
  const f=fields.find(f=>f.key===field);if(!f)continue;
  const el=name=>$(name+'-'+key),gradient=el('legend-gradient'),ticks=el('legend-ticks'),bands=el('legend-bands');
  const legendOffset=f.legendStart??0,legendColors=f.colors.slice(legendOffset),displayBreaks=displayStops(f).slice(legendOffset),min=f.temperatureBands?displayBreaks[1]:displayBreaks[0],max=displayBreaks.at(-1);
  if(panels[key].legendField!==field){
  panels[key].legendField=field;
  el('legend-title').textContent=field===WEATHER_COMPOSITE?'Modelled cloud (%) / precipitation (mm/h)':['precipitation_probability','snowfall_probability'].includes(field)?'Chance (%)':f.categoryLabels?'Precipitation type & intensity':displayUnit(f);
  gradient.hidden=!!f.bands;ticks.hidden=!!f.bands;bands.hidden=!f.bands;ticks.replaceChildren();bands.replaceChildren();
  gradient.style.background='linear-gradient(to right,'+(f.temperatureBands?f.colors.flatMap((c,i)=>[c+' '+100*i/f.colors.length+'%',c+' '+100*(i+1)/f.colors.length+'%']):f.colors.map((c,i)=>c+' '+100*(displayBreaks[i]-min)/(max-min)+'%')).join(',')+')';
  [min,f.temperatureBands?0:(min+max)/2,max].forEach(v=>{const span=document.createElement('span');span.textContent=Number(v.toFixed(2))+(f.unit==='°C'?'°':'');if(f.temperatureBands)span.style.left=100*f.stops.indexOf(v)/f.colors.length+'%';ticks.append(span);});
  ticks.classList.toggle('temperature-ticks',!!f.temperatureBands);
  if(f.bands)displayBreaks.forEach((v,i)=>{const item=document.createElement('div'),swatch=document.createElement('i'),label=document.createElement('span');const range=f.categoryLabels?.[i+legendOffset]??(f.categorical?String(v):i===displayBreaks.length-1?v+'+':v+'–<'+displayBreaks[i+1]);item.title=range+' '+displayUnit(f);item.setAttribute('aria-label',range+' '+displayUnit(f));swatch.style.background=legendColors[i];label.textContent=f.categoryLabels?.[i+legendOffset]??v+(i===displayBreaks.length-1&&!f.categorical?'+':'');item.append(swatch,label);bands.append(item);});
  bands.style.gridTemplateColumns='repeat('+displayBreaks.length+',minmax(0,1fr))';
  if(field===WEATHER_COMPOSITE){
   gradient.hidden=false;ticks.hidden=false;gradient.style.background='linear-gradient(to right,#414141,#e6e6e6)';ticks.replaceChildren();
   for(const text of ['Clear · 0%','Overcast · 100%']){const label=document.createElement('span');label.textContent=text;ticks.append(label);}
   const dry=bands.firstElementChild;if(dry){dry.querySelector('i').style.background='linear-gradient(to right,#414141,#e6e6e6)';dry.title='Below 0.5 mm/h: modelled cloud remains visible, not necessarily dry';}
  }
  if(isTypeField(field)){bands.replaceChildren();bands.style.gridTemplateColumns='repeat('+ (field===NATIVE_PRECIPITATION_TYPE?6:4)+',minmax(0,1fr))';for(const scale of precipitationTypeScales(field===NATIVE_PRECIPITATION_TYPE)){const cell=document.createElement('div'),swatch=document.createElement('i'),label=document.createElement('span');swatch.style.background='linear-gradient(to right,'+scale.colors.flatMap((c,i)=>[c+' '+i*25+'%',c+' '+(i+1)*25+'%']).join(',')+')';label.textContent=scale.name.split(' · ')[0];cell.title=scale.labels.join(' / ')+' mm/h water equivalent';cell.append(swatch,label);bands.append(cell);}}
  el('legend-winter').hidden=!isTypeField(field)&&field!==THETA_SYMBOLS;el('legend-winter').textContent=isTypeField(field)?'Light → dark: 0.1–<0.5 / 0.5–<2 / 2–<5 / 5+ mm/h water equivalent · below 0.1 unshaded':field===THETA_SYMBOLS?f.legendNote:'';
  el('temperature-scale-note').textContent=isTypeField(field)?'Light → dark: 0.1–<0.5 / 0.5–<2 / 2–<5 / 5+ mm/h water equivalent':field===THETA_SYMBOLS?f.legendNote:f.temperatureBands?f.temperatureBands+'°C colour bands · '+min+' to '+max+'°C; end colours extend beyond this range.':'';
  }
  let note=f.note+' '+winterNote(state.metas[model],field)+(state.metas[model]?.ensembleNote?' '+state.metas[model].ensembleNote:''),interval=accumulationPeriod(field,state.times[state.index])||f.legendNote||'';
  if(field===VERTICAL_MOTION){const sourceNote=directVerticalNote(fieldSource(state.metas[model],field,state.times[state.index]));if(sourceNote){note+=' '+sourceNote;interval+=' '+sourceNote;}}
  if([WEATHER_COMPOSITE,...TYPE_KEYS,THETA_SYMBOLS,'precipitation','precipitation_probability','snowfall_probability','rain','showers','snowfall_water_equivalent'].includes(field)){
   const hours=fieldIntervalHours(state.metas[model],field,state.times[state.index]);
   const rate=field===WEATHER_COMPOSITE||isPrecipitationRate(field);
   interval=hours?(rate?'Mean rate over preceding '+hours+' h':hours+' h ending at valid time'):'Period unavailable';
   if(['precipitation_probability','snowfall_probability'].includes(field)&&hours)interval='≥'+Number((hours*.1).toFixed(2))+(field==='snowfall_probability'?' mm water / ':' mm / ')+interval;
   note+=' '+(hours?(['precipitation_probability','snowfall_probability'].includes(field)?'Probability threshold: ':rate?'':'Accumulation: ')+interval+'.':'The model interval is unavailable.');
  }
  if(/^temperature_2m_(max|min)$/.test(field))interval='Native period ending at valid time · duration unspecified';
  const ensembleInterval=ensemblePeriodLabel(state.metas[model],field,state.times[state.index]);
  if(ensembleInterval)note+=' Reporting period: '+ensembleInterval+'.';
  const extraSource=fieldSource(state.metas[model],field,state.times[state.index]);
  if(extraSource?.coverage)note+=' Coverage: North Atlantic and Europe, including all four map areas. '+extraSource.member_count+' ensemble members.';
  el('legend-interval').textContent=ensembleInterval||(f.ensembleStatistic==='spread'?'Standard deviation · higher = more disagreement':f.ensembleStatistic==='mean'?'Ensemble mean':interval);
  el('variable-note').textContent=note;
  el('field-availability').textContent=modelName(model)+' · '+f.name;
  const meta=state.metas[model],source=fieldSource(meta,field);
  if(meta&&source){const end=field===WEATHER_COMPOSITE?meta.valid_times.filter(time=>hasFieldTime(meta,field,time)).at(-1):(source.variable_valid_times?.[sourceVariable(source,field)]??source.valid_times).at(-1);el('run').textContent='Initialized '+runLabel(meta)+(end?' · layer data ends '+stamp(end)+' UTC':' · awaiting common forecast times');}
  if(meta&&source&&meta.runFamily)el('run').textContent+=' · '+ukvCoverageText(meta,meta.runFamily);
  const step=f.contourLabel??(field.startsWith('geopotential_height_')?(Number(field.match(/_(\d+)hPa/)?.[1])<=100?'120 m':'60 m'):f.unit==='°C'?'2°C':f.unit==='%'?'10%':field==='freezing_level_height'?'250 m':field.startsWith('wind_speed_')?'approximately 11 mph (5 m/s native)':'the positive legend thresholds');
  el('contour-note').textContent=f.categorical?'Discrete categories: contours are disabled.':'Contours: '+step+'.';
 }
 for(const {key,field}of panelSelections(state))$('map-contours-'+key).disabled=!!fields.find(f=>f.key===field)?.categorical;
}
function populateVariables(onlyKey){
 for(const {key,model,field} of panelSelections(state).filter(item=>!onlyKey||item.key===onlyKey)){
  const available=availableFields(fields,[state.metas[model],...(state.metas[model]?.normalMenuMeta?[state.metas[model].normalMenuMeta]:[])]);for(const f of productChoices(sourceModel(model)))if(!available.some(a=>a.key===f.key))available.push(f);const select=$('map-variable'+(key==='a'?'':'-'+key)),groups=new Map();select.replaceChildren();
  for(const f of available){const group=variableGroup(f.key);if(!groups.has(group)){const element=document.createElement('optgroup');element.label=group;groups.set(group,element);select.append(element);}const option=document.createElement('option');option.value=f.key;option.textContent=f.name;if(f.group==='Temperature anomalies'&&!state.metas[model]?.variables.includes(f.key)){option.disabled=true;option.textContent+=' — awaiting reference data';}groups.get(group).append(option);}
  if(state.metas[model]?.variables.includes('precipitation')){
   const supported=ACCUMULATION_KEYS.filter(k=>accumulationSource(state.metas[model],k));
   let group=groups.get('Accumulated precipitation');
   if(!group&&(state.metas[model].sources??[state.metas[model]]).some(source=>source.variables?.includes('precipitation')&&precipitationStepHours(source.domain,6))){group=document.createElement('optgroup');group.label='Accumulated precipitation';select.append(group);}
   if(group){for(const k of ACCUMULATION_KEYS.filter(k=>!supported.includes(k))){const o=document.createElement('option');o.value=k;o.disabled=true;o.textContent=accumulationHours(k)+' h total — incomplete window in this run';group.append(o);}
    const sorted=[...group.children].sort((a,b)=>accumulationHours(a.value)-accumulationHours(b.value));group.replaceChildren(...sorted);}
  }
  const selected=available.some(f=>f.key===field)?field:available.find(f=>f.key==='temperature_2m')?.key??available[0]?.key;
  state['field'+(key==='a'?'':key.toUpperCase())]=selected;select.value=selected??'';
 }
}
function refreshTimeline(){
 const models=panelModelIds(state).map(id=>MODELS.find(model=>model.id===sourceModel(id)));
 const {hours}=forecastInterval(models,state.interval,{allowRegionalSteps:true});
 state.times=panelForecastTimes(state,hours);
 $('map-forecast-interval').value=hours?String(hours):'native';
 $('map-forecast-interval').disabled=!state.times.length;
 $('forecast-interval-note').textContent=(hours?'Only the selected forecast hours load. Coarser model steps are retained.':'Every available forecast hour loads; longer forecasts take more time.')+(state.compare?' All available panel times are included; a panel is blank where it has no forecast.':'');
 if(!state.times.length){
  refreshStartingTime();
  $('map-time').disabled=true;$('play-map').disabled=true;$('previous-time').disabled=true;$('next-time').disabled=true;
  $('map-time').max=0;$('map-time').value=0;$('range-start').textContent='';$('range-end').textContent='';
  throw new Error(state.compare?'The selected panels have no available forecast times. Choose another model or layer.':'The selected layer has no available forecast times for this model run.');
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
function updateRunMenus(results){
 for(const {key,model} of panelSelections(state)){
  const result=results.find(item=>sourceModel(item.key)===sourceModel(model));
  if(result&&state.metas[model])renderRunSelector($('map-run'+(key==='a'?'':'-'+key)),sourceModel(model),result,state.metas[model],{followLatest:followLatest[key]});
 }
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
 const generation=state.generation,selected=panelSelections(state).filter(p=>!productField(p.field));
 if(!selected.length){checkingLiveRuns=false;return;}
 try{
  const load=metadataLoader(true);
  // Panels can share a model and initialization while having different intent:
  // one may follow the latest complete cycle and another deliberately pin it.
  const results=await Promise.allSettled(selected.map(item=>mapRunCatalogue.select(requestedRun(item),load)));
  if(generation!==state.generation||briefingActive||document.hidden)return;
  const next={...state.metas};let changed=false,failed=false;
  results.forEach((result,index)=>{
   const {key,model}=selected[index],previous=state.metas[model];
   if(result.status==='rejected'){failed=true;next[model]=previous;return;}
   const meta=retainProductSources(retainRunProgress(previous,result.value.meta),previous),id=selectedRunKey(model,meta);
   next[id]=meta;
   state['model'+(key==='a'?'':key.toUpperCase())]=id;
   document.dispatchEvent(new CustomEvent('snowline-model-run-verified',{detail:{model:sourceModel(model),meta:result.value.latest}}));
   if(id!==model||runSignature(meta)!==runSignature(previous))changed=true;
  });
  const retryPromotion=failedSelection&&selected.some(({key})=>followLatest[key]&&panels[key].displayedModel!==panelSelection(state,key).model);
  if(changed||retryPromotion){
   const resume=playing;pauseAnimation();++timeGeneration;
   requestedTime=Date.parse(state.times[state.index]);state.metas=next;
   extendCatalogue(fields,Object.values(next),OM,settings);populateVariables();refreshTimeline();
   await setTime();if(resume&&generation===state.generation&&!failedSelection&&!briefingActive)playback.start();
  }
  if(generation!==state.generation||briefingActive||document.hidden)return;
  updateRunMenus(results.filter(r=>r.status==='fulfilled').map(r=>r.value));
  showRunUpdates(failed?'Live check temporarily unavailable. Keeping the displayed run; retrying in one minute.':'');
 }catch(error){if(generation===state.generation)showRunUpdates('Live update could not finish: '+error.message+' Retrying in one minute.');}
 finally{checkingLiveRuns=false;}
}

async function resolvePanelRun(item,load){
 const request=requestedRun(item),model=sourceModel(item.model);
 if(productField(item.field)&&productChoices(model).some(f=>f.key===item.field)){
  const meta=await loadProducts(model,load,followLatest[item.key]?null:state.metas[item.model]?.reference_time);
  if(!meta.variables.includes(item.field))throw Error('This ensemble product is not yet published for the selected run.');
  return {meta:{...meta,normalMenuMeta:state.metas[item.model]?.normalMenuMeta??state.metas[item.model]},latest:meta,previous:null,key:selectedRunKey(model,meta)};
 }
 return mapRunCatalogue.select(request,load);
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
 const generation=++state.generation;$('reload-maps').disabled=true;$('map-variable').disabled=true;$('map-variable-b').disabled=true;$('map-variable-c').disabled=true;
 for(const {key} of panelSelections(state))$('map-run'+(key==='a'?'':'-'+key)).disabled=true;
 status('Checking model runs…');
 try{
  const load=metadataLoader(force);
  const selected=panelSelections(state);
  const results=await Promise.all(selected.map(async item=>({...item,...await resolvePanelRun(item,load)})));if(generation!==state.generation)return;
  const pairs=results.map(result=>[result.key,result.meta]);
  for(let i=0;i<selected.length;i++){
   const panelKey=selected[i].key,suffix=panelKey==='a'?'':panelKey.toUpperCase();
   state['model'+suffix]=results[i].key;
   $('map-model'+(panelKey==='a'?'':'-'+panelKey)).value=sourceModel(results[i].key);
  }
  state.metas={};for(const [key,meta] of pairs){const previous=state.metas[key];state.metas[key]=meta.productOnly&&previous&&!previous.productOnly?retainProductSources(previous,meta):retainProductSources(meta,previous);}const metas=Object.values(state.metas);
  updateRunMenus(results);
  for(const result of results)document.dispatchEvent(new CustomEvent('snowline-model-run-verified',{detail:{model:sourceModel(result.key),meta:result.latest}}));
  showRunUpdates();
  extendCatalogue(fields,metas,OM,settings);populateVariables();
  if(panelSelections(state).some(({field})=>!field))throw new Error('No map fields are available for one of these runs.');
  refreshTimeline();
  setLegend();setTime();
 }catch(error){if(generation===state.generation){state.times=[];refreshStartingTime('Forecast unavailable');for(const p of Object.values(panels)){p.frameCache?.clear();p.loaded=false;}$('map-time-label').textContent='Forecast unavailable';status(error.message);}}
 finally{if(generation===state.generation){$('reload-maps').disabled=false;$('map-variable').disabled=!state.field;$('map-variable-b').disabled=!state.fieldB;$('map-variable-c').disabled=!state.fieldC;}}
}
// A panel selection resolves independently. Keep the shared timeline and the
// other panels' sources, labels and prepared frames throughout the request.
async function configurePanel(key,model,follow){
 const panel=panels[key],suffix=key==='a'?'':'-'+key,property='model'+(key==='a'?'':key.toUpperCase());
 const selection=panel.selectionGeneration=(panel.selectionGeneration??0)+1;
 pauseAnimation();++timeGeneration;++state.generation;panel.configuring=true;
 $('reload-maps').disabled=true;$('map-variable'+suffix).disabled=true;$('map-run'+suffix).disabled=true;
 failedSelection=null;
 $('animation-status').textContent='Checking Panel '+(['a','b','c'].indexOf(key)+1)+' model run…';
 status($('animation-status').textContent);
 try{
  const requestedField=panelSelection(state,key).field;
  const requested={key,model,field:requestedField};
  const oldFollow=followLatest[key];followLatest[key]=follow;
  let result;try{result=await resolvePanelRun(requested,metadataLoader(false));}catch(error){followLatest[key]=oldFollow;throw error;}
  if(selection!==panel.selectionGeneration)return;
  requestedTime=Date.parse(state.times[state.index])||requestedTime;
  state[property]=result.key;followLatest[key]=follow;
  state.metas={...state.metas,[result.key]:result.meta};
  $('map-model'+suffix).value=sourceModel(result.key);
  updateRunMenus([result]);extendCatalogue(fields,[result.meta],OM,settings);populateVariables(key);
  document.dispatchEvent(new CustomEvent('snowline-model-run-verified',{detail:{model:sourceModel(result.key),meta:result.latest}}));
  showRunUpdates();refreshTimeline();await setTime();
 }catch(error){
  if(selection!==panel.selectionGeneration)return;
  $('map-model'+suffix).value=sourceModel(state[property]);
  $('map-run'+suffix).value=state[property];
  $('map-error-'+key).textContent='Unable to change this panel: '+error.message;
  $('map-error-'+key).hidden=false;status(error.message);
  $('animation-status').textContent='Unable to change this panel';
 }finally{
  if(selection===panel.selectionGeneration){
   panel.configuring=false;$('map-variable'+suffix).disabled=!panelSelection(state,key).field;$('map-run'+suffix).disabled=false;
   $('reload-maps').disabled=Object.values(panels).some(p=>p.configuring);
  }
 }
}
for(const [key,property]of [['a','model'],['b','modelB'],['c','modelC']]){
 const suffix=key==='a'?'':'-'+key;
 $('map-model'+suffix).addEventListener('change',e=>configurePanel(key,e.target.value,true));
 $('map-run'+suffix).addEventListener('change',e=>configurePanel(key,e.target.value,e.target.value===e.target.dataset.preferredRun));
}
for(const [id,property]of [['map-variable','field'],['map-variable-b','fieldB'],['map-variable-c','fieldC'],['map-forecast-interval','interval']])$(id).addEventListener('change',async e=>{
 pauseAnimation();failedSelection=null;
 const key=property==='fieldB'?'b':property==='fieldC'?'c':'a',selection=panelSelection(state,key),chosen=e.target.value;
 if(productField(chosen)){
  const generation=panels[key].selectionGeneration=(panels[key].selectionGeneration??0)+1;
  ++state.generation;panels[key].configuring=true;
  e.target.disabled=true;status('Loading published ensemble product…');
  try{
   const meta=await loadProducts(sourceModel(selection.model),metadataLoader(false),followLatest[key]?null:state.metas[selection.model]?.reference_time);
   if(generation!==panels[key].selectionGeneration)return;
   if(!meta.variables.includes(chosen))throw Error(chosen.includes('anomaly')?'Temperature anomalies await the verified HadUK-Grid minimum/maximum climatology.':'This probability is not yet published for this run.');
   // Product identity is separate so another panel on the same model keeps its sources.
   const normalKey=selectedRunKey(selection.model,meta);
   state['model'+(key==='a'?'':key.toUpperCase())]=normalKey;
   // Same-reference sources can be merged safely; all other runs stay separate.
   const previous=state.metas[normalKey];
   const merged=previous&&!previous.productOnly?{...previous,sources:[...(previous.sources??[previous]),meta],variables:[...new Set([...previous.variables,...meta.variables])],valid_times:[...new Set([...previous.valid_times,...meta.valid_times])].sort()}:{...meta,normalMenuMeta:previous?.normalMenuMeta??previous??state.metas[selection.model]};
   state.metas={...state.metas,[normalKey]:merged};state[property]=chosen;
   requestedTime=meta.variable_valid_times[chosen].map(Date.parse).reduce((best,t)=>Math.abs(t-requestedTime)<Math.abs(best-requestedTime)?t:best);
   extendCatalogue(fields,[merged],OM,settings);populateVariables(key);showRunUpdates('Ensemble products · '+runLabel(meta));
   const runSelect=$('map-run'+(key==='a'?'':'-'+key));if(![...runSelect.options].some(o=>o.value===normalKey)){const option=document.createElement('option');option.value=normalKey;option.textContent=runLabel(meta)+' · ensemble products';runSelect.append(option);}runSelect.value=normalKey;
   refreshTimeline();await setTime();
  }catch(error){e.target.value=selection.field;status(error.message);$('map-error-'+key).textContent=error.message;$('map-error-'+key).hidden=false;}
  finally{if(generation===panels[key].selectionGeneration){e.target.disabled=false;panels[key].configuring=false;}}
  return;
 }
 state[property]=chosen;
 if(property!=='interval'&&state.metas[selection.model]?.productOnly){await configurePanel(key,sourceModel(selection.model),true);return;}

 try{refreshTimeline();setTime();}
 catch(error){
  status(error.message);$('map-time-label').textContent='Forecast unavailable';$('animation-status').textContent=error.message;
  for(const p of Object.values(panels)){p.frameCache?.clear();p.frameCache=null;p.loaded=false;p.url=null;p.sourceId=null;p.displayedTime=null;if(p.map.isStyleLoaded()){}}
 }
});
const comparisonInitialized=new Set(state.compare?panelSelections(state).map(p=>p.key):['a']);
function setPanelMenuExpanded(key,expanded){
 const button=$('toggle-panel-menu-'+key);
 $('panel-selectors-'+key).hidden=!expanded;
 $('panel-overlays-'+key).hidden=!expanded;
 button.setAttribute('aria-expanded',String(expanded));
 const label=(expanded?'Collapse':'Show')+' Panel '+(['a','b','c'].indexOf(key)+1)+' menu';
 button.setAttribute('aria-label',label);button.title=label;
}
for(const key of ['a','b','c'])$('toggle-panel-menu-'+key).addEventListener('click',()=>{
 const expanded=$('toggle-panel-menu-'+key).getAttribute('aria-expanded')==='true';
 setPanelMenuExpanded(key,!expanded);
 resizeMapLayout();
});
async function changeComparison(){
 pauseAnimation();requestedTime=Date.parse(state.times[state.index])||requestedTime;
 state.compare=$('compare-maps').checked;
 state.comparisonCount=Number($('map-comparison-count').value);
 $('comparison-count-control').hidden=!state.compare;
 for(const key of ['a','b','c']){
  $('toggle-panel-menu-'+key).hidden=!state.compare;
  if(!state.compare)setPanelMenuExpanded(key,true);
 }
 for(const key of ['b','c']){
  const visible=panelVisible(key);
  if(visible&&!comparisonInitialized.has(key)){
   const suffix=key.toUpperCase();state['model'+suffix]=state.model;followLatest[key]=followLatest.a;if(key==='c')state['field'+suffix]=state.field;
   $('map-model-'+key).value=sourceModel(state['model'+suffix]);comparisonInitialized.add(key);
  }
  $('panel-'+key).hidden=!visible;$('layer-notes-'+key).hidden=!visible;
  if(visible&&!panels[key])makeMap(key);
  if(!visible){panels[key]?.frameCache?.clear();if(panels[key])clearGridValues(panels[key]);}
 }
 for(const {key} of panelSelections(state)){panels[key].map.resize();fitArea(panels[key].map);}
 await configure();
}
$('compare-maps').addEventListener('change',changeComparison);
$('map-comparison-count').addEventListener('change',changeComparison);
for(const key of ['a','b','c']){
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
 const preview=Number(e.target.value),from=state.index;pauseAnimation();++timeGeneration;viewportRefresh.cancel();
 if(preview!==from)navigationDirection=preview>from?1:-1;
 // Dragging supersedes the pending selection immediately, not only on release.
 // Its late success/failure must not reset the thumb or show a stale warning.
 // Keep useful tile downloads and saved frames when the thumb passes them.
 // Only pause new speculation; release will reuse/promote the selected work.
 for(const {key}of panelSelections(state)){
  const panel=panels[key];
  panel.frameCache?.focus(panel.frameURLs?.[preview],frameWindow(panel.frameURLs??[],preview,frameBudget()).keep);
  $('map-error-'+key).hidden=true;
 }
 failedSelection=null;state.index=preview;e.target.value=String(preview);syncArrowButtons(preview);
 if(state.times.length)$('animation-status').textContent='Preview '+stamp(state.times[preview])+' UTC · release to load';
});
$('previous-time').addEventListener('click',()=>stepTime(-1));$('next-time').addEventListener('click',()=>stepTime(1));
document.addEventListener('keydown',event=>{
 if(briefingActive||!state.times.length||event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
 const direction=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,target=event.target;
 if(!direction||!(target instanceof Element))return;
 if(target.isContentEditable||target.closest('select,textarea,[role="menu"],[role="listbox"],[role="combobox"]'))return;
 if(target.closest('input')&&target!==$('map-time'))return;
 if(target.closest('dialog:not(#expanded-map),[role="dialog"]'))return;
 // Capture before MapLibre's canvas handler or the range's native key action,
 // so a press selects one forecast step without also panning or stepping twice.
 event.preventDefault();event.stopPropagation();stepTime(direction);
},true);
$('map-opacity').addEventListener('input',e=>{state.opacity=Number(e.target.value)/100;$('opacity-label').textContent=e.target.value+'%';for(const p of Object.values(panels))if(p.weatherLayer&&p.map.getLayer(p.weatherLayer)){p.map.setPaintProperty(p.weatherLayer,'raster-opacity',state.opacity);for(const id of p.frameCache?.current?.underlays??[])p.map.setPaintProperty(id,'raster-opacity',state.opacity);}});
$('map-area').addEventListener('change',()=>{for(const p of Object.values(panels))fitArea(p.map,400);});
$('reset-map').addEventListener('click',()=>{$('map-area').value='uk';for(const p of Object.values(panels))fitArea(p.map,400);});
$('play-map').addEventListener('click',()=>{
 if(playing){pauseAnimation();for(const {key}of panelSelections(state))warmUpcoming(panels[key]);$('animation-status').textContent='Paused';return;}
 if(!state.times.length)return;
 navigationDirection=1;arrowNavigation.flush();
 for(const {key}of panelSelections(state))clearGridValues(panels[key]);
 playback.start();
});
window.addEventListener('pagehide',()=>{outlineWait?.abort();pauseAnimation();});document.addEventListener('visibilitychange',()=>{
 if(briefingActive)return;
 if(document.hidden){outlineWait?.abort();pauseAnimation();for(const panel of Object.values(panels))panel.frameCache?.pause();}
 else{
  for(const panel of Object.values(panels))panel.frameCache?.resume();
  if(state.times.length)setTime();
  refreshLiveRuns();
 }
});
function loadBriefing(){
 return briefingModule??=import('./map-briefing.js?v=20261021-run-menu').catch(error=>{briefingModule=null;throw error;});
}
function closeBriefing(){
 ++briefingOpening;briefingActive=false;
 $('briefing-view').hidden=true;$('briefing-loading').hidden=true;
 document.body.classList.remove('briefing-open');
 for(const panel of Object.values(panels)){panel.map.resize();panel.frameCache?.invalidateView();}
 viewportBounds();if(!restyleMaps())void restoreMapFrame();
 void refreshLiveRuns();
 window.scrollTo(0,briefingScroll);
 (matchMedia('(max-width:650px)').matches?$('mobile-briefing'):$('open-briefing')).focus({preventScroll:true});
}
async function openBriefing(){
 if(briefingActive)return;
 // Carry explicit area presets; retain the UK briefing default after free panning.
 const bounds=a.map.getBounds(),selection={model:state.model,followLatest:followLatest.a,field:state.field,time:state.times[state.index],interval:$('map-forecast-interval').value,area:$('map-area').value==='current'?'uk':$('map-area').value,bounds:[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]};
 briefingScroll=window.scrollY;briefingActive=true;pauseAnimation();++timeGeneration;viewportRefresh.cancel();
 const opening=++briefingOpening;
 if($('expanded-map').open)$('expanded-map').close();
 for(const panel of Object.values(panels)){panel.frameCache?.stop();clearGridValues(panel);}
 // Switch views before any network wait, with a working way back while loading.
 document.body.classList.add('briefing-open');$('briefing-view').hidden=false;
 window.scrollTo(0,0);
 try{
  if(!briefingView){
   $('briefing-loading').hidden=false;$('briefing-loading-close').focus({preventScroll:true});
   const {createBriefing}=await loadBriefing();
   if(opening!==briefingOpening||!briefingActive)return;
   briefingView=createBriefing({getAppearance:()=>({opacity:state.opacity,terrain,roads}),getBackground:()=>background,onBackgroundChange:selectBackground,host:$('briefing-content'),models:MODELS,fields,imageMenu,maplibre:maplibregl,OM,settings,createURL:concreteURL,
    loadJSON:(url,options={})=>cachedJSON(url,{kind:'metadata',ttl:60000,...options}),onMetadata:meta=>extendCatalogue(fields,[meta],OM,settings),
    loadRun:async (model,reference,load)=>{const meta=await loadSpatialRun(model,reference,load);extendCatalogue(fields,[meta],OM,settings);return meta;},
    loadModel:async (model,force=false)=>{const meta=await loadSpatialModel(model,metadataLoader(force));extendCatalogue(fields,[meta],OM,settings);return meta;},
    onClose:closeBriefing
   });
  }
  $('briefing-loading').hidden=true;briefingView.open(selection);
 }catch(error){if(opening!==briefingOpening||!briefingActive)return;closeBriefing();status('Briefing could not open. '+error.message);setTime();}
}
$('open-briefing').addEventListener('click',openBriefing);$('mobile-briefing').addEventListener('click',openBriefing);
$('briefing-loading-close').addEventListener('click',closeBriefing);
// Prepare the optional view when the user approaches either button.
for(const id of ['open-briefing','mobile-briefing'])for(const event of ['pointerenter','focus'])$(id).addEventListener(event,()=>{void loadBriefing().catch(()=>{});});
await configure();
let liveRunTimer=setInterval(refreshLiveRuns,60000);
window.addEventListener('pagehide',()=>clearInterval(liveRunTimer));
window.addEventListener('pageshow',event=>{if(event.persisted){clearInterval(liveRunTimer);liveRunTimer=setInterval(refreshLiveRuns,60000);refreshLiveRuns();}});
if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await document.modelContext.registerTool({name:'select_event_location',title:'Prepare an event analysis at a location',description:'Select latitude and longitude for the visible event analysis form. Does not calculate a hazard or fetch point forecasts; use the visible Calculate event action afterwards.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!finite(input.latitude)||!finite(input.longitude)||Math.abs(input.latitude)>90||Math.abs(input.longitude)>180)throw new Error('Valid latitude and longitude are required.');state.location={latitude:input.latitude,longitude:input.longitude};selectEventPoint(state.location,state.times[state.index]);$('event-analysis').scrollIntoView({block:'start'});return {location:state.location,eventStartUTC:$('event-start').value+'Z',eventEndUTC:$('event-end').value+'Z',calculated:false};}},{signal:lifecycle.signal});}catch(error){console.info('Optional map tool unavailable:',error.message);}}
