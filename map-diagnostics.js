// Derived fields always use one source grid, run and valid time. No vertical
// interpolation, ensemble-mean thermodynamics, or substitution of nearby levels.
export const THETA_W='wet_bulb_potential_temperature_850hPa';
export const DIAGNOSTIC_KEYS=[THETA_W,'relative_vorticity_300hPa','relative_vorticity_400hPa'];
const regularDomains=new Set(['ncep_gfs025','dwd_icon','dwd_icon_eu','ecmwf_ifs025','ecmwf_aifs025_single','ncep_aigfs025','jma_gsm','meteofrance_arome_france0025','ukmo_global_deterministic_10km']);
const ukv='ukmo_uk_deterministic_2km';
const speedDirection=new Set([ukv,'ukmo_global_deterministic_10km']);
export function diagnosticInputs(domain,key){
 if(key===THETA_W&&(regularDomains.has(domain)||domain===ukv||domain==='knmi_harmonie_arome_europe'))return ['temperature_850hPa','relative_humidity_850hPa'];
 const level=key.match(/^relative_vorticity_(300|400)hPa$/)?.[1];
 if(!level||!(regularDomains.has(domain)||domain===ukv))return null;
 return (speedDirection.has(domain)?['wind_speed_','wind_direction_']:['wind_u_component_','wind_v_component_']).map(prefix=>prefix+level+'hPa');
}
export function diagnosticVariable(meta,key){
 const inputs=diagnosticInputs(meta?.domain,key);
 return inputs?.every(key=>meta.variables?.includes(key))?key+'_derived':null;
}
export function diagnosticField(key){
 if(key===THETA_W)return {key,name:'850 hPa theta-w (wet-bulb potential temperature)',group:'Derived diagnostics',unit:'°C',
  stops:[-20,-10,-5,0,4,8,12,16,20,24,28,32],colors:['#53318b','#355db0','#269ed0','#78d7da','#4bb958','#7ed33b','#d8e52b','#ffdf33','#ffac32','#ec662a','#c52438','#87144e'],
  contourLabel:'2°C',note:'Derived 850 hPa wet-bulb potential temperature (theta-w), expressed in °C at 1000 hPa. Bolton / Davies-Jones approximation from same-time temperature and relative humidity over liquid water. Not 850 hPa air temperature. This pressure surface can lie below high terrain.'};
 if(/^relative_vorticity_(300|400)hPa$/.test(key))return {key,name:key.match(/\d+/)[0]+' hPa relative vorticity',group:'Derived diagnostics',unit:'10⁻⁵ s⁻¹',
  stops:[-40,-20,-10,-5,0,5,10,20,40],colors:['#279ecd','#51ccdf','#86e4db','#a4dfb5','#c8df65','#fbe075','#f7a439','#df5429','#9b1839'],contourValues:Array.from({length:41},(_,i)=>(i-20)*5),
  contourLabel:'5 × 10⁻⁵ s⁻¹',note:'Derived vertical relative vorticity from same-time horizontal winds on the stated pressure surface, with spherical geometry and projection correction. Positive = anticlockwise; negative = clockwise. Gaussian smoothing (20 km standard deviation) reduces grid-scale striping; small features and peak values are softened. Shading, contours and point values use the same smoothed field. Missing neighbours, outer domain edges and poles remain blank. End colours extend beyond the scale.'};
 return null;
}

