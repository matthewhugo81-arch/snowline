// Buffered playback uses complete native forecast frames, never interpolated data.
export class ForecastPlayback{
 constructor({length,index,prepare,show,onState=()=>{},interval=700,buffer=3,now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  Object.assign(this,{length,index,prepare,show,onState,interval,buffer,now,sleep});this.epoch=0;this.playing=false;
 }
 pause(){this.playing=false;this.epoch++;this.onState('paused');}
 async start(){
  this.pause();this.playing=true;const epoch=this.epoch;
  const active=()=>this.playing&&epoch===this.epoch;
  try{
   if(!this.length()){this.pause();return;}
   if(this.index()>=this.length()-1){if(!await this.show(0)||!active())return;}
   const count=Math.min(this.buffer,this.length()-this.index()-1);
   for(let offset=1;offset<=count;offset++){
    if(!active())return;
    this.onState('buffering',offset-1,count);
    if(!await this.prepare(this.index()+offset)){if(active()){this.pause();this.onState('failed');}return;}
   }
   if(!active())return;
   let deadline=this.now()+this.interval;
   while(active()&&this.index()<this.length()-1){
    this.onState('playing');
    await this.sleep(Math.max(0,deadline-this.now()));
    if(!active())return;
    const next=this.index()+1;
    this.onState('next');
    if(!await this.prepare(next)||!active()){if(active()){this.pause();this.onState('failed');}return;}
    if(!await this.show(next)||!active()){if(active()){this.pause();this.onState('failed');}return;}
    // Do not add the decode time to every ready frame, and never race to catch up.
    deadline=Math.max(deadline+this.interval,this.now()+this.interval);
   }
   if(active()){this.pause();this.onState('ended');}
  }catch(error){if(active()){this.pause();this.onState('failed',error);}}
 }
}
