# Chart styling and PNG export — 12 October 2026

## 850 hPa temperature

With Contours enabled, isotherms at −25, −20, −15, −10, −5, 0, 5, 10, 15, 20 and 25°C are thicker. These exact levels are added to the existing contour requests, rather than merely restyling an even-numbered 2°C contour set that omits some of them. Existing intermediate isotherms remain thinner. Map line widths are 1.8/0.7 px; briefing line widths are 2.6/1.3 px. The same policy applies to 850 hPa ensemble-mean temperature, not ensemble spread. MSLP isobars, other temperature levels, theta-w and temperature shading are unchanged.

## 300 and 200 hPa wind

Both jet-level wind fields use a shared 60–180 mph colour scale in 15 mph intervals, with an opaque white under-range band below 60 mph and the final colour covering 180 mph and above. Legends omit the under-range bin and explain it in text. Wind arrows and optional grid labels below 60 mph are hidden on these two levels only. Native spatial data remains in m/s, with correct mph conversion for displayed values; point drill-down retains actual speeds below the shading threshold. Cache keys distinguish the revised styles from previously rendered tiles.

## Right-click Copy image / Save image

Both interactive map panels, briefing thumbnails and enlarged briefing images have the image context menu. Left-click behaviour is retained. Interactive exports capture the current WebGL frame during a render callback, including weather shading, isobars, contours, basemap labels and any currently displayed grid labels. No extra map is constructed or recentered, and persistent drawing-buffer mode is not enabled. Title/run/valid-time metadata and matching legends are captured with the displayed frame, then added alongside attribution in the PNG. Briefing exports reuse their rendered bitmap at its existing resolution. Controls and interactive location popups are not part of the saved bitmap.

Copy image writes image/png to the clipboard after the user selects it. A blocked or unsupported clipboard opens an ordinary image preview with native browser copy/save options rather than reporting false success. Save image initiates a PNG download with a model/field/run/time filename. The menu supports keyboard navigation and is contained within the viewport or an active enlarged-map dialog. Export does not request different forecast data.
