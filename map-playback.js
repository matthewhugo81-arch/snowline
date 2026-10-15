// Buffered playback uses complete native forecast frames, never interpolated data.
export class ForecastPlayback{
 constructor({length,index,prepare,show,settle=async()=>true,onState=()=>{},interval=700,buffer=3,now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  Object.assign(this,{length,index,prepare,show,settle,onState,interval,buffer,now,sleep});this.epoch=0;this.playing=false;
 }
 pause(){this.playing=false;this.epoch++;this.onState('paused');}
 async start(){
  this.pause();this.playing=true;const epoch=this.epoch;
  const active=()=>this.playing&&epoch===this.epoch;
  try{
   // A timeline selection can still be committing when Play is pressed. Never
   // start speculative frames that would cancel that foreground selection.
   this.onState('buffering',0,this.buffer);
   if(!await this.settle()||!active()){if(active()){this.pause();this.onState('failed');}return;}
   const length=this.length(),start=this.index();
   if(length<2){this.pause();if(length===1)this.onState('ended');return;}
   const count=Math.min(this.buffer,length-1);
   for(let offset=1;offset<=count;offset++){
    if(!active())return;
    this.onState('buffering',offset-1,count);
    if(!await this.prepare((start+offset)%length)){if(active()){this.pause();this.onState('failed');}return;}
   }
   if(!active())return;
   let deadline=this.now()+this.interval;
   while(active()){
    this.onState('playing');
    // Prepare during the presentation interval, not after it. Attach a rejection
    // handler immediately so pausing during the wait cannot leak a rejection.
    const next=(this.index()+1)%length;
    const preparation=Promise.resolve().then(()=>this.prepare(next)).catch(()=>false);
    await this.sleep(Math.max(0,deadline-this.now()));
    if(!active())return;
    this.onState('next');
    if(!await preparation||!active()){if(active()){this.pause();this.onState('failed');}return;}
    // Anchor to this presentation, allowing display work to consume the next
    // interval. A late frame starts a new cadence; no skipped times or catch-up.
    deadline=this.now()+this.interval;
    if(!await this.show(next)||!active()){if(active()){this.pause();this.onState('failed');}return;}
   }
  }catch(error){if(active()){this.pause();this.onState('failed',error);}}
 }
}
