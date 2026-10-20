# Pages publication and release checks

The first real preflight found an oversized package. See
[the measured capacity review](pages-capacity-review.md) before merging or
deploying these controls. The guard deliberately preserves the last deployment
until a publication fits the budget without removing advertised forecasts.

The publisher assembles source from its exact triggering commit. It retains all
advertised forecast runs, native hours and verified frames. Conversion-only
sidecars, incomplete backfills not listed in an archive index, temporary files,
worker/scheduler source and test tools remain outside the published site. The
conversion cache keeps incomplete backfills so later passes can resume them.

`scripts/pages_release.py` counts every **unpacked** file byte, including its
publication record, before upload. The job summary includes application, model
and exact-run totals. A 1,000,000,000-byte budget stops an oversized deployment
and preserves the previous site; it does not delete advertised forecast hours
or substitute another run. A warning starts at 90% of that budget. The compressed
artifact ZIP size and the conversion cache size are different measurements.
GitHub's published-site limit is documented at:
https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

`site-publication.json` records the source revision and a content digest. New
application code, changed grid bytes, new forecast hours, archive changes or
changed source-health status publish immediately. Poll-only `generated_at` and
`checked_at` changes do not force a full upload every five minutes. An unchanged
site still publishes a source-check heartbeat after 20 minutes, ahead of the
existing 30-minute publication-check recovery threshold. Point forecast
retrieval times are not excluded from the digest.

Every newly published source revision must pass both map and location browser
workflows. Data-only builds can reuse these checks only when the existing
published record proves that **the same commit** passed the current validation
version. The build, both browser workflows and the deployment refer to the same
commit. Missing validation, failed browser checks and cancelled checks cannot
authorize a deployment. The release record is part of the same atomic artifact
as the tested code and data; it is never published ahead of the checks.

Use the scheduled or manual publication run's summary to inspect size trends
and its deploy job to establish whether a release actually reached Pages. A
successful no-change run intentionally has no deployment. The first release of
these controls has no prior publication record, so it runs both browser suites
and publishes a new record after they pass.

Pull requests changing assembly/release code also run `Pages package preflight`.
It restores the last available main-branch data caches read-only, assembles the
proposed source with those forecasts and reports its measured size. It never
prepares new weather data or publishes. If the cache has been evicted, that
measurement is explicitly unavailable; the publisher's mandatory size check
still applies before any later deployment.

Validation:

```sh
python -m unittest discover -s tests -p 'test_pages*.py'
```

The regression tests exercise same-cycle corrections, timestamp-only polls,
source status changes, exact-revision validation, actual unpacked byte totals,
oversized payload rejection and retention of every advertised forecast run.
