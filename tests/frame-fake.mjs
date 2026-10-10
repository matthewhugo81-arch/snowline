export class FakeMap{
 layers=[{id:'background'}];sources=new Map();events=new Map();sourceAdds=0;moves=[];
 on(type,callback){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(callback);}
 off(type,callback){this.events.get(type)?.delete(callback);}
 emit(type,event={}){for(const callback of [...(this.events.get(type)??[])])callback(event);}
 getStyle(){return {layers:this.layers};}
 addSource(id,source){this.sources.set(id,{...source,loaded:false});this.sourceAdds++;}
 getSource(id){return this.sources.get(id);}
 removeSource(id){this.sources.delete(id);}
 isSourceLoaded(id){return !!this.sources.get(id)?.loaded;}
 addLayer(layer,before){this.layers.splice(before?this.layers.findIndex(item=>item.id===before):this.layers.length,0,layer);}
 getLayer(id){return this.layers.find(layer=>layer.id===id);}
 removeLayer(id){this.layers=this.layers.filter(layer=>layer.id!==id);}
 moveLayer(id,before){this.moves.push(id);const layer=this.getLayer(id);this.removeLayer(id);this.addLayer(layer,before);}
 setLayoutProperty(id,key,value){const layer=this.getLayer(id);layer.layout??={};layer.layout[key]=value;}
 setPaintProperty(id,key,value){this.getLayer(id).paint??={};this.getLayer(id).paint[key]=value;}
 triggerRepaint(){queueMicrotask(()=>this.emit('render'));}
 load(frame){for(const id of frame.resources??[frame.id])this.sources.get(id).loaded=true;this.emit('sourcedata',{sourceId:frame.id});}
}
export const loaded=async(cache,map,url)=>{const frame=cache.prepare(url);map.load(frame);if(!await frame.ready)throw Error('Frame not ready');return frame;};
