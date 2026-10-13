// Presentation only. The numerical reader still sums every native interval.
// Call after intersecting all required fields/runs, never once per run before
// an intersection: comparisons must use identical absolute UTC periods.
const HOUR = 3600000;
const stamp = value => typeof value === 'number' ? value : Date.parse(value);
export const periodStart = (end, hours) => new Date(stamp(end) - hours * HOUR).toISOString();

export function fixedAccumulationPeriods(endingTimes, hours, requestedStart) {
  if (!Number.isInteger(hours) || hours <= 0) throw new RangeError('Invalid accumulation duration.');
  const step = hours * HOUR;
  const ends = [...new Set(endingTimes.map(stamp).filter(Number.isFinite))].sort((a, b) => a - b);
  const starts = ends.map(end => end - step);
  if (!ends.length) return {starts: [], times: [], index: 0, start: null};
  const requested = stamp(requestedStart);
  const anchor = Number.isFinite(requested)
    ? starts.reduce((best, value) => Math.abs(value - requested) < Math.abs(best - requested) ? value : best)
    : starts[0];
  // Keep the chosen phase (including non-synoptic starts), not UTC midnight or
  // run initialization. Missing periods are omitted, never shortened/filled.
  const times = ends.filter(end => (end - step - anchor) % step === 0);
  return {
    starts: starts.map(value => new Date(value).toISOString()),
    times: times.map(value => new Date(value).toISOString()),
    index: times.indexOf(anchor + step),
    start: new Date(anchor).toISOString()
  };
}

export function configurePeriodInterval(select, hours, selection = '3', regional = false) {
  const choices = hours
    ? [[`period-${hours}`, `${hours}-hour periods`]]
    : [['native', 'Hourly / all available'], ['3', '3 hourly'], ['6', '6 hourly']];
  select.replaceChildren(...choices.map(([value, text]) => {
    const option = select.ownerDocument.createElement('option');
    option.value = value; option.textContent = text; return option;
  }));
  select.value = hours ? `period-${hours}` : regional ? 'native' : selection;
  select.disabled = Boolean(hours || regional);
}

export function fixedPeriodNote(hours) {
  return `Complete ${hours}-hour precipitation periods from the selected start time; successive charts do not overlap. ` +
    'All native precipitation intervals are included. Liquid plus frozen water equivalent, from one model run. ' +
    'Only complete periods are shown; missing values remain missing. White: below 0.2 mm, not necessarily zero. ' +
    'MSLP isobars describe the period end.';
}
