import {isWindField,MPH_PER_MS} from './map-wind-units.js?v=20261019-ensemble-extra3';
import {isJetWind,JET_MIN_MS,contourLineWidth} from './map-chart-style.js?v=20261019-ensemble-extra3';
import {VERTICAL_MOTION} from './map-vertical-motion.js?v=20261015-direct-vertical';

// Construct the enabled overlays once per cached frame, rather than re-creating
// them after the raster has already changed. Source URLs remain cycle-specific.
export function overlayGroups({field,url,pressureURL,heightURL,windURL,contours,isobars}){
 const groups=[],layers=[];
 if(field.key===VERTICAL_MOTION){
  if(contours)groups.push({id:'omega',source:{type:'vector',url,maxzoom:10},layers:[
   {id:'omega-lines',type:'line','source-layer':'contours',paint:{'line-color':'#666666','line-width':.55,'line-opacity':.7}}
  ]});
  if(heightURL)groups.push({id:'height700',source:{type:'vector',url:heightURL,maxzoom:10},layers:[
   {id:'height700-lines',type:'line','source-layer':'contours',layout:{'line-join':'round'},paint:{'line-color':'#000000','line-width':1,'line-opacity':1}},
   {id:'height700-labels',type:'symbol','source-layer':'contours',layout:{'symbol-placement':'line','symbol-spacing':160,'text-max-angle':85,'text-font':['Noto Sans Regular'],'text-field':['to-string',['round',['/',['to-number',['get','value']],10]]],'text-size':11,'text-padding':6,'text-offset':[0,-.5]},paint:{'text-color':'#000000','text-halo-color':'rgba(255,255,255,0.8)','text-halo-width':1}}
  ]});
  if(windURL)groups.push({id:'wind700',source:{type:'vector',url:windURL,maxzoom:10},layers:[
   {id:'wind700-pennants',type:'fill','source-layer':'wind-barb-pennants',paint:{'fill-color':'#5555ff','fill-opacity':.85}},
   {id:'wind700-barbs',type:'line','source-layer':'wind-arrows',paint:{'line-color':'#5555ff','line-width':.7,'line-opacity':.85}}
  ]});
  return groups;
 }
 if(!field.categorical){
  if(!field.ensembleStatistic&&/^(wind_speed_|ocean_current_speed$)/.test(field.key)){
   const jet=isJetWind(field.key);
   for(const [id,color,width]of [['wind-halo','#ffffff',jet?1.4:2.6],['wind-arrows','#111111',jet?.65:1]]){
    layers.push({id,type:'line','source-layer':'wind-arrows',...(jet?{filter:['>=',['to-number',['get','value']],JET_MIN_MS]}:{}),paint:{'line-color':color,'line-width':width,'line-opacity':jet?.75:1}});
   }
  }
  if(contours||((field.key==='pressure_msl'||field.isPressure)&&isobars)){
   layers.push({id:'contour-lines',type:'line','source-layer':'contours',layout:{'line-join':'round'},paint:{'line-color':'#000000','line-width':contourLineWidth(field),'line-opacity':0.8}});
   layers.push({id:'contour-labels',type:'symbol','source-layer':'contours',layout:{'symbol-placement':(field.key==='pressure_msl'||field.isPressure)?'point':'line','symbol-spacing':140,'text-max-angle':85,'text-font':['Noto Sans Regular'],'text-field':isWindField(field.key)?['to-string',['round',['*',['to-number',['get','value']],MPH_PER_MS]]]:['to-string',['get','value']],'text-size':10,'text-padding':(field.key==='pressure_msl'||field.isPressure)?24:6,'text-offset':[0,-0.5]},paint:{'text-color':'#000000','text-halo-color':'rgba(255,255,255,0.8)','text-halo-width':1}});
  }
 }
 if(layers.length)groups.push({id:'contours',source:{type:'vector',url,maxzoom:10},layers});
 if(isobars&&pressureURL&&field.key!=='pressure_msl'&&!field.isPressure){
  groups.push({id:'mslp',source:{type:'vector',url:pressureURL,maxzoom:10},layers:[
   {id:'mslp-lines',type:'line','source-layer':'contours',layout:{'line-join':'round'},paint:{'line-color':'#000000','line-width':0.8,'line-opacity':1}},
   {id:'mslp-labels',type:'symbol','source-layer':'contours',layout:{'symbol-placement':'point','text-allow-overlap':false,'text-font':['Noto Sans Regular'],'text-field':['to-string',['case',['>', ['to-number',['get','value']],2000],['/', ['to-number',['get','value']],100],['to-number',['get','value']]]],'text-size':12,'text-padding':24,'text-offset':[0,-0.6]},paint:{'text-color':'#000000','text-halo-width':0}}
  ]});
 }
 return groups;
}
