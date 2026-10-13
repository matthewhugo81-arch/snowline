# UKV selection and ensemble publication — 13 October 2026

The maps, Forecast briefing and Previous Run Analysis expose one UKV entry.
It retains the existing main-family selection (00/03/06/09/12/15/18/21Z) and all
supplied hourly valid forecast steps within each run. No nowcast is offered or
polled. Legacy nowcast URLs resolve to UKV. Low-level compatibility functions
remain tested. No initialization, horizon, numerical field or unit is invented.
Location charts, their model averaging and the point API are unchanged.

The probability-only GEFS 0.25°, GEFS 0.5° extended-range and ECMWF ENS 0.25°
entries are removed. HGEFS mean and the two official mean/standard-deviation
products remain, with their six original native fields and units.

The last observed scheduled publisher before this investigation ran at 03:06
UTC, before the 00Z official statistical products were available. The general
feed-health check was excluding both site-generated statistical products. It
now includes their metadata and a small native pressure-mean byte-range sample.
A new lightweight check compares the deployed initialization and available
frames with official GEFS mean/spread and ECMWF em/es source indexes. Source
errors are not interpreted as permission to substitute an older run.

The publisher uses an offset five-minute schedule and prepares the two ensemble
models concurrently, with four bounded workers per model. Existing grids are
reused. Every new grid still requires all six verified native fields. Publication
remains atomic. A separately timed 15-minute health workflow can request a
refresh when official data is missing from the site. An active-publisher and
ten-minute recent-run guard prevent overlapping or rapidly looping recovery.
Health is also checked after deployment. These are repository Actions, not
ChatGPT scheduled tasks. GitHub queue delays can still occur; removing UKV
nowcasts cannot accelerate the upstream provider's processing of main cycles.

The menu discloses an overdue publication check or a verified newer official
ensemble initialization while retaining the initialization of the actual data.
The prior fixed-period rainfall and tighter North Atlantic changes are included.
Backup: backup/uk-model-maps-before-fixed-periods-20261013 at
2b6282c44f768b3069aab9ffd4b815d20da28492. Release only reviewed map, test,
script, workflow and documentation files; preserve unrelated website code.
