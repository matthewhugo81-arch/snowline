# Post-publication checks — 12 October 2026

Feature commit `0e958a92479434f30c08df36f1c916e68851272c` deployed successfully in
run 38294770960, completed at 19:02 UTC. The preceding application snapshot is
unchanged in `backup/uk-model-maps-before-accumulations-20261012`.

The production-source Node regression suite passed. Production-source desktop
and mobile playback/briefing tests and the new accumulation/history tests passed
in run 38294770912. That run then exposed a mobile test synchronization failure
in the separate chart-export suite: clicking panel B automatically scrolled the
page, and a late scroll event correctly dismissed the context menu before the
test inspected it. The same suite had passed in the full pre-release review.

The test now settles its own scroll, waits for image decoding where applicable,
and right-clicks the visible centre without initiating a second automatic scroll.
No application or context-menu behavior was changed; PNG content, clipboard,
fallback and menu visibility assertions remain intact. Verification run
38296285081 then passed the complete export/chart-style suite three consecutive
times at both 1280 px and 390 px (six successful viewport checks). The tested
file is blob `32ae9aa7f1317f9fd04ac46f8b04b17102018a8b`.

The separate hourly Map feed health run 38294770934 completed at 19:01 UTC and
flagged one review condition: the UKV main initialization was 12Z, age 7.02 h,
above the conservative six-hour threshold. All 19 remote model choices returned
metadata successfully; forecast byte-range samples succeeded where applicable.
The age warning remains visible rather than being suppressed to make CI green.
The earlier direct 18:56 UTC checks found both UKV live pointers at the 14Z
nowcast and returned HTTP 404 for the 15Z/18Z main-run metadata at this spatial
source. This is not proof of a wider Met Office outage, and does not justify
inventing a later cycle or changing the selected run.
