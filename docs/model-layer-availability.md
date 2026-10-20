# Model comparison availability

The weather-layer menus use the compact selection restored on 20 October 2026,
filtered to fields published for the selected model run:

- Temperature: 1000, 850, 500 and 250 hPa.
- Wind: 1000, 500, 300 and 200 hPa.
- Relative humidity: 1000, 700 and 300 hPa.
- Geopotential height: 500, 300 and 200 hPa.
- Height-level temperature and wind: 50, 100, 200 and 300 m, alongside standard
  2 m temperature and 10 m wind.
- Cloud: total, low, middle, high and near-surface cloud, where supplied.

Other native levels remain available internally for derived charts. They do not
add long profiles of temperature, wind, cloud, humidity or height to the menus.

The same catalogue serves the main panels, forecast sequences and archived-run
comparisons. Wind arrows require both components, or speed and direction, from
one source. Companion sources must match the selected initialization.

The menu retains the established 700 hPa vertical-motion chart. Internally,
additional pressure-level vertical motion is supported on the six verified
deterministic feeds wherever same-source velocity and temperature are supplied.
The hydrostatic conversion uses that level’s pressure, not a fixed 700 hPa
density. JMA’s native pressure velocity is converted directly to 0.1 Pa/s.
The existing combined 700 hPa height/wind chart remains unchanged.

## Added native GEM comparison feed

`snowline_gem_upper` imports ECCC GDPS GRIB2 fields on the native 0.15° grid,
cropped to 66°W–35°E and 30–75°N:

- Temperature: 1000, 850, 500 and 250 hPa.
- Height: 500, 300 and 200 hPa.
- Relative humidity: 1000, 700 and 300 hPa.
- Wind components: 1000, 500, 300 and 200 hPa.

These complement the existing native 700 hPa omega/height/wind feed. The public
ECCC catalogue contains further parameters and levels; this importer covers the
previous comparison menu's principal fields, not the entire GDPS archive.
Metadata, GRIB parameter, pressure level, units, scan direction, grid,
initialization and validity are checked before publication. Upper-air frames are
three-hourly through T+168, then six-hourly through T+240, matching the common
availability of the high-level fields.

## Added MOGREPS-G fields

The native 18 same-cycle members supply 500 hPa height mean and population SD,
300/200 hPa scalar wind-speed means and SDs, and MSLP mean and SD. Scalar mean
wind speed has no direction arrows: it is not the magnitude of a mean vector.

The 500 hPa anomaly subtracts NOAA NCEP/NCAR Reanalysis 1 daily 1991–2020
500 hPa climatology from the ensemble-mean height. Only the climatological grid
is bilinearly interpolated. Forecast cells stay native. February 29 uses the
average of February 28 and March 1. This is a reanalysis-relative anomaly,
not a hindcast-calibrated model anomaly. Missing members remain missing.

Sources:

- https://eccc-msc.github.io/open-data/msc-data/nwp_gdps/readme_gdps-datamart_en/
- https://registry.opendata.aws/met-office-global-ensemble/
- https://psl.noaa.gov/thredds/catalog/Datasets/ncep.reanalysis.derived/pressure/catalog.html

Additional MOGREPS fields are prepared incrementally (24 forecast frames per
publication), retaining the existing temperature/precipitation frames during
conversion. Field-specific valid times prevent extrapolation across unpublished
hours. Failed additions are retried. The health check includes these missing
field-hours and the new GEM feed.

## Audit and deliberate exclusions

`node scripts/audit_map_layers.mjs` checks every map model against live run
metadata, listing offered layers, undescribed fields, unavailable inputs and
publication notices. A field existing somewhere in a provider's archive does
not establish that it is ingested in a particular model/grid/run.

Unknown categorical codes, unverified native spread units, ocean-vector
products and unsupported derived diagnostics are not assigned an unrelated
colour scale. MSLP remains available as the pressure overlay. The audit reports
these exclusions rather than asserting that every raw provider parameter has
been implemented.

The GEM upper-air and complete MOGREPS-G grids are published under the existing
Snowline Ensembles companion site. This keeps the main site below its Pages
size limit without removing its existing archived model runs.
