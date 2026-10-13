# Fixed rainfall periods and tighter North Atlantic view — 13 October 2026

## Scope and recovery

Pre-change application preserved in `backup/uk-model-maps-before-fixed-periods-20261013`
at `2b6282c44f768b3069aab9ffd4b815d20da28492`. Earlier backup branches are unchanged.
Only map/briefing presentation, the shared area preset, and associated tests change.
Location charts, forecast inputs, native precipitation accumulation arithmetic,
cache limits, six-slot loading pipeline, run-family selection and scheduled
feed-health/ingestion/publication workflows are not changed.

## Simpler rainfall charts

Forecast briefing and Previous Run Analysis retain all eight accumulation lengths:
6, 12, 18, 24, 36, 48, 72 and 120 hours where complete source data exists.
For those charts the start selector reads **Period start · UTC** (shared in
history), and the disabled interval indicator reads **N-hour periods**.
Select the desired starting time; panels then cover successive non-overlapping
N-hour periods. For example, 24 h starting 00Z gives 00Z–00Z daily totals rather
than rolling totals at 03Z, 06Z etc. Other weather fields restore the prior
hourly/three-/six-hourly setting. Regional models retain their native cadence.

The available start times are obtained from complete native windows. Every
native interval is still included numerically. Three-run comparisons first
intersect exact coverage and then anchor to one shared absolute start; they
never compare equal lead times with different accumulation periods. No zero
padding, partial totals, cycle stitching or splitting of a coarse interval.
Short horizons produce only the number of complete periods available (for
example, two 24 h charts or one 48 h chart from a suitable UKV 54 h run), not
six overlapping charts to fill the layout. Gaps remain unavailable. Titles,
period captions, image exports and initialization labels remain explicit.

Ordinary interactive-map accumulations keep their existing rolling timeline
for detailed monitoring. Fixed-period behavior is confined to the two briefing
modes requested in the interval-control screenshot. Existing Hide/Show controls
preserve images without recalculation or downloads. Accumulation pages do not
pre-render additional off-screen pages.

## North Atlantic area

The shared North Atlantic preset is tightened from `[-80,20,30,78]` to
`[-65,35,35,73]` (west, south, east, north, degrees), with 960 × 660 landscape
charts. It centers the synoptic analysis on southern Greenland, Iceland, the
North Atlantic and Europe, retaining only the eastern Canadian fringe rather
than deep North America and removing the subtropical Atlantic. This is an
approximate geographic match to the supplied reference; the existing Mercator
projection is retained. Small fit-padding margins remain. Both briefing modes
and enlarged/exported charts use the same preset. UK/Ireland, Europe and custom
current-map extents are unchanged.

## Verification

Tests cover all eight durations, arbitrary UTC starts, midnight transitions,
missing windows, native-cadence transitions, short-run horizons, matching
three-run periods, interval restoration and the shared Atlantic bounds.
The new desktop/mobile browser suite additionally checks fixed-period paging,
reduced chart counts, exactly matching area bounds between briefing modes,
and no imagery requests from Hide/Show controls. The existing browser workflow
runs it after relevant changes, alongside the original playback/history/export
suites. The live browser reproduction uses real retained 12 October IFS cycles,
48 h periods, grid labels, MSLP and the full basemap; its source URLs are dated
and subject to archive retention, so it is not a permanent scheduled monitor.
Measured results are recorded in the release-check document and Actions artifacts.
