import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {feedPolicy,classifyFeed,parseIncidentState,updateFeedIncidents,healthSummary,STALE_CONFIRMATION_MS,MAX_OBSERVATION_GAP_MS} from '../scripts/map_feed_status.mjs';

const ukv={id:'ukmo_uk_deterministic_2km',name:'UKV',regional:true};
const start=Date.parse('2026-10-20T12:00:00Z');
function record(ageHours=13,extra={},model=ukv){
 const result={model:model.id,name:model.name??model.id,ageHours,reference_time:new Date(start-ageHours*3600000).toISOString(),horizonHours:54,warnings:[],...extra};
 return {...result,health:classifyFeed(model,result)};
}
const restore=result=>parseIncidentState(JSON.stringify(result.state));

test('freshness thresholds distinguish review from conservative stale age by model',()=>{
 assert.deepEqual(feedPolicy(ukv),{reviewHours:6,staleHours:12,freshnessAuthority:'initialization-age'});
 assert.equal(record(6).health.freshness,'current');
 assert.equal(record(6.01).health.freshness,'review');
 assert.equal(record(12).health.freshness,'review');
 assert.equal(record(12.01).health.freshness,'stale');
 assert.equal(record(23,{}, {id:'icon_eu',regional:true}).health.freshness,'review');
 assert.equal(record(25,{}, {id:'icon_eu',regional:true}).health.freshness,'stale');
 assert.equal(record(47,{}, {id:'ecmwf_ifs'}).health.freshness,'review');
 assert.equal(record(49,{}, {id:'ecmwf_ifs'}).health.freshness,'stale');
 assert.equal(record(-1).health.status,'invalid');
});

test('unreadable metadata or samples are unavailable with unverified freshness, not asserted stale',()=>{
 for(const extra of [{error:'HTTP 503'},{warnings:['Forecast byte-range check failed: HTTP 404']}]){
  const result=record(80,extra);
  assert.equal(result.health.availability,'unavailable');assert.equal(result.health.freshness,'unverified');
  const incident=updateFeedIncidents([result],parseIncidentState(),{now:start});
  assert.equal(incident.monitoring.alerts.length,1);assert.equal(incident.monitoring.alerts[0].status,'unavailable');
 }
 const missing=classifyFeed(ukv,{warnings:[]});assert.equal(missing.status,'invalid');
});

test('readable stale data remains degraded immediately and alerts once after sustained observations',()=>{
 const initial=updateFeedIncidents([record()],parseIncidentState(),{now:start});
 assert.equal(initial.monitoring.dataStatus,'degraded');assert.equal(initial.monitoring.alerts.length,0);
 assert.equal(initial.monitoring.observations[0].notification,'awaiting-confirmation');
 const early=updateFeedIncidents([record()],restore(initial),{now:start+STALE_CONFIRMATION_MS-1});
 assert.equal(early.monitoring.alerts.length,0);
 const confirmed=updateFeedIncidents([record()],restore(early),{now:start+STALE_CONFIRMATION_MS});
 assert.equal(confirmed.monitoring.alerts.length,1);assert.equal(confirmed.state.models[ukv.id].alerted,true);
 const ongoing=updateFeedIncidents([record()],restore(confirmed),{now:start+STALE_CONFIRMATION_MS+60000});
 assert.equal(ongoing.monitoring.dataStatus,'degraded');assert.equal(ongoing.monitoring.alerts.length,0);
 assert.equal(ongoing.monitoring.observations[0].notification,'already-notified');
 const report={checkedAt:new Date(start).toISOString(),scope:'Tiny sample check.',results:[record()],monitoring:ongoing.monitoring};
 assert.match(healthSummary(report),/Data status: DEGRADED/);assert.match(healthSummary(report),/Ongoing incident; repeat suppressed/);
});

