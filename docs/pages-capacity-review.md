# Pages capacity: release blocker and hosting decision

Measured on 20 October 2026. This is a release decision record; it does not
change the data hosts, forecast products, resolution or retention policy.

## Confirmed measurement

The repair branch's [read-only package preflight](https://github.com/matthewhugo81-arch/snowline/actions/runs/39487578021/job/118851903511)
assembled the current cached forecasts and proposed runtime files. It measured
**1,165,262,641 unpacked bytes across 1,969 files**. The
1,000,000,000-byte release budget correctly rejected this package. A successful
compressed artifact upload would not make an oversized published site compliant
with [GitHub Pages' published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

| Main-site group | Measured unpacked bytes |
| --- | ---: |
| ECMWF core ensembles | 556,474,048 |
| GEFS core ensembles | 182,916,648 |
| ICON-EU 700 hPa | 153,905,463 |
| MOGREPS global local fallback | 85,162,799 |
| GEM 700 hPa | 83,929,126 |
| ECMWF additional fields | 69,251,432 |
| GEFS additional fields | 18,515,878 |
| MOGREPS UK snowfall | 7,570,836 |

These rows exclude the remaining runtime, point-data and health files; the
headline total includes every publication file. Later builds can have different
sizes, so this measurement must not replace the mandatory release gate.

## Why the existing companion is not a sufficient simple move

The [successful companion publication](https://github.com/matthewhugo81-arch/snowline-ensembles/actions/runs/39469678629)
measured **568,851,765 unpacked bytes**. Moving today's GEM and ICON-EU 700 hPa
files there would make the main site 927,428,052 bytes and the companion
806,686,354 bytes. These snapshots alone are misleading.

The companion currently contains two MOGREPS grid runs, one run of each
additional-field ensemble, and five point-index runs. Existing retention can
hold three MOGREPS grid runs, two runs of each additional-field ensemble, and
up to nine point-index runs across the 48-hour window. Using observed run
sizes, that healthy retained state is approximately **765.5 MB before moving
any ICON-EU or GEM 700 hPa data**. Point indexes are already compressed.

ICON-EU usually alternates full and short cycles, but source failures can leave
three full runs retained. A regressed upstream pointer can temporarily retain
three full runs and one short run. At the observed file sizes these cases are
approximately 268.7 MB and 300.9 MB. GEM upper-air retention can also keep an
extra verified run during a source-pointer regression. These are plausible
states allowed by current code, not a proven upper bound on future bytes.

The older MOGREPS local fallback is not wholly redundant: the 19 October 12Z
and 18Z runs are available on the main site and absent from the companion.
Removing all fallback files would remove existing exact-run choices. The
20 October 00Z companion data cover the corresponding local variables, hours,
intervals, grid and members, but removing that one duplicate saves only about
28.3 MB. Neither changing file extensions nor reducing JSON whitespace solves
the overall capacity problem.

## Recommended decision before merging the main repair

Give the existing GEM and ICON-EU 700 hPa conversions a separate data
publication, keeping all four public website entry URLs unchanged. A dedicated
GitHub Pages data repository is one option; object storage supporting HTTP byte
ranges is another. This changes file hosting only, not the upstream model feeds.

The two domains occupy **237,834,589 bytes today**. The main site would be
approximately **927.4 MB** after their relocation, and the existing companion
would not take on their growth. A separate data publication has substantially
more room for the roughly 385–413 MB observed-size recovery scenarios involving
extra retained GEM/ICON runs. It still needs its own unpacked-size gate. The
main site remains above the 90% warning threshold and must retain its budget
check and per-run inventory.

No new repository, storage service or data endpoint has been created. The
choice needs review because it adds a public hosting destination and, for an
object-storage service, potentially account setup and charges.

## Required rollout and acceptance checks

1. Publish the existing converters and every currently advertised migrated run
   to the chosen data host, using the existing native grids, units and hours.
2. Verify exact-reference metadata, variable coverage and every advertised
   binary frame. Check byte ranges, CORS and transport content type on the live
   host. A newer cycle cannot stand in for a selected older cycle.
3. Add the new exact-run route with the existing same-run fallback, update all
   affected JavaScript import versions, and pass browser and forecast tests.
4. Transfer freshness monitoring and recovery ownership to the data publisher;
   a missing remote frame must not trigger a main build unable to repair it.
5. Remove the original binaries only after live coverage verification and all
   publication budgets pass. Record the completed migration, then use ordinary
   retention and freshness checks rather than requiring old migration references
   forever.

Already-open tabs using old JavaScript may need a reload after the old binary
URLs disappear. GitHub Pages cannot redirect arbitrary binary paths, and the
current main-site size does not permit a full overlap package within its budget.
Do not conceal this transition with cross-cycle substitutions or silent loss of
forecast hours. Until a capacity solution is verified, keep the main repair PR
in draft and do not merge it into the scheduled publisher.
