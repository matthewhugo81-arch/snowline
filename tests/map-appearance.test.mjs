import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMapAppearance,orderForecastBasemap,gridLabelLayer,appearanceKey,coastlineController} from '../map-appearance.js';
class Events{
 events=new Map();
 on(name,callback){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(callback);return this;}
 off(name,callback){this.events.get(name)?.delete(callback);return this;}
 emit(name,event={}){for(const callback of [...this.events.get(name)??[]])callback(event);}
}
function fixture(){
 const layers=[{id:'water',type:'fill','source-layer':'water'},{id:'park-outline',type:'line','source-layer':'park'},{id:'roads',type:'line','source-layer':'transportation'},{id:'label_country_1',type:'symbol','source-layer':'place',filter:['==','rank',1]},{id:'city',type:'symbol','source-layer':'place',layout:{'text-size':12}}],sources={};
 return Object.assign(new Events(),{layers,sources,getStyle:()=>({layers}),getLayer:id=>layers.find(l=>l.id===id),getSource:id=>sources[id],
  isSourceLoaded:id=>!!sources[id]?.loaded,
  addSource(id,s){
   const map=this,source=Object.assign(new Events(),s,{loaded:false,setData(data){
    this.data=data;this.loaded=false;this.emit('dataloading',{dataType:'source'});
    queueMicrotask(()=>{if(map.getSource(id)!==this)return;this.loaded=true;this.emit('data',{dataType:'source',sourceDataType:'content'});map.triggerRepaint();});
    return this;
   }});
   sources[id]=source;if(s.type==='geojson')source.setData(s.data);
  },
  removeSource(id){delete sources[id];},
  addLayer(l,before){const i=layers.findIndex(x=>x.id===before);layers.splice(i<0?layers.length:i,0,l);},
  removeLayer(id){const i=layers.findIndex(l=>l.id===id);if(i>=0)layers.splice(i,1);},
  moveLayer(id,before){const i=layers.findIndex(x=>x.id===id),[l]=layers.splice(i,1);this.addLayer(l,before);},
  setLayoutProperty(id,p,v){const l=this.getLayer(id);(l.layout??={})[p]=v;},setFilter(id,f){this.getLayer(id).filter=f;},
  triggerRepaint(){queueMicrotask(()=>this.emit('render'));}
 });
}
test('both chart surfaces keep native place labels, remove marine park outlines and draw coast above weather',async t=>{
 let finishDownload,fetches=0;
 const download=new Promise(resolve=>{finishDownload=resolve;});
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(url,'coastline.geojson');fetches++;return download;});
 const map=fixture();applyMapAppearance(map);
 assert.equal(map.getLayer('city').layout['text-size'],12);assert.equal(map.getLayer('city').layout.visibility,undefined);
 assert.equal(map.getLayer('park-outline').layout.visibility,'none');assert.equal(map.getLayer('roads').layout.visibility,'none');
 assert.deepEqual(map.getLayer('label_country_1').filter,['all',['==','rank',1],['!=',['get','iso_a2'],'GB']]);
 assert.ok(map.layers.indexOf(map.getLayer('terrain-shading'))<map.layers.indexOf(map.getLayer('water')));
 const order=orderForecastBasemap(map);
 assert.ok(map.layers.indexOf(map.getLayer('coast-line'))>map.layers.findIndex(l=>l.id===order.rasterBefore));
 assert.ok(map.layers.indexOf(map.getLayer('coast-line'))<map.layers.findIndex(l=>l.id===order.overlayBefore));
 assert.equal(map.getLayer('coast-line').paint['line-color'],'#000000');
 const coastline=coastlineController(map);t.after(()=>coastline.destroy());
 map.addLayer({id:'forecast-isobar-labels',type:'symbol'},order.overlayBefore);
 const layerOrder=map.layers.map(layer=>layer.id);
 assert.ok(layerOrder.indexOf('coast-line')<layerOrder.indexOf('forecast-isobar-labels'),'the pending outline reserves its position below forecast labels');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fetches,1);assert.equal(map.isSourceLoaded('coastline'),true,'the empty placeholder has rendered');
 assert.equal(coastline.isReady(),false,'an empty placeholder cannot complete the chart before the download');
 finishDownload({ok:true,json:async()=>({type:'FeatureCollection',features:[]})});
 await coastline.wait({timeout:1000});
 assert.equal(coastline.isReady(),true);assert.deepEqual(map.layers.map(layer=>layer.id),layerOrder,'finishing the data load does not reorder forecast labels');
 applyMapAppearance(map,{terrain:false,roads:true});assert.equal(map.getLayer('terrain-shading').layout.visibility,'none');assert.equal(map.getLayer('roads').layout.visibility,'visible');
 assert.deepEqual(gridLabelLayer('briefing-grid-labels','briefing-grid-values'),{...gridLabelLayer(),id:'briefing-grid-labels',source:'briefing-grid-values'});
});
test('default and explicit main-map appearance are equivalent cache identities',()=>{
 assert.equal(appearanceKey(),appearanceKey({roads:false,opacity:.8,terrain:true}));
 for(const appearance of [{opacity:.6},{roads:true},{terrain:false}])assert.notEqual(appearanceKey(appearance),appearanceKey());
});
