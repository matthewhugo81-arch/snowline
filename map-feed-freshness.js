// Age is reported independently from readability. These are conservative review
// and overdue thresholds, not claims about a provider's delivery promise.
export function feedFreshness(model,ageHours){
 const reviewHours=model.id.startsWith('ukmo_uk_deterministic_2km')?6:model.regional?12:24;
 const overdueHours=reviewHours*2;
 return {state:!Number.isFinite(ageHours)||ageHours<-.1?'invalid':ageHours>overdueHours?'overdue':ageHours>reviewHours?'review':'current',ageHours,reviewHours,overdueHours};
}
