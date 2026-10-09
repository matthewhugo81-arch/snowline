# Snowline

UK model maps and local multi-model weather charts: snowfall, snow depth, temperature, dew point, humidity, precipitation, wind speed and wind gusts.

A static website using Open-Meteo. No build step is required. GitHub Pages serves the main branch from the repository root.

Open [Location charts](https://matthewhugo81-arch.github.io/snowline/) or [UK maps](https://matthewhugo81-arch.github.io/snowline/maps.html). The map page includes model comparison, weather layers, MSLP isobars, forecast animation and point event analysis. Click a map location to open its charts; navigation retains the chosen location and valid time.

Maps load live Open-Meteo spatial data and OpenFreeMap basemaps directly in the browser. The bundled map renderer, WebAssembly decoder and licences are in `vendor/`; see [map credits](map-credits.html). Map wind layers retain their native m/s units; location charts use mph.

The UK maps were imported from Snowline Sites version 23, source commit `7e347e9cb6daa96b403fdcb64c7e543043c3dddb`, on 9 October 2026. Existing GitHub chart exports, table averages and mph wind charts are preserved.

Each variable chart has a **Data** button in its top-right corner. It opens an hourly table for the selected chart models, all models, or one model. Choose the chart time window or the full dataset returned by the models (including earlier hours). **Download CSV** opens in Excel/Google Sheets; **Download table** saves a standalone HTML table with the colour scale. CSV retains supplied numeric precision, identifies the location, variable, units and UTC timestamps, and leaves missing values blank. Model retrieval times and data availability appear in the table view and HTML export.

All Celsius variables (air, dew point, 850 hPa and 0 cm soil temperature) use the same fixed sub-zero scale in tables and chart readouts: light blue below 0°C, then progressively deeper colours at −2, −5, −10 and −15°C (purple). Zero, positive and missing values are uncoloured. Chart lines retain their model colours.

Run the data/export checks with `node --test tests/export.test.mjs`.

Every hourly dataset has an **Average** column at the far right, also included in CSV and HTML downloads. It recalculates from the displayed models using the same arithmetic mean as the charts: missing values are excluded and zeroes count. If no model has a value for an hour, the average is unavailable. Hover over an average to see how many models contributed.

Total precipitation values and their averages use five green display bands: above 0 but below 0.5, 0.5 to below 2, 2 to below 5, 5 to below 10, and 10+ mm/h. Dry and missing values are unshaded. The same shading appears in chart readouts, tables and saved HTML. These are display thresholds, not warning categories; total precipitation includes snow water equivalent as described on the chart.

Weather data: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Geocoding: Open-Meteo / GeoNames.

Wind speed and gusts at 10 m are shown in **mph** throughout charts, averages, tables and downloads. The API explicitly requests mph, and normalisation respects the returned units without converting mph twice. The gust chart shows the maximum in the preceding hour, as defined by [Open-Meteo](https://open-meteo.com/en/docs). Models without gust data remain available for other variables, with missing gust values excluded from the average. Choose **Focus → Wind** to show the wind-speed and gust charts together.

The weather-layer menu uses each selected spatial run’s catalogue. Grouped additions include gusts, visibility, cloud layers, surface temperature, rain/showers, snow height, CAPE/CIN, boundary-layer height, column moisture, soil fields, solar radiation/UV and common upper-air temperature, humidity, wind and geopotential-height levels. Available pressure levels are 1000, 925, 850, 700, 500, 300, 250, 200, 100, 50 and 10 hPa; height-level fields include 50, 100, 200 and 300 m. Unsupported fields and incomplete wind-vector pairs are omitted; comparison marks fields available from only one model. Categorical precipitation-type codes, ensemble spreads and vertical velocity are not added without a verified interpretation for each feed. Run all checks with `node --test tests/*.test.mjs`.