// Bolton (1980) theta-e followed by Davies-Jones (2008), Eq. 3.8.
// Coefficients/reference: doi:10.1175/2007MWR2224.1 and MetPy's
// wet_bulb_potential_temperature. RH is interpreted over liquid water, as in
// the existing provider dew-point calculation. No Stull wet-bulb shortcut.
export function thetaWCelsius(temperature,humidity){
 if(!Number.isFinite(temperature)||!Number.isFinite(humidity)||temperature<=-100||temperature>=80||humidity<0)return NaN;
 const t=temperature+273.15,rh=Math.min(100,humidity)/100;
 if(rh===0)return thetaWFromThetaE(t*(1000/850)**(2/7));
 const e=rh*6.112*Math.exp(17.67*temperature/(temperature+243.5));
 const log=Math.log(e/6.112),td=243.5*log/(17.67-log)+273.15;
 if(!(td>0)||e>=850)return NaN;
 const r=.6219569100577033*e/(850-e),tl=56+1/(1/(td-56)+Math.log(t/td)/800);
 const thetaE=t*(1000/(850-e))**(2/7)*(t/tl)**(.28*r)*Math.exp((3036/tl-1.78)*r*(1+.448*r));
 return thetaWFromThetaE(thetaE);
}
function thetaWFromThetaE(thetaE){
 const x=thetaE/273.15;
 const a=7.101574+x*(-20.68208+x*(16.11182+x*(2.574631-5.205688*x)));
 const b=1+x*(-3.552497+x*(3.781782+x*(-.6899655-.592934*x)));
 return (thetaE<=173.15?thetaE:thetaE-Math.exp(a/b))-273.15;
}
export const thetaWRule={pattern:/^wet_bulb_potential_temperature_850hPa_derived$/,provides:{directions:false,barbs:false},scaleFactor:100,
 getSourceVars:()=>['temperature_850hPa','relative_humidity_850hPa'],
 process(temperature,humidity){
  if(temperature.length!==humidity.length)throw Error('Theta-w input grids do not match.');
  const values=new Float32Array(new temperature.buffer.constructor(temperature.byteLength));
  for(let i=0;i<values.length;i++)values[i]=thetaWCelsius(temperature[i],humidity[i]);
  return {values,directions:undefined};
 }
};

const radians=Math.PI/180;
const angle=x=>Math.atan2(Math.sin(x),Math.cos(x));
export function cyclicColumns(config){
 if(config.type!=='regular')return 0;
 const {nx,dx}=config,span=Math.abs((nx-1)*dx),gap=360-span;
 // ICON omits one longitude column; its closing interval is twice the step.
 if(Math.abs(gap)<1e-6)return nx-1;
 return gap>0&&gap<=Math.abs(dx)*2.01?nx:0;
}
export function diagnosticWindow(config,ranges,halo={x:1,y:1}){
 const target=ranges??[{start:0,end:config.ny},{start:0,end:config.nx}];
 if(target.length!==2||target.some((r,i)=>!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start||r.end>[config.ny,config.nx][i]))throw Error('Invalid diagnostic grid window.');
 const period=cyclicColumns(config),y={start:Math.max(0,target[0].start-halo.y),end:Math.min(config.ny,target[0].end+halo.y)};
 const x={start:period?target[1].start-halo.x:Math.max(0,target[1].start-halo.x),end:period?target[1].end+halo.x:Math.min(config.nx,target[1].end+halo.x)};
 const segments=[];
 for(let column=x.start;column<x.end;){
  const start=period?((column%period)+period)%period:column;
  const length=Math.min(x.end-column,(period||config.nx)-start);
  segments.push({ranges:[y,{start,end:start+length}],offset:column-x.start});column+=length;
 }
 return {target,y,x,period,segments,width:x.end-x.start,height:y.end-y.start};
}

