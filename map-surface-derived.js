// Derived from two native arrays in one spatial file. Restrict availability to
// the verified IFS 9 km feed; native variables take precedence in the catalogue.
export const SURFACE_DERIVED_KEYS=['relative_humidity_2m','diffuse_radiation'];
const inputs={
 relative_humidity_2m:['temperature_2m','dew_point_2m'],
 diffuse_radiation:['shortwave_radiation','direct_radiation']
};
export function surfaceDerivedVariable(meta,key){
 return meta?.domain==='ecmwf_ifs'&&inputs[key]?.every(k=>meta.variables?.includes(k))?key+'_derived':null;
}
// Same Magnus coefficients and saturation bound as Open-Meteo Meteorology.swift.
export function humidityFromDewPoint(temperature,dewpoint){
 if(!Number.isFinite(temperature)||!Number.isFinite(dewpoint)||temperature<=-243.04||dewpoint<=-243.04)return NaN;
 return Math.min(100,Math.max(0,100*Math.exp(17.625*dewpoint/(243.04+dewpoint)-17.625*temperature/(243.04+temperature))));
}
export function diffuseFromRadiation(total,direct){
 if(!Number.isFinite(total)||!Number.isFinite(direct)||total<0||direct<0)return NaN;
 // Permit a single W/m² of native packing roundoff, not inconsistent inputs.
 return direct>total+1?NaN:Math.max(0,total-direct);
}
export const surfaceDerivedRules=SURFACE_DERIVED_KEYS.map(key=>({
 pattern:new RegExp('^'+key+'_derived$'),provides:{directions:false,barbs:false},
 scaleFactor:key==='relative_humidity_2m'?100:1,getSourceVars:()=>inputs[key],
 process(first,second){
  if(first.length!==second.length)throw Error('Surface diagnostic input grids do not match.');
  const values=new Float32Array(new first.buffer.constructor(first.byteLength));
  const calculate=key==='relative_humidity_2m'?humidityFromDewPoint:diffuseFromRadiation;
  for(let i=0;i<values.length;i++)values[i]=calculate(first[i],second[i]);
  return {values,directions:undefined};
 }
}));
export function installSurfaceDerived(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader;
 for(const rule of surfaceDerivedRules)if(!reader.allDerivationRules?.some(r=>String(r.pattern)===String(rule.pattern)))
  reader.allDerivationRules=[...(reader.allDerivationRules??[]),rule];
}
