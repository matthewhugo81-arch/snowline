# Ensemble probabilities and temperature anomalies

The Weather layer menu contains **Ensemble probabilities** and **Temperature
anomalies**. Temperature anomalies are restricted to MOGREPS-UK and remain
disabled until verified HadUK-Grid min/max climatology is installed. The user
explicitly chose to wait for HadUK-Grid rather than substitute a coarse baseline.

## Probability definitions

- Gusts: >50, >60 or >70 knots over 12 or 24 hours. MOGREPS uses every hourly
  maximum. ECMWF uses available interval maxima at three-hour output steps;
  early intervals cover only one hour, so peaks between outputs can be missed.
  GEFS uses instantaneous gust outputs every three hours. EC/GEFS must not be
  described as equivalent to complete hourly MOGREPS maxima.
- Rain: >=1, >=10, >=25 or >=50 mm over 12 or 24 hours. ECMWF subtracts native
  snowfall water equivalent from total precipitation, member by member.
  MOGREPS uses rainfall fields, including the separate convective component for
  MOGREPS-G.
- Snow: >=0.1, >=1, >=5 or >=10 mm liquid-water equivalent over 12 or 24 hours.
  MOGREPS-G includes both resolved and convective snowfall. No fixed snow/liquid
  ratio, snow-depth difference or settling inference is used.
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

## Installing the temperature baseline

Download these files through the user's CEDA account, accepting the applicable
HadUK-Grid licence:

- `tasmin_hadukgrid_uk_1km_mon-30y_199101-202012.nc`
- `tasmax_hadukgrid_uk_1km_mon-30y_199101-202012.nc`

Run `python scripts/temperature_climatology.py /path/to/files`. It validates
period, units, grid and file provenance and writes
`climatology/haduk-extrema-1991-2020.npz`. Publishing that verified baseline
enables the anomaly builder. No CEDA credentials should be committed.

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
