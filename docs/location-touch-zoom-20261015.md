# Location graph touch zoom — 15 October 2026

Spread two fingers inside a location graph to zoom into the period under their midpoint; pinch inward to zoom out. Move both fingers sideways to pan through time. All twelve graphs, overview statistics, inspected-hour slider, readouts and chart-window exports update together during the gesture. A single finger still scrolls the page vertically, and a tap inspects an hour.

Each expanded graph has labelled, keyboard-accessible +, − and Reset zoom buttons with at least 44 px touch targets. Plus halves the visible time span around its midpoint; minus doubles it. Zoom stops at two adjacent hourly samples and the selected 1–7 day horizon. Reset restores that horizon. The existing desktop right-drag, Shift-left-drag, double-click and Escape controls remain available.

The implementation uses the existing shared window and forecast samples. Zooming makes no forecast requests and does not interpolate data. Horizontal time labels reserve space for the anchored endpoint labels at intermediate zoom levels.

Touch handling only consumes two fingers that start inside the same graph. The location-scoped `touch-action: pan-y` permits native vertical scrolling while reserving pinch for the chart. Non-passive touch listeners cancel browser handling for accepted two-finger sequences. The stable `.plot` container receives events while its SVG redraws; SVG children do not intercept pointer events. Finger identities are retained, and lifting either original finger ends updates until all fingers lift. Cancellation, blur, resizing and visibility changes clear gesture state. Accidental compatibility clicks after a pinch are suppressed.

Validation: `node --test tests/*.test.mjs` and `python tests/chart-zoom-browser.py`. The browser suite uses deterministic offline forecasts and native Chromium touch dispatch to check live pinch, pinch-out, panning, staggered finger arrival/release, cancellation, one-finger scrolling, tap inspection, button limits, exports, summaries, request counts, desktop gestures and mobile layouts. Screenshots are reviewed at mobile and desktop widths. Physical iOS/Android devices have not been tested.

This extends the mouse zoom described in `location-chart-zoom-20261012.md`. Only location chart code/styles, tests and documentation change; geographic maps and their controls are unchanged.
