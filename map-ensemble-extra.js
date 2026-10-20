// Native cells cropped to include all four map areas; no interpolation in time.
export const ENSEMBLE_EXTRAS={snowline_gefs_ensemble:'snowline_gefs_extra_v2',snowline_ecmwf_ensemble:'snowline_ecmwf_extra_v2'};
export const ENSEMBLE_EXTRA_DOMAINS=[
 {value:'snowline_gefs_extra_v2',label:'GEFS additional fields',grid:{type:'regular',nx:205,ny:87,latMin:31,lonMin:-66,dx:.5,dy:.5,zoom:1},time_interval:'3_hourly',model_interval:'6_hourly'},
 {value:'snowline_ecmwf_extra_v2',label:'ECMWF ENS additional fields',grid:{type:'regular',nx:409,ny:173,latMin:31,lonMin:-66,dx:.25,dy:.25,zoom:2},time_interval:'3_hourly',model_interval:'12_hourly'}
];
const colors=['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643'];
const blue=['#ffffff','#dbeefd','#9ecae1','#4292c6','#2171b5','#08519c','#08306b'];
const spread=['#ffffff','#dceaf2','#9ecae1','#4292c6','#5460ab','#8f479d','#d4486b','#9e1538'];
const definitions={
 wind_speed_300hPa:['300 hPa wind speed','m/s',[0,10,20,30,40,50,70,90],10],
 wind_speed_200hPa:['200 hPa wind speed','m/s',[0,10,20,30,40,50,70,90],10],
 temperature_2m:['2 m air temperature','°C',[-20,-10,-5,0,5,10,20,30],2],
 dew_point_2m:['2 m dew point','°C',[-20,-10,-5,0,5,10,20,30],2],
 relative_humidity_2m:['2 m relative humidity','%',[0,20,40,60,70,80,90,100],10],
 cloud_cover:['Total cloud cover','%',[0,20,40,60,75,85,95,100],20],
 snow_depth:['Snow depth','cm',[0,1,2,5,10,20,50,100],10],
 cape:['CAPE','J/kg',[0,100,250,500,750,1000,2000,3000],250],
 wind_vector_10m:['10 m mean wind · vector magnitude','m/s',[0,2,5,10,15,20,25,35],5],
 wind_speed_10m:['10 m wind speed','m/s',[0,2,5,10,15,20,25,35],5],
 wind_gusts_10m:['10 m wind gusts','m/s',[0,2,5,10,15,20,25,35],5],
 geopotential_height_300hPa:['300 hPa height','m',[8100,8400,8700,9000,9300,9600,9900,10200],120],
 geopotential_height_1000hPa:['1000 hPa height','m',[-400,-300,-200,-100,0,100,200,300],40],
 temperature_500hPa:['500 hPa temperature','°C',[-60,-50,-40,-35,-30,-25,-20,-10],4],
 temperature_250hPa:['250 hPa temperature','°C',[-80,-70,-60,-55,-50,-45,-40,-30],4],
 wind_speed_250hPa:['250 hPa wind speed','m/s',[0,10,20,30,40,50,70,90],10],
 wind_speed_850hPa:['850 hPa wind speed','m/s',[0,2,5,10,15,20,25,35],5]
};
export const ensembleProbabilityThreshold=key=>Number(/^precipitation_probability_(1|5|10|20|25|50|100)mm_24h$/.exec(key)?.[1])||null;
export function extraEnsembleField(key){
 const threshold=ensembleProbabilityThreshold(key);
 if(threshold)return {key,name:'24 h precipitation ≥ '+threshold+' mm · probability',unit:'%',group:'Ensemble probabilities',
  ensembleStatistic:'probability',threshold,periodHours:24,stops:[0,10,25,50,75,90,100],colors:blue,contourValues:[10,25,50,75,90],contourLabel:'10, 25, 50, 75 and 90%',
  note:'Official ECMWF probability of total precipitation reaching at least '+threshold+' mm in the 24 hours ending at the valid time. Includes rain and frozen water equivalent. Available every 12 hours; no hourly interpolation.'};
 const m=/^(.*)_(mean|spread)$/.exec(key);if(!m)return null;
 const base=m[1],sd=m[2]==='spread';
 if(['precipitation','snowfall_water_equivalent'].includes(base)&&!sd)return {key,name:(base==='precipitation'?'Total precipitation':'Snowfall water equivalent')+' · ensemble mean',unit:'mm/h',group:'Ensemble mean',ensembleStatistic:'mean',
  stops:[0,.1,.25,.5,1,2,4,8],colors:['#ffffff','#dbeefd','#91c5f4','#2162b5','#21835b','#a5bd45','#e48735','#ad2738'],contourValues:[.1,.25,.5,1,2,4,8],contourLabel:'precipitation rate thresholds',
  note:'Mean across ensemble members, expressed as mm/h over the stated reporting period. Longer intervals show an average rate, not hourly detail. '+(base==='precipitation'?'Includes liquid and frozen water equivalent.':'Liquid-water equivalent of falling snow, not snow depth or settling risk.')};
 const d=definitions[base];if(!d)return null;
 // Only upper-air fields are supplied as extra spreads.
 if(sd&&!/hPa$/.test(base))return null;
 const [name,unit,mean,step]=d,stops=sd?(unit==='m'?[0,10,20,40,60,90,120,180]:[0,.5,1,2,3,4,6,8]):mean;
 let note=sd?'Standard deviation of ensemble members. Higher values indicate greater disagreement; this is not a probability.':'Mean of contributing ensemble members; individual weather features are smoothed.';
 if(base==='wind_vector_10m')note='Magnitude of NOAA’s ensemble-mean wind vector. Opposing member winds can cancel; this differs from averaging member wind speeds.';
 if(/^wind_speed_/.test(base)&&!sd)note='Arithmetic mean of member wind speeds. Direction arrows are not defined for this scalar mean.';
 if(base==='wind_gusts_10m')note='Mean of the members’ maximum gusts over the stated source reporting period. This is not a probability of a strong gust.';
 if(base==='snow_depth')note='Mean model snow depth on the ground, in centimetres. Missing cells remain unavailable.';
 if(base==='cape')note+=' CAPE indicates instability, not thunderstorm probability.';
 return {key,name:name+' · '+(sd?'ensemble spread (SD)':'ensemble mean'),unit,group:sd?'Ensemble spread':'Ensemble mean',ensembleStatistic:sd?'spread':'mean',
  stops,colors:sd?spread:base==='cloud_cover'?['#263c55','#3b5573','#56738e','#7391ac','#96b1c7','#bdcfdf','#dce9f1','#ffffff']:colors,
  contourValues:sd?stops.slice(1):Array.from({length:Math.floor((stops.at(-1)-stops[0])/step)+1},(_,i)=>stops[0]+i*step),contourLabel:step+' '+unit,note};
}
export function verifiedEnsembleExtra(meta,domain,reference){
 return meta?.format_version===2&&meta.domain===domain&&Date.parse(meta.reference_time)===Date.parse(reference)&&
  meta.member_count===(domain==='snowline_gefs_extra_v2'?30:51)&&Array.isArray(meta.variables)&&Array.isArray(meta.valid_times)&&
  meta.variables.every(key=>Array.isArray(meta.variable_valid_times?.[key])&&meta.variable_valid_times[key].every(time=>meta.valid_times.includes(time)));
}
export function ensemblePeriod(meta,key,time){
 const sources=meta?.sources??[meta];
 const source=sources.find(s=>s?.variables?.includes(key)&&s.variable_valid_times?.[key]?.some(t=>Date.parse(t)===Date.parse(time)));
 if(!source)return null;
 const stamp=source.variable_valid_times[key].find(t=>Date.parse(t)===Date.parse(time));
 return source.variable_intervals?.[key]?.[stamp]??null;
}
export function ensemblePeriodLabel(meta,key,time){
 const p=ensemblePeriod(meta,key,time);if(!p)return '';
 const start=new Date(p.start).toISOString().slice(5,16).replace('T',' '),end=new Date(p.end).toISOString().slice(5,16).replace('T',' ');
 const threshold=ensembleProbabilityThreshold(key);
 return (threshold?'≥'+threshold+' mm / ':'')+p.hours+' h · '+start+' to '+end+' UTC';
}
