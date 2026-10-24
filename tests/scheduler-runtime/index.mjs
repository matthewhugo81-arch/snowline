import worker,{ModelScheduler} from '../../scheduler/index.mjs';
// Exercise the production cron -> Durable Object RPC -> persisted lease path
// inside workerd. Only GitHub's remote HTTP responses are replaced.
export class TestScheduler extends ModelScheduler {
 constructor(ctx,env){
  super(ctx,{...env,GITHUB_ACTIONS_TOKEN:'runtime-fixture'});
  this.scheduler.fetcher=async(url,options)=>{
   const key='fixture-posts',count=await ctx.storage.get(key)??0;
   if(options.method==='POST'){await ctx.storage.put(key,count+1);return Response.json({workflow_run_id:42});}
   return Response.json({workflow_runs:[]});
  };
  this.companion.fetcher=this.scheduler.fetcher;
  this.products.fetcher=this.scheduler.fetcher;
 }
 async posts(){return await this.ctx.storage.get('fixture-posts')??0;}
}
export default {
 async fetch(request,env){
  let pending;
  for(let i=0;i<2;i++){
   await worker.scheduled({},env,{waitUntil:promise=>{pending=promise;}});
   await pending;
  }
  const object=env.MODEL_SCHEDULER.get(env.MODEL_SCHEDULER.idFromName('snowline-model-scheduler-v1'));
  const response=await worker.fetch(new Request('https://fixture.test/health'),env);
  const status=await response.json(),posts=await object.posts();
  if(!status.ok||status.status!=='cooldown'||status.companion.status!=='cooldown'||status.products.status!=='cooldown'||status.lastDispatchedRunId!==42||posts!==3)throw Error(JSON.stringify({status,posts}));
  return Response.json({ok:true,rpc:true,posts,leaseReused:true});
 }
};
