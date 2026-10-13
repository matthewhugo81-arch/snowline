import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMapAppearance,orderForecastBasemap,gridLabelLayer,appearanceKey} from '../map-appearance.js';
function fixture(){
 const layers=[{id:'water',type:'fill','source-layer':'water'},{id:'park-outline',type:'line','source-layer':'park'},{id:'roads',type:'line','source-layer':'transportation'},{id:'label_country_1',type:'symbol','source-layer':'place',filter:['==','rank',1]},{id:'city',type:'symbol','source-layer':'place',layout:{'text-size':12}}],sources={};
 return {layers,sources,getStyle:()=>({layers}),getLayer:id=>layers.find(l=>l.id===id),getSource:id=>sources[id],addSource(id,s){sources[id]=s;},addLayer(l,before){const i=layers.findIndex(x=>x.id===before);layers.splice(i<0?layers.length:i,0,l);},moveLayer(id,before){const i=layers.findIndex(x=>x.id===id),[l]=layers.splice(i,1);this.addLayer(l,before);},setLayoutProperty(id,p,v){const l=this.getLayer(id);(l.layout??={})[p]=v;},setFilter(id,f){this.getLayer(id).filter=f;}};
}
test('both chart surfaces keep native place labels, remove marine park outlines and draw coast above weather',()=>{
 const map=fixture();applyMapAppearance(map);
 assert.equal(map.getLayer('city').layout['text-size'],12);assert.equal(map.getLayer('city').layout.visibility,undefined);
 assert.equal(map.getLayer('park-outline').layout.visibility,'none');assert.equal(map.getLayer('roads').layout.visibility,'none');
 assert.deepEqual(map.getLayer('label_country_1').filter,['all',['==','rank',1],['!=',['get','iso_a2'],'GB']]);
 assert.ok(map.layers.indexOf(map.getLayer('terrain-shading'))<map.layers.indexOf(map.getLayer('water')));
 const order=orderForecastBasemap(map);
 assert.ok(map.layers.indexOf(map.getLayer('coast-line'))>map.layers.findIndex(l=>l.id===order.rasterBefore));
 assert.ok(map.layers.indexOf(map.getLayer('coast-line'))<map.layers.findIndex(l=>l.id===order.overlayBefore));
 assert.equal(map.getLayer('coast-line').paint['line-color'],'#000000');
 applyMapAppearance(map,{terrain:false,roads:true});assert.equal(map.getLayer('terrain-shading').layout.visibility,'none');assert.equal(map.getLayer('roads').layout.visibility,'visible');
 assert.deepEqual(gridLabelLayer('briefing-grid-labels','briefing-grid-values'),{...gridLabelLayer(),id:'briefing-grid-labels',source:'briefing-grid-values'});
});
test('default and explicit main-map appearance are equivalent cache identities',()=>{
 assert.equal(appearanceKey(),appearanceKey({roads:false,opacity:.8,terrain:true}));
 for(const appearance of [{opacity:.6},{roads:true},{terrain:false}])assert.notEqual(appearanceKey(appearance),appearanceKey());
});