export const VORTICITY_SMOOTHING_KM=20;
function gaussianKernel(sigma){
 const radius=Math.ceil(3*sigma),weights=Float64Array.from({length:2*radius+1},(_,i)=>Math.exp(-.5*((i-radius)/sigma)**2));
 const sum=weights.reduce((a,b)=>a+b,0);return {radius,weights:weights.map(value=>value/sum)};
}
// Physical smoothing scale, independent of map zoom or tile boundaries. Only
// the longitude scale beyond the Mercator display limit is capped, avoiding an
// unbounded stencil at a pole that cannot be displayed on these maps.
export function vorticitySmoothing(config,ranges){
 const base=diagnosticWindow(config,ranges),radius=config.projection?.radius??6371229;
 const regular=config.type==='regular',distance=VORTICITY_SMOOTHING_KM*1000;
 const dy=regular?Math.abs(config.dy)*radians*radius:Math.abs(config.dy);
 const vertical=gaussianKernel(distance/dy),horizontal=new Map();
 const kernelForRow=row=>{
  if(!horizontal.has(row)){
   const latitude=Math.min(85.05112878,Math.abs(config.latMin+row*config.dy));
   const dx=regular?Math.abs(config.dx)*radians*radius*Math.cos(latitude*radians):Math.abs(config.dx);
   horizontal.set(row,gaussianKernel(distance/dx));
  }
  return horizontal.get(row);
 };
 const first=Math.max(1,base.target[0].start-vertical.radius),last=Math.min(config.ny-2,base.target[0].end-1+vertical.radius);
 let maxX=0;for(let row=first;row<=last;row++)maxX=Math.max(maxX,kernelForRow(row).radius);
 const window=diagnosticWindow(config,ranges,{x:maxX+1,y:vertical.radius+1});
 // Vorticity needs one extra wind neighbour beyond every smoothing neighbour.
 const derivativeWindow={...window,target:[{start:window.y.start+1,end:window.y.end-1},{start:window.x.start+1,end:window.x.end-1}]};
 return {window,derivativeWindow,vertical,kernelForRow};
}
export function smoothVorticity(values,smoothing){
 const {window,derivativeWindow,vertical,kernelForRow}=smoothing,[rows,columns]=derivativeWindow.target;
 const width=columns.end-columns.start,height=rows.end-rows.start;
 if(values.length!==width*height)throw Error('Vorticity smoothing grid does not match.');
 const [targetRows,targetColumns]=window.target,outWidth=targetColumns.end-targetColumns.start;
 const horizontal=new Float32Array(height*outWidth);
 // Separable Gaussian, truncated at 3 sigma. Never replace missing cells with
 // zero or renormalise across gaps. This also keeps partial domains honest.
 for(let row=rows.start;row<rows.end;row++){
  const {radius,weights}=kernelForRow(row),inputOffset=(row-rows.start)*width,outputOffset=(row-rows.start)*outWidth;
  for(let column=targetColumns.start;column<targetColumns.end;column++){
   const local=column-columns.start;let sum=0;
   if(local-radius<0||local+radius>=width)sum=NaN;
   else for(let k=-radius;k<=radius;k++)sum+=values[inputOffset+local+k]*weights[k+radius];
   horizontal[outputOffset+column-targetColumns.start]=sum;
  }
 }
 const output=new Float32Array(new values.buffer.constructor((targetRows.end-targetRows.start)*outWidth*4));
 for(let row=targetRows.start;row<targetRows.end;row++)for(let column=0;column<outWidth;column++){
  const local=row-rows.start;let sum=0;
  if(local-vertical.radius<0||local+vertical.radius>=height)sum=NaN;
  else for(let k=-vertical.radius;k<=vertical.radius;k++)sum+=horizontal[(local+k)*outWidth+column]*vertical.weights[k+vertical.radius];
  output[(row-targetRows.start)*outWidth+column]=sum;
 }
 return output;
}
// Geometry is prepared once per viewport and shared across levels/times. The
// bounded cache avoids retaining whole model grids when the user changes area.
export function vorticityGeometry(OM,config,window){
 const {target,y,x,width,height,period}=window,grid=OM.GridFactory.create(config),radius=config.projection?.radius??6371229;
 const count=(target[0].end-target[0].start)*(target[1].end-target[1].start);
 const coefficients=Array.from({length:7},()=>new Float32Array(count));
 const lat=new Float64Array(width*height),lon=new Float64Array(width*height);
 for(let j=0;j<height;j++)for(let i=0;i<width;i++){
  const column=period?((x.start+i)%period+period)%period:x.start+i,row=y.start+j,index=j*width+i;
  const projectedX=grid.minX+column*grid.dx,projectedY=grid.minY+row*grid.dy;
  // The bundled LAEA inverse has a removable 0/0 at its exact origin. Its
  // geographic position is the projection centre, not a missing model cell.
  const point=config.type==='regular'?[config.latMin+row*config.dy,config.lonMin+column*config.dx]
   :projectedX===0&&projectedY===0&&config.projection?.name==='LambertAzimuthalEqualAreaProjection'?[config.projection.ϕ1,config.projection.λ0]
   :grid.projection.reverse(projectedX,projectedY);
  lat[index]=point[0]*radians;lon[index]=point[1]*radians;
 }
 let out=0;
 for(let row=target[0].start;row<target[0].end;row++)for(let column=target[1].start;column<target[1].end;column++,out++){
  coefficients[0][out]=NaN;
  const j=row-y.start,i=column-x.start,k=j*width+i;
  if(!j||j===height-1||!i||i===width-1||Math.abs(Math.cos(lat[k]))<1e-6)continue;
  const w=k-1,e=k+1,s=k-width,n=k+width,cos=Math.cos(lat[k]);
  if(config.type==='regular'){
   // Three-point derivative on possibly unequal longitude intervals (ICON seam).
   const left=angle(lon[k]-lon[w]),right=angle(lon[e]-lon[k]),dy=lat[n]-lat[s];
   if(!left||!right||!dy)continue;
   coefficients[0][out]=-right/(left*(left+right)*cos*radius)*1e5; // v west
   coefficients[1][out]=left/(right*(left+right)*cos*radius)*1e5; // v east
   coefficients[2][out]=(right-left)/(left*right*cos*radius)*1e5; // v centre
   coefficients[3][out]=0; // v north - south
   coefficients[4][out]=0; // u east - west
   coefficients[5][out]=-1/(dy*radius)*1e5; // u north - south
  }else{
   // Invert the local geographic Jacobian. UKV winds are earth-relative,
   // not aligned to the Lambert azimuthal equal-area grid axes.
   const lx=angle(lon[e]-lon[w]),ly=angle(lon[n]-lon[s]),px=lat[e]-lat[w],py=lat[n]-lat[s],det=lx*py-ly*px;
   if(!Number.isFinite(det)||Math.abs(det)<1e-16)continue;
   const east=py/(det*cos*radius)*1e5;
   coefficients[0][out]=-east;coefficients[1][out]=east;coefficients[2][out]=0;
   coefficients[3][out]=-px/(det*cos*radius)*1e5;
   coefficients[4][out]=ly/(det*radius)*1e5;
   coefficients[5][out]=-lx/(det*radius)*1e5;
  }
  coefficients[6][out]=Math.tan(lat[k])/radius*1e5; // spherical metric term
 }
 return coefficients;
}
export function relativeVorticity(first,second,window,geometry,fromSpeedDirection=false){
 if(first.length!==window.width*window.height||second.length!==first.length)throw Error('Vorticity input grids do not match.');
 let u=first,v=second;
 if(fromSpeedDirection){
  u=new Float32Array(first.length);v=new Float32Array(first.length);
  for(let i=0;i<u.length;i++){
   const valid=Number.isFinite(first[i])&&first[i]>=0&&Number.isFinite(second[i]);
   u[i]=valid?-first[i]*Math.sin(second[i]*radians):NaN;v[i]=valid?-first[i]*Math.cos(second[i]*radians):NaN;
  }
 }
 const {target,x,y,width}=window,values=new Float32Array(new first.buffer.constructor(geometry[0].length*4));
 const [vw,ve,vc,vy,ux,uy,metric]=geometry;let out=0;
 for(let row=target[0].start;row<target[0].end;row++)for(let col=target[1].start;col<target[1].end;col++,out++){
  const k=(row-y.start)*width+col-x.start;
  // Never turn a missing source cell/neighbour into a zero or bridge a gap.
  values[out]=Number.isFinite(u[k]+v[k]+u[k-1]+u[k+1]+u[k-width]+u[k+width]+v[k-1]+v[k+1]+v[k-width]+v[k+width])
   ?vw[out]*v[k-1]+ve[out]*v[k+1]+vc[out]*v[k]+vy[out]*(v[k+width]-v[k-width])+ux[out]*(u[k+1]-u[k-1])+uy[out]*(u[k+width]-u[k-width])+metric[out]*u[k]:NaN;
 }
 return values;
}

