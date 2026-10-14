# Theta-w precipitation symbols: Visual Weather-inspired refinement

Requested reference: Matt's Visual Weather IFS 0.125-degree screenshot. This is a presentation refinement of Snowline's existing shared theta-w / precipitation symbols / MSLP layer, not a reproduction of Visual Weather's undocumented formula or its data resolution.

## Presentation

The former four-step radius scale is replaced by continuous logarithmic interpolation through circle diameters of 3, 5, 7, 9, 12 and 15 tile pixels at interval-average rates of 0.1, 0.5, 1, 2, 4 and 8 mm/h respectively. Below 0.1 mm/h remains unplotted; above 8 mm/h the diameter is capped. These are display anchors, not official intensity classifications. Raster display scale also depends on map zoom.

Convective symbols follow the same rate curve with a compact 0.86 radius factor: an open V below 0.5 mm/h, a closed downward equilateral triangle above. ICON total-snow stars remain distinct. A thin translucent white stroke beneath the coloured outline improves contrast without filling the symbol. Existing phase colours are retained; colour has NOT been repurposed as an intensity scale.

Variable-radius packing replaces fixed offsets for simultaneous components. All components of an accepted sample remain visible. The original globally anchored 16-pixel sampling lattice is retained; light precipitation stays dense. Groups are thinned only where they collide with a higher-priority neighbouring lattice sample. Spatial priority is independent of rainfall magnitude: it does not move rainfall to local maxima, and symbol density must not be interpreted as intensity. Decisions are local and order-independent; a 96-pixel halo covers component overhang and competing samples on adjacent tiles.

## Meteorological safeguards and scope

- No changes to theta-w calculations/shading, MSLP, run selection, valid times, panels, export functionality, point charts or data ingestion.
- Native interval totals are still divided by the model's actual 1-, 3- or 6-hour precipitation interval, never the selected animation interval. There is no extra deaccumulation of already interval-based spatial fields.
- Native nearest-cell sampling is preserved; this does not add model resolution or recover every narrow feature between display samples.
- ICON/ICON-EU retain separate native large-scale rain, convective rain and total snowfall. GFS and AIFS retain total-minus-convective and convective water-equivalent components. Snowfall is not subtracted twice or allocated to a mechanism without supporting data.
- Other feeds retain their existing native/estimated/unknown phase recipe and total-precipitation circles. In particular, the currently selected UKV spatial inputs do not establish a dynamic/convective split. No CAPE or intensity-based shower inference is introduced.
- Both the main map and briefing renderer already call the shared precipitation-symbol protocol, so both receive the refinement. The separate precipitation-type/intensity shaded layer retains its original categorical bands.

## Validation and rollback

New tests cover size anchors/continuity, thresholds, all component layouts, collision-free retained samples, uniform-field coverage, order independence, four tile boundaries, distinct paths, native intervals, all current model recipes, missing/invalid partitions, the legend/cache key and actual tile-protocol calls with a mocked native reader. A local Chromium canvas comparison used synthetic inputs, explicitly not a forecast.

The pre-change main commit was `8d4dedf0b191e44f11fbb3a85468eb4da014f0b0`. Revert the symbol-refinement commit(s), not the whole branch or unrelated forecast fixes, to restore the earlier renderer. A hard refresh loads changed shared modules after publication; generated symbol-tile URLs also carry a new style version.
