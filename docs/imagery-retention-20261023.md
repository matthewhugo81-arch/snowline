# Imagery retention — 23 October 2026

Prepared interactive-map tiles previously expired after one hour, although the
frame-progress counter could still say all frames were loaded. The same age limit
applied to saved viewport progress. This release keeps validated source imagery
within the existing bounded caches and checks the physical source files for
corrections instead of rebuilding unchanged pixels because of their age.

Source validators and the cache revision are shared under a browser lock. A
correction rotates both rendered and physical-source identities, then refreshes
the saved page layout to discard native, derived and in-flight data together.
New runs and appended hours retain the existing live metadata refresh behavior.
The update applies to the interactive Maps cache; other views retain their own
image-cache policies. It does not include the earlier scheduling experiment.

## Verification

- 669 Node tests passed, including two-hour disk restoration, corrected source
  revisions, native reader invalidation, startup checks, cross-tab coordination,
  failed checks/retry, immutable sources and unavailable persistent storage.
- Desktop (1280 × 900) and mobile (390 × 844) map browser regressions passed,
  including run selection and appended forecast hours.
- Live UKV / IFS 9 km / UKMO global cloud/precipitation/MSLP: all 154 available
  panel frames saved, 2,310 cache entries, 111,313,583 bytes. Seven distant/return
  selections and next/back controls made no weather-file requests or native
  renderer calls during those selections. Three selections followed an artificial
  two-hour clock advance and clearing the prepared-tile memory cache.
- A changed ETag injected only in the test browser caused a new imagery namespace
  and native preparation while preserving the selected time and three models.
  No live provider file was edited.
- Additional live comparisons covered three MOGREPS-UK probability fields and
  GEFS / ECMWF ENS / MOGREPS-G height anomalies with contours and mean MSLP.
  Both reused selected imagery without native regeneration after the simulated
  age. Saved probability selections took 94–225 ms; layered ensemble selections
  took 446–507 ms in that run.

The clock advance tests expiry behavior, not a literal two-hour soak. Browser
measurements used headless Chromium with software graphics and are not device
speed promises. Saved charts still require cache reads, image decoding, source
attachment, label layout and painting. Storage pressure can still evict entries.

## Release and rollback

The tested base is `9b30b633eb8b0117c8b4c97e4ba7f2e2ef537e6a`.
The application entry-point versions change so a normal page refresh fetches the
new modules. Existing tabs adopt this code on refresh; their first pass prepares
imagery in the new cache namespace. Layouts and favourites are preserved.
To roll back, revert the retention release commit and publish through the normal
Pages workflow; keep later unrelated changes and forecast data intact.
