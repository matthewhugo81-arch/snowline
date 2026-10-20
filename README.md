# Snowline

GEFS and ECMWF ENS maps now include additional surface and upper-air ensemble
fields across the UK, Europe and North Atlantic map areas. Both include mean
precipitation in mm/h; ECMWF also includes mean snowfall water equivalent and
official 24-hour precipitation probabilities for thresholds of 1, 5, 10, 20, 25,
50 and 100 mm. Legends state the actual reporting period. ECMWF surface means
use all 51 members; GEFS uses NOAA's official 30-member statistics. Additional
fields appear only for verified times on the latest run; the original six-field
three-run archive remains available. See
[ensemble data definitions](scripts/ENSEMBLES.md).

UK model maps and local multi-model weather charts: snowfall, snow depth, temperature, dew point, humidity, precipitation, wind speed and wind gusts.

A static website using Open-Meteo. No build step is required. GitHub Pages serves the main branch from the repository root.

The header's **Theme** menu offers **System**, **Light** and **Dark** on location charts, UK maps and credits. System follows the device's appearance; an explicit choice is saved in this browser and shared across pages and open tabs. Dark mode includes chart lines and labels, data dialogs, map controls, Briefing and Previous Run Analysis. Forecast colour bands, map imagery and downloaded tables/images keep their existing palettes. Switching themes preserves the forecast selection, inspected hour and chart zoom.

**Compare panels** offers two or three independently selected model/layer panels with one shared valid-time control. The timeline includes the full available range of every visible panel, so a shorter or coarser model cannot hide another model's charts. At a time missing from one selected model/layer, that panel clears its weather and overlays and shows an availability message while the others continue. Returning to a supplied time restores its chart. Collapsing the sidebar widens every map; smaller screens stack the panels. A shared forecast-interval dropdown beside the starting time offers Hourly / all available, 3 hourly, 6 hourly and 12 hourly in the main maps, including UKV and mixed-model comparisons. Regional panels default to all supplied hours; an explicit choice applies to every panel and remains selected when models change. Viewing intervals are applied separately to each selected layer before combining the timeline, retaining coarse and off-cycle model steps. Precipitation periods are unchanged. Briefing and Previous Run Analysis retain their existing interval rules.

