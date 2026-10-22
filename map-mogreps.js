// Precipitation is supplied by Open-Meteo; snowfall probabilities are counted
// directly from the Met Office's native member files by build_mogreps_snow.py.
export const MOGREPS_MODELS = [
 {id:'ukmo_uk_ensemble_2km',name:'MOGREPS-UK 2 km',ensemble:true,regional:true,snowDomain:'snowline_mogreps_uk',
  ensembleNote:'MOGREPS-UK uses only 3 members from this hourly run: grid probabilities are 0, 33, 67 or 100%. Map shading can interpolate between grid cells. Runs are not time-lagged together.'}
];

export const MOGREPS_SNOW_DOMAINS = [
 {value:'snowline_mogreps_uk',label:'MOGREPS-UK snowfall probability',grid:{type:'projectedFromProjectedOrigin',nx:1042,ny:970,latitudeProjectionOrigin:-1036000,longitudeProjectionOrigin:-1158000,dx:2000,dy:2000,zoom:4,projection:{'λ0':-2.5,'ϕ1':54.9,radius:6371229,name:'LambertAzimuthalEqualAreaProjection'}},time_interval:'hourly',model_interval:'hourly'}
];

export function verifiedSnowMetadata(meta,model){
 return meta?.format_version===1&&model.id==='ukmo_uk_ensemble_2km'&&meta.member_count===3&&meta.threshold_mm_per_hour===.1&&
  meta.variables?.length===1&&meta.variables[0]==='snowfall_probability'&&Number.isFinite(Date.parse(meta.reference_time))&&
  meta.valid_times?.length>0&&meta.valid_times.every(t=>Date.parse(t)>Date.parse(meta.reference_time)&&meta.intervals?.[t]===1);
}
