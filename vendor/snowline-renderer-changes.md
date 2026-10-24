Local fixes to the bundled Open-Meteo weather map renderer (11 October 2026):

- `index.mjs` uses `forecast-worker-pool.mjs` for tile dispatch. Each worker
  dispatch has a unique wire key, while active identical requests still share
  work. Late results/cancellations cannot settle a replacement request.
- Cancelled worker jobs reject as `AbortError` instead of returning a successful
  empty tile. The calling forecast cache can retry a still-needed request.
- Legitimately empty image tiles (outside a model domain) are transparent PNG
  bytes, rather than ImageBitmap objects. This preserves them through the
  prepared tile cache's disk round trip and worker transfer.
- `arrow_profile=jet` selects the readable `jetArrows` vector generator in
  `worker.js`. It uses 18 lattice intervals, scales shaft and head together
  from 2 to 100 m/s, and omits calm/missing vectors. Other arrow/barb styles
  retain their upstream geometry. The worker URL is versioned with this change.

Preserve these changes when updating the bundled renderer. The upstream licence
remains in `weather-map-layer-LICENSE.txt`. Worker dispatch regression coverage
is in `tests/map-worker-pool.test.mjs`.

14 October 2026: paired derived-field reads and variable prefetches use
`settleNativeReads` before releasing native readers. A cancelled/failed input
must not dispose the file or sibling reader while another WASM read is still
pending. Regression coverage: `tests/map-reader-lifetime.test.mjs`.

21 October 2026: `index.mjs` uses `forecastTileReadBounds(tileIndex)` for
image/vector requests. Complete geographic tiles include a native-grid halo
and no longer depend on shared viewport clipping. Point reads retain viewport
bounds. Preserve this distinction: the interactive map now caches tiles across
pans and independent panels. Tests: `tests/map-read-bounds.test.mjs` and the
actual-renderer check in `tests/map-interactions-browser.mjs`.

24 October 2026: `index.mjs` uses `forecast-http.mjs` for native HTTP reads.
The request deadline covers both headers and response-body consumption; timeout
aborts the underlying fetch before retry backoff. Caller cancellation also
interrupts backoff. Permanent HTTP errors retain their status and are not
retried. Shared-reader subscriber ownership is unchanged. Preserve the helper
import and the body consumer in `getBytes` when updating the bundle.
Regression coverage: `tests/forecast-http.test.mjs`, including real stalled
HTTP connections and the bundled native range-reader integration.
