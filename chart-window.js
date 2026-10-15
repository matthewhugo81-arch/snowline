// One inclusive, hourly window shared by charts, statistics, the slider and exports.
// The inspected index always belongs to the original timeline, never a sliced copy.
export function chartWindow({times = [], hours = times.length, zoom = null}) {
  const length = Math.max(0, Math.min(times.length, Number.isFinite(hours) ? Math.trunc(hours) : times.length));
  if (!length) return {start: 0, end: -1, times: []};
  let start = 0, end = length - 1;
  if (zoom && Number.isInteger(zoom.start) && Number.isInteger(zoom.end) && zoom.start < zoom.end) {
    const first = Math.max(0, zoom.start), last = Math.min(end, zoom.end);
    if (first < last) { start = first; end = last; }
  }
  return {start, end, times: times.slice(start, end + 1)};
}

export function indexAtX(x, {left, inner, n, start = 0}) {
  if (!Number.isFinite(x) || !(inner > 0) || !(n > 0)) return null;
  const local = Math.max(0, Math.min(n - 1, Math.round((x - left) / inner * (n - 1))));
  return start + local;
}

export function selectionRange(x1, x2, layout) {
  const a = indexAtX(x1, layout), b = indexAtX(x2, layout);
  if (a === null || b === null || a === b) return null;
  return {start: Math.min(a, b), end: Math.max(a, b)};
}

// Scale around a fractional position in the starting window, then move that
// anchor with the fingers. Snap to whole hours and preserve the span at edges.
export function transformRange({start, end}, {length, scale = 1, anchor = .5, midpoint = anchor}) {
  if (!Number.isInteger(length) || length < 2 || ![start, end, scale, anchor, midpoint].every(Number.isFinite) || end <= start || scale <= 0) return null;
  const span = Math.max(1, Math.min(length - 1, Math.round((end - start) / scale)));
  const first = Math.max(0, Math.min(length - 1 - span, Math.round(start + anchor * (end - start) - midpoint * span)));
  return {start:first, end:first + span};
}
