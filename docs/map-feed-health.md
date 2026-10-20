# Map feed health

`scripts/check_map_feeds.mjs` reads published metadata and tiny byte ranges. It reports availability separately from initialization age. An unreadable source has **unverified freshness**; it is not classified as stale from an old or missing timestamp.

| Model family | Age review | Conservative stale age |
|---|---:|---:|
| UKV | More than 6 hours | More than 12 hours |
| Other regional feeds | More than 12 hours | More than 24 hours |
| Global feeds | More than 24 hours | More than 48 hours |

These are monitoring thresholds, not upstream publication promises. Initialization age alone does not prove that a newer source run exists. The monitor never changes the run, forecast times, intervals, units, cache policy or data provider used by the website. Generated GEFS, ECMWF ENS and MOGREPS-G freshness remains the responsibility of the existing official-source comparison in `check_generated_freshness.py`.

## Incident and notification behaviour

Every report and Actions summary retains the current data status: healthy, review or degraded. Readable data beyond the stale threshold is shown as degraded immediately. A stale native feed triggers a new workflow failure only after at least two observations spanning 15 minutes. A gap longer than 45 minutes restarts an unconfirmed persistence window. Unreadable metadata or sampled current/archive files and invalid timestamps trigger a new failure immediately.

The read-only metadata/sample check, incident persistence and report upload run even while the publisher is active. Only the generated-feed source/recovery checks defer to an active publisher. Frequent conversion builds therefore cannot indefinitely hide a stale native feed.

The workflow restores and saves a small incident-state file using an Actions cache prefix that is independent of the code revision. An incident already notified does not fail every subsequent dispatch. Its summary and JSON artifact continue to say that it is ongoing and degraded. Recovery clears that incident and adds a notice; a later incident can fail again. Existing generated-feed checks and recovery dispatches retain their own behaviour.

Cache loss or an incompatible/corrupt state file is explicitly reported. It does not mark currently degraded data healthy. Persistence and notification history must be established again, so an unreadable source can produce a new notification after cache loss, and stale age must be confirmed again. The cache is a best-effort notification history, not a durable incident database. No email, issue or external notification service is added.

To run the check with an explicit state location:

```sh
node scripts/check_map_feeds.mjs health-output/map-feeds.json --state .health-state/map-feed-state.json
```

The default state path is `.health-state/map-feed-state.json`. The JSON output includes `health` on each model and a `monitoring` section with the restored-state status, current degraded models, new incidents, recovery notices and repeat-notification decisions. A successful workflow after the first incident means no **new** notification from this monitor; inspect its data status to determine whether the feed has recovered.

Policy, persistence, recovery and summary behaviour are covered by offline tests in `tests/map-feed-status.test.mjs`.
