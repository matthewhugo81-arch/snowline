# Operational map release validation — 13 October 2026

## Tested source and scope

Operational review: Actions run 38372398285, successful; tested commit
cb7a87515db6e9574d8c493ea31c1fc48ec4ae36. All 297 Node tests and 13 Python
ensemble tests passed. Full desktop (1280px) and phone (390px) browser tests
passed, including single UKV menus, no polling of removed probability-only
products, retained mean/spread fields, paired maps, looping and forecast briefing.
Fixed-period rainfall and Atlantic framing tests passed at both widths.

Earlier fixed-period review: Actions run 38368825797. All 298 then-current
Node tests and five browser/live suites passed. Its final review-branch push
failed, but its tested source commit b41b5722a490a684dfb1ce06cc8f13e4bec93e7c
was available and formed the base of the successful operational review.
The later test count is lower because four removed menu entries are no longer
iterated by per-model tests and three new operational tests were added.

Release files are selected by exact tested blob hashes onto the prior main tree.
Review scripts, workflows and payloads are not included. Unrelated location-chart
application files and existing backup branches are unchanged. Rollback point:
backup/uk-model-maps-before-fixed-periods-20261013 at
2b6282c44f768b3069aab9ffd4b815d20da28492.

## Native ensemble verification

At 08:54:40 UTC, both prepared runs matched the newest verified official source
initialization, 13 October 2026 00Z. GEFS: 105 frames, completed, T+384. ECMWF
ENS: 85 frames, completed, T+360. All six mean/standard-deviation fields were
checked in first, middle and final OM files, with valid UTC timestamps retained.
The normal GRIB parameter/statistic/cycle/grid/unit checks remained enabled.
These are pre-deployment results; later cycles can arrive during publication.

## Provider versus website timing

The 08:36 UTC source audit found UKV 03Z still incomplete (21 valid times, through
T+20), UKV 06Z returning HTTP 404, and the completed UKV 00Z through T+54. The
live pointer had an intervening 04Z analysis. Selecting only main cycles therefore
removes unnecessary nowcasts but cannot accelerate Open-Meteo's upstream work.

The same audit found the website's statistical GEFS still at 12 October 18Z and
ECMWF at 12 October 12Z, despite official 13 October 00Z products being available.
The last observed publisher had run at 03:06 UTC, before those official products
were ready. This is why the new health check includes both locally generated
feeds and can request guarded publication recovery. Five-minute and 15-minute
schedules are intended checks, not guaranteed GitHub start-time service levels.
HGEFS is a separate provider feed and is not relabelled or regenerated from GEFS.

## Chart loading measurements

Real three-run IFS 9 km comparison, 48-hour totals ending 14 October 12Z, full
UK/Ireland basemap, MSLP and grid values enabled; hosted-runner measurement at
08:25 UTC. First chart: 10.150 s; all three: 23.296 s. Next full 48-hour period:
18.158 s. Returning to cached period: 0.058 s, zero new network requests.
Three real Atlantic composite charts: 15.126 s. These measurements are not a
promise of identical user-device/network speeds. Large cold accumulation requests
remain materially heavier than revisiting a prepared chart.

The fixed-period UI avoids off-screen accumulation page preparation and renders
only complete available periods. Every native precipitation interval is still
included numerically. Hide/show preserves prepared imagery without re-downloading.
Raw logs, native samples, source audit, screenshots and timing metrics are retained
in the two review-run artifacts for seven days after the test runs.
