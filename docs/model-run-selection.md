# Dated model runs

Each model appears once in Maps and Forecast Briefing. A separate Run control
lists the newest published initialization and its most recent verified complete
predecessor. New selections prefer a complete run; if none can be verified, the
incoming run remains available with an explicit notice.

Maps and Forecast Briefing list each dated initialization once. By default, minute
checks keep the previous complete initialization selected while a newer run is
updating, then advance automatically once the newer run is verified complete. Checks also run
when a hidden page becomes visible again. The selected weather layer and valid
time are retained where the new run supplies them; otherwise the existing
field/time availability rules apply. Frames and their UTC labels change together
when the new frame is ready.

Selecting an older run deliberately pins that panel; selecting an incoming run
allows its published hours to be inspected at that exact initialization. Minute
checks still append hours and fields to a pinned run and update the other choices.
Selecting the most recent complete run resumes automatic promotion. Choosing
another forecast model also resumes automatic selection. A dated model key in
a shared URL remains an explicit pin. Opening Forecast Briefing carries the first
panel's automatic or pinned choice; returning to Maps rechecks the panel runs.

Panels track this choice independently, including two panels showing the same
model. Their timeline is the union of supplied valid times, with unavailable
panels blanked rather than filled from another run. An older pinned run remains
in its selector while being viewed, subject to the provider's archive availability.

Completion requires explicit completed metadata for all attached sources.
GFS also requires its exact-cycle 0.25-degree companion. A missing optional
derived product is described in the run notes; core completion does not promise
an optional layer that was never published. Unknown completion, missing metadata,
identity errors and incomplete intervening cycles never qualify as a fallback.
Failed checks retain verified displayed metadata. UKV retains its main-cycle
restriction; no point-forecast API behaviour changes.

MOGREPS-UK 2 km chart runs also use 00, 03, 06, 09, 12, 15, 18 and 21 UTC.
Maps, Forecast Briefing and Previous Run Analysis select the same dated cycles.
An hourly upstream latest index is resolved to the newest published three-hourly
initialization; archived selections and completion hints cannot introduce an
intervening hourly run. Forecast steps and each field's reporting periods remain
unchanged. The generated native snowfall supplement builds only these cycles,
reuses existing frames and retains three runs with complete-predecessor protection.
Old hourly generations age out through that retention policy. This reduces new
generation work, but does not imply a threefold reduction in total hosted storage:
native grids are upstream and the retained generation count remains three.
The separate full 18-member probability products still use all six hourly member
cycles, and their six-hourly initialization anchors remain unchanged.

Native models use existing dated Open-Meteo OM grids. No native run is copied
to Snowline, and no bulk imagery download is added to the browser. The checked
native source runs on 20 October 2026 occupied about 124.6 GiB upstream; this is
not a new hosting requirement. Browser preparation still covers only selected
runs, hours, fields and views using the existing bounded caches.

The main Pages deployment artifact measured 940,998,007 bytes, and the existing
companion artifact 326,546,845 bytes. These are archive measurements, not billing
figures or exact uncompressed site totals. Additional GEFS and ECMWF frames
measured approximately 14.1 MiB (partial GEFS) and 65.8 MiB (complete ECMWF).
A complete GEFS generation is estimated around 18 MiB at the measured bytes
per frame. Allow about 85–170 MiB for the retained extra-field generations.

To keep that increase off the nearly-full main publication, the existing
snowline-ensembles publisher copies completed extra-field files into its dated
companion archive. It checks metadata first, reuses existing files, publishes a
run manifest only after every listed frame is present, and retains a completed
predecessor through incomplete cycles. This reuses prepared files rather than
recomputing ensembles. The normal main-site incoming publication remains intact.
Archive loads try the primary exact-cycle URL and then the companion exact-cycle
URL. Already-deleted historical extra fields cannot be recovered by this policy;
protection begins with the next successfully captured complete generation.

Existing three-run analytical archives are preserved. Generated-feed cleanup
additionally protects the newest complete stored predecessor if several newer
cycles fail. The companion build measures its uncompressed publication and
rejects an oversized deployment before upload. Upstream outages or archive
expiry remain genuine availability limits and are not hidden by mixed runs.

Validation: Node unit suite, generated-feed Python tests, and
`tests/run-selector-browser.mjs` cover independent selections, default complete
runs, automatic completion promotion, partial arrivals, deliberate pins,
hidden-page catch-up, reload, source failure, UTC labels, Briefing and
desktop/mobile layouts. Synthetic browser tests verify application
behaviour rather than upstream throughput.
