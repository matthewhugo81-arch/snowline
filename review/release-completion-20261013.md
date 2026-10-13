# Release completion check — 13 October 2026

Production commit: 83e2a4a3cfb7ace2a1c34ebe9f1be3b8ac6a8d51.
Publish Snowline and ensemble maps run 38373951380: build and Pages deployment
both completed successfully. Production regression run 38373951396 succeeded.
The exact pre-publication code passed operational review run 38372398285:
297 Node tests, 13 Python tests, full desktop/mobile maps and briefing tests,
and fixed-period rainfall/Atlantic desktop/mobile tests. The main-branch browser
workflow repeats those checks independently after publication.

## Deployed data check, 09:08 UTC

Post-deployment feed-health run 38374168640, artifact 11800626408:
- GEFS mean/spread: 13 October 00Z, 105 frames, completed, T+384.
- ECMWF ENS mean/spread: 13 October 00Z, 85 frames, completed, T+360.
Both matched the newest verified official statistical product at 09:08:28 UTC.
Both deployed OM binary range probes returned HTTP 206 with the correct 64-byte
range. Small range response times were 95 ms GEFS and 139 ms ECMWF, not full
chart-rendering measurements.

The only warning in the general offered-model check at 09:08:35 UTC was UKV:
03Z still incomplete, through T+31, initialization older than its six-hour review
threshold. This is an upstream Open-Meteo spatial-feed delay, not hidden by the
release. The earlier 08:36 audit found the UKV 06Z path not published (HTTP 404).
The post-deployment health workflow intentionally remained failed/red for this
UKV warning; ensemble source-to-site comparisons passed with no refresh needed.
Do not describe the whole feed-health run as green or the UKV delay as resolved.

## Released behavior

One UKV entry across maps, Forecast briefing and Previous Run Analysis; only
00/03/06/09/12/15/18/21Z main initializations. All supplied hourly forecast valid
steps remain. No separate hourly-nowcast menu entry. Legacy nowcast URL selection
resolves to UKV. Main-run arrival checks remain frequent and honest about partial
coverage; no artificial three-hour polling delay is added.

Removed probability-only GEFS 0.25, GEFS 0.5 extended and ECMWF ENS probability
entries and their menu polling. HGEFS mean and both official mean/spread products
are retained. The separate upstream HGEFS product is not relabelled as a newer
GEFS run.

Ensemble generation is concurrent, with bounded workers and unchanged native
GRIB validation. An offset five-minute publisher schedule plus a separately timed
15-minute official-source health check and guarded automatic recovery are in
place. These are GitHub repository workflows, not ChatGPT reminders. GitHub
scheduling delays and upstream publication timing are not guaranteed away.

Fixed, consecutive non-overlapping rainfall periods from a chosen start are now
used in briefing and Previous Run Analysis; interval indicator matches the total.
Only full periods are shown. The tighter Atlantic preset uses [-65,35,35,73].
Hide/show controls retain prepared imagery without re-downloading. Earlier real
three-run 48-hour IFS measurement: first chart 10.150 s, all three 23.296 s,
cached return 0.058 s with no network requests. Cold long-period totals still
need appreciable data retrieval; measurements are specific to the hosted runner.

Rollback branch backup/uk-model-maps-before-fixed-periods-20261013 remains at
2b6282c44f768b3069aab9ffd4b815d20da28492. Release was assembled from tested
blob hashes onto the original main tree, excluding all review scaffolding and
leaving unrelated location-chart application files unchanged.
