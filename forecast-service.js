// Verified shared service; clear the URL to restore the direct forecast path.
export const FORECAST_SERVICE_URL='https://snowline-forecast-cache.matthewhugo81.workers.dev';
export function pointForecastURL(location,model,service=FORECAST_SERVICE_URL){
 if(!service)return null;
 const url=new URL(service);
 if(url.protocol!=='https:'&&url.hostname!=='localhost')throw Error('Forecast service must use HTTPS.');
 url.pathname='/forecast';url.search='';url.hash='';
 url.search=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,model:model.id});
 return url.href;
}
