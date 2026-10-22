# HadUK-Grid temperature reference

Contains Met Office data © Crown copyright, licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

Source: HadUK-Grid v1.3.2.0, CEDA archive v1.3.2.ceda, file version v20260512.
1991–2020 monthly normals of daily minimum and maximum temperature, 1 km grid.
Downloaded with authorised CEDA access on 21 October 2026. Original filenames
and SHA-256 checksums are recorded in `manifest.json`; credentials and source
NetCDF files are not included.

Prepared using `scripts/temperature_climatology.py`. The British National Grid
reference is sampled at native 2 km MOGREPS-UK cell centres. January–December
ordering, extrema statistic, units, period and grid are verified. The land mask
is retained; missing and inconsistent min/max pairs are excluded. One mapped
September cell had a minimum 0.10 °C above its maximum and is excluded from both.

The compressed reference is only a publication input. It is excluded from the
website bundle and is never fetched by chart viewers. Re-run preparation only
when intentionally updating the baseline, then update its manifest/checksum.

[Met Office definitions and licence](https://www.metoffice.gov.uk/research/climate/maps-and-data/data/haduk-grid/datasets)

[CEDA minimum normals directory](https://data.ceda.ac.uk/badc/ukmo-hadobs/data/insitu/MOHC/HadOBS/HadUK-Grid/v1.3.2.ceda/1km/tasmin/mon-30y/v20260512/)

[CEDA maximum normals directory](https://data.ceda.ac.uk/badc/ukmo-hadobs/data/insitu/MOHC/HadOBS/HadUK-Grid/v1.3.2.ceda/1km/tasmax/mon-30y/v20260512/)

ECMWF ENS anomalies use `haduk-extrema-1991-2020-ecmwf.npz`: original valid 1 km HadUK land cells are averaged within each published 0.25-degree cell (-16 to 10 E, 46 to 63 N). Cells without UK observations stay missing. This matches spatial support approximately; it does not correct model elevation or forecast bias. The manifest records the prepared checksum and original source checksums.

The forecast uses all 51 member extrema over complete 09-09 UTC windows. Native three-hour extrema are available through T+144. Later six-hour intervals cannot partition a 09-09 window, so these anomaly charts intentionally stop at the last complete window before that change; no interpolation or shifted observation period is substituted.

## Republic of Ireland supplement

The UK-only reference was the reason Ireland was blank: model forecasts cover
Ireland, but subtracting a missing HadUK normal produces a missing anomaly.
There is no temperature-anomaly clipping polygon in the browser.

`met-eireann-extrema-1991-2020.npz` and its `-ecmwf` counterpart contain
Met Éireann's **1991–2020 monthly normals of daily minimum and maximum air
temperature**, from the [V2 temperature grids](https://www.met.ie/climate/30-year-averages),
downloaded 22 October 2026. The archive has 70,091 supplied land points on a
1 km Irish Grid TM65 (EPSG:29902) grid. Source and prepared checksums, URLs and
grid methods are recorded in `ireland-manifest.json`.

Reproduce with:

```
python scripts/ireland_temperature_climatology.py /path/to/IE_TEMP_9120_V2.zip
```

The preparation pins the original ZIP and individual extrema checksums and
validates the month order, Celsius units/range, common coordinates and min/max
ordering. MOGREPS samples the containing supplied 1 km cell at each native
forecast centre; ECMWF averages supplied land points in each 0.25° cell.
No nearest-land extrapolation fills the sea, islands or missing source cells.
The existing HadUK artifacts are unchanged. The loader adds the Irish pair
only where both UK extrema are missing; existing valid UK values, including
Northern Ireland and mixed border cells, take precedence exactly.

The supplements total about 0.61 MB and remain publication inputs excluded
from the website bundle. Browser requests, grid dimensions, range reads,
palettes, forecast windows and member requirements are unchanged. A baseline
fingerprint invalidates only retained extrema tasks; obsolete anomalies are
hidden during rebuilding, while existing probability tasks are reused.

These are monthly observation-relative anomalies, not a daily climatology or
a model hindcast correction. Station networks, observation practices, gridding
and terrain support differ between HadUK and Met Éireann. A discontinuity near
the border is possible; coarse cells with existing HadUK data retain that
reference. Coastal gaps follow the supplied grids. There is no bias or elevation
correction, no extension beyond the model domain, and no relaxation of complete
member/window requirements. Older archived runs can retain UK-only coverage.

Copyright Met Éireann. Source: [met.ie](https://www.met.ie/). This data is
published under a [Creative Commons Attribution 4.0 International licence](https://creativecommons.org/licenses/by/4.0/),
with [Met Éireann's open-data notice](https://www.met.ie/about-us/specialised-services/open-data).
Met Éireann does not accept any liability whatsoever for any error or omission
in the data, their availability, or for any loss or damage arising from their
use. Snowline has mapped the reference to the model grids and subtracted it
from ensemble forecasts. Original source files are not included.
