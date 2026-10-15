# Shared location forecast service

Activated for Snowline on 15 October 2026 after owner deployment and public
forecast verification. The service is
`https://snowline-forecast-cache.matthewhugo81.workers.dev`.
GitHub Pages continues to serve the website. Two live same-point IFS requests
returned 192 hours with identical `_retrievedAt` values and `shared cache` source;
CORS allowed the GitHub Pages origin. No paid API subscription was configured.
Private `/stats` access requires the owner to set `STATS_TOKEN`; it remains
inaccessible without that secret. The deployment instructions below also cover
recreating the service and rollback.

## Behaviour

1. The six existing exact-location `point-data` snapshots remain the first choice.
2. When a snapshot is unavailable or needs refreshing, the configured service
   supplies one model for the requested location. Other searched locations use
   the same service. Empty configuration retains the existing direct-API behaviour.
3. The Worker accepts only latitude, longitude and one of Snowline's 15 models.
   It constructs the existing fixed request itself: the same 11 variables,
   eight-day window, GMT timestamps, Celsius, mm and mph. It cannot proxy arbitrary
   URLs, dates, variables or model lists. Coordinates are rounded to four decimal
   places (about 11 m north–south); this rounding also applies to the provider
   request. Nearby town forecasts are never substituted.
4. One named SQLite-backed Durable Object coordinates requests from all regions.
   Each coordinate/model result is fresh for one hour from **provider retrieval**.
   Simultaneous requests for the same key join the same fetch. Browser Refresh
   cannot force an upstream refresh within that hour. Three distinct upstream
   requests may run at once; another 60 distinct keys can wait. Overload returns
   a temporary error and can use an eligible previous forecast.
5. Provider 429 responses set a persistent service-wide cooldown using Retry-After
   or the existing daily/hourly/minutely rules. Already-running requests can finish.
   Other failed keys back off for one minute (five minutes for HTTP 400).
6. Temporary network, 429 and 5xx failures may serve the **same location and model**
   forecast up to 24 hours old, only if current/future values remain. Retrieval
   timestamps are never advanced on cache hits or errors. Existing chart labels
   show cached forecasts and refresh failures. Missing fields stay missing.
   HTTP 400 never becomes a stale success. Expired forecasts are refused.
7. Once configured, the browser does **not** fall through to direct Open-Meteo
   forecast requests on service failure. Existing browser and town caches can
   still provide data. Map rendering, geocoding and the elevation endpoint are unchanged. The maps’
   separate point-event forecast analysis is outside this location-chart integration
   and retains its existing request path.

Storage retains at most 256 coordinate/model entries, evicting oldest stored
entries first; that is about 17 complete 15-model locations, or more partial
locations. Entries past 24 hours are pruned on writes. Eviction may make a later
search fetch again. Original forecast responses and coordinates are stored; no
visitor identity is recorded by the application. Cloudflare's own request logs
and platform policies remain separate. Failure responses are not stored as forecasts.

## Usage and limits

`DAILY_HTTP_BUDGET` defaults to 1,000 outbound forecast HTTP requests per UTC day.
Reservations are saved before fetching and survive restarts. At the ceiling,
fresh cache hits still work; missing/expired entries return an error or eligible
stale data. This ceiling covers this Worker only: the six-town publisher and any
other direct clients consume their own requests. A cache can reduce repetition;
unique searches, eviction and hourly updates still consume provider usage.

**HTTP counts are not Open-Meteo's weighted API units or remaining allowance.**
This implementation makes no promise about plan eligibility or cost, does not
bypass provider limits, and does not change commercial-use licensing.

`GET /stats` requires `Authorization: Bearer <STATS_TOKEN>` and returns daily
`requests`, `hits`, `joined`, `upstream`, `stale`, `errors`, `blocked`, cache entry
count and inflight count. Counts cover calls reaching the Durable Object, not
requests handled by the browser or predefined town snapshots. `errors` counts
failed refresh operations, `stale` counts those operations that supplied a fallback,
and `blocked` counts budget rejections; joined callers share that result. Daily
counters roll over at UTC midnight; the service cooldown remains independent.
The counters are activity measurements, not billing reconciliation.

