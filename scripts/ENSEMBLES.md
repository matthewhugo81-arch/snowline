# Operational ensemble maps

`build_ensembles.py` reads the official NOAA GEFS 0.5° mean/SD products and ECMWF
IFS ENS 0.25° em/es products. It retains the full native global grid and publishes
six named OM arrays per forecast time: 500 hPa geopotential height, 850 hPa
temperature and mean sea-level pressure, each as ensemble mean and standard
deviation. GEFS products currently contain 30 perturbed members; ECMWF contains
51 members. These six fields use the provider's statistics.

## Additional map fields

`build_ensemble_extras.py` publishes exact-cycle companions under
`snowline_gefs_extra_v2` and `snowline_ecmwf_extra_v2`. It retains native cells within
66°W–36°E, 31–74°N, covering all four map presets. The original global six-field
feeds and pressure overlays remain available. Metadata lists actual times for
each variable. A missing member/frame never becomes zero, and a companion from
a different initialization is never attached.

GEFS adds mean 2 m temperature, relative humidity, 10 m vector-wind magnitude,
cloud cover, snow depth, CAPE and precipitation. These are NOAA's official
30-perturbed-member statistics. Vector magnitude differs from the average of
member speeds because opposing winds cancel. Additional 300/1000 hPa heights
and 250/500 hPa temperatures have mean and standard deviation.

ECMWF adds those upper-air statistics plus 250/850 hPa wind-speed mean/spread,
and official probabilities of at least 1, 5, 10, 20, 25, 50 and 100 mm in 24 hours.
Probability frames are 12-hourly from T+24; each describes the preceding 24 hours.
GRIB template, threshold (mm), units (%) and period are verified.

ECMWF surface means (2 m temperature/dew point, 10 m speed/gusts, cloud,
precipitation and snowfall water equivalent) use all 51 members. With IFS 50r1
the control is `oper/fc`, the documented replacement for `enfo/cf`:
https://confluence.ecmwf.int/spaces/FCST/pages/554148365/Data+streams+and+types+to+be+discontinued+in+IFS+cycle+50R1+and+user+impact
All 50 `enfo/pf` members plus CTRL must have matching cycle, parameter, level,
grid and reporting period. Wind speed is the arithmetic mean of member speeds.
Missing cells propagate through the mean; the denominator never shrinks.

Precipitation and snowfall means are displayed in mm/h. GEFS retains its actual
overlapping 3/6-hour reporting periods. ECMWF cumulative means are differenced
at consecutive native steps (3-hourly to T+144, then 6-hourly), then divided by
the interval length. Small packing roundoff is clipped at zero; decreases over
0.05 mm fail validation. Marginal precipitation spreads are not differenced.
These rate fields are not raw amounts for the rolling-total reader. Snow depth
is centimetres; snowfall is liquid-water equivalent. Gust and GEFS cloud
averaging periods are retained independently of the file cadence.

The first ECMWF surface preparation downloads many member fields. Completed
frames and cumulative means are cached; later passes prepare only missing
frames. Additional fields are published for the latest run only, to retain native
resolution within the existing hosting size allowance. The original six-field
three-run archive is unchanged. Partial companions expose only verified
variable/time pairs and are labelled as still being prepared. Raw calculation
caches are excluded from the Pages artifact. No initialization is altered.

Checks: `node --test tests/ensemble-extra.test.mjs` and
`python -m unittest discover -s tests -p 'test_ensemble_extra.py'`.
`tests/ensemble-extra-browser.mjs` exercises converted real forecast grids on
desktop and phone layouts when supplied a local preview with scratch data.

GEFS: 0–240 h every 3 h, then every 6 h to 384 h, four cycles/day.
ECMWF: 0–144 h every 3 h, then every 6 h to 360 h, 00/12 UTC cycles.
The published run's actual metadata drives the browser timeline.
If ECMWF's primary server is rate-limited or temporarily unavailable, both the
publisher and source check use ECMWF's official Google Cloud replica. Each
binary uses the same mirror as its index so byte offsets cannot cross sources.
Missing products remain missing; failed mirrors remain visible as check errors.

All GRIB identities, units, statistic codes, grid shape, scan directions, cycle
and lead times are validated before publishing. Mean temperature is K−273.15;
temperature SD is unchanged. Pressure values are Pa/100. Geopotential height
is retained in geopotential metres. Grids are reordered to south-to-north and
−180° to +180°, without regridding or temporal interpolation. OM precision is
1 m for mean height, 0.1 for most other arrays and 0.01°C for temperature SD.

The `Publish Snowline and ensemble maps` workflow runs on main pushes, requests
a scheduled run every five minutes, and supports manual runs. GitHub scheduled
timing is best-effort and can leave gaps longer than the requested interval.
A forecast hour is exposed only after all six arrays succeed. Missing hours
are retried on the next build, while verified frames remain available.
An independent health workflow requests checks every ten minutes and dispatches
the publisher when an official cycle/hour is missing, the three-run archive
needs repair, or the published source check is over 30 minutes old. Recovery
skips active publishers and uses a ten-minute cooldown to prevent duplicate
builds. Provider/network failures remain visible; they never alter run times.

