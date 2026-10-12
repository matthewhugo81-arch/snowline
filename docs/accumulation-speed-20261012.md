# Long accumulation performance and Hide controls — 12 October 2026

## Scope and recovery

These changes affect the shared accumulation reader and map/briefing integration, plus the Previous Run Analysis controls. Native forecast data, precipitation intervals, model initialization selection, map resolution, image dimensions, colour scales, pressure contours and missing-data rules are unchanged. Ordinary non-accumulation reads still use the existing reader methods. No model ingestion or scheduled feed-health workflow was changed.

The original recovery branch `backup/uk-model-maps-before-accumulations-20261012` remains at `b7aa68bc5243ac98180f277368088b2236ec6b7f`. An additional pre-speed-change snapshot is at `backup/uk-model-maps-before-speed-fix-20261012`, commit `801191213c4e98f8d5341cb77234135943ad18bd`. The intervening location-chart zoom changes in that commit are preserved; no location-chart files are replaced by this release.

## What was slow

The reported example was three IFS 9 km cycles (12 October 00Z, 06Z and 12Z), a 72-hour precipitation total ending 15 October 13Z, UK & Ireland, and grid values enabled. Each total needs 72 hourly source grids. In the reproduction, the old shaded-map and grid-label paths together decoded 432 precipitation grids for the three initial panels, rather than the necessary 216. The small rolling-snapshot count also caused repeated work when stepping through these three runs.

## Changes

- Native reads use a bounded six-slot sliding pipeline. A completed slot is refilled without waiting for the slowest member of a fixed three-file batch.
- Exact simultaneous total requests are coalesced. A bounded 16 MiB completed-total cache lets shading, contours, prefetch and labels reuse a result. A narrower label request can crop an already calculated native region exactly, without remapping or resampling. Every returned buffer remains independently owned, including after worker transfer.
- The existing 32 MiB decoded-input and 32 MiB rolling-snapshot byte limits remain. The snapshot count limit increases from four to eight within the same byte limit, helping preserve three-run stepping state. Native grid shape is validated in the same reader session used for decoding. The reader already prefetches native blocks; a redundant extra-prefetch experiment was slower and was not adopted.
- Cancellation stays subscriber-aware. One abandoned panel cannot cancel work still needed by another. The shared reader still withholds missing or incompatible data, never stitching cycles or dropping forecast hours to appear faster.
- Previous Run Analysis shows queued panels separately from the active calculation. The active total reports native-interval progress, then map/grid-value drawing, instead of leaving every panel at an indistinguishable Preparing message.

## Hide controls / Show controls

A top button in Previous Run Analysis collapses model/chart/area/time settings, overlay settings, explanatory notes and the three initialization selectors. It leaves the chart run titles, valid-time/accumulation captions, legend, earlier/later controls and Back to maps visible. The new-run notice remains outside the collapsed section. Show controls restores the same selections. This does not rerender, recenter, change or redownload the displayed charts. Desktop and mobile layouts are covered; the existing Forecast sequence controls are unchanged.

## Measured before/after

Review run **38301568738** used independent cold Chromium contexts on the same hosted runner, with the real IFS source grids, real raster workers, MSLP vectors and grid-value labels. To isolate forecast work, the benchmark used a blank basemap with glyphs, not the complete background-map tile service. It reproduced the exact run/window/area combination above at a 1664 × 940 viewport.

| Measurement | Before | After |
| --- | ---: | ---: |
| First panel ready | 35.839 s | 15.361 s |
| All three panels ready | 98.348 s | 40.151 s |
| All three after one-hour advance | 92.711 s | 7.911 s |
| Return to already rendered time | 0.083 s | 0.060 s |
| Initial native precipitation decodes | 432 | 216 |
| Initial provider requests (including metadata/HEAD/ranges) | 2,583 | 1,428 |

The first full comparison was about 59% quicker in this test; the next-hour comparison about 91% quicker. Network conditions, device performance, map extent and cache state can change actual user times. The next-hour test follows the initial comparison and permits normal nearby-frame warming; it is not a cold-start measurement. These results do not imply that a first uncached long-period total is instantaneous.

The baseline and optimized screenshots' three rendered weather panels were pixel-identical: comparison of RGB pixels in bounding box (12, 550, 1651, 1088) returned no differences. Their run and period captions also matched. Full screenshots differ in controls and elapsed-time text, as expected.

An independent UKV numerical check used 1,024 native cells for a six-hour window from the then-published 15Z run; maximum discrepancy from an independent sum was 3.73e-8 mm. A one-hour advance read one additional native input. A 24-hour window was not yet published in that arriving run and was correctly not claimed as verified in this check.

## Regression verification

The review passed 269 Node tests, including new exact-result reuse, buffer ownership, native subregion indexing, pipeline scheduling, cancellation, memory bounds and grid-shape checks. It also passed real IFS before/after rendering, independent UKV arithmetic, accumulation/history tests at 1280 px and 390 px (including Hide/Show without image reload), existing chart-style and PNG/clipboard tests, and the existing map playback/briefing suite. Tested application files were committed to review branch commit `d404576c6965f46c58107f51d982ffa9aaa19f3f` before promotion.

Evidence: Actions run 38301568738, artifact `verified-accumulation-speed` (11770748004), includes the original benchmark JSON, screenshots, numerical report, test logs and verified patch. `tests/ifs-history-live-browser.mjs` preserves the dated reproduction; its fixed historical files are subject to the provider's archive retention and this is not a permanent live-feed availability test.
