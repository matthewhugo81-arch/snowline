# Ensemble probabilities and temperature anomalies

The Weather layer menu contains **Ensemble probabilities** and **Temperature
anomalies**. Temperature anomalies are restricted to MOGREPS-UK and ECMWF ENS.
ECMWF anomalies stop at Day 6 (T+144), where complete 09–09 UTC windows end. The verified
HadUK-Grid v1.3.2.0 1991–2020 baseline is installed; both extrema layers load
on selection, with no new ordinary-startup requests.

## Probability definitions

- Gusts: >50, >60 or >70 knots over 6, 12 or 24 hours (GEFS: 12/24 only). MOGREPS uses every hourly
  maximum. ECMWF uses available interval maxima at three-hour output steps;
  early intervals cover only one hour, so peaks between outputs can be missed.
  GEFS uses instantaneous gust outputs every three hours. EC/GEFS must not be
  described as equivalent to complete hourly MOGREPS maxima.
- Rain: >=1, >=10, >=25 or >=50 mm over 6, 12 or 24 hours. ECMWF subtracts native
  snowfall water equivalent from total precipitation, member by member.
  MOGREPS uses rainfall fields, including the separate convective component for
  MOGREPS-G.
- Snow: >=0.1, >=1, >=5 or >=10 mm liquid-water equivalent over 6, 12 or 24 hours.
  MOGREPS-G includes both resolved and convective snowfall. No fixed snow/liquid
  ratio, snow-depth difference or settling inference is used.
- MOGREPS-UK air temperature: minimum <=0, <=-2, <=-5 or <=-10°C during
  each complete 24-hour period ending 09 UTC. Count the 18 member minima at or
  below each threshold, including equality. This reuses the hourly minimum
  input for anomalies, requires no climatology, and does not predict surface
  freezing or damage directly. Existing retained minimum tasks are upgraded
  when their threshold grids are missing.
- GEFS rain/snow: occurrence from its native six-hour mean categorical flags.
  A positive flag in either/some constituent interval means occurrence for that
  member. GEFS also supplies total-precipitation threshold probabilities; these
  include frozen precipitation and are labelled accordingly.

ECMWF uses 50 perturbed members plus CTRL; GEFS uses 30 perturbed members plus
control. MOGREPS-G uses 18 same-cycle members. MOGREPS-UK uses six consecutive
hourly cycles (three distinct members each), aligned to the same valid window.
UK publication anchors every six hours and uses the common forecast coverage
of all six cycles, initially through T+108 h. Global products initially extend
through T+120 h. Grids cover the UK and nearby waters; they do not fabricate
coverage across the full North Atlantic map preset.

Extrema/sums are calculated before counting members. Missing members or source
intervals prevent publication; missing cells stay missing. Source GRIB packing
error bounds permit only small negative rounding residuals to be clipped when
differencing cumulative precipitation or subtracting snowfall from total water.

Six-hour gust/rain/snow products are available for ECMWF ENS, MOGREPS-UK
and MOGREPS-G at six-hour endpoints. Existing 12/24-hour products keep their
12-hour endpoints. Cold-temperature probabilities remain 24-hour 09–09 UTC
products. Probability menus sort by duration (6, then 12, then 24 hours),
including native ECMWF 24-hour precipitation probabilities.

## Loading and publication

`ensemble-products.yml` runs independently of `publish-maps.yml`. Ordinary map
startup makes no additional product metadata or grid requests. Selecting a new
product reads a small publication pointer and metadata, then renders precomputed
OM grids through the existing byte-range reader and frame cache. No native
ensemble processing runs in the browser.

The generated `ensemble-products` branch is a disposable data publication, never
an application branch. A force-with-lease replaces only this branch with a
snapshot containing two retained runs per model and a pointer commit. This
avoids unbounded Git data history. Charts pin the snapshot SHA, so incremental
publication cannot mix cached OM headers and new array chunks. Independent model
failures retain the previous model snapshot. Source member files are scratch
data and never uploaded.

Briefing View offers the same optional product groups without requiring a main-map
selection first. Selecting a product loads its separate metadata and uses its
actual initialization, validity intervals and available frames for the panel
sequence. Ordinary briefing charts make no optional-product requests.

## Installing the temperature baseline

The following files were downloaded through the user's CEDA access on
21 October 2026 (archive v1.3.2.ceda, version v20260512):

- `tasmin_hadukgrid_uk_1km_mon-30y_199101-202012.nc`
- `tasmax_hadukgrid_uk_1km_mon-30y_199101-202012.nc`

Run `python scripts/temperature_climatology.py /path/to/files`. It validates
period, units, grid and file provenance and writes
`climatology/haduk-extrema-1991-2020.npz`. Publishing that verified baseline
enables the anomaly builder. No CEDA credentials are committed. The compact
5.4 MB reference is used only by the independent data publisher and excluded
from the website bundle. Source NetCDF files are not committed. See
`climatology/README.md` for attribution, checksums and preparation details.

The first implementation uses monthly normals of daily extrema, with forecast
24-hour windows ending 09 UTC to match HadUK definitions. Minimum uses the end
date's normal; maximum uses the start date's normal. This differs from the UKPP
day/night charts against daily NCIC climatology and is explicitly labelled.
For a future exact daily reference, derive smoothed calendar-day normals from
the historical daily HadUK files and validate their observation windows.

## Validation

Run `python -m unittest discover -s tests -p test_ensemble_products.py`,
`node --test tests/*.test.mjs`, and `node tests/ensemble-products-browser.mjs`.
The existing 143-frame desktop/phone interaction test remains part of release
validation. Live-source smoke builds use `--max-hour 24` in a scratch output
directory; reduced validation runs are never used as the operational horizon.
