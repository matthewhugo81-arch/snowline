// UKMO spatial files contain temperature (Celsius) and relative humidity (%).
// Keep a separate virtual key so a supplied native dew-point field always wins.
export const DERIVED_DEW_POINT='dew_point_2m_derived';
export function canDeriveDewPoint(meta){
 return ['ukmo_uk_deterministic_2km','ukmo_global_deterministic_10km'].includes(meta?.domain)
  && ['temperature_2m','relative_humidity_2m'].every(key=>meta.variables?.includes(key));
}
// Same Magnus coefficients as Open-Meteo's Meteorology.dewpoint:
// https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Meteorology.swift
export function dewPointCelsius(temperature,humidity){
 if(!Number.isFinite(temperature)||!Number.isFinite(humidity)||temperature<=-243.04||humidity<=0)return NaN;
 const rh=Math.min(humidity,100);
 if(rh===100)return temperature;
 const gamma=Math.log(rh/100)+17.625*temperature/(243.04+temperature);
 return 243.04*gamma/(17.625-gamma);
}
export const dewPointRule={
 pattern:/^dew_point_2m_derived$/,
 provides:{directions:false,barbs:false},scaleFactor:'primary',
 getSourceVars:()=>['temperature_2m','relative_humidity_2m'],
 process(temperature,humidity){
  if(temperature.length!==humidity.length)throw Error('Dew-point input grids do not match.');
  const values=new Float32Array(new temperature.buffer.constructor(temperature.byteLength));
  for(let i=0;i<values.length;i++)values[i]=dewPointCelsius(temperature[i],humidity[i]);
  return {values,directions:undefined};
 }
};
export function installDewPoint(OM,settings){
 const reader=OM.getProtocolInstance(settings).omFileReader;
 if(!reader.allDerivationRules?.some(rule=>rule.pattern.toString()===dewPointRule.pattern.toString()))
  reader.allDerivationRules=[...(reader.allDerivationRules??[]),dewPointRule];
}
