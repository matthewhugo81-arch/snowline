// A decoded grid is immutable while tiles use it. Send it once to each worker,
// then send lightweight references. FIFO worker messages make evictions safe
// even when several frames have already queued render jobs.
export class ForecastWorkerData{
 constructor(maxBytes=16*1024*1024){this.maxBytes=maxBytes;this.ids=new WeakMap();this.sequence=0;this.workers=new WeakMap();}
 reset(worker){this.workers.delete(worker);}
 encode(worker,message){
  if(!message.layers)return message;
  let state=this.workers.get(worker);
  if(!state){state={entries:new Map(),bytes:0};this.workers.set(worker,state);}
  const evicted=[],layers=message.layers.map(layer=>{
   const data=layer.data,bytes=(data?.values?.byteLength??0)+(data?.directions?.byteLength??0);
   if(!bytes||bytes>this.maxBytes)return layer;
   let id=this.ids.get(data);if(!id){id=++this.sequence;this.ids.set(data,id);}
   const known=state.entries.has(id);
   if(known)state.entries.delete(id);
   else{
    while(state.bytes+bytes>this.maxBytes&&state.entries.size){
     const [old,size]=state.entries.entries().next().value;state.entries.delete(old);state.bytes-=size;evicted.push(old);
    }
    state.bytes+=bytes;
   }
   state.entries.set(id,bytes);
   return {...layer,data:known?undefined:data,dataRef:id};
  });
  return {...message,layers,evicted:[...new Set(evicted)].filter(id=>!state.entries.has(id))};
 }
}
