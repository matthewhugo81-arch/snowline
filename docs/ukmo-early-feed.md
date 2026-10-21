# Direct early UKMO charts

The full UKMO spatial feed can lag the public Met Office native NetCDF files.
`snowline-ensembles/scripts/build_ukmo_early.py` publishes a bounded regional
subset to the existing companion site. Its freshness gate examines newly
available raw field-hours, independently of the intermediary's completed index.
The existing three-minute external scheduler supplies the trigger; no additional
scheduler or subscription is required.

The six fields are 2 m temperature, MSLP, 500 hPa height, 850 hPa temperature,
total cloud and precipitation. Native 0.140625° × 0.09375° cells are preserved
over the North Atlantic, UK and Europe (66°W–40°E, 30–75°N), with pressure-level
below-ground masks. Every file's initialization, valid time, coordinates,
pressure, units and precipitation bounds are verified. Inventory ETags pin HTTP
ranges to their source objects. A failed frame retains its previous publication.

The subset is always `completed:false`. The last verified complete run remains
the preferred run until the full feed completes. Same-initialization native
fields take priority, while direct later hours remain usable. A matching full
native completion establishes completeness without deleting a pinned early
source. Different initializations are never combined. The existing dated Run
choices and comparison-panel selection behaviour are preserved.

Only two early cycles are cached, with a 250 MB cache budget and the companion's
existing 1 GB total-publication guard. Four sampled frames at T+0, 3, 57 and 168
occupied about 4.1 MB including metadata. This is a sample, not a guarantee of
future source size. The conversion uses at most four workers and eight workflow
minutes; unavailable early data does not prevent the ordinary feed publishing.
The raw feed remains subject to Met Office release times and GitHub queue time.

No DataHub key is used, and the user's DataHub quota is not consumed. Attribution
and the CC BY-SA 4.0 licence are on the existing map credits page.