test('long gaps restart unconfirmed persistence but preserve already-notified incidents',()=>{
 const initial=updateFeedIncidents([record()],parseIncidentState(),{now:start});
 const later=updateFeedIncidents([record()],restore(initial),{now:start+MAX_OBSERVATION_GAP_MS+1});
 assert.equal(later.monitoring.alerts.length,0);assert.equal(later.monitoring.observations[0].observationGapReset,true);
 assert.equal(later.state.models[ukv.id].observations,1);
 const unavailable=updateFeedIncidents([record(13,{error:'HTTP 503'})],parseIncidentState(),{now:start});
 const resumed=updateFeedIncidents([record()],restore(unavailable),{now:start+2*86400000});
 assert.equal(resumed.monitoring.alerts.length,0);assert.equal(resumed.monitoring.dataStatus,'degraded');
 assert.equal(resumed.monitoring.observations[0].notification,'already-notified');
});

test('recovery clears the incident and a subsequent outage can notify again',()=>{
 const outage=updateFeedIncidents([record(13,{error:'HTTP 503'})],parseIncidentState(),{now:start});
 const repeated=updateFeedIncidents([record(13,{error:'HTTP 503'})],restore(outage),{now:start+60000});
 assert.equal(repeated.monitoring.alerts.length,0);
 const recovered=updateFeedIncidents([record(2)],restore(repeated),{now:start+120000});
 assert.equal(recovered.monitoring.dataStatus,'healthy');assert.equal(recovered.monitoring.recoveries.length,1);
 assert.deepEqual(recovered.state.models,{});
 const next=updateFeedIncidents([record(13,{error:'HTTP 503'})],restore(recovered),{now:start+180000});
 assert.equal(next.monitoring.alerts.length,1);
});

test('missing, incompatible and corrupt persistence cannot present stale data as healthy',()=>{
 for(const saved of [undefined,'{broken','{"schema":2,"models":{}}','{"schema":1,"models":{"bad":{}}}']){
  const restored=parseIncidentState(saved);assert.notEqual(restored.status,'restored');
  const result=updateFeedIncidents([record()],restored,{now:start});
  assert.equal(result.monitoring.dataStatus,'degraded');assert.match(result.monitoring.stateNote,/Current degraded data remains visible/);
  assert.equal(result.monitoring.observations[0].notification,'awaiting-confirmation');
 }
 const saved=updateFeedIncidents([record(13,{error:'HTTP 503'})],parseIncidentState(),{now:start});
 const afterDeployment=parseIncidentState(JSON.stringify({...saved.state,commit:'a-new-deployment'}));
 assert.equal(afterDeployment.status,'restored');
 assert.equal(updateFeedIncidents([record()],afterDeployment,{now:start+60000}).monitoring.alerts.length,0);
});

test('generated ensemble freshness stays visible without duplicating official-source incidents',()=>{
 const generated=record(80,{}, {id:'snowline_mogreps_global'});
 assert.equal(generated.health.status,'stale');assert.equal(generated.health.incident,false);
 const result=updateFeedIncidents([generated],parseIncidentState(),{now:start});
 assert.equal(result.monitoring.dataStatus,'degraded');assert.equal(result.monitoring.alerts.length,0);
 assert.equal(result.monitoring.observations[0].notification,'managed-by-official-source-check');
 const failed=record(80,{error:'HTTP 404'}, {id:'snowline_mogreps_global'});
 assert.equal(updateFeedIncidents([failed],restore(result),{now:start+60000}).monitoring.alerts.length,1);
});

test('the health workflow restores across revisions and saves state after a failed check',()=>{
 const source=readFileSync(new URL('../.github/workflows/map-feed-health.yml',import.meta.url),'utf8');
 assert.match(source,/restore-keys: snowline-map-feed-health-state-v1-/);
 assert.doesNotMatch(source,/snowline-map-feed-health-state[^\n]*github\.sha/);
 assert.match(source,/Check all offered models, transport and persistent initialization age\s+if: always\(\)/);
 assert.match(source,/Save map feed incident history, including new failures\s+if: always\(\)\s+uses: actions\/cache\/save@v4/);
 assert.match(source,/actions\/upload-artifact@v4\s+if: always\(\)/);
});
