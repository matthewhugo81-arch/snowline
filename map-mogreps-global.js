export const MOGREPS_GLOBAL='snowline_mogreps_global';
export const MOGREPS_GLOBAL_DOMAIN={value:MOGREPS_GLOBAL,label:'MOGREPS-G mean, spread & probabilities',
 grid:{type:'regular',nx:365,ny:232,lonMin:-66.234375,latMin:30.84375,dx:.28125,dy:.1875,zoom:2},
 time_interval:'3_hourly',model_interval:'6_hourly'};
export const MOGREPS_GLOBAL_PERIOD_FIELDS=['precipitation_mean','snowfall_water_equivalent_mean','precipitation_probability','snowfall_probability'];
export const MOGREPS_GLOBAL_FIELDS=['temperature_850hPa_mean','temperature_850hPa_spread','temperature_500hPa_mean','temperature_500hPa_spread',...MOGREPS_GLOBAL_PERIOD_FIELDS];
export const MOGREPS_GLOBAL_NOTE='MOGREPS-G · 18 members from one run. Native 3 h steps. Mean and population SD; rain/snow probabilities are raw member fractions ≥0.1 mm/h over the preceding 3 h, not calibrated probabilities. Snow is liquid-water equivalent. Native cells cover the UK, Europe and North Atlantic map areas.';
export function verifiedMogrepsGlobal(meta){
 const run=Date.parse(meta?.reference_time),members=new Date(run).getUTCHours()%12===0?Array.from({length:18},(_,i)=>i):[0,...Array.from({length:17},(_,i)=>i+18)];
 if(meta?.format_version!==2||meta.domain!==MOGREPS_GLOBAL||!Number.isFinite(run)||run%21600000!==0||
  meta.member_count!==18||JSON.stringify(meta.member_ids)!==JSON.stringify(members)||meta.threshold_mm_per_hour!==.1||
  !Array.isArray(meta.variables)||!meta.variables.length||!Array.isArray(meta.valid_times)||!meta.valid_times.length)return false;
 if(Object.entries(MOGREPS_GLOBAL_DOMAIN.grid).some(([k,v])=>meta.grid?.[k]!==v))return false;
 if(meta.valid_times.some((t,i)=>!Number.isFinite(Date.parse(t))||Date.parse(t)<run||Date.parse(t)>run+246*3600000||(Date.parse(t)-run)%10800000!==0||(i&&Date.parse(t)<=Date.parse(meta.valid_times[i-1]))))return false;
 return meta.variables.every(key=>MOGREPS_GLOBAL_FIELDS.includes(key)&&Array.isArray(meta.variable_valid_times?.[key])&&meta.variable_valid_times[key].length&&meta.variable_valid_times[key].every(time=>{
  if(!meta.valid_times.includes(time))return false;
  if(!MOGREPS_GLOBAL_PERIOD_FIELDS.includes(key))return true;
  const p=meta.variable_intervals?.[key]?.[time];
  return p?.hours===3&&Date.parse(p.end)===Date.parse(time)&&Date.parse(p.start)===Date.parse(time)-10800000&&Date.parse(p.start)>=run;
 }));
}
