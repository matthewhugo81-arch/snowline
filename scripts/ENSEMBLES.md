# Operational ensemble maps

`build_ensembles.py` reads the official NOAA GEFS 0.5° mean/SD products and ECMWF
IFS ENS 0.25° em/es products. It retains the full native global grid and publishes
six named OM arrays per forecast time: 500 hPa geopotential height, 850 hPa
temperature and mean sea-level pressure, each as ensemble mean and standard
deviation. GEFS products currently contain 30 perturbed members; ECMWF contains
51 members. We use the provider's statistics, not a reconstructed ensemble.

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
