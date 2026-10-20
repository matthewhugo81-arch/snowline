import {JET_WIND_SCALE} from './map-chart-style.js?v=20261020-surface-wind110';
import {extraEnsembleField} from './map-ensemble-extra.js?v=20261020-native-levels';
import {MOGREPS_GLOBAL_DOMAIN} from './map-mogreps-global.js?v=20261020-native-levels';
// Same native global grids as the official GEFS/IFS mean and SD GRIB products.
export const ENSEMBLE_DOMAINS = [
 {value:'snowline_gefs_ensemble',label:'GEFS mean & spread',grid:{type:'regular',nx:720,ny:361,latMin:-90,lonMin:-180,dx:.5,dy:.5,zoom:1},time_interval:'3_hourly',model_interval:'6_hourly'},
 {value:'snowline_ecmwf_ensemble',label:'ECMWF ENS mean & spread',grid:{type:'regular',nx:1440,ny:721,latMin:-90,lonMin:-180,dx:.25,dy:.25,zoom:2},time_interval:'3_hourly',model_interval:'12_hourly'},
 MOGREPS_GLOBAL_DOMAIN
];
const spreadColors=['#ffffff','#dceaf2','#9ecae1','#4292c6','#5460ab','#8f479d','#d4486b','#9e1538'];
const meanColors=['#6148ae','#3163b5','#368fc1','#77cee1','#e8f3ec','#ffdc81','#ee9755','#c74643'];
const definitions={
 geopotential_height_500hPa:{name:'500 hPa height',unit:'m',mean:[4800,4980,5160,5340,5520,5700,5880,6060],spread:[0,10,20,40,60,90,120,180],step:60,spreadStep:20},
 temperature_850hPa:{name:'850 hPa temperature',unit:'°C',mean:[-30,-20,-10,-5,0,5,10,20],spread:[0,.5,1,2,3,4,6,8],step:2,spreadStep:1},
 pressure_msl:{name:'Mean sea-level pressure',unit:'hPa',mean:[940,960,980,1000,1010,1020,1040,1060],spread:[0,1,2,4,6,8,12,20],step:4,spreadStep:2}
};
export function ensembleField(key){
 if(key==='geopotential_height_500hPa_anomaly_mean')return {key,name:'500 hPa height anomaly · ensemble mean (1991–2020)',unit:'m',group:'Ensemble mean',ensembleStatistic:'mean',
  stops:[-300,-200,-150,-100,-50,0,50,100,150,200,300],colors:['#302080','#244bb8','#3687d0','#76b7de','#c7e3f1','#ffffff','#fee2b5','#f8b86c','#ed7844','#ce3836','#841e48'],
  contourValues:[-300,-200,-100,0,100,200,300],contourLabel:'100 m',
  note:'MOGREPS-G 18-member mean 500 hPa height minus NOAA NCEP/NCAR Reanalysis 1 daily 1991–2020 climatology, in metres. The baseline is bilinearly interpolated to the native forecast grid; forecast cells are not smoothed. This is an anomaly from climatology, not ensemble spread or a model-bias-corrected anomaly.'};
 const extra=extraEnsembleField(key);if(extra)return /^wind_speed_(300|200)hPa_mean$/.test(key)?{...extra,...JET_WIND_SCALE,contourValues:JET_WIND_SCALE.stops.slice(1),contourLabel:'15 mph from 60 to 180 mph'}:extra;
 const match=key.match(/^(.*)_(mean|spread)$/),d=definitions[match?.[1]];
 if(!d)return null;
 const spread=match[2]==='spread',stops=spread?d.spread:d.mean,step=spread?d.spreadStep:d.step;
 const min=spread?0:Math.floor(stops[0]/step)*step,max=stops.at(-1);
 return {key,name:d.name+' · '+(spread?'ensemble spread (SD)':'ensemble mean'),unit:d.unit,stops,colors:spread?spreadColors:meanColors,
  ensembleStatistic:spread?'spread':'mean',isPressure:!spread&&match[1]==='pressure_msl',
  contourValues:Array.from({length:Math.ceil((max-min)/step)+1},(_,i)=>min+i*step),contourLabel:step+' '+d.unit,
  note:spread?'Standard deviation of ensemble members, in '+d.unit+'. Higher values indicate greater disagreement; this is not a probability or a forecast anomaly.':'Ensemble mean: the average of the contributing members, which smooths individual weather features.',
  group:spread?'Ensemble spread':'Ensemble mean'};
}

// Publication health never changes the initialization time of actual pixels.
export function ensemblePublicationStatus(meta,health,now=Date.now()){
 const checked=Date.parse(health?.checked_at),row=health?.models?.find(r=>r.model===meta?.domain);
 const status=(code,label,message)=>({code,label,message,checked_at:health?.checked_at??null});
 if(row?.index_refresh_needed&&Date.parse(row?.official_source_reference)>Date.parse(meta?.reference_time))return status('index-pending','new run awaiting indexing','A complete newer Met Office run awaits indexing; showing the last verified forecast');
 if(row?.source_reference&&Date.parse(row.source_reference)>Date.parse(meta?.reference_time))return status('newer-run','new run pending','Newer official ensemble run awaits publication');
 const published=new Set((meta?.valid_times??[]).map(Date.parse));
 if(Date.parse(row?.source_reference)===Date.parse(meta?.reference_time)&&row?.source_hours?.some(h=>!published.has(Date.parse(meta.reference_time)+h*3600000)))return status('hours-pending','more hours pending','Additional official forecast hours await publication');
 if(row?.status==='check-failed')return status('check-failed','source check failed','Official ensemble source check failed; showing verified data');
 const age=now-Date.parse(meta?.reference_time),limit=meta?.domain==='snowline_gefs_ensemble'?12:20;
 if(age>limit*3600000)return status('run-age','older run','Ensemble initialization age exceeds the '+limit+' h review threshold');
 if(!Number.isFinite(checked)||!row)return status('check-unavailable','check unavailable','Ensemble source check is unavailable; showing verified published data');
 if(now-checked>45*60000)return status('check-overdue','check overdue','Ensemble source check is over 45 minutes old. Scheduled publication may be delayed; this does not by itself establish that a newer model run is available.');
 return null;
}
export function ensembleFreshnessWarning(meta,health,now=Date.now()){
 return ensemblePublicationStatus(meta,health,now)?.message??null;
}
