// Initialization age is a monitoring policy, not evidence of a newer source run.
// Keep source availability separate from freshness: a failed read cannot verify age.
const GENERATED=new Set(['snowline_gefs_ensemble','snowline_ecmwf_ensemble','snowline_mogreps_global']);
export const INCIDENT_SCHEMA=1;
export const STALE_CONFIRMATION_MS=15*60000;
export const MAX_OBSERVATION_GAP_MS=45*60000;

export function feedPolicy(model){
 const reviewHours=model.id==='ukmo_uk_deterministic_2km'||model.id==='ukmo_uk_deterministic_2km_nowcast'?6:model.regional?12:24;
 return {reviewHours,staleHours:reviewHours*2,freshnessAuthority:GENERATED.has(model.id)?'official-source-check':'initialization-age'};
}

export function classifyFeed(model,record){
 const policy=feedPolicy(model),failures=(record.warnings??[]).filter(w=>w.startsWith('Forecast byte-range check failed:'));
 if(record.error||failures.length)return {availability:'unavailable',freshness:'unverified',status:'unavailable',incident:true,reason:record.error??failures.join(' '),policy};
 if(!Number.isFinite(record.ageHours)||record.ageHours<-.1)return {availability:'available',freshness:'invalid',status:'invalid',incident:true,reason:Number.isFinite(record.ageHours)?'Initialization is in the future.':'Initialization age could not be verified.',policy};
 const freshness=record.ageHours>policy.staleHours?'stale':record.ageHours>policy.reviewHours?'review':'current';
 const status=freshness==='current'?(record.warnings?.length?'review':'healthy'):freshness;
 const reason=freshness==='stale'?`Initialization age exceeds the ${policy.staleHours} h conservative stale threshold.`:freshness==='review'?`Initialization age exceeds the ${policy.reviewHours} h review threshold.`:'';
 return {availability:'available',freshness,status,incident:freshness==='stale'&&policy.freshnessAuthority==='initialization-age',reason,policy};
}

const emptyState=()=>({schema:INCIDENT_SCHEMA,models:{}});
export function parseIncidentState(text){
 if(text===undefined)return {state:emptyState(),status:'missing',note:'Previous incident state is unavailable. Current degraded data remains visible; persistence and notification history must be established again.'};
 try{
  const state=JSON.parse(text);
  if(state?.schema!==INCIDENT_SCHEMA)return {state:emptyState(),status:'incompatible',note:'Previous incident state has an unsupported schema. Current degraded data remains visible; notification history could not be restored.'};
  if(!state.models||typeof state.models!=='object'||Array.isArray(state.models))throw Error('Invalid model incidents');
  for(const incident of Object.values(state.models)){
   if(!incident||!Number.isFinite(Date.parse(incident.firstSeen))||!Number.isFinite(Date.parse(incident.lastSeen))||Date.parse(incident.lastSeen)<Date.parse(incident.firstSeen)||!Number.isInteger(incident.observations)||incident.observations<1||typeof incident.alerted!=='boolean')throw Error('Invalid incident history');
  }
  return {state,status:'restored',note:'Incident state restored independently of the code revision.'};
 }catch{
  return {state:emptyState(),status:'invalid',note:'Previous incident state could not be read. Current degraded data remains visible; notification history could not be restored.'};
 }
}

export function updateFeedIncidents(records,restored,{now=Date.now(),confirmationMs=STALE_CONFIRMATION_MS,maxGapMs=MAX_OBSERVATION_GAP_MS}={}){
 const checkedAt=new Date(now).toISOString(),models={},alerts=[],recoveries=[],observations=[];
 for(const record of records){
  const health=record.health,prior=restored.state.models[record.model];
  if(!health.incident){
   if(prior)recoveries.push({model:record.model,status:health.status,previousStatus:prior.status,firstSeen:prior.firstSeen});
   observations.push({model:record.model,status:health.status,notification:health.freshness==='stale'?'managed-by-official-source-check':'none'});
   continue;
  }
  // A long monitoring gap cannot prove continuous staleness. Preserve a known
  // notification across gaps, but restart the confirmation window if unalerted.
  const gap=prior?now-Date.parse(prior.lastSeen):null;
  const continuous=prior&&gap>=0&&gap<=maxGapMs;
  const keepPrior=prior&&(prior.alerted||continuous);
  const incident={firstSeen:keepPrior?prior.firstSeen:checkedAt,lastSeen:checkedAt,observations:keepPrior?prior.observations+1:1,alerted:Boolean(prior?.alerted),status:health.status,referenceTime:record.reference_time??null,reason:health.reason};
  const confirmed=health.status!=='stale'||(incident.observations>=2&&now-Date.parse(incident.firstSeen)>=confirmationMs);
  let notification=incident.alerted?'already-notified':'awaiting-confirmation';
  if(confirmed&&!incident.alerted){incident.alerted=true;notification='new-incident';alerts.push({model:record.model,status:health.status,reason:health.reason,firstSeen:incident.firstSeen});}
  models[record.model]=incident;
  observations.push({model:record.model,status:health.status,notification,firstSeen:incident.firstSeen,observations:incident.observations,observationGapReset:Boolean(prior&&!keepPrior)});
 }
 const degraded=records.filter(r=>['stale','unavailable','invalid'].includes(r.health.status)).map(r=>r.model);
 return {state:{schema:INCIDENT_SCHEMA,checkedAt,models},monitoring:{stateStatus:restored.status,stateNote:restored.note,dataStatus:degraded.length?'degraded':records.some(r=>r.health.status==='review')?'review':'healthy',degradedModels:degraded,confirmationMinutes:confirmationMs/60000,alerts,recoveries,observations}};
}

export function healthSummary(report){
 const {monitoring}=report;
 const lines=['## Snowline map feed health',report.checkedAt,'',`**Data status: ${monitoring.dataStatus.toUpperCase()}**${monitoring.degradedModels.length?' — '+monitoring.degradedModels.join(', '):''}`,'',report.scope,'',monitoring.stateNote,'',
  'Initialization age alone does not establish that a newer upstream run exists. Generated ensemble freshness is checked separately against official sources.',
  'A new confirmed incident fails this check once. Repeat notifications are suppressed while the incident remains ongoing; the data status above and the artifact retain the degraded state.','',
  '| Model | Initialization UTC | Horizon | Availability | Freshness | Notification | Details |','|---|---|---:|---|---|---|---|'];
 const cell=value=>String(value??'—').replaceAll('|','\\|').replaceAll('\n',' ');
 for(const result of report.results){
  const notification=monitoring.observations.find(row=>row.model===result.model)?.notification;
  const details=[result.health.reason,...(result.warnings??[])].filter(Boolean);
  const note=notification==='already-notified'?'Ongoing incident; repeat suppressed':notification==='awaiting-confirmation'?'Awaiting persistent stale confirmation':notification==='new-incident'?'New confirmed incident':notification==='managed-by-official-source-check'?'Official-source check owns freshness':'—';
  lines.push('| '+[result.name,result.reference_time??'unverified',result.horizonHours===undefined?'—':result.horizonHours+' h',result.health.availability,result.health.freshness,note,[...new Set(details)].join(' ')||'OK'].map(cell).join(' | ')+' |');
 }
 for(const recovered of monitoring.recoveries)lines.push('',`Recovered: ${recovered.model} (${recovered.previousStatus} → ${recovered.status}).`);
 return lines.join('\n')+'\n';
}
