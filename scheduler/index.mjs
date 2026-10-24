import {DurableObject} from 'cloudflare:workers';
import {ModelSchedulerService} from './service.mjs';
export class ModelScheduler extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);
  this.products=new ModelSchedulerService(ctx.storage,{token:env.GITHUB_ACTIONS_TOKEN,products:true});
  this.scheduler=new ModelSchedulerService(ctx.storage,{token:env.GITHUB_ACTIONS_TOKEN});
  this.companion=new ModelSchedulerService(ctx.storage,{token:env.COMPANION_GITHUB_ACTIONS_TOKEN??env.GITHUB_ACTIONS_TOKEN,companion:true});
 }
 async tick(){
  // One publisher being busy or failing must not prevent the other being checked.
  const results=await Promise.allSettled([this.scheduler.tick(),this.companion.tick(),this.products.tick()]);
  const failures=results.filter(result=>result.status==='rejected');
  if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'A model publication check failed');
  return results.map(result=>result.value);
 }
 async status(){
  const [main,companion,products]=await Promise.all([this.scheduler.status(),this.companion.status(),this.products.status()]);
  return {...main,mainOk:main.ok,companion,products,ok:main.ok&&companion.ok&&products.ok};
 }
}
const object=env=>env.MODEL_SCHEDULER.get(env.MODEL_SCHEDULER.idFromName('snowline-model-scheduler-v1'));
export default {
 async scheduled(controller,env,ctx){ctx.waitUntil(object(env).tick());},
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET')return Response.json({error:'GET required'},{status:405,headers});
  if(!['/','/health'].includes(path))return Response.json({error:'Not found'},{status:404,headers});
  // Read-only; public requests cannot dispatch a workflow or choose a target.
  try{const status=await object(env).status();return Response.json(status,{status:status.ok?200:503,headers});}
  catch{return Response.json({ok:false,status:'unavailable'},{status:503,headers});}
 }
};
