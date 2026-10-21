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
