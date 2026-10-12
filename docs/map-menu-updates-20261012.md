# Map menu updates — 12 October 2026

The shared layer menu retains only these standalone pressure-level fields, when supplied by the selected model:

| Field | Pressure levels (hPa) |
| --- | --- |
| Temperature | 1000, 850, 500, 250 |
| Wind speed and direction | 1000, 500, 300, 200 |
| Relative humidity | 1000, 700, 300 |
| Geopotential height | 500, 300, 200 |

This is a menu filter, not deletion of the underlying source variables. Native 850 hPa humidity and 400 hPa winds remain available internally for existing theta-w and vorticity diagnostics. Surface fields, ensemble statistics, map styles and geometry are unchanged.

## Native 2 m temperature extrema

At 08:12 UTC all 21 map choices were checked with the same `loadSpatialModel` run selection as the website. Only `ecmwf_ifs` (IFS 9 km) and `ecmwf_ifs025` (IFS 0.25°) advertised both `temperature_2m_max` and `temperature_2m_min`. Neither UKV main-run nor hourly-nowcast metadata advertised these fields. The full model summary is in `temperature-extrema-audit-20261012.json`.

An additional check inspected individual OM file headers using the bundled reader. Both extrema were absent at initialization, present at the sampled forecast times, and retained at the checked longer leads. IFS 9 km was sampled at T+0–7, 90, 93, 144, 150 and 360 h; IFS 0.25° at T+0–21 every 3 h, 90, 93 and 144 h. Data-variable children exposed a unit attribute, but no reporting-period bounds.

The layers are therefore explicitly native-period maximum/minimum, not daily maxima/minima. Neither file spacing nor playback cadence is used to invent the extrema period. Initialisation time is excluded, and the map legend and briefing captions say the duration is unspecified. Both extrema use the same Celsius palette as ordinary 2 m temperature.

Briefing presets are available only when a run supplies the corresponding extreme and pressure fields. No UKV extrema are fabricated or substituted from IFS. A newly supplied compatible field can appear automatically via the existing availability filter.

Provider references: Open-Meteo `Sources/App/Ecmwf/EcmwfVariable.swift` maps these extrema from mx2t3/mx2t6/max_2t and mn2t3/mn2t6/min_2t, uses backward interpolation, and stores Celsius. The UKMO API documentation distinguishes daily aggregates from native spatial fields.

- https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Ecmwf/EcmwfVariable.swift
- https://github.com/open-meteo/open-data#data-organization
- https://open-meteo.com/en/docs/ukmo-api

## Briefing model runs

The lazily created briefing selector attaches to the existing model-run menu service. It immediately reuses verified run-date/UTC-cycle labels, including UKV family separation and updating/failure states; it does not start a second metadata poller. Selected-run verification updates the shared labels in the main and briefing menus. Short- and medium-term grouping matches the main view for existing briefing-supported models.
