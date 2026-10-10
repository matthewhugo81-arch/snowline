// Describe the data actually supplied; this module NEVER selects a model run.
// UKV run families: https://registry.opendata.aws/met-office-uk-deterministic/
export function ukvCoverageText(meta,family=null){
 const reference=Date.parse(meta?.reference_time);
 const times=(meta?.valid_times??[]).map(value=>Date.parse(value)).filter(Number.isFinite);
 if(!Number.isFinite(reference)||!times.length)return 'Forecast coverage unavailable.';
 const hours=(Math.max(...times)-reference)/3600000;
 if(hours<0)return 'Forecast coverage unavailable.';
 const hour=new Date(reference).getUTCHours();
 const kind=hours===12&&![0,3,6,9,12,15,18,21].includes(hour)?'12-hour nowcast run':hours===54&&[0,6,9,12,18,21].includes(hour)?'54-hour short-range run':hours===120&&[3,15].includes(hour)?'120-hour medium-range run':'Feed currently reaches T+'+hours+' hours';
 return kind+'. '+(family==='main'?'Latest completed main cycle only':family==='nowcast'?'Latest completed hourly nowcast cycle only':'Latest published cycle only')+'; other cycles are not appended.';
}
