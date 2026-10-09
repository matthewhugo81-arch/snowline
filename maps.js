import {ForecastFrames,frameWindow} from './map-frames.js?v=20261009-loading';
import {panelSelection,panelSelections,panelModelIds,panelForecastTimes,createPanelOverlays} from './map-panels.js?v=20261009-overlays';
import {visibleGridPoints,gridValueLabel} from './map-grid.js?v=20261009-overlays';
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
function viewportBounds(){const visible=Object.entries(panels).filter(([key])=>key==='a'||state.compare).map(([,p])=>p.map.getBounds());if(!visible.length)return;OM.updateCurrentBounds([Math.min(...visible.map(b=>b.getWest())),Math.min(...visible.map(b=>b.getSouth())),Math.max(...visible.map(b=>b.getEast())),Math.max(...visible.map(b=>b.getNorth()))]);}
let state={model:'ukmo_uk_deterministic_2km',modelB:'ukmo_uk_deterministic_2km',compare:false,field:'temperature_2m',fieldB:'precipitation',times:[],index:0,metas:{},generation:0,location:null,opacity:.8,overlays:createPanelOverlays()};
$('map-opacity').value=String(state.opacity*100);$('opacity-label').textContent=(state.opacity*100)+'%';
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
 const map=new maplibregl.Map({container:'map-'+key,style:'https://tiles.openfreemap.org/styles/'+backgrounds[background],center:[-3,55.3],zoom:4.6,minZoom:2.5,maxZoom:10,renderWorldCopies:false,dragRotate:false,touchPitch:false,attributionControl:{compact:true}});
 map.touchZoomRotate.disableRotation();
 map.once('load',()=>{const credits=map.getContainer().querySelector('.maplibregl-compact-show .maplibregl-ctrl-attrib-button');credits?.click();});
 map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.fitBounds([[UK[0],UK[1]],[UK[2],UK[3]]],{padding:25,duration:0});
 const panel={key,map,ready:new Promise(resolve=>map.once('style.load',resolve)),url:null,sourceId:null,version:0,loaded:false};panels[key]=panel;map.on('dataloading',viewportBounds);map.on('moveend',()=>{viewportBounds();$('zoom-'+key).textContent='Zoom '+map.getZoom().toFixed(1);scheduleGridValues(panel);});map.on('movestart',()=>{panel.frameCache?.suspend(panel.requestedURL);clearGridValues(panel);});new ResizeObserver(()=>map.resize()).observe($('map-'+key));
 map.on('style.load',()=>{applyRoads(map);drawTerrain(map);if(panel.restyling){panel.restyling=false;panel.sourceId=null;if((key==='a'||state.compare)&&!a.restyling&&(!state.compare||!panels.b.restyling))setTime();}});
 map.on('error',event=>{console.warn('Map rendering:',event.error?.message);if(event.sourceId==='mslp-source'){$('mslp-note-'+key).textContent='MSLP overlay could not be loaded. Try another time or model.';return;}if(event.error?.name==='AbortError'||(event.sourceId&&event.sourceId!==panel.sourceId))return;const el=$('map-error-'+key);el.textContent='This layer could not be loaded. Try another field or check the latest run.';el.hidden=false;panel.loaded=false;});
 map.on('sourcedata',event=>{if(event.sourceId===panel.sourceId&&event.isSourceLoaded){panel.loaded=true;status('Click a map for a value and local charts.');scheduleGridValues(panel);}});
 map.on('click',async event=>{if(panel.displayedTime!==state.times[state.index])return;dismissLocation();const latitude=Number(event.lngLat.lat.toFixed(5)),longitude=Number(event.lngLat.lng.toFixed(5));state.location={latitude,longitude};const div=document.createElement('div');const title=document.createElement('strong');title.textContent=`${Math.abs(latitude).toFixed(3)}° ${latitude<0?'S':'N'}, ${Math.abs(longitude).toFixed(3)}° ${longitude<0?'W':'E'}`;div.append(title);const value=document.createElement('p');value.textContent='Reading model value…';div.append(value);const link=document.createElement('a');const selectedTime=state.times[state.index]??'';const pointParams=new URLSearchParams({lat:latitude.toFixed(5),lon:longitude.toFixed(5),time:selectedTime});link.href='./?'+pointParams;link.textContent='Open location charts';div.append(link);$('nav-charts').href=link.href;const eventButton=document.createElement('button');eventButton.type='button';eventButton.className='event-link';eventButton.textContent='Analyse an event here';eventButton.addEventListener('click',()=>{selectEventPoint({latitude,longitude},selectedTime);$('event-analysis').scrollIntoView({behavior:'smooth',block:'start'});$('event-start').focus({preventScroll:true});});div.append(eventButton);locationMarker=new maplibregl.Marker({color:'#007e84'}).setLngLat(event.lngLat).addTo(map);
const popup=new maplibregl.Popup({closeButton:true,closeOnClick:false,offset:30}).setLngLat(event.lngLat).setDOMContent(div).addTo(map);
locationPopup=popup;popup.on('close',()=>{if(locationPopup===popup)dismissLocation();});try{const result=panel.loaded?await OM.getValueFromLatLong(latitude,longitude,panel.url,map.getZoom()):null;const field=fields.find(f=>f.key===panel.displayedField);value.textContent=result&&finite(result.value)?`${result.value.toFixed(2)} ${field.unit} · ${modelName(key==='a'?state.model:state.modelB)}`:'No value available here for this layer.';}catch{value.textContent='No value available here for this layer.';}});
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
 const field=fields.find(f=>f.key===panelSelection(state,panel.key).field);const url=panel.url;if(field.categorical)return;
 panel.map.addSource('contour-source',{type:'vector',url,maxzoom:10});
 if(/^wind_speed_|^ocean_current_speed$/.test(field.key))for(const [id,color,width]of [['wind-halo','#ffffff',2.6],['wind-arrows','#111111',1]])panel.map.addLayer({id,type:'line',source:'contour-source','source-layer':'wind-arrows',paint:{'line-color':color,'line-width':width}},before);
 const overlay=state.overlays[panel.key];const visibility=overlay.contours||(field.key==='pressure_msl'&&overlay.isobars)?'visible':'none';
 panel.map.addLayer({id:'contour-lines',type:'line',source:'contour-source','source-layer':'contours',layout:{visibility,'line-join':'round'},paint:{'line-color':'#000000','line-width':0.7,'line-opacity':0.8}},before);
 panel.map.addLayer({id:'contour-labels',type:'symbol',source:'contour-source','source-layer':'contours',layout:{visibility,'symbol-placement':field.key==='pressure_msl'?'point':'line','symbol-spacing':140,'text-max-angle':85,'text-font':['Noto Sans Regular'],'text-field':['to-string',['get','value']],'text-size':10,'text-padding':field.key==='pressure_msl'?24:6,'text-offset':[0,-0.5]},paint:{'text-color':'#000000','text-halo-color':'rgba(255,255,255,0.8)','text-halo-width':1}},before);
}
function clearPressure(panel){
 for(const id of ['mslp-labels','mslp-lines'])if(panel.map.getLayer(id))panel.map.removeLayer(id);
 if(panel.map.getSource('mslp-source'))panel.map.removeSource('mslp-source');
}
function pressureNote(){
 for(const {key,model}of panelSelections(state)){
  const missing=!hasFieldTime(state.metas[model],'pressure_msl',state.times[state.index]),warnings=state.metas[model]?.sourceWarnings??[];
  $('mslp-note-'+key).textContent=warnings.length?warnings.join(' '):missing?'MSLP is unavailable at this time.':'MSLP isobars every 4 hPa.';
  if(model==='gfs_global'&&!missing)$('mslp-note-'+key).textContent+=' Uses the GFS 0.25° grid from the same run.';
  $('map-mslp-'+key).disabled=missing;
 }
}
function drawPressure(panel,model,before){
 clearPressure(panel);
 if(!state.overlays[panel.key].isobars||panelSelection(state,panel.key).field==='pressure_msl'||!sourceVariable(state.metas[model],'pressure_msl'))return;
 const time=state.times[state.index];if(!time||!hasFieldTime(state.metas[model],'pressure_msl',time))return;
 panel.map.addSource('mslp-source',{type:'vector',url:concreteURL(model,state.metas[model],time,'pressure_msl'),maxzoom:10});
 panel.map.addLayer({id:'mslp-lines',type:'line',source:'mslp-source','source-layer':'contours',layout:{'line-join':'round'},paint:{'line-color':'#000000','line-width':0.8,'line-opacity':1}},before);
 panel.map.addLayer({id:'mslp-labels',type:'symbol',source:'mslp-source','source-layer':'contours',layout:{'symbol-placement':'point','text-allow-overlap':false,'text-font':['Noto Sans Regular'],'text-field':['to-string',['case',['>', ['to-number',['get','value']],2000],['/', ['to-number',['get','value']],100],['to-number',['get','value']]]],'text-size':12,'text-padding':24,'text-offset':[0,-0.6]},paint:{'text-color':'#000000','text-halo-width':0}},before);
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
 if(!note.hidden)note.textContent='Grid values loading…';
}
function scheduleGridValues(panel){
 if(!state.overlays[panel.key].grid||panel.restyling)return;
 clearTimeout(panel.gridTimer);panel.gridTimer=setTimeout(()=>drawGridValues(panel),150);
}
async function drawGridValues(panel){
 if(!state.overlays[panel.key].grid||!panel.loaded||panel.restyling||panel.displayedTime!==state.times[state.index])return;
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
  if(!map.getLayer('grid-labels'))map.addLayer({id:'grid-labels',type:'symbol',source:'grid-values',layout:{'text-field':['get','label'],'text-font':['Noto Sans Regular'],'text-size':11,'text-padding':7,'text-allow-overlap':false},paint:{'text-color':'#101820','text-halo-color':'rgba(255,255,255,0.9)','text-halo-width':1.5}});else map.moveLayer('grid-labels');
  note.textContent=features.length?'Grid values · '+f.unit:'No grid values in this area.';
 }catch(error){if(version===panel.gridVersion){note.textContent='Grid values unavailable; try another time.';console.warn('Grid values:',error.message);}}
}
function concreteURL(model,meta,time,field){const source=fieldSource(meta,field,time);return 'om://'+fieldDataURL(meta,field,time)+'?'+new URLSearchParams({variable:sourceVariable(source,field)??field,interpolation:fields.find(f=>f.key===field)?.categorical?'nearest':'linear',arrows:/^wind_speed_|^ocean_current_speed$/.test(field)?'true':'false',tile_size:'512',color_blend:fields.find(f=>f.key===field)?.bands||fields.find(f=>f.key===field)?.temperatureBands?'false':'true',contours:'true',intervals:contourLevels(fields.find(f=>f.key===field)).join(',')});}
let playing=false,playTimer=null,timeGeneration=0;
function pauseAnimation(){playing=false;clearTimeout(playTimer);$('play-map').textContent='▶ Play';$('play-map').setAttribute('aria-pressed','false');}
function nextAnimation(){clearTimeout(playTimer);if(!playing)return;playTimer=setTimeout(()=>{if(!playing)return;if(state.index>=state.times.length-1){pauseAnimation();return;}state.index++;setTime();},900);}
function discardFrame(panel,frame){panel.frameCache?.discard(frame);}
function prepareFrame(panel,url){
 if(!panel.frameCache){panel.frameCache=new ForecastFrames(panel.map,'frame-'+panel.key);panel.frames=panel.frameCache.frames;}
 return panel.frameCache.prepare(url);
}
function warmUpcoming(panel,model,field){
 if(panel.restyling||!panel.frameCache||!state.metas[model])return;
 const urls=state.times.map(time=>hasFieldTime(state.metas[model],field,time)?concreteURL(model,state.metas[model],time,field):null);
 panel.frameCache.warm(frameWindow(urls,state.index));
}

