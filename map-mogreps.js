// Precipitation is supplied by Open-Meteo; snowfall probabilities are counted
// directly from the Met Office's native member files by build_mogreps_snow.py.
export const MOGREPS_MODELS = [
 {id:'ukmo_global_ensemble_20km',name:'MOGREPS-G 20 km · precipitation & snow probability',ensemble:true,snowDomain:'snowline_mogreps_global',
  ensembleNote:'MOGREPS-G uses 18 members from this run; member fractions change in steps of about 5.6%. Map shading can interpolate between grid cells.'},
 {id:'ukmo_uk_ensemble_2km',name:'MOGREPS-UK 2 km · precipitation & snow probability',ensemble:true,regional:true,snowDomain:'snowline_mogreps_uk',
  ensembleNote:'MOGREPS-UK uses only 3 members from this hourly run: grid probabilities are 0, 33, 67 or 100%. Map shading can interpolate between grid cells. Runs are not time-lagged together.'}
];

export const MOGREPS_SNOW_DOMAINS = [
 {value:'snowline_mogreps_global',label:'MOGREPS-G snowfall probability',grid:{type:'regular',nx:1280,ny:960,latMin:-89.90625,lonMin:-179.859375,dx:.28125,dy:.1875,zoom:1},time_interval:'hourly',model_interval:'6_hourly'},
 {value:'snowline_mogreps_uk',label:'MOGREPS-UK snowfall probability',grid:{type:'projectedFromProjectedOrigin',nx:1042,ny:970,latitudeProjectionOrigin:-1036000,longitudeProjectionOrigin:-1158000,dx:2000,dy:2000,zoom:4,projection:{'λ0':-2.5,'ϕ1':54.9,radius:6371229,name:'LambertAzimuthalEqualAreaProjection'}},time_interval:'hourly',model_interval:'hourly'}
];

export function verifiedSnowMetadata(meta,model){
 return meta?.format_version===1&&meta.member_count===(model.regional?3:18)&&meta.threshold_mm_per_hour===.1&&
  meta.variables?.length===1&&meta.variables[0]==='snowfall_probability'&&Number.isFinite(Date.parse(meta.reference_time))&&
  meta.valid_times?.length>0&&meta.valid_times.every(t=>Date.parse(t)>Date.parse(meta.reference_time)&&[1,3].includes(meta.intervals?.[t]));
}
