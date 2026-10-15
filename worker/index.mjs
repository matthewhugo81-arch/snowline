import {DurableObject} from 'cloudflare:workers';
import {ForecastCache,parsePoint} from './cache-service.mjs';
export class SharedForecasts extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.cache=new ForecastCache(ctx.storage,{dailyBudget:env.DAILY_HTTP_BUDGET});ctx.blockConcurrencyWhile(()=>this.cache.ready);}
 async fetch(request){
  if(new URL(request.url).pathname==='/stats')return Response.json(await this.cache.stats());
  let point;try{point=parsePoint(request.url);}catch(error){return Response.json({error:true,reason:error.message},{status:400});}
  try{return Response.json(await this.cache.get(point));}catch(error){return Response.json({error:true,reason:error.message},{status:error.status??502,headers:{'Retry-After':String(Math.max(1,Math.ceil(((error.retryAt??Date.now()+60000)-Date.now())/1000)))}});}
 }
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  const allowed=(env.ALLOWED_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean);
  const headers={'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  if(origin&&!allowed.includes(origin))return Response.json({error:true,reason:'Origin not allowed.'},{status:403,headers});
  if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Expose-Headers':'Retry-After'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return Response.json({error:true,reason:'GET required.'},{status:405,headers});
  if(!['/forecast','/stats','/health'].includes(url.pathname))return Response.json({error:true,reason:'Not found.'},{status:404,headers});
  if(url.pathname==='/health')return Response.json({ok:true,version:1},{headers});
  if(url.pathname==='/stats'&&(!env.STATS_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.STATS_TOKEN))return Response.json({error:true,reason:'Unauthorized.'},{status:401,headers});
  if(url.pathname==='/forecast')try{parsePoint(url);}catch(error){return Response.json({error:true,reason:error.message},{status:400,headers});}
  try{
   const id=env.SHARED_FORECASTS.idFromName('snowline-v1');
   const response=await env.SHARED_FORECASTS.get(id).fetch(new Request(url.href));
   const result=new Response(response.body,response);for(const [key,value] of Object.entries(headers))result.headers.set(key,value);return result;
  }catch{return Response.json({error:true,reason:'Shared forecast service temporarily unavailable.'},{status:503,headers:{...headers,'Retry-After':'60'}});}
 }
};