Open [Location charts](https://matthewhugo81-arch.github.io/snowline/) or [UK maps](https://matthewhugo81-arch.github.io/snowline/maps.html). The map page includes model comparison, weather layers, MSLP isobars, forecast animation and point event analysis. Maps default to the latest published initialization and show their actual UTC run date/cycle. UKV additionally offers exactly one previous completed main run. Click a map location to open its charts; navigation retains the chosen location and valid time.

Maps load live Open-Meteo spatial data and OpenFreeMap basemaps directly in the browser. The bundled map renderer, WebAssembly decoder and licences are in `vendor/`; see [map credits](map-credits.html). Wind speeds and gusts display in mph on maps, legends, contours, grid-value labels and point readouts; source grids and renderer scales retain native m/s.

**Arriving model runs:** all remote spatial models compare `in-progress.json` with `latest.json` and use the newest initialization with published hours. `completed: false` is supported: only the forecast times actually listed are requested. Maps and Briefing revalidate every 60 seconds while visible, append new hours, retain the chosen valid time where available, and label unfinished runs **Updating** with their current horizon. Failed checks keep verified displayed data and retry; an older response cannot roll an open page backwards. UKV menus contain only the latest main run and one previous completed main run, using 00/03/06/09/12/15/18/21Z initializations and retaining hourly valid steps. Both choices use the same operational model. The completed fallback rolls forward when a newer main cycle appears; incomplete intervening cycles are skipped. GFS companion fields must belong to the same initialization. Run selection uses UTC throughout, independently of BST/GMT. See [the provider's progressive publication contract](https://github.com/open-meteo/open-data#updates-to-real-time-weather-forecasts). Source-provider processing latency still applies; point-location API time series follow the provider's separate update schedule.

Snowline's own GEFS/ECMWF mean and spread conversion also accepts partial runs. The Pages workflow checks every five minutes (GitHub scheduling can be delayed), converts all currently available forecast frames (up to 128 per model per pass) and publishes each verified batch; each frame requires the complete set of mean/spread fields, but later lead times and the other model's full horizon are not prerequisites. Repeated passes reuse converted files and retry missing frames. Only verified local files are listed in metadata. The preceding distinct cycle is retained while the current cycle grows. ECMWF mean/spread availability follows its published bundled products; Snowline cannot publish a statistic before the upstream product exists.

**2 m dew point** is available for UKV main runs and UKMO Global when both 2 m temperature and relative humidity are present in the same spatial source. It uses Open-Meteo's Magnus calculation (17.625 / 243.04) at each native grid cell before map interpolation. Native dew-point fields take precedence. Missing/zero humidity stays missing, and humidity above saturation is capped at 100%. The calculated grid shares normal map playback, imagery caching, contours and point/grid readouts; no separate point-forecast API requests are needed.

## Forecast briefing

Briefing opens on **UK & Ireland**, using square 960 × 960 charts with a closer view of the British Isles and nearby European coastline. The same view is used for every model and preset. Europe, North Atlantic and Current map area retain their wider format; each cached image is specific to its area and shape.

**Briefing view · 6 charts** opens a separate sequence of six (optionally nine) static chart images. Choose one model, preset, area, starting time and interval. Presets are cloud/precipitation/MSLP, 850 hPa temperature/MSLP, and 500 hPa geopotential height/MSLP, offered only when the run supplies all required fields. The air-mass preset is ordinary 850 hPa temperature, not derived theta-w. Derived theta-w and 400 hPa vorticity are not part of this release.

The cloud composite uses dark clear skies, white overcast, transparent precipitation below 0.5 mm, coloured precipitation above that threshold, and black MSLP isobars at 4 hPa intervals. Each panel states its original precipitation accumulation period; selecting three-hourly viewing does not turn one-hour amounts into three-hour totals. Short-range regional models retain all supplied hours. One offscreen map produces the visible images first, then the next group only, retaining at most 36 image URLs. The interactive map's background work pauses while Briefing is open. Closing Briefing releases its renderer and restores the previous map selections; enlarged charts use the same prepared image.

The pre-Briefing restore point requested for **16:00 BST, Sunday 11 October 2026** is tag [`restore-2026-10-11-1600-bst`](https://github.com/matthewhugo81-arch/snowline/tree/restore-2026-10-11-1600-bst), commit `1021c5215db4cec2490bc50e5f14a141a0d56c6c`. Restore through a new commit after checking for later unrelated changes; do not rewrite repository history. A source archive, Git recovery bundle, deployed Pages package and checksum manifest were also saved locally for Matthew.

GFS global combines Open-Meteo's `ncep_gfs013` surface grid with its `ncep_gfs025` companion grid for MSLP, gusts, visibility and upper-air fields. Each layer uses its actual source grid. Both feeds must have the same initialization time, and a field is rendered only at a valid time supplied by that feed. A missing companion run leaves surface forecasts usable and displays a retry message. MSLP labels remain in hPa, with thin black isobars every 4 hPa. Pressure lines and labels have no white outline.

The **Ensemble models** map group includes GEFS, ECMWF ENS, HGEFS and **MOGREPS-UK 2 km precipitation & snow probability**. Precipitation probability uses the native Open-Meteo spatial feed. The **Winter Analysis → Snow risk · member snowfall probability** layer is generated directly from Met Office member NetCDF snowfall files by `scripts/build_mogreps_snow.py`. It counts members with at least **0.1 mm/hour of snowfall liquid-water equivalent**, using verified CF accumulation bounds. The denominator is all 3 UK members; a missing member makes the cell unavailable. These are raw member fractions for falling snow, not calibrated probabilities, settling risk or depth. No heuristic temperature thresholds, neighbourhood smoothing or time-lagging are applied.

GEFS and ECMWF mean/spread feeds retain the latest cycle and two completed predecessors for Previous Run Analysis. The publisher backfills exact older cycles from official products and records them in `history.json`; all six statistical fields compare at the same valid time without mixing initializations. Menu statuses distinguish known missing runs/hours from an overdue source check. Scheduled publication is requested every five minutes, but GitHub can delay it; a check older than 45 minutes does not prove a newer forecast exists. See [ensemble publication and retention](scripts/ENSEMBLES.md).

The publisher prepares every available hourly UK snow frame. It validates run, valid time, bounds, members, units and grid coordinates before writing compressed OM arrays. The UK ellipsoidal LAEA grid is mapped by nearest cell to the renderer’s spherical 2 km LAEA grid. Explicit periods survive gaps in publication. Three prepared cycles are retained, and no stale snow run is blended with newer precipitation: both charts use the prepared snow cycle with exact-cycle native precipitation, with a notice when a newer native cycle awaits conversion. If snow is unavailable, native precipitation remains usable. All derived Met Office data retains © Crown copyright / CC BY-SA 4.0; see map credits. Maps, comparison, Forecast Briefing and Previous Run Analysis share the catalogue; location charts are unchanged.

Ensemble precipitation probability uses a white-to-blue 0–100% scale. It represents the fraction of members reaching **at least 0.1 mm/h averaged over the native interval** ([provider calculation](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Gfs/PrecipitationProbability.swift)): at least 0.3 mm in three hours, or 0.6 mm in six hours. Each panel's legend gives its own threshold and period ending at the displayed valid time. Initialization has no precipitation interval and is excluded. Native steps, changing time intervals and actual run horizons are retained; comparison includes every selected layer's available times, clearly marks missing panels and can show different period lengths. Playback and background buffering work with these ensemble frames as with the other models.

Precipitation, rain and showers maps share the supplied 14-band scale: 0, 0.5, 1, 2, 4, 6, 8, 10, 15, 20, 25, 30, 40 and 50 mm. The 0–<0.5 mm band is white, values at 50 mm or above use the final colour, and missing grid data remains missing. Colours change at the exact thresholds without blending between bands. Amounts refer to the model interval shown beside the map, which can differ between models and forecast times.

The UK maps were imported from Snowline Sites version 23, source commit `7e347e9cb6daa96b403fdcb64c7e543043c3dddb`, on 9 October 2026. Existing GitHub chart exports, table averages and mph wind charts are preserved.

Each variable chart has a **Data** button in its top-right corner. It opens an hourly table for the selected chart models, all models, or one model. Choose the chart time window or the full dataset returned by the models (including earlier hours). **Download CSV** opens in Excel/Google Sheets; **Download table** saves a standalone HTML table with the colour scale. CSV retains supplied numeric precision, identifies the location, variable, units and UTC timestamps, and leaves missing values blank. Model retrieval times and data availability appear in the table view and HTML export.

Location charts are paired on desktop in this order: snowfall / snow depth, air temperature / dew point, precipitation / cloud cover, wind speed / gusts, relative humidity / soil temperature, then 850 hPa temperature on its own. Phones and tablets use the same reading order in one column. The small chevron in each chart heading (including snowfall agreement) collapses that chart's contents; its title and available Data/reset controls remain accessible. Collapse choices survive focus filters, refreshes and location changes within the current page. Reopening redraws against the current shared zoom, inspected hour, model selection and panel width. Location graphs support live two-finger pinch zoom and two-finger horizontal panning, with the original compact Reset zoom button in each chart heading while zoomed in. All graphs, summaries, the inspected-hour slider and chart-window exports share the same period. One-finger vertical scrolling and tap inspection remain available. Right-drag synchronized zoom, keyboard controls and exports retain their existing behaviour. See [touch zoom details](docs/location-touch-zoom-20261015.md). Run `python tests/chart-zoom-browser.py` with Python Playwright and its Chromium browser installed to check these interactions with deterministic forecast fixtures.

All Celsius variables (air, dew point, 850 hPa and 0 cm soil temperature) use the same fixed sub-zero scale in tables and chart readouts: light blue below 0°C, then progressively deeper colours at −2, −5, −10 and −15°C (purple). Zero, positive and missing values are uncoloured. Chart lines retain their model colours.

Run the data/export checks with `node --test tests/export.test.mjs`.

Every hourly dataset has an **Average** column at the far right, also included in CSV and HTML downloads. It recalculates from the displayed models using the same arithmetic mean as the charts: missing values are excluded and zeroes count. If no model has a value for an hour, the average is unavailable. Hover over an average to see how many models contributed.

Total precipitation values and their averages use five green display bands: above 0 but below 0.5, 0.5 to below 2, 2 to below 5, 5 to below 10, and 10+ mm/h. Dry and missing values are unshaded. The same shading appears in chart readouts, tables and saved HTML. These are display thresholds, not warning categories; total precipitation includes snow water equivalent as described on the chart.

Weather data: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Geocoding: Open-Meteo / GeoNames.

Wind speed and gusts at 10 m are shown in **mph** throughout charts, averages, tables and downloads. The API explicitly requests mph, and normalisation respects the returned units without converting mph twice. The gust chart shows the maximum in the preceding hour, as defined by [Open-Meteo](https://open-meteo.com/en/docs). Models without gust data remain available for other variables, with missing gust values excluded from the average. Choose **Focus → Wind** to show the wind-speed and gust charts together.

The weather-layer menu uses each selected spatial run’s catalogue. Grouped additions include gusts, visibility, cloud layers, surface temperature, rain/showers, snow height, CAPE/CIN, boundary-layer height, column moisture, soil fields, solar radiation/UV and common upper-air temperature, humidity, wind and geopotential-height levels. Available pressure levels are 1000, 925, 850, 700, 500, 300, 250, 200, 100, 50 and 10 hPa; height-level fields include 50, 100, 200 and 300 m. Unsupported fields and incomplete wind-vector pairs are omitted; comparison marks fields available from only one model. Winter Analysis exposes precipitation type with interval-average intensity on verified deterministic feeds (native ECMWF type or an explicitly labelled total/snow-water estimate). It also offers 850 hPa theta-w with precipitation symbols and MSLP when all three fields exist at the same run/time. ICON retains native rain/convection/snow components. GFS and AIFS partition native total and convective precipitation without double-counting snow. Dense dots/rings show dynamic precipitation where a native split is available; smaller V shapes/triangles show supplied convection. Feeds without a mechanism split, including UKV, use the same continuous rings for total precipitation, with this limitation stated in the legend. Each component has its own interval-average rate and symbol size. Intensity uses 0.1–<0.5, 0.5–<2, 2–<5 and 5+ mm/h water-equivalent bands, with no smoothing of phase categories. See map-credits.html#winter-analysis for definitions and limitations. Unsupported categorical codes, ensemble spreads and vertical velocity are not added without a verified interpretation for each feed. Run all checks with `node --test tests/*.test.mjs`.


## Buffered map playback
Rapid timeline input invalidates the superseded request immediately. Forward/back arrows retain every click in the requested time, combine cold clicks within a 70 ms burst into the final selection, and display already prepared frames immediately. Both arrows reflect the requested position while images retain their displayed valid-time labels; users can reverse immediately at either timeline end. Nearby preparation follows the direction of travel using the same bounded layer budget. View refreshes are cancelled when another zoom/pan starts and resume after movement settles. Replacement frame caches use distinct source IDs, and parallel native input reads settle before their WASM readers are released. Genuine missing-data errors still stop playback and retain the displayed frame's own valid-time label.

**Verified field gaps (14 October 2026):** initialization-time gusts are omitted for IFS, ICON and Météo-France feeds that do not supply them; GFS UV and AROME cloud fields also begin after initialization. AIGFS and HGEFS precipitation starts at T+12 because their T+6 file has no precipitation field. IFS 0.25° gusts at T+93–144 are absent from Open-Meteo's files: ECMWF supplies `10fg3` in that block, which the current provider importer omits. Only those gust steps are excluded, and the model note explains the gap. Recheck this rule when the provider adds `10fg3` support. Other fields keep their available hours; missing precipitation is never treated as zero in an accumulation.

The shared timeline excludes initialization for precipitation, rain, showers, snowfall water equivalent and interval solar-radiation fields. These backward sums/averages have no first timestep in the provider's spatial files ([Open-Meteo open-data documentation](https://github.com/open-meteo/open-data#data-structure)). Instantaneous fields retain their initialization frame. Selecting a field with a different timeline also refreshes both panels' frame URL indices.
Weather rasters and enabled contour/MSLP overlays are prepared as complete, cycle-specific frames. Playback loops continuously, buffering two upcoming frames before starting. Selecting a model or variable automatically prepares the entire available sequence for the current map view, including both comparison panels, without needing to press Play. Nearby upcoming frames load first, then the remaining forecast wraps through earlier times. A progress indicator reports loaded/total frames and offers a retry for failed background frames. The bounded rolling map-layer window retains only nearby decoded frames plus one background frame per panel. Prepared raster and vector tile bytes are retained in browser CacheStorage, with a 32 MiB hot memory cache, so distant jumps and subsequent loops do not repeat model downloads and rendering. Requests shared by both panels are deduplicated, and each worker receives its own transferable buffer. Moving to a new view cancels obsolete work and prepares the new area; returning to one of the three most recent exact clip bounds reuses its disk tiles; changing selections cancels obsolete background work. Cache keys distinguish cycle, variable, tile coordinates, request type and view. Persistent disk caches are bounded to three exact views and reuse a rendering-version-specific one-hour bucket across reloads; evicted views and expired buckets are removed. If storage is unavailable or full and memory retention is exceeded, full preloading stops with an explicit storage-limited message while nearby buffering and normal viewing remain available. The requested frame takes priority over new background work; once displayed, bounded parallel background loading resumes immediately. Both ready and uncached selections preserve useful in-flight downloads and their concurrency slots; an uncached selection pauses new speculative dispatch while its foreground frame loads. The background queue rejoins surviving jobs without exceeding its concurrency limit. Persistent storage is bounded to 64 MiB or 2,048 entries per view; reaching either limit stops full-sequence preloading and reports storage-limited caching while selected frames remain usable. Appended same-cycle hours retain unchanged frames; newly available companion overlays invalidate only affected frames. A single-frame forecast remains paused. All visible comparison panels commit the same valid time together, with explicit unavailable states where a selected model/layer has no supplied frame. Basemap ordering and colour-legend DOM are reused rather than rebuilt each hour. Playback speeds are 1.2, 0.7 and 0.4 seconds per native forecast frame. Preparation overlaps the display interval, and display work consumes that interval instead of adding a second delay. Late frames start a new cadence without skipping or catch-up bursts. A loading failure for a published frame stops playback. Expected gaps in one panel do not stop the available charts in the others. While waiting, an existing image retains its own valid-time label. No cross-fades or temporal interpolation are used. Grid-value labels resume when playback is paused to avoid competing with image/overlay decoding. Forecast availability and upstream network speed still constrain loading.


The location-chart UKV model remains **UKMO UKV 2 km**. Maps and Forecast Briefing offer **UKV · latest** and **UKV · previous completed**, with dated UTC labels. UKV Previous Run Analysis compares exactly that pair and refreshes it automatically; unrelated models retain their pinned three-run analysis. No cycle or missing forecast hour is stitched to another. See [UKV run retention](docs/ukv-run-choices.md).


## Location forecast resilience (14 October 2026)

Location forecasts use a shared, hourly cache for the starting point, Barnoldswick, Thornton-in-Craven, Colne, Rawtenstall and Love Clough. The public town coordinates are listed in `point-snapshots.js`; matching is to four decimal places, and a neighbouring location is never substituted. The existing Pages publisher restores `point-data`, refreshes each model no more than once per hour, and publishes it alongside the site. This is at most 90 ordinary forecast HTTP requests per hourly refresh for six locations, shared by all visitors; Open-Meteo's weighted API-call accounting still applies. The API request, model names, 11 variables, units and eight-day source window remain unchanged.

Other coordinates continue to use the direct point API. Successful browser responses are fresh for one hour and can be used for up to 24 hours after a transient failure, provided they still contain current/future values. Failed refreshes retain the original retrieval timestamp and explicitly say **Cached forecasts — live refresh unavailable**. Partial model failures do not discard the successful models. A fresh shared response is reused even on Refresh, while a direct response has a 60-second minimum refresh interval.

HTTP 429 starts a persistent cooldown for that service, including elevation and queued models. `Retry-After` is honoured; without it, a daily limit waits until the next UTC day plus one minute, an hourly limit until the next UTC hour plus one minute, and other limits one minute. Refresh cannot override it. Up to three already-running model requests may finish. Search and map metadata on different services remain independent. No quota is reset or guaranteed by the site: a never-cached location can remain unavailable until the provider accepts new requests.

Altitude is reused from the forecast response or geocoding result. The separate elevation endpoint is only needed when neither supplies a height. Cached/shared data retains missing values and original units; it never invents forecasts or replaces missing data with zero. Shared snapshots expire after 24 hours and are published only for their requested coordinates.

Validation: `node --test tests/*.test.mjs` includes transport, cooldown, cache expiry, partial failure, coordinate isolation and publisher tests. `python tests/chart-zoom-browser.py` checks all charts, exports, synchronized right-drag, panel state, mobile layouts, and an actual simulated HTTP 429 through the browser fetch/cache path. No chart geometry, zoom implementation, CSS, map rendering or map data sources were changed by this fix.

## Shared cache for searched locations (activated 15 October 2026)

The configured Cloudflare Worker extends forecast sharing to searched coordinates,
with one-hour reuse, globally coordinated simultaneous requests, persistent
provider cooldowns, a daily HTTP safety budget, dated stale fallback and protected
usage counters. The existing six town snapshots remain first choice. The live service is
`https://snowline-forecast-cache.matthewhugo81.workers.dev`. Clearing
`FORECAST_SERVICE_URL` restores the direct forecast path. See [setup, validation and rollback](docs/shared-forecast-cache.md).

## Loading performance

Briefing and previous-run views pre-read one next chart's native inputs while the current chart renders and exports. They still use one map renderer and complete same-time raster/overlay images. Native tile work uses the OM renderer's existing bounded worker pool.

Location chart redraws read all plot widths before DOM writes and cache per-model coverage calculations. Event analysis uses the same exact-location shared forecast loader as location charts, preserving retrieval timestamps, stale labels, cancellation and missing-hour rules.

Regression checks: `node --test tests/*.test.mjs`, `node tests/map-browser.mjs`, `python tests/chart-zoom-browser.py`, and `python tests/event-analysis-browser.py`. Live-provider timing results are observational: upstream files, publication progress, hardware and network still constrain cold playback.


## 700 hPa vertical motion

The vertical-motion chart is available for GFS (the matching 0.25-degree upper-air companion), IFS 0.25°, AIFS, NOAA AIGFS, UKMO Global and JMA GSM. The catalogue requires velocity, temperature, height and both wind components in one supported source. UKV, HGEFS mean and other unverified feeds are deliberately excluded. Native forecast times are preserved.

Shading is pressure velocity in 0.1 Pa/s (microbar/s): red/negative ascent, blue/positive descent, white from −1 to +1. Black 700 hPa height contours are 4 dam apart; blue wind barbs are in knots. The Contours switch adds grey omega contours. These overlays also appear in Briefing, Previous Run Analysis and saved images. MSLP is omitted for this chart.

JMA spatial files retain pressure velocity in Pa/s. The other five feeds store geometric velocity in m/s; conversion uses matching 700 hPa temperature and the inverse of Open-Meteo's hydrostatic dry-air conversion. Missing values remain missing. Geometric-to-pressure conversion is an approximation for native geometric velocity; do not treat it as an independent model omega field. The chart highlights model ascent, including frontal, convective and orographic contributions, rather than identifying fronts automatically.

Validation: `node --test tests/*.test.mjs` and the optional live-browser check `node tests/vertical-motion-live.mjs` (Playwright required). Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed browser if necessary. `SNOWLINE_LIVE_URL` checks a deployed origin; `SNOWLINE_TEST_OUTPUT` selects the output directory. All 531 forecast files in the six audited runs contained the required fields on 15 October 2026; first/middle/last UK-area derived samples were finite. Runtime source availability can change.

### Direct GEM and ICON Europe 700 hPa charts

The existing GEM and ICON Europe model choices now load exact-cycle 700 hPa companions from `ensemble-data/snowline_gem_700` and `ensemble-data/snowline_icon_eu_700`. `scripts/build_vertical_motion.py` reads official ECCC/DWD GRIB files, validates all four parameters, units, timestamps, scan directions and native geometry, then writes omega, height, U and V together in an atomic OM frame. ICON geopotential is divided by 9.80665; both native pressure velocities are multiplied by 10 for the established 0.1 Pa/s scale. Analysis steps encoded in minutes are checked by their absolute valid time.

Native resolution is retained in regional subsets: GEM 0.15° over 66°W–34.95°E, 30–75°N (including the North Atlantic preset); ICON Europe 0.0625° over 23.5°W–35°E, 35–70.5°N. Coverage and provider attribution appear on the chart/export legend. Nothing is extrapolated beyond the subset. OM quantization is 0.01 Pa/s for omega, 1 m for height and 0.1 m/s for winds. The six existing model charts keep their original coverage.

GEM pressure-level files are three-hourly to T+240, even though some surface fields are hourly. ICON main cycles are hourly to T+78 then three-hourly to T+120; 03/09/15/21Z cycles are hourly to T+30 then T+36/42/48. Only published complete frames enter the timeline; there is no temporal filling of unavailable hours. The publisher prepares the same initialization used by the existing model feed and two preceding runs, caches complete frames, retries missing ones, and preserves verified data through source outages. Missing direct data hides this diagnostic for that run while other model fields remain usable. The height and wind overlays are pinned to the diagnostic source, including ICON where the existing feed has other 700 hPa fields.

The existing Pages workflow refreshes both imports and publishes them with its other cached forecasts. Direct-data Python tests run in CI and the publisher: `python -m unittest discover -s tests -p 'test_vertical*.py'`. Run the map/browser checks as above; `SNOWLINE_TEST_MODELS=gem_global,icon_eu` can focus the live data checks on these additions.

## EC ENS location forecasts

The location graphs include **EC ENS mean**, the ECMWF IFS 0.25° ensemble mean,
as a purple dashed line alongside HGEFS mean. Both have dashed legend samples.
Open-Meteo’s ensemble endpoint supplies the chart variables through
the shared forecast cache and exact-location snapshots. Missing values remain
gaps. Each selected ensemble mean counts once in the overall average; ensemble
means remain excluded from the deterministic snowfall-agreement percentage.

## MOGREPS-G in location charts and maps

The location page adds an 18-member **MOGREPS-G mean** for 850/500 hPa
temperature, precipitation and snowfall, plus a shared 500 hPa panel for all
supporting models. `mogreps-client.js` uses Snowline Ensembles' complete-run
index and existing public Met Office point service. No new account or hosting
is required. All other MOGREPS-G location variables remain unavailable.
Temperatures stay at native three-hour instants; the connecting line does not
create hourly values. Three-hour rain/snow amounts become period-average rates
held over their actual preceding interval. Summing the rates over its three
hours conserves each amount. Snowfall uses the same 7:1 depth equivalent as the
ensemble site. This is not predicted settling depth. Missing members, failed
steps and below-ground pressure levels remain missing. Ensemble means do not
enter deterministic snowfall agreement. Tables, CSV and images retain period,
run and source information.

The independent **MOGREPS-G 20 km** map choice exposes eight fields: temperature
mean and population SD at 850/500 hPa; mean precipitation and snowfall water
equivalent; and raw precipitation/snowfall member fractions. All 18 members
come from one run. Fractions count members with at least 0.3 mm water equivalent
in the preceding three hours (0.1 mm/h). Statistics require every member;
probabilities are not thresholded means or averages of hourly probabilities.
MOGREPS-UK remains a separate regional choice with its existing member rules.

`scripts/build_mogreps_global.py` reads ETag-pinned HDF5 chunks using the shared
immutable indices at `snowline-ensembles/mogreps/`. Temperature status flags
mask pressure levels below the model surface. Native rows 644:876 and columns
404:769 form a 365 × 232 subset covering all four map presets. No regridding or
time interpolation is applied. Source data are Kelvin and metres water
equivalent; published values are Celsius, population SD in Celsius, mm/h and
percent. OM precision is 0.01 display units. Longitude does not wrap around the
regional subset. There is no invented pressure overlay.

The existing Pages publisher prepares every three-hour step from T+0 to T+246,
reuses completed frames, retries missing steps, retains three generated runs
and publishes through the existing URL. Version 2 metadata carries field-level
valid times and explicit interval bounds; history indices use version 1 and
initialization strings. Shared index failure preserves a verified prior run
and appears in publication health. Run labels always retain source
initialization, rather than the time a file was downloaded.

MOGREPS-G source data and these derived products: © Crown copyright 2026,
Met Office, **CC BY-SA 4.0**. Source and method details are in `map-credits.html`.
Validate with `node --test tests/*.test.mjs` and
`python -m unittest discover -s tests -p 'test_mogreps*.py'`.