async function drawPanel(key,model){
 const panel=panels[key];await panel.ready;if(panel.restyling)return false;const version=++panel.version;const meta=state.metas[model],time=state.times[state.index],field=panelSelection(state,key).field;if(!meta||!time)return false;
 if(!sourceVariable(meta,field)||!hasFieldTime(meta,field,time)){
  clearPressure(panel);clearContours(panel);
  panel.sourceId=null;panel.url=null;panel.loaded=false;panel.displayedTime=null;
  if(state.overlays[key].grid)$('grid-note-'+key).textContent='No grid values at this time.';
  for(const frame of [...(panel.frames?.values()??[])])discardFrame(panel,frame);
  $('panel-label-'+key).textContent=fields.find(f=>f.key===field).name+' · '+stamp(time)+' UTC';
  $('map-error-'+key).textContent=!sourceVariable(meta,field)?fields.find(f=>f.key===field).name+' is not supplied in this model’s map feed.':'No forecast for this layer at this time. Its data ends '+stamp(fieldSource(meta,field).valid_times.at(-1))+' UTC.';$('map-error-'+key).hidden=false;
  drawPressure(panel,model,panel.map.getStyle().layers.find(l=>l.type==='symbol')?.id);return true;
 }
 const url=concreteURL(model,meta,time,field);$('map-error-'+key).hidden=true;
 const frame=prepareFrame(panel,url);const ready=await frame.ready;
 if(version!==panel.version||panel.restyling||time!==state.times[state.index]||field!==panelSelection(state,key).field||model!==panelSelection(state,key).model)return false;
 if(!ready){if(panel.frameCache.current!==frame)discardFrame(panel,frame);$('map-error-'+key).textContent='Next frame could not load. The previous forecast remains visible; try again.';$('map-error-'+key).hidden=false;if(state.overlays[key].grid)$('grid-note-'+key).textContent='Grid values unavailable at this time.';return false;}
 clearPressure(panel);clearContours(panel);
 panel.sourceId=frame.id;panel.url=url;panel.loaded=true;
 panel.frameCache.show(frame,state.opacity,fields.find(f=>f.key===field)?.bands?'nearest':'linear');panel.weatherLayer=frame.layer;
 for(const layer of panel.map.getStyle().layers)if(['line','symbol'].includes(layer.type)&&layer.id!=='coast-line')panel.map.moveLayer(layer.id);
 const before=panel.map.getStyle().layers.find(l=>l.type==='symbol')?.id;
 drawContours(panel,before);drawPressure(panel,model,before);drawCoastline(panel.map,before);
 $('panel-label-'+key).textContent=fields.find(f=>f.key===field).name+' · '+stamp(time)+' UTC';panel.displayedTime=time;panel.displayedField=field;panel.displayedModel=model;scheduleGridValues(panel);return true;
}
async function setTime(){
 if(!state.times.length)return;const generation=++timeGeneration;state.index=Math.max(0,Math.min(state.index,state.times.length-1));const time=state.times[state.index];requestedTime=Date.parse(time);
 $('map-time').value=state.index;$('map-time').setAttribute('aria-valuetext',stamp(time)+' UTC');$('map-time-label').textContent=stamp(time);$('previous-time').disabled=state.index===0;$('next-time').disabled=state.index===state.times.length-1;setLegend();pressureNote();dismissLocation();$('animation-status').textContent='Loading frame…';
 const targets=panelSelections(state);for(const {key,model,field}of targets){const panel=panels[key];panel.requestedURL=hasFieldTime(state.metas[model],field,time)?concreteURL(model,state.metas[model],time,field):null;panel.frameCache?.stop(panel.requestedURL);clearGridValues(panel);}
 const loaded=await Promise.all(targets.map(({key,model})=>drawPanel(key,model)));
 if(generation!==timeGeneration)return;
 if(loaded.every(Boolean)){for(const {key,model,field}of targets)warmUpcoming(panels[key],model,field);$('animation-status').textContent='Next frames loading in background';status('Click a map for a value and local charts.');nextAnimation();}else{pauseAnimation();$('animation-status').textContent='Frame unavailable — previous image retained';}
}
function setLegend(){
 for(const {key,model,field} of panelSelections(state)){
  const f=fields.find(f=>f.key===field);if(!f)continue;
  const el=name=>$(name+'-'+key),gradient=el('legend-gradient'),ticks=el('legend-ticks'),bands=el('legend-bands');
  const min=f.temperatureBands?f.stops[1]:f.stops[0],max=f.stops.at(-1);
  el('legend-title').textContent=f.unit;
  gradient.hidden=!!f.bands;ticks.hidden=!!f.bands;bands.hidden=!f.bands;ticks.replaceChildren();bands.replaceChildren();
  gradient.style.background='linear-gradient(to right,'+(f.temperatureBands?f.colors.flatMap((c,i)=>[c+' '+100*i/f.colors.length+'%',c+' '+100*(i+1)/f.colors.length+'%']):f.colors.map((c,i)=>c+' '+100*(f.stops[i]-min)/(max-min)+'%')).join(',')+')';
  [min,f.temperatureBands?0:(min+max)/2,max].forEach(v=>{const span=document.createElement('span');span.textContent=Number(v.toFixed(2))+(f.unit==='°C'?'°':'');if(f.temperatureBands)span.style.left=100*f.stops.indexOf(v)/f.colors.length+'%';ticks.append(span);});
  ticks.classList.toggle('temperature-ticks',!!f.temperatureBands);
  if(f.bands)f.stops.forEach((v,i)=>{const item=document.createElement('div'),swatch=document.createElement('i'),label=document.createElement('span');const range=f.categorical?String(v):i===f.stops.length-1?v+'+':v+'–<'+f.stops[i+1];item.title=range+' '+f.unit;item.setAttribute('aria-label',range+' '+f.unit);swatch.style.background=f.colors[i];label.textContent=v+(i===f.stops.length-1&&!f.categorical?'+':'');item.append(swatch,label);bands.append(item);});
  bands.style.gridTemplateColumns='repeat('+f.stops.length+',minmax(0,1fr))';
  el('temperature-scale-note').textContent=f.temperatureBands?f.temperatureBands+'°C colour bands · '+min+' to '+max+'°C; end colours extend beyond this range.':'';
  let note=f.note,interval='';
  if(['precipitation','rain','showers','snowfall_water_equivalent'].includes(field)){
   const times=fieldSource(state.metas[model],field)?.valid_times??[],idx=times.indexOf(state.times[state.index]);
   interval=idx>0?(Date.parse(times[idx])-Date.parse(times[idx-1]))/3600000+' h ending at valid time':'Initial model time';
   note+=' '+(idx>0?'Accumulation: '+interval+'.':'An accumulation interval is not defined at the initial model time.');
  }
  el('legend-interval').textContent=interval;
  el('variable-note').textContent=note;
  el('field-availability').textContent=modelName(model)+' · '+f.name;
  const meta=state.metas[model],source=fieldSource(meta,field);
  if(meta&&source)el('run').textContent=stamp(meta.reference_time)+' UTC · ends '+stamp(source.valid_times.at(-1));
  const step=field.startsWith('geopotential_height_')?(Number(field.match(/_(\d+)hPa/)?.[1])<=100?'120 m':'60 m'):f.unit==='°C'?'2°C':f.unit==='%'?'10%':field==='freezing_level_height'?'250 m':field.startsWith('wind_speed_')?'5 m/s':'the positive legend thresholds';
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
 state.times=panelForecastTimes(state);if(!state.times.length)throw new Error('These layers have no available forecast times.');
 state.index=state.times.reduce((best,t,i)=>Math.abs(Date.parse(t)-requestedTime)<Math.abs(Date.parse(state.times[best])-requestedTime)?i:best,0);
 $('map-time').max=state.times.length-1;$('range-start').textContent=stamp(state.times[0]);$('range-end').textContent=stamp(state.times.at(-1));
}
async function loadModelRun(id,force){
 const load=url=>cachedJSON(url,{force,kind:'metadata',ttl:600000});
 return loadSpatialModel(id,load,$('map-run-mode').value);
}
$('map-run-mode').addEventListener('change',()=>configure());
async function configure(force=false){
 pauseAnimation();++timeGeneration;for(const p of Object.values(panels)){p.frameCache?.stop();p.version++;p.displayedTime=null;clearGridValues(p);}
 const generation=++state.generation;$('reload-maps').disabled=true;$('map-variable').disabled=true;$('map-variable-b').disabled=true;
 status('Checking model runs…');
 try{
  const pairs=await Promise.all(panelModelIds(state).map(async id=>[id,await loadModelRun(id,force)]));if(generation!==state.generation)return;
  state.metas=Object.fromEntries(pairs);const metas=pairs.map(p=>p[1]);
  $('ukv-run-note').textContent=$('map-run-mode').value==='extended'?'Uses the recent completed run reaching furthest ahead for each model.':'Uses the newest published run for each model.';
  extendCatalogue(fields,metas,OM,settings);populateVariables();
  if(panelSelections(state).some(({field})=>!field))throw new Error('No map fields are available for one of these runs.');
  refreshTimeline();
  setLegend();setTime();
 }catch(error){if(generation===state.generation){state.times=[];for(const p of Object.values(panels)){clearPressure(p);clearContours(p);p.frameCache?.clear();p.loaded=false;}$('map-time-label').textContent='Forecast unavailable';status(error.message);}}
 finally{if(generation===state.generation){$('reload-maps').disabled=false;$('map-variable').disabled=!state.field;$('map-variable-b').disabled=!state.fieldB;}}
}
$('map-model').addEventListener('change',e=>{state.model=e.target.value;configure();});
$('map-model-b').addEventListener('change',e=>{state.modelB=e.target.value;configure();});
for(const [id,property]of [['map-variable','field'],['map-variable-b','fieldB']])$(id).addEventListener('change',e=>{pauseAnimation();state[property]=e.target.value;refreshTimeline();setTime();});
let comparisonInitialized=false;
$('compare-maps').addEventListener('change',async e=>{
 state.compare=e.target.checked;
 if(state.compare&&!comparisonInitialized){state.modelB=state.model;$('map-model-b').value=state.modelB;comparisonInitialized=true;}
 $('panel-b').hidden=!state.compare;$('layer-notes-b').hidden=!state.compare;
 if(state.compare&&!panels.b)makeMap('b');a.map.resize();panels.b?.map.resize();await configure();
});
function updateContourVisibility(key){
 const {field}=panelSelection(state,key),overlay=state.overlays[key],panel=panels[key];if(!panel)return;
 for(const id of ['contour-lines','contour-labels'])if(panel.map.getLayer(id))panel.map.setLayoutProperty(id,'visibility',overlay.contours||(field==='pressure_msl'&&overlay.isobars)?'visible':'none');
}
for(const key of ['a','b']){
 $('map-contours-'+key).addEventListener('change',e=>{state.overlays[key].contours=e.target.checked;updateContourVisibility(key);});
 $('map-mslp-'+key).addEventListener('change',e=>{state.overlays[key].isobars=e.target.checked;const panel=panels[key],{model}=panelSelection(state,key);if(panel&&!panel.restyling&&state.metas[model]){const before=panel.map.getStyle().layers.find(layer=>layer.type==='symbol'&&!['contour-labels','mslp-labels','grid-labels'].includes(layer.id))?.id;drawPressure(panel,model,before);}updateContourVisibility(key);pressureNote();});
 $('map-grid-'+key).addEventListener('change',e=>{state.overlays[key].grid=e.target.checked;const panel=panels[key];if(panel){clearGridValues(panel);scheduleGridValues(panel);}});
}
$('map-terrain').addEventListener('change',e=>{terrain=e.target.checked;try{localStorage.setItem('snowline-terrain',String(terrain));}catch{}for(const panel of Object.values(panels))if(panel.map.getLayer('terrain-shading')||panel.map.isStyleLoaded())drawTerrain(panel.map);});
$('map-roads').addEventListener('change',e=>{roads=e.target.checked;try{localStorage.setItem('snowline-roads',String(roads));}catch{}for(const panel of Object.values(panels))if(panel.map.isStyleLoaded())applyRoads(panel.map);});
$('map-background').addEventListener('change',e=>{pauseAnimation();++timeGeneration;$('animation-status').textContent='Loading map background…';background=e.target.value;try{localStorage.setItem('snowline-background',background);}catch{}for(const panel of Object.values(panels)){clearGridValues(panel);panel.restyling=true;panel.loaded=false;panel.version++;panel.frameCache?.clear();panel.frameCache=null;panel.frames=new Map();panel.map.setStyle('https://tiles.openfreemap.org/styles/'+backgrounds[background]);}});
$('reload-maps').addEventListener('click',()=>configure(true));$('map-time').addEventListener('change',e=>{pauseAnimation();state.index=Number(e.target.value);setTime();});$('map-time').addEventListener('input',e=>{if(state.times.length)$('map-time-label').textContent=stamp(state.times[Number(e.target.value)]);});
$('previous-time').addEventListener('click',()=>{pauseAnimation();state.index--;setTime();});$('next-time').addEventListener('click',()=>{pauseAnimation();state.index++;setTime();});
$('map-opacity').addEventListener('input',e=>{state.opacity=Number(e.target.value)/100;$('opacity-label').textContent=e.target.value+'%';for(const p of Object.values(panels))if(p.weatherLayer&&p.map.getLayer(p.weatherLayer))p.map.setPaintProperty(p.weatherLayer,'raster-opacity',state.opacity);});
$('reset-map').addEventListener('click',()=>{for(const p of Object.values(panels))p.map.fitBounds([[UK[0],UK[1]],[UK[2],UK[3]]],{padding:25,duration:400});});
$('play-map').addEventListener('click',()=>{if(playing){pauseAnimation();return;}if(!state.times.length)return;playing=true;$('play-map').textContent='Ⅱ Pause';$('play-map').setAttribute('aria-pressed','true');if(state.index>=state.times.length-1)state.index=0;setTime();});
window.addEventListener('pagehide',pauseAnimation);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAnimation();});
await configure();
if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await document.modelContext.registerTool({name:'select_event_location',title:'Prepare an event analysis at a location',description:'Select latitude and longitude for the visible event analysis form. Does not calculate a hazard or fetch point forecasts; use the visible Calculate event action afterwards.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||!finite(input.latitude)||!finite(input.longitude)||Math.abs(input.latitude)>90||Math.abs(input.longitude)>180)throw new Error('Valid latitude and longitude are required.');state.location={latitude:input.latitude,longitude:input.longitude};selectEventPoint(state.location,state.times[state.index]);$('event-analysis').scrollIntoView({block:'start'});return {location:state.location,eventStartUTC:$('event-start').value+'Z',eventEndUTC:$('event-end').value+'Z',calculated:false};}},{signal:lifecycle.signal});}catch(error){console.info('Optional map tool unavailable:',error.message);}}
