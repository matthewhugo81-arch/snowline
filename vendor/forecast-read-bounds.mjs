// Coarse, stable read bounds let nearby tiles share decoded native grids.
// A hemisphere-wide view must not snap to the whole globe: cap the padding
// at z5 (11.25 degrees longitude), retaining the existing finer zoom behavior.
export function forecastReadBounds([west,south,east,north]){
 const limit=85.0511287798066,width=east-west;
 const zoom=Math.min(20,Math.max(5,Math.round(Math.log2(360/Math.max(width,1e-9))))),tiles=2**zoom;
 const y=lat=>tiles*(1-Math.asinh(Math.tan(Math.max(-limit,Math.min(limit,lat))*Math.PI/180))/Math.PI)/2;
 const lat=row=>Math.atan(Math.sinh(Math.PI*(1-2*row/tiles)))*180/Math.PI;
 const bottom=lat(Math.min(tiles,Math.ceil(y(south)))),top=lat(Math.max(0,Math.floor(y(north))));
 if(width>=360||west>east)return [-180,bottom,180,top];
 const left=Math.floor((west+180)/360*tiles)/tiles*360-180;
 const right=Math.ceil((east+180)/360*tiles)/tiles*360-180;
 // Wrapped views need both sides of the native grid.
 return left < -180||right > 180?[-180,bottom,180,top]:[left,bottom,right,top];
}
