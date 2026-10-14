// A queued moveend refresh must not start decoding midway through the next
// zoom/pan. All settled moves share one latest-view refresh.
export function createViewRefresh(refresh,isMoving,{delay=120}={}){
 let timer;
 const cancel=()=>{clearTimeout(timer);timer=null;};
 const schedule=()=>{cancel();timer=setTimeout(()=>{timer=null;if(!isMoving())refresh();},delay);};
 return {cancel,schedule};
}