## Deploy and activate

Prerequisite: an owner-controlled Cloudflare account with Workers and SQLite-backed
Durable Objects available. Review that account's current limits before deployment.
No API key is required for the existing public Open-Meteo endpoint; a future paid
endpoint/key would need a separate server-side change, never a key in browser code.

From the repository root, using a current Node.js installation:

```sh
npx wrangler login
npx wrangler deploy --config worker/wrangler.toml
npx wrangler secret put STATS_TOKEN --config worker/wrangler.toml
```

Enter a strong private token in the last prompt. Do not commit it. The first
Worker deployment creates the namespace via the `v1` migration; no KV or R2 bucket
setup is required. The allowed browser origin is initially
`https://matthewhugo81-arch.github.io`; add any later custom origin explicitly in
`ALLOWED_ORIGINS` and redeploy. An origin allowlist is not authentication: scripts
outside browsers can omit/spoof Origin. The fixed request shape, global budget,
concurrency bound and entry limit constrain exposure; use Cloudflare rate limiting
if public traffic warrants it. Stats authentication is enforced independently.

Before editing the public site:

- Check `https://<actual-worker-host>/health` returns `{"ok":true,"version":1}`.
- Request `/forecast?latitude=53.9171&longitude=-2.1871&model=ecmwf_ifs`
  twice. Confirm the same `_retrievedAt` and `_source: "shared cache"`.
- Check authenticated `/stats`: two service requests should normally have one
  upstream fetch and one hit (allow for other traffic). Verify other requests
  without the token cannot read stats.
- Check an unsupported model returns 400 without increasing upstream requests.
- Test from Snowline's browser origin to verify CORS. `/health` alone does not
  verify provider connectivity, storage or the cache.

Then set `FORECAST_SERVICE_URL` in `forecast-service.js` to the **actual HTTPS
Worker origin** and publish that commit through the normal GitHub Pages process.
Do not put a placeholder host into a live configuration. Bump the `app.js` script
query in `index.html` and the `point-forecasts.js` import query in `app.js`, and the `forecast-service.js` import query in
`point-forecasts.js` when activating, so already-cached application modules pick up the configuration.
Verify a newly searched location uses `/forecast` in the browser Network panel,
all 15 model results settle, a second browser reuses retrieval times, and a Worker
failure displays dated cached results or an unavailable message rather than
issuing direct forecast requests. Existing six-town snapshots may correctly
avoid the Worker entirely.

Rollback: clear `FORECAST_SERVICE_URL` and bump those module queries again, then
publish. This explicitly restores direct forecasts (and their previous allowance
exposure). The Worker can remain available while investigating; deleting it or
its Durable Object storage discards cached data and counters.

## Validation

```sh
node --test tests/*.test.mjs
python tests/worker-runtime/check.py
npx wrangler deploy --dry-run --config worker/wrangler.toml
```

The automated service fixtures make no live provider calls. They cover single
flight, restarts, expiry, coordinate/model isolation, cooldowns, stale timestamps,
failed-key backoff, budget enforcement, client routing and HTTP access controls.
A dry-run checks packaging, not deployment credentials, account entitlements or
end-to-end production behaviour. Complete the activation checks above after deployment.

Cloudflare references:
- https://developers.cloudflare.com/durable-objects/get-started/
- https://developers.cloudflare.com/durable-objects/api/state/
- https://developers.cloudflare.com/durable-objects/platform/limits/

## Worker transport correction (15 October 2026)

The first deployed forecast request exposed two runtime-specific transport defects:
ambient `fetch` had been stored as an instance method (an invalid receiver in
workerd), and `redirect: "error"` is unsupported by Workers. The transport now
wraps global fetch and uses `manual`, refusing unexpected redirects as HTTP 502.
The native workerd fixture exercises a complete cache miss and cache hit through
the real fetch implementation using a local data URL, without contacting Open-Meteo.
It runs in regression CI alongside the Node tests. Prior health/packaging checks
did not exercise this outbound path.
