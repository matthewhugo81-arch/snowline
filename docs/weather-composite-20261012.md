# Interactive cloud, precipitation and MSLP composite

The main Weather layer selectors now include **Combined weather → Cloud, precipitation & MSLP**, when all three fields exist in the selected run. The same layer can be selected independently in either comparison panel.

This is modelled total-cloud cover, not observed satellite imagery or an infrared brightness-temperature product. White cloud shading increases with cloud fraction, from transparent clear skies to a maximum visual opacity of 80% at overcast. Blue-grey sea and pale neutral land remain distinguishable underneath, using the existing geographic water masks. The weather background is local to each composite panel and is hidden when another field is selected. Total precipitation uses the existing coloured bands; below 0.5 mm the overlay is transparent so the cloud remains visible (not a guarantee of zero precipitation). MSLP isobars are included every 4 hPa. The existing MSLP checkbox is locked on for this combined choice, without changing its saved state for other layers.

All component fields must share the selected model initialisation and chart valid time. Matching GFS companion grids are supported. Missing components or missing forecast hours are not substituted. The precipitation accumulation period follows the source's native timestep, not the playback interval. Optional contours, grid labels and point readouts show precipitation in millimetres of water.

The renderer shares the existing briefing composite colours. Request-specific style keys isolate composite shading from ordinary cloud and precipitation panels, preloading and worker caches. A complete frame owns the cloud underlay, precipitation raster and pressure vectors and cannot advance until every required source is ready. On interactive maps, the shading control adjusts cloud opacity up to 80%; coloured precipitation stays fully opaque. Forecast Sequence, Previous Run Analysis and exported charts use the same 80% cloud cap and geographic colours. The cloud legend shows the matching land and sea gradients. Map boundaries and labels remain above the weather. Versioned style keys prevent reuse of older opaque cloud tiles.

## Rain versus precipitation

Precipitation is the total liquid plus frozen water equivalent. Rain excludes the frozen component. Open-Meteo's generic API documentation additionally distinguishes large-scale rain from separately supplied convective showers; that split is model-dependent and should not be assumed identical across native spatial feeds. UKV supplies native rain and snowfall-water-equivalent fields. The composite uses total precipitation, not rain alone.

References:
- https://open-meteo.com/en/docs#hourly-parameter-definition
- https://open-meteo.com/en/docs/ukmo-api