The publisher retains the latest run and two completed predecessors within
48 hours, including their full available native horizons. Missing predecessors
are backfilled from official exact-cycle GRIB products. Archive preparation
cannot change `latest.json`; failed or incomplete predecessors never stand in
for another initialization. `history.json` lists the retained verified cycles.
Previous Run Analysis loads each cycle's own metadata and compares all six
mean/spread fields at common valid times. Metadata discovery does not preload
the entire archive. One incomplete backfill is also retained for retry.

The menu distinguishes `new run pending`, `more hours pending`, `source check
failed`, `older run`, and `check overdue`. The last means the published official
source check is over 45 minutes old, not that a newer run is known to exist.
Run-age review thresholds are 12 hours for GEFS and 20 hours for ECMWF. None of
these statuses changes the initialization time attached to the actual grids.

Pages must use **GitHub Actions** as its build source. The deployment artifact
contains the site plus prepared data; forecast binaries are never committed to
Git. Typical two-model run size is about 240 MiB before artifact compression.
No service credentials or paid forecast API are required.

Local verification:

```sh
pip install -r scripts/ensemble-requirements.txt
python -m unittest discover -s tests -p 'test_ensemble*.py'
python scripts/build_ensembles.py
node --test tests/*.test.mjs
```

GitHub Pages applies HTTP gzip to `.om` and returns ranges of compressed bytes,
which breaks binary random access in browsers. During artifact assembly only,
files receive an `.om.png` transport suffix to select a non-compressed MIME type.
They remain OM binary data, not pictures. `map-ensemble-transport.js` adapts the
public renderer reader's `withReader` entry point for our own data URLs only;
the bundled renderer stays unmodified. Logical URLs and cache keys retain `.om`.
The preview server must support HEAD with Content-Length and HTTP byte ranges,
and serve `.om.png` paths from their matching `.om` files with `image/png` MIME.
`--hours` is only for a scratch validation output and must not be used for the
production deployment. The browser renderer, comparison, contours, grid values
and full-forecast tile cache all use the same OM paths as other model layers.

### Compact ensemble reads (20 October 2026)

The core GEFS/ECMWF statistical files, their extra-field bundles and MOGREPS-G
use a separate 64 KiB native block cache, bounded to 16 MiB. The general spatial
reader retains its existing 256 KiB blocks and 32 MiB limit. These compact
ensemble files otherwise fetched large blocks of unrelated fields when reading
the file directory and a small regional grid. The smaller blocks apply at both
Snowline publication origins; other feeds, including native HGEFS and
MOGREPS-UK, retain their existing transport. File URLs, run identities, native
grid cells, statistics and rendering are unchanged. Existing rendered tiles
remain reusable, so this transport update does not discard the image cache.

Cold native reads of 500 hPa height mean plus MSLP mean were compared using the
bundled decoder and the same published file/cells for each pair:

| Model and extent | Previous bytes (KiB) | New bytes (KiB) |
| --- | ---: | ---: |
| GEFS, UK | 512 | 256 |
| GEFS, North Atlantic | 512 | 256 |
| ECMWF ENS, UK | 768 | 320 |
| ECMWF ENS, North Atlantic | 768 | 384 |
| MOGREPS-G, UK | 768 | 256 |
| MOGREPS-G, North Atlantic | 768 | 256 |

SHA-256 checks of the decoded arrays matched before and after the change for
all six comparisons. Repeating the same reads through the new cache required
no further network requests. These are transfer-size measurements from the
20 October samples, not guaranteed wall-clock speedups: some fields use more,
smaller HTTP requests. The 64 KiB choice balances transfer size against request
latency; 32 KiB added further round trips in the ECMWF comparisons.

`tests/ensemble-transport.test.mjs` covers source/run isolation, the unchanged
normal-model cache, concurrent ENS/native reads, callbacks, cancellation and
errors. Browser performance checks must retain the real OM transport: the
general map-control browser fixture substitutes synthetic weather data and
therefore cannot establish real ENS loading throughput.

Live Chromium comparisons used fresh contexts, the same published run and view,
and an override of this transport module only (terrain disabled). Initial 2 m
mean/MSLP transfers fell from 708,118 to 315,098 bytes for GEFS 20 October 12Z,
and from 787,423 to 328,668 bytes for ECMWF ENS 20 October 00Z. In a GEFS 500 hPa
North Atlantic ten-second sample, 22 versus 24 of 105 frames were prepared while
cumulative native transfers fell from 13,850,081 to 7,789,228 bytes. ECMWF
background throughput remained around 10–11 frames per ten seconds; this is a
download-efficiency improvement, not a promise of instantly loading a full run.
Cached returns made no new native requests for the revisited forecast. Desktop
and 390 × 844 mobile checks retained geography, contours and correct run/valid
labels without JavaScript errors. Network/CDN caching and software rendering
affect elapsed-time comparisons, so the byte reductions are the stronger result.
