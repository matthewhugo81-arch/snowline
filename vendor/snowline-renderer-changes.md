Local fixes to the bundled Open-Meteo weather map renderer (11 October 2026):

- `index.mjs` uses `forecast-worker-pool.mjs` for tile dispatch. Each worker
  dispatch has a unique wire key, while active identical requests still share
  work. Late results/cancellations cannot settle a replacement request.
- Cancelled worker jobs reject as `AbortError` instead of returning a successful
  empty tile. The calling forecast cache can retry a still-needed request.
- Legitimately empty image tiles (outside a model domain) are transparent PNG
  bytes, rather than ImageBitmap objects. This preserves them through the
  prepared tile cache's disk round trip and worker transfer.

Preserve these changes when updating the bundled renderer. The upstream licence
remains in `weather-map-layer-LICENSE.txt`. Worker dispatch regression coverage
is in `tests/map-worker-pool.test.mjs`.
