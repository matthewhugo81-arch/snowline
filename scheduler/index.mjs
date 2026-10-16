import {DurableObject} from 'cloudflare:workers';
import {ModelSchedulerService} from './service.mjs';
export class ModelScheduler extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.scheduler=new ModelSchedulerService(ctx.storage,{token:env.GITHUB_ACTIONS_TOKEN});}
 async tick(){return this.scheduler.tick();}
 async status(){return this.scheduler.status();}
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
