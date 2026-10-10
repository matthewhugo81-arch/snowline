import {isWindField,MPH_PER_MS} from './map-wind-units.js';

// Construct the enabled overlays once per cached frame, rather than re-creating
// them after the raster has already changed. Source URLs remain cycle-specific.
export function overlayGroups({field,url,pressureURL,contours,isobars}){
 const groups=[],layers=[];
 if(!field.categorical){
  if(/^wind_speed_|^ocean_current_speed$/.test(field.key)){
   for(const [id,color,width]of [['wind-halo','#ffffff',2.6],['wind-arrows','#111111',1]]){
    layers.push({id,type:'line','source-layer':'wind-arrows',paint:{'line-color':color,'line-width':width}});
   }
  }
  if(contours||(field.key==='pressure_msl'&&isobars)){
   layers.push({id:'contour-lines',type:'line','source-layer':'contours',layout:{'line-join':'round'},paint:{'line-color':'#000000','line-width':0.7,'line-opacity':0.8}});
   layers.push({id:'contour-labels',type:'symbol','source-layer':'contours',layout:{'symbol-placement':field.key==='pressure_msl'?'point':'line','symbol-spacing':140,'text-max-angle':85,'text-font':['Noto Sans Regular'],'text-field':isWindField(field.key)?['to-string',['round',['*',['to-number',['get','value']],MPH_PER_MS]]]:['to-string',['get','value']],'text-size':10,'text-padding':field.key==='pressure_msl'?24:6,'text-offset':[0,-0.5]},paint:{'text-color':'#000000','text-halo-color':'rgba(255,255,255,0.8)','text-halo-width':1}});
  }
 }
 if(layers.length)groups.push({id:'contours',source:{type:'vector',url,maxzoom:10},layers});
 if(isobars&&pressureURL&&field.key!=='pressure_msl'){
  groups.push({id:'mslp',source:{type:'vector',url:pressureURL,maxzoom:10},layers:[
   {id:'mslp-lines',type:'line','source-layer':'contours',layout:{'line-join':'round'},paint:{'line-color':'#000000','line-width':0.8,'line-opacity':1}},
   {id:'mslp-labels',type:'symbol','source-layer':'contours',layout:{'symbol-placement':'point','text-allow-overlap':false,'text-font':['Noto Sans Regular'],'text-field':['to-string',['case',['>', ['to-number',['get','value']],2000],['/', ['to-number',['get','value']],100],['to-number',['get','value']]]],'text-size':12,'text-padding':24,'text-offset':[0,-0.6]},paint:{'text-color':'#000000','text-halo-width':0}}
  ]});
 }
 return groups;
}
