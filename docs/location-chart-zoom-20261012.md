# Location chart time-range zoom — 12 October 2026

## Controls and scope

Hold the right mouse button inside any location graph, drag horizontally over the required period, then release. A shaded selection shows the snapped UTC endpoints while dragging. Both directions work, and a second selection can narrow an existing zoom. Shift + left-drag is an alternative.

All eleven variable charts and the snowfall agreement chart share the resulting range. The inspected-hour slider, per-model values and averages, overview statistics, and Data dialog's Chart time window use the same inclusive hourly timestamps. The Data dialog defaults to that window, including CSV and HTML table downloads. Its explicit Full model dataset option remains independent.

Reset zoom (visible only during zoom) or double-clicking a graph restores the chosen 1–7 day horizon. Escape cancels an unfinished drag; Escape on a focused chart resets a completed zoom. Changing the horizon, refreshing forecasts or choosing a location clears zoom. Model selection and ordinary viewport resizing preserve it.

Selection uses existing hourly samples. It does not interpolate finer temporal detail, alter source values, fill missing forecasts, or make new forecast requests. Graph vertical scales are calculated from the visible series using the existing variable scale rules.

## Implementation boundary

The shared window is defined in chart-window.js. Pointer handling is isolated in chart-zoom.js, including SVG coordinate conversion, pointer capture, cancellation and accidental-drag protection. Rendering is deferred during an active selection so arriving model responses cannot invalidate its geometry.

Only index.html, app.js and dataset-dialog.js integrate the feature. chart-zoom.css is a separate, location-page-scoped stylesheet. Shared styles.css, all UK maps files, forecast ingestion and deployment workflows are unchanged. Touch drag and wheel events are not intercepted; existing vertical scrolling and tap-to-inspect remain.

## Validation before merge

- 12 Node unit tests passed: preset and nested ranges, reverse selection, boundary clamping, invalid input, adjacent hourly samples, UTC midnight, reset, zero and missing values, and scoped/full exports.
- 31 offline Chromium interaction checks passed: chart rendering, right-drag band and endpoints, synchronization of slider/readouts/statistics, CSV and HTML downloads, reverse/nested zoom, model toggles, resize, Escape, double-click/button reset, horizon changes, accidental drags, Shift-left alternative, request counts, refresh, and 390 px mobile layout. No JavaScript errors were observed.
- Desktop and mobile screenshots were visually reviewed. The browser tests use deterministic fixture forecasts, not live meteorological data. Only Chromium was tested interactively; other browser engines are not claimed verified.

Reproduce the unit tests with `node --test tests/chart-window.test.mjs`. The existing repository regression workflow also includes this file. Reproduce browser checks with `python tests/chart-zoom-browser.py` after installing Python Playwright and Chromium; `CHROMIUM_PATH` can specify the executable. Browser checks are manual and are not added to deployment workflows.

## Rollback

The pre-change state was preserved at commit `8dc6da723bc8b8f8983fdfc249da23c06029056b` on branch `backup/location-charts-before-zoom-20261012`. Prefer reverting only the chart-zoom release commit so any subsequent unrelated map or data changes remain intact.
