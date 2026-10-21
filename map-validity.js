import {productField} from './map-ensemble-products.js';
import {accumulationHours} from './map-accumulation.js?v=20261014-interaction-audit';

const instant=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const periodStamp=(date,year)=>{
 const parts=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).formatToParts(date);
 const part=type=>parts.find(p=>p.type===type).value;
 return part('day')+' '+part('month')+(year?' '+part('year'):'')+' '+part('hour')+':'+part('minute');
};

// A total has a valid period, not a second, separate valid-at timestamp.
export function forecastValidity(field,time){
 const end=new Date(time),hours=productField(field)?.periodHours??accumulationHours(field);
 if(!Number.isFinite(end.getTime()))return '';
 if(!hours)return 'Valid '+instant.format(end)+' UTC';
 const start=new Date(end.getTime()-hours*3600000),year=start.getUTCFullYear()!==end.getUTCFullYear();
 return 'VALID '+periodStamp(start,year)+' to '+periodStamp(end,year)+' UTC';
}
