// Set only after deploying and verifying worker/wrangler.toml; empty preserves the current site.
export const FORECAST_SERVICE_URL='';
export function pointForecastURL(location,model,service=FORECAST_SERVICE_URL){
 if(!service)return null;
 const url=new URL(service);
 if(url.protocol!=='https:'&&url.hostname!=='localhost')throw Error('Forecast service must use HTTPS.');
 url.pathname='/forecast';url.search='';url.hash='';
 url.search=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,model:model.id});
 return url.href;
}
