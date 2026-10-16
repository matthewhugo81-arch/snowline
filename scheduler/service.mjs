// The external clock dispatches the existing health workflow. That workflow
// verifies all five generated feeds and requests publication only when needed.
// Native map feeds continue their independent 60-second browser refresh.
export const REPOSITORY='matthewhugo81-arch/snowline';
export const HEALTH_WORKFLOW='map-feed-health.yml';
export const PUBLISH_WORKFLOW='publish-maps.yml';
const MINUTE=60000;
const iso=value=>new Date(value).toISOString();
export class ModelSchedulerService {
 constructor(storage,{token,fetcher=(...args)=>fetch(...args),now=()=>Date.now()}={}){
  this.storage=storage;this.token=token;this.fetcher=fetcher;this.now=now;this.inflight=null;
 }
 async api(path,method='GET',body){
  const response=await this.fetcher(`https://api.github.com/repos/${REPOSITORY}/${path}`,{
   method,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',
    'User-Agent':'Snowline-model-scheduler',Authorization:`Bearer ${this.token}`,...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(20000)
  });
  // Never store response bodies or credentials in public scheduler status.
  if(!response.ok){await response.body?.cancel();throw Error(`GitHub ${method} returned HTTP ${response.status}`);}
  if(response.status===204)return null;
  return response.json();
 }
 tick(){
  if(!this.inflight)this.inflight=this.check().finally(()=>{this.inflight=null;});
  return this.inflight;
 }
 async check(){
  const now=this.now(),previous=await this.storage.get('state')??{};
  let state={...previous,checkedAt:iso(now),intervalSeconds:180,repository:REPOSITORY};
  const save=async values=>{state={...state,...values};await this.storage.put('state',state);return state;};
  try{
   if(!this.token)throw Error('GITHUB_ACTIONS_TOKEN is not configured');
   // Persist before sending. An ambiguous POST outcome or isolate restart must
   // not cause a second dispatch during this lease. Leave 30 seconds below
   // the cron interval so ordinary trigger jitter does not skip every other tick.
   if(now-(Date.parse(previous.lastAttemptAt)||0)<150000)return save({status:'cooldown'});
   const [health,publish]=await Promise.all([HEALTH_WORKFLOW,PUBLISH_WORKFLOW].map(async workflow=>{
    const data=await this.api(`actions/workflows/${workflow}/runs?branch=main&per_page=20`);
    if(!Array.isArray(data.workflow_runs))throw Error('Invalid GitHub workflow response');
    return data.workflow_runs;
   }));
   const successful=health.find(run=>run.conclusion==='success');
   state.lastSuccessfulCheckAt=successful?.updated_at??previous.lastSuccessfulCheckAt??null;
   state.lastHealthRunId=health[0]?.id??null;
   state.lastHealthConclusion=health[0]?.conclusion??null;
   state.lastPublisherConclusion=publish[0]?.conclusion??null;
   const active=[...health,...publish].filter(run=>run.status!=='completed');
   if(active.length){
    const stuck=active.some(run=>now-Date.parse(run.created_at)>35*MINUTE);
    return save({status:stuck?'stalled':'busy',activeRunIds:active.map(run=>run.id),error:stuck?'A workflow has been queued or running for over 35 minutes':null});
   }
   // Native GitHub schedules and manual checks count too. Do not issue another
   // job when one already started within the most recent interval.
   if(health.some(run=>now-Date.parse(run.created_at)<150000))return save({status:'recent',activeRunIds:[],error:null});
   await save({status:'dispatching',lastAttemptAt:iso(now),activeRunIds:[],error:null});
   const result=await this.api(`actions/workflows/${HEALTH_WORKFLOW}/dispatches`,'POST',{ref:'main'});
   return save({status:'dispatched',lastDispatchAt:iso(now),lastDispatchedRunId:result?.workflow_run_id??null,error:null});
  }catch(error){
   await save({status:'error',error:error.message});
   throw error; // Cloudflare marks the trigger failed; the next tick retries.
  }
 }
 async status(){
  const state=await this.storage.get('state');
  if(!state)return {ok:false,status:'not-started',intervalSeconds:180};
  const fresh=this.now()-Date.parse(state.checkedAt)<10*MINUTE;
  return {...state,ok:fresh&&!state.error&&!['error','stalled'].includes(state.status),stale:!fresh};
 }
}
