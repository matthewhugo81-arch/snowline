# Automatic model publication

The source check now covers every feed Snowline converts: GEFS mean/spread,
ECMWF ensemble mean/spread, MOGREPS-UK snowfall, GEM 700 hPa and ICON Europe
700 hPa. It compares exact initialization and forecast hours with real source
files. Missing later hours of an already published run also request a build.
One unavailable provider cannot suppress updates from the other providers.

Native map grids, including IFS 9 km, IFS 0.25, AIFS, GFS, ICON, GEM, UKMO,
UKV, AIGFS, HGEFS, JMA, HARMONIE, ARPEGE, AROME and MOGREPS precipitation,
come directly from Open-Meteo object storage. Their existing browser refresh
checks published metadata every 60 seconds. A Snowline deployment cannot make
these upstream files arrive earlier. UKV continues to select the latest issued
main cycle; intermediate short nowcasts do not replace it. MOGREPS snowfall
must match the precipitation cycle, and direct 700 hPa grids match their native
surface-model cycle.

## Independent clock

`scheduler/` is a separate Cloudflare Worker. Its UTC cron runs every three
minutes, including when the owner's computer is off. A persistent Durable
Object checks GitHub for active health/publication jobs and dispatches
`map-feed-health.yml` on `main` only when another recent check is not running.
The health workflow runs `scripts/check_generated_freshness.py`, requests
`publish-maps.yml` when source files are missing from the site, then tests all
18 offered map models. The publisher converts all five feeds and deploys the
complete site atomically. A further check catches files that arrived during
the preceding build. Existing GitHub schedules remain independent fallbacks.

The same external clock independently checks `snowline-ensembles/pages.yml`.
Its `check_freshness` input runs the source/field-hour gate before deciding to
build. An unfinished MOGREPS-G run therefore resumes on subsequent ticks even
when GitHub's own schedule is delayed. The companion finishes a published
partial run before advancing to a newer initialization (up to the source's
48-hour retention window). Its importer continues protecting the last complete
run and publishing verified progress atomically. No map controls are changed.

Main and companion dispatches have separate persisted leases. A busy or failed
main build cannot suppress the companion, and an active companion build is
never duplicated or cancelled. The companion's stalled threshold is 110 minutes
to accommodate its existing 90-minute conversion timeout and publishing.
`/health` retains the main status and adds `mainOk` and `companion`; overall `ok`
requires both checks to be healthy.

Normal detection latency is up to three minutes, followed by GitHub queue,
conversion and Pages publication time. This is a polling target, not a hard
delivery SLA: provider outages, Cloudflare or GitHub outages can still delay
availability. No dates are advanced to hide delayed ingestion.

One scheduler instance joins concurrent ticks and persists its dispatch lease
before the API call. A lost response, restart, manual check or GitHub cron must
not produce a dispatch loop. Failed API calls are visible and retry on a later
tick. Running builds are never cancelled. A queued/running workflow older than
35 minutes is reported as stalled. The publisher has a 25-minute build limit.

## Deployment and credentials

Deployment is **not activated by merging this code**. Deploy this Worker and
configure its secret before describing the external clock as operational.

The dedicated GitHub credential needs access to **only**
`matthewhugo81-arch/snowline`, with repository **Actions: Read and write** and
the mandatory Metadata read permission. The companion additionally needs the
same permissions on `matthewhugo81-arch/snowline-ensembles`, either through that
credential or a separate `COMPANION_GITHUB_ACTIONS_TOKEN` Worker secret.
Do not give it Contents, Administration,
Secrets or account-wide access. GitHub's Actions permission includes more than
dispatching, so treat this credential as sensitive. Store it only as the
Cloudflare Worker secret `GITHUB_ACTIONS_TOKEN`, never in source, frontend
configuration, logs, screenshots or chat. Set an explicit expiry and record
its renewal date privately in the owner's credential manager. An expired or
revoked token produces a visible HTTP 401/403 scheduler error; GitHub fallback
schedules remain enabled.

From a signed-in owner-controlled Cloudflare CLI:

```sh
npx wrangler deploy --config scheduler/wrangler.toml
npx wrangler secret put GITHUB_ACTIONS_TOKEN --config scheduler/wrangler.toml
```

The second command prompts privately. The scheduler is separate from the
existing forecast cache and does not change its bindings, budgets or secrets.
No new paid product or subscription is required by this configuration.

Verify activation:

1. Cloudflare lists `*/3 * * * *` for `snowline-model-scheduler`. Trigger changes
   can take up to 15 minutes to propagate.
2. Its `/health` endpoint shows a fresh `checkedAt`, a real dispatched run ID
   (or an existing active/recent check), and no error. This is **scheduler**
   health; `lastHealthConclusion` and `lastPublisherConclusion` expose workflow
   outcomes separately. HTTP access is read-only and cannot trigger work.
3. Observe at least two real cron executions without manual dispatch.
4. Follow the associated GitHub health run through source checking and, when
   required, publication. Confirm the five model rows in the live
   `ensemble-data/health.json`, current metadata and byte-range samples.
5. Keep the existing local heartbeat only as a secondary backup, not the clock
   on which unattended publication depends.

Rollback: remove the cron from this Worker's configuration and redeploy, then
revoke its dedicated GitHub credential. The existing GitHub schedules and
website remain available. Do not delete the forecast cache Worker or storage.

## Tests

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_generated*.py'
python -m unittest discover -s tests -p 'test_ensemble*.py'
python -m unittest discover -s tests -p 'test_mogreps*.py'
python -m unittest discover -s tests -p 'test_vertical*.py'
npx wrangler deploy --dry-run --config scheduler/wrangler.toml
```

The fixtures cover simultaneous ticks, persistent leases across restarts,
ambiguous/failed dispatches, missing credentials, queued jobs, stale heartbeats,
public endpoint isolation, exact-cycle matching, late forecast hours, partial
source products, pagination, and independent source failure.

References:
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
