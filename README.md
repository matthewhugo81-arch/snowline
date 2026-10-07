# Snowline

Local multi-model weather charts: snowfall, snow depth, temperature, dew point, humidity, precipitation, wind speed and wind gusts.

A static website using Open-Meteo. No build step is required. GitHub Pages serves the main branch from the repository root.

Each variable chart has a **Data** button in its top-right corner. It opens an hourly table for the selected chart models, all models, or one model. Choose the chart time window or the full dataset returned by the models (including earlier hours). **Download CSV** opens in Excel/Google Sheets; **Download table** saves a standalone HTML table with the colour scale. CSV retains supplied numeric precision, identifies the location, variable, units and UTC timestamps, and leaves missing values blank. Model retrieval times and data availability appear in the table view and HTML export.

All Celsius variables (air, dew point, 850 hPa and 0 cm soil temperature) use the same fixed sub-zero scale in tables and chart readouts: light blue below 0°C, then progressively deeper colours at −2, −5, −10 and −15°C (purple). Zero, positive and missing values are uncoloured. Chart lines retain their model colours.

Run the data/export checks with `node --test tests/export.test.mjs`.

Every hourly dataset has an **Average** column at the far right, also included in CSV and HTML downloads. It recalculates from the displayed models using the same arithmetic mean as the charts: missing values are excluded and zeroes count. If no model has a value for an hour, the average is unavailable. Hover over an average to see how many models contributed.

Total precipitation values and their averages use five green display bands: above 0 but below 0.5, 0.5 to below 2, 2 to below 5, 5 to below 10, and 10+ mm/h. Dry and missing values are unshaded. The same shading appears in chart readouts, tables and saved HTML. These are display thresholds, not warning categories; total precipitation includes snow water equivalent as described on the chart.

Weather data: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Geocoding: Open-Meteo / GeoNames.

Wind speed and gusts at 10 m are shown in **mph** throughout charts, averages, tables and downloads. The API explicitly requests mph, and normalisation respects the returned units without converting mph twice. The gust chart shows the maximum in the preceding hour, as defined by [Open-Meteo](https://open-meteo.com/en/docs). Models without gust data remain available for other variables, with missing gust values excluded from the average. Choose **Focus → Wind** to show the wind-speed and gust charts together.
