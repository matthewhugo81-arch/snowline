// A queued moveend refresh must not start decoding midway through the next
// zoom/pan. All settled moves share one latest-view refresh.
export function createViewRefresh(refresh,isMoving,{delay=120}={}){
 let timer;
 const cancel=()=>{clearTimeout(timer);timer=null;};
 const schedule=()=>{cancel();timer=setTimeout(()=>{timer=null;if(!isMoving())refresh();},delay);};
 return {cancel,schedule};
}

// Reserve the map's available layout space before decoding clipped weather
// tiles. Menus can then give that space back to the canvas without changing
// the pixels' clipping context. Real camera movement still changes these bounds.
export function layoutForecastBounds(map,{width,height}){
 const box=map.getContainer(),cx=box.clientWidth/2,cy=box.clientHeight/2;
 const halfWidth=Math.max(width,box.clientWidth)/2,halfHeight=Math.max(height,box.clientHeight)/2;
 const westSouth=map.unproject([cx-halfWidth,cy+halfHeight]);
 const eastNorth=map.unproject([cx+halfWidth,cy-halfHeight]);
 return [westSouth.lng,westSouth.lat,eastNorth.lng,eastNorth.lat];
}
