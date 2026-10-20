// Match the reference chart: pressure velocity in 0.1 Pa/s (microbar/s).
// Negative = ascent (red); positive = descent (blue). JMA's spatial arrays
// retain omega in Pa/s; the other five feeds store geometric w in m/s.
import {verifiedDirectVertical,DIRECT_VERTICAL_DOMAINS} from './map-direct-vertical.js?v=20261020-comparison-feeds';
export const VERTICAL_MOTION='vertical_motion_700hPa';
export const VERTICAL_DOMAINS=Object.freeze(['ncep_gfs025','ecmwf_ifs025','ecmwf_aifs025_single','ncep_aigfs025','ukmo_global_deterministic_10km','jma_gsm']);
export const HEIGHT_700='geopotential_height_700hPa';
export const WIND_700='wind_speed_700hPa';
export const HEIGHT_700_CONTOURS=Array.from({length:51},(_,i)=>2000+i*40);
export function verticalMotionInputs(domain){
 if(!VERTICAL_DOMAINS.includes(domain))return null;
 return ['vertical_velocity_700hPa','temperature_700hPa',HEIGHT_700,
  ...(domain==='ukmo_global_deterministic_10km'?['wind_speed_700hPa','wind_direction_700hPa']:['wind_u_component_700hPa','wind_v_component_700hPa'])];
}
export function verticalMotionVariable(meta){
 if(DIRECT_VERTICAL_DOMAINS.some(d=>d.value===meta?.domain))return verifiedDirectVertical(meta)&&meta.variables.includes('omega_700hPa')?'omega_700hPa':null;
 const inputs=verticalMotionInputs(meta?.domain);
 return inputs?.every(key=>meta.variables?.includes(key))?(meta.domain==='jma_gsm'?'omega_700hPa_from_pressure':'omega_700hPa_from_w'):null;
}
export function verticalMotionField(){return {
 key:VERTICAL_MOTION,name:'700 hPa vertical motion, height & wind',group:'Derived diagnostics',unit:'0.1 Pa/s',bands:true,
 stops:[-80,-40,-20,-10,-5,-2.5,-1,1,2.5,5,10,20,40,80],
 colors:['#990000','#e00000','#ff3333','#ff7777','#ffaaaa','#ffdddd','#ffffff','#eeeeff','#ccccff','#9999ff','#6666ff','#3333ff','#0000dd','#000099'],
 contourValues:[-80,-40,-20,-10,-5,-2.5,-1,1,2.5,5,10,20,40,80],
 contourLabel:'optional grey vertical-motion contours at the colour thresholds; black 700 hPa heights every 4 dam',
 legendNote:'Black contours: 700 hPa height (dam), every 4 dam · blue wind barbs: knots. Red / negative = ascent · blue / positive = descent · white: −1 to +1 · 1 unit = 0.1 Pa/s = 1 μbar/s. End colours extend beyond ±80.',
 note:'700 hPa pressure vertical velocity (omega). Red/negative = rising air; blue/positive = sinking air. Black height contours every 4 dam (40 m); blue wind barbs in knots (half barb 5, full barb 10, pennant 50). All layers use the same model, run and valid time. Geometric velocity is converted with same-time 700 hPa temperature using hydrostatic dry-air density; JMA and the direct GEM/ICON Europe feeds already supply pressure velocity. Ascent can highlight active fronts, convection or terrain forcing; interpret with humidity and precipitation. This pressure surface can lie below high terrain.'
};}
export function omegaMicrobars(velocity,temperature,pressureNative=false){
 if(!Number.isFinite(velocity)||!Number.isFinite(temperature)||temperature<=-273.15)return NaN;
 if(velocity===0)return 0;
 // Inverse of Open-Meteo Meteorology.verticalVelocityPressureToGeometric.
 return pressureNative?velocity*10:-70000*9.80665*velocity/(287.058*(temperature+273.15))*10;
}
export const verticalMotionRules=[false,true].map(pressureNative=>({
 pattern:pressureNative?/^omega_700hPa_from_pressure$/:/^omega_700hPa_from_w$/,
 provides:{directions:false,barbs:false},scaleFactor:100,
 getSourceVars:()=>['vertical_velocity_700hPa','temperature_700hPa'],
 process(velocity,temperature){
  if(velocity.length!==temperature.length)throw Error('Vertical-motion input grids do not match.');
  const values=new Float32Array(new velocity.buffer.constructor(velocity.byteLength));
  for(let i=0;i<values.length;i++)values[i]=omegaMicrobars(velocity[i],temperature[i],pressureNative);
  return {values,directions:undefined};
 }
}));
export function installVerticalMotion(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader;
 for(const rule of verticalMotionRules)if(!reader.allDerivationRules?.some(item=>String(item.pattern)===String(rule.pattern)))
  reader.allDerivationRules=[...(reader.allDerivationRules??[]),rule];
}
// These URLs are made by the same cycle-aware builder as the shaded layer.
export function verticalMotionOverlayURLs(field,urlFor){
 if(field!==VERTICAL_MOTION)return {};
 const change=(url,params)=>{const [base,query='']=url.split('?'),search=new URLSearchParams(query);for(const [key,value]of Object.entries(params))search.set(key,value);return base+'?'+search;};
 return {
  heightURL:change(urlFor(HEIGHT_700),{intervals:HEIGHT_700_CONTOURS.join(','),arrows:'false',contours:'true',vertical_style:'700-v1'}),
  windURL:change(urlFor(WIND_700),{arrows:'true',arrow_style:'barb',contours:'false',vertical_style:'700-v1'})
 };
}
