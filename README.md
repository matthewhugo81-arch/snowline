# Snowline

Local multi-model weather charts: snowfall, snow depth, temperature, dew point, humidity and precipitation.

A static website using Open-Meteo. No build step is required. GitHub Pages serves the main branch from the repository root.

Each variable chart has a **Data** button in its top-right corner. It opens an hourly table for the selected chart models, all models, or one model. Choose the chart time window or the full dataset returned by the models (including earlier hours). **Download CSV** opens in Excel/Google Sheets; **Download table** saves a standalone HTML table with the colour scale. CSV retains supplied numeric precision, identifies the location, variable, units and UTC timestamps, and leaves missing values blank. Model retrieval times and data availability appear in the table view and HTML export.

All Celsius variables (air, dew point, 850 hPa and 0 cm soil temperature) use the same fixed sub-zero scale in tables and chart readouts: light blue below 0°C, then progressively deeper colours at −2, −5, −10 and −15°C (purple). Zero, positive and missing values are uncoloured. Chart lines retain their model colours.

Run the data/export checks with `node --test tests/export.test.mjs`.

Weather data: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Geocoding: Open-Meteo / GeoNames.
