# Accumulated precipitation and Previous Run Analysis

## Recovery point

Before any application change, production source was preserved in branch
`backup/uk-model-maps-before-accumulations-20261012`, at commit
`b7aa68bc5243ac98180f277368088b2236ec6b7f` (tree
`760dc2e6e4fb690c4cee711014ba8cc34580fef3`). A ZIP source snapshot was also saved:
`Snowline-UK-Model-Maps-backup-2026-10-12.zip` (SHA256
`96a85b4c3bb3c177d3dbf6f62f980fc49dd0b4f2a0e24984da3029783f99d4ce`).
This preserves the application, dependencies and settings, not changing external
forecast data. Restore the feature commit with `git revert`, or restore only the
affected map files from the backup branch in a new commit. Do not force-reset
main over unrelated later work.

## Accumulations

Weather layer → Accumulated precipitation offers rolling 6, 12, 18, 24, 36, 48,
72 and 120-hour totals ending at the displayed UTC valid time. The title/legend
and copied/saved PNG state both period boundaries. Amounts are total precipitation
in millimetres of water, including frozen precipitation water equivalent, not
snow depth. One fixed colour scale is shared across windows, models and panels.
The ordinary native-interval Precipitation layer is unchanged.

The reader adds native numerical precipitation grids, not image colours or
point-forecast daily products. Run, domain, grid shape and timestamps must match.
Provider-specific native cadence is explicit; missing hourly files cannot be
reinterpreted as longer accumulation intervals. Every necessary interval must
exist within the chosen run. Missing/non-finite or negative cells remain missing.
There is no proportional split of a coarse interval, cycle stitching, probability
summation, or substitution of the separate rain field.

A 54-hour run cannot offer 72/120-hour totals, and a 12-hour nowcast cannot offer
longer totals. Unsupported windows are disabled. A newly arriving run is not
replaced by an older longer run to supply a total. Full windows become available
as that same run publishes the necessary hours.

The 12 October 18:04 UTC feed audit retrieved metadata and sample forecast bytes
for UKV cycles 3, 6, 9, 12, 24 and 48 hours earlier. The then-current UKV main feed
had 54 hours. Raw Met Office open-data documentation describes extended runs,
but this Open-Meteo UKV ingestion currently requests 54 hours for main runs; do
not promise UKV 120-hour data solely from the upstream raw-model specification.
Longer totals remain available on other supported amount feeds when the
selected run supplies the complete window.

## Previous Run Analysis

Briefing view → Previous Run Analysis is separate from the existing forecast
sequence. Desktop shows three run panels; on small screens these stack.
The default is the latest three available main cycles for the selected UKV main
choice, arranged oldest to newest. Each panel has an explicit initialization
selector from a bounded 48-hour archive search. UKV hourly nowcasts stay in their
own family. Other existing deterministic briefing models can use the same mode
where the provider retains matching runs.

All panels share chart, area, colour scale and forecast valid time. Each labels
its actual initialization and lead time. Accumulations additionally require the
same start/end window. The weather composite compares equal precipitation
interval lengths. Runs without required fields or common hours are not replaced.
An unavailable archive file is shown as unavailable, not as an empty dry chart.

Selected cycles stay pinned. The existing shared metadata checker supplies a
new-run notice; Load latest three runs is the explicit update control. There is
no second polling loop for the archive. Right-click copy/save and enlargement
use the actual selected run/time bitmap and metadata.

## Performance and checks

Ordinary maps do not retrieve a historical run catalogue or numerical
accumulation grids until those features are selected. New work uses the existing
spatial provider and renderer; no point API quota or new external service is
introduced. Accumulations use at most three simultaneous native grid reads,
32 MiB of additional decoded-input cache, and 32 MiB of rolling sum snapshots
(maximum four). Independent cancellation prevents one panel from aborting a
shared read needed by another. Nearby windows reuse their overlap: typically
only entering/leaving intervals need reading. Cancellation and yielding prevent
obsolete full-window computations from monopolising the page.

Only nearby accumulation frames are warmed, not the whole forecast horizon.
The previous-run view uses one renderer for three reusable images, rather than
three live maps; it prepares the selected three first and at most the next
shared time afterwards. There is no archive-wide image preloading. Expensive
accumulation renders have a longer timeout to avoid restarting the same work.

The hourly Map feed health workflow checks published initialization, available
horizon, partial-feed warnings, metadata latency, a tiny byte-range sample, and
the preceding two UKV main cycles. It publishes an Actions summary and JSON
artifact. Conservative age/latency thresholds trigger a review warning/failure,
not an assertion that the upstream model should already have completed. This
runs independently of ChatGPT and does not generate imagery or alter the site.
The existing model ingestion/publication workflow is unchanged. The normal map
browser-test workflow now also exercises the new history/accumulation and
image-export tests after relevant code changes.

## Validation before release

The full review run 38292925735 passed 261 Node regression tests, the existing
map/briefing browser suite, chart-style and PNG/clipboard tests, and the new
accumulation/history suite at 1280 px and 390 px. New checks include no archive
or accumulation downloads before selection, all eight periods, disabled short
windows, same-valid-time comparisons, distinct run selection, pinned runs on
new-cycle notification, explicit refresh, mobile stacking and historical PNGs.

Actual UKV 12Z grids were independently summed over 1,024 native cells for
6-hour and 24-hour windows. Maximum difference from the independent sums was
below 0.000001 mm. Advancing each window one hour required one additional native
input read in this test, rather than six or 24 reads. The reader never exceeded
three simultaneous native input requests.

A separate real-browser check used real UKV OM data and raster workers in an
1100 x 850 view with a blank basemap and no MSLP overlay. The selected 6-hour
and 24-hour maps became ready in 1.594 and 3.590 seconds on that runner. These
are test-environment measurements, not full-site end-user latency guarantees;
the 24-hour test also followed the 6-hour test and could reuse its cached inputs.
The first cold long-period total can take longer than an instantaneous layer.

At 18:51 UTC, remote metadata checks took 27–238 ms on the runner and successful
forecast byte-range checks took 106–214 ms. The UKV main initialization was still
12Z and triggered the conservative six-hour age review warning. This is an
explicit source-age warning, not a fabricated newer run or proof of an outage.
The report, exact cycles and sampled URLs are retained in the review artifacts.

## Primary implementation references

Provider source reviewed at open-meteo/open-meteo commit
`735f488affdb3d8332df878ac7508d12bc51a42c`:
`Sources/App/UKMO/UkmoVariable.swift`, `UkmoDomain.swift`, and
`Sources/App/Helper/Writer/OmSpatialTimestepWriter.swift` (spatial values and
metadata), plus ECMWF/GFS downloaders' deaccumulation handling.

- https://github.com/open-meteo/open-data
- https://github.com/open-meteo/open-meteo/tree/735f488affdb3d8332df878ac7508d12bc51a42c/Sources/App/UKMO
- https://registry.opendata.aws/met-office-uk-deterministic/
