import {cachedJSON} from './cache.js?v=20261015-shared-cache';
export const MODELS = [
 ['ecmwf_ifs','IFS 9 km','#007a80'],['ecmwf_aifs025_single','ECMWF AIFS','#9450c6'],['icon_global','ICON global','#cc7116'],['gem_global','GEM global','#3778c2'],['gfs_global','GFS global','#d84758'],['ukmo_global_deterministic_10km','UKMO global','#25844c'],['ncep_aigfs025','NOAA AIGFS','#aa427d'],['jma_gsm','JMA GSM','#6a6b30'],['knmi_harmonie_arome_europe','KNMI HARMONIE','#008db6',true],['meteofrance_arpege_europe','ARPEGE Europe','#9e613e',true],['icon_eu','ICON Europe','#5855c5',true],['ukmo_uk_deterministic_2km','UKMO UKV 2 km','#078a7b',true],['ncep_hgefs025_ensemble_mean','HGEFS mean','#7b8491',false,true],['ecmwf_ifs025','IFS 0.25°','#363a8a'],['meteofrance_arome_france','AROME France','#bb7510',true],
 ['ecmwf_ifs025_ensemble_mean','EC ENS mean','#7c3aed',false,true,'ensemble'],
 ['mogreps_global_ensemble_mean','MOGREPS-G mean','#b52970',false,true,'mogreps'],
 ['ukmo_uk_ensemble_mean_2km','MOGREPS-UK 2 km mean','#98631d',true,true,'ensemble','2 km regional grid; hourly mean of the 3 members supplied per cycle by Open-Meteo. Around 5 days of forecasts; snow depth and 850/500 hPa temperatures unavailable.']
].map(([id,name,color,regional=false,ensemble=false,api='forecast',detail=''])=>({id,name,color,regional,ensemble,api,detail}));
export const VARIABLES = [
 {key:'snowfall',title:'Snowfall rate',unit:'cm / hour',note:'New snow; MOGREPS-G shows the preceding 3 h average rate (7:1 snow-to-water equivalent)',floor:0,minRange:0.2},
 {key:'snow_depth',title:'Snow depth',unit:'cm',note:'Snow on the ground, including existing cover',floor:0,minRange:1},
 {key:'temperature_2m',title:'2 m air temperature',unit:'°C',note:'Near-surface air, not road-surface temperature',minRange:4},
 {key:'dew_point_2m',title:'2 m dew point',unit:'°C',note:'Moisture context for frost and evaporative cooling',minRange:4},
 {key:'precipitation',title:'Total precipitation',unit:'mm / hour',note:'Rain, showers and snow water equivalent; MOGREPS-G shows the preceding 3 h average rate',floor:0,minRange:0.5},
 {key:'cloud_cover',title:'Total cloud cover',unit:'%',note:'Watch for clearing after rain and overnight cooling',floor:0,ceiling:100,minRange:20},
 {key:'wind_speed_10m',title:'10 m wind speed',unit:'mph',note:'Wind speed at 10 m above ground',floor:0,minRange:5},
 {key:'wind_gusts_10m',title:'10 m wind gusts',unit:'mph',note:'Maximum gust in the preceding hour; availability varies by model',floor:0,minRange:5},
 {key:'wind_direction_10m',title:'10 m wind direction',unit:'°',note:'Dots show each model; direction the wind comes from (N = 0° / 360°)',floor:0,ceiling:360,minRange:360,direction:true},
 {key:'relative_humidity_2m',title:'2 m relative humidity',unit:'%',note:'Moisture context alongside the minimum temperature',floor:0,ceiling:100,minRange:20},
 {key:'soil_temperature_0cm',title:'0 cm soil temperature',unit:'°C',note:'Modelled ground proxy; not a road or pavement forecast',minRange:4},
 {key:'pressure_msl',title:'Mean sea-level pressure',unit:'hPa',note:'Mean sea-level pressure from each available model, with the selected-model average',absolute:true,minRange:8},
 {key:'temperature_850hPa',title:'850 hPa temperature',unit:'°C',note:'Upper-air context; this level may lie below high terrain. MOGREPS-G: native 3 h steps',absolute:true,minRange:4},
 {key:'temperature_500hPa',title:'500 hPa temperature',unit:'°C',note:'Mid-tropospheric temperature. MOGREPS-G: native 3 h steps; gaps stay unavailable',absolute:true,minRange:4}
];
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export function windMph(value,unit){
 if(!finite(value))return null;
 if(unit==='mp/h'||unit==='mph')return value;
 if(unit==='km/h'||unit==='kmh')return value/1.609344;
 if(unit==='m/s'||unit==='ms')return value*3600/1609.344;
 if(unit==='kn'||unit==='knots')return value*1.852/1.609344;
 return null; // Never label a value as mph when its source unit is unknown.
}
export function parseCoordinates(query){
 const m=query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);if(!m)return null;
 const latitude=Number(m[1]),longitude=Number(m[2]);if(Math.abs(latitude)>90||Math.abs(longitude)>180)throw new Error('Latitude must be −90 to 90 and longitude −180 to 180.');
 return {latitude,longitude,name:`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`};
}
export function normalise(json,model){
 if(!json.hourly?.time?.length)throw new Error('No hourly forecast returned.');
 const data={...model,time:json.hourly.time.map(t=>new Date(t.endsWith('Z')?t:t+'Z').toISOString().replace('.000Z','Z')),values:{},latitude:json.latitude,longitude:json.longitude,elevation:json.elevation,fetchedAt:json._retrievedAt,stale:!!json._stale,source:json._source,refreshError:json._refreshError,retryAt:json._retryAt};
 for(const v of VARIABLES){
  const raw=json.hourly[v.key]??[],unit=json.hourly_units?.[v.key];
  data.values[v.key]=data.time.map((_,i)=>{
   if(!finite(raw[i]))return null;
   if(v.direction)return raw[i]>=0&&raw[i]<=360?raw[i]%360:null;
   if(v.unit==='mph')return windMph(raw[i],unit);
   return v.key==='snow_depth'&&unit==='m'?raw[i]*100:raw[i];
  });
 }
 data.index=new Map(data.time.map((t,i)=>[t,i]));
 return data;
}
export function valueAt(model,key,time){
 // A constant rate over its explicit native period conserves the 3 h amount.
 // Temperature remains sampled only at the supplied instants.
 let stamp=time;
 if(model.intervalHours===3&&['precipitation','snowfall'].includes(key))stamp=new Date(Math.ceil(Date.parse(time)/10800000)*10800000).toISOString().replace('.000Z','Z');
 const i=model.index?.get(stamp);return i===undefined?null:model.values[key]?.[i]??null;
}
export function agreement(models,time){const eligible=models.filter(m=>!m.ensemble&&finite(valueAt(m,'snowfall',time)));const snow=eligible.filter(m=>valueAt(m,'snowfall',time)>=0.1);return {valid:eligible.length,snow:snow.length,percent:eligible.length?100*snow.length/eligible.length:null};}
export async function fetchJSON(url,signal,options={}){
 return cachedJSON(url,{signal,...options,kind:url.includes('geocoding-api')?'search':'forecast'});
}
export function forecastURL(location,model){
 if(model.api==='mogreps')throw Error('MOGREPS-G uses the native Met Office service.');
 const endpoint=model.api==='ensemble'?'https://ensemble-api.open-meteo.com/v1/ensemble':'https://api.open-meteo.com/v1/forecast';
 return endpoint+'?'+new URLSearchParams({latitude:location.latitude,longitude:location.longitude,hourly:VARIABLES.map(v=>v.key).join(','),models:model.id,forecast_days:'8',timezone:'GMT',temperature_unit:'celsius',precipitation_unit:'mm',wind_speed_unit:'mph'});
}