const installed=new WeakSet();
export function installDiagnostics(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader;
 if(installed.has(reader))return;installed.add(reader);
 reader.allDerivationRules=[...(reader.allDerivationRules??[]),thetaWRule];
 const originalRead=reader.readVariable?.bind(reader),originalPrefetch=reader.prefetchVariable?.bind(reader),geometries=new Map();let geometryBytes=0;
 const selection=(url,variable,ranges)=>{
  const key=variable.replace(/_derived$/,''),level=key.match(/^relative_vorticity_(300|400)hPa$/);
  if(!level)return null;
  const domain=new URL(url).pathname.split('/data_spatial/')[1]?.split('/')[0],inputs=diagnosticInputs(domain,key);
  const config=settings.domainOptions?.find(option=>option.value===domain)?.grid;
  if(!inputs||!config)throw Error('Unsupported vorticity source grid.');
  const smoothing=vorticitySmoothing(config,ranges);
  return {domain,inputs,config,window:smoothing.window,smoothing};
 };
 const useInputs=async(url,spec,signal,prefetch=false)=>reader.withReader(url,async file=>{
  const children=[];
  try{
   // Await both settlements before disposing either child, including failure.
   const acquired=await Promise.allSettled(spec.inputs.map(key=>file.getChildByName(key)));
   for(const result of acquired)if(result.status==='fulfilled'&&result.value)children.push(result.value);
   const failure=acquired.find(result=>result.status==='rejected');if(failure)throw failure.reason;
   if(children.length!==2)throw Error('Pressure-level winds are unavailable.');
   for(const child of children){const dimensions=child.getDimensions();if(dimensions.length!==2||dimensions[0]!==spec.config.ny||dimensions[1]!==spec.config.nx)throw Error('Unexpected diagnostic input grid dimensions.');}
   const {window}=spec;
   const settled=await Promise.allSettled(children.map(async(child,index)=>{
    const values=prefetch||window.segments.length===1?null:new Float32Array(new (reader.config.useSAB?SharedArrayBuffer:ArrayBuffer)(window.width*window.height*4));
    for(const segment of window.segments){
     signal?.throwIfAborted();
     if(prefetch){await child.readPrefetch({ranges:segment.ranges,prefetchConcurrency:4,signal});continue;}
     // readSimpleVariable reads raw components (readVariable would turn U/V
     // into wind speed). Keep the bundled reader's data type/SAB configuration.
     const result=await reader.readSimpleVariable({getChildByName:async()=>({getDimensions:()=>child.getDimensions(),scaleFactor:()=>child.scaleFactor(),read:options=>child.read(options),dispose(){}})},spec.inputs[index],segment.ranges,signal);
     if(window.segments.length===1)return result.values;
     const width=segment.ranges[1].end-segment.ranges[1].start;
     for(let row=0;row<window.height;row++)values.set(result.values.subarray(row*width,(row+1)*width),row*window.width+segment.offset);
    }
    return values;
   }));
   const failed=settled.find(result=>result.status==='rejected');if(failed)throw failed.reason;
   return settled.map(result=>result.value);
  }finally{for(const child of children)child.dispose();}
 });
 reader.readVariable=async(url,variable,ranges=null,signal)=>{
  const spec=selection(url,variable,ranges);if(!spec)return originalRead(url,variable,ranges,signal);
  const inputs=await useInputs(url,spec,signal);signal?.throwIfAborted();
  const derivativeWindow=spec.smoothing.derivativeWindow;
  const key=JSON.stringify([spec.config,derivativeWindow.target]);let geometry=geometries.get(key);
  if(geometry){geometries.delete(key);geometries.set(key,geometry);}else{
   geometry=vorticityGeometry(OM,spec.config,derivativeWindow);
   const bytes=geometry.reduce((sum,a)=>sum+a.byteLength,0);
   while(geometryBytes+bytes>32*1024*1024&&geometries.size){const [old,arrays]=geometries.entries().next().value;geometryBytes-=arrays.reduce((sum,a)=>sum+a.byteLength,0);geometries.delete(old);}
   if(bytes<=32*1024*1024){geometries.set(key,geometry);geometryBytes+=bytes;}
  }
  const raw=relativeVorticity(...inputs,derivativeWindow,geometry,speedDirection.has(spec.domain));
  return {values:smoothVorticity(raw,spec.smoothing),directions:undefined,scaleFactor:100};
 };
 reader.prefetchVariable=async(url,variable,ranges=null,signal)=>{
  const spec=selection(url,variable,ranges);if(!spec)return originalPrefetch(url,variable,ranges,signal);
  await useInputs(url,spec,signal,true);
 };
}
