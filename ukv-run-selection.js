// Met Office UKV run families. Selection is by initialization, NEVER end time.
// https://registry.opendata.aws/met-office-uk-deterministic/
export const UKV = 'ukmo_uk_deterministic_2km';
export const UKV_NOWCAST = UKV + '_nowcast';
const HOUR = 3600000;
export const ukvRunFamily = model => model === UKV ? 'main' : model === UKV_NOWCAST ? 'nowcast' : null;
export function cycleFamily(referenceTime) {
 const time = Date.parse(referenceTime);
 if (!Number.isFinite(time) || time % HOUR !== 0) return null;
 return new Date(time).getUTCHours() % 3 === 0 ? 'main' : 'nowcast';
}
export function ukvRunPath(referenceTime) {
 const iso = new Date(referenceTime).toISOString();
 return iso.slice(0,10).replaceAll('-','/') + '/' + iso.slice(11,16).replace(':','') + 'Z/';
}
function validatePublished(meta, expectedTime) {
 if (!meta || Date.parse(meta.reference_time) !== expectedTime)
  throw new Error('UKV metadata does not match its requested initialization. Check latest runs to retry.');
 if (meta.completed === false) return false;
 if (meta.completed !== true || !Array.isArray(meta.variables) || !meta.variables.length ||
     !Array.isArray(meta.valid_times) || !meta.valid_times.length ||
     meta.valid_times.some(time => !Number.isFinite(Date.parse(time)) || Date.parse(time) < expectedTime))
  throw new Error('UKV metadata is invalid; the latest cycle cannot be verified.');
 return true;
}
export async function selectUKVRun(latest, base, load, family, {lookbackHours = 24} = {}) {
 if (!['main','nowcast'].includes(family)) throw new Error('Unknown UKV run family.');
 const newest = Date.parse(latest?.reference_time);
 if (!Number.isFinite(newest) || !cycleFamily(latest.reference_time))
  throw new Error('Latest UKV initialization is unavailable or invalid.');
 if (!Number.isInteger(lookbackHours) || lookbackHours < 0 || lookbackHours > 48)
  throw new Error('Invalid UKV search window.');
 const skipped = [];
 // latest.json is the provider's published frontier, not the browser's clock.
 for (let time = newest; time >= newest - lookbackHours * HOUR; time -= HOUR) {
  const reference = new Date(time).toISOString();
  if (cycleFamily(reference) !== family) continue;
  let meta;
  try {
   meta = time === newest ? latest : await load(base + ukvRunPath(reference) + 'meta.json');
  } catch (error) {
   if (error?.status === 404) { skipped.push(reference); continue; }
   // A timeout/500 is NOT evidence that an older run is the latest one.
   throw error;
  }
  if (!validatePublished(meta, time)) { skipped.push(reference); continue; }
  return {...meta, runFamily: family, selectionWarnings: skipped.length ? [
   'A newer ' + (family === 'main' ? 'main' : 'hourly nowcast') +
   ' cycle is not yet fully published. Showing the latest verified completed cycle in this group.'
  ] : []};
 }
 throw new Error('No completed UKV ' + family + ' cycle is available within the last ' + lookbackHours +
  ' hours of the published feed. The other run group has not been substituted.');
}
