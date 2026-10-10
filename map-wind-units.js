export const MPH_PER_MS=2.2369362921;
export const isWindSpeed=key=>typeof key==='string'&&key.startsWith('wind_speed_');
export const isWindField=key=>isWindSpeed(key)||key==='wind_gusts_10m';
export const displayUnit=field=>isWindField(field?.key)?'mph':field?.unit;
export const displayValue=(value,field)=>isWindField(field?.key)?value*MPH_PER_MS:value;
export const displayStops=field=>isWindField(field?.key)?field.stops.map(v=>Math.round(v*MPH_PER_MS*10)/10):field.stops;
