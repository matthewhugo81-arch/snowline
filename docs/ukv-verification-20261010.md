# UKV identity and forecast-range verification

Checked on 10 October 2026 at 07:13:49 UTC against the live Open-Meteo spatial feed. This is a historical diagnostic snapshot, not a statement that these remain the latest runs.

## Model identity

Open-Meteo identifies its `ukmo_uk_deterministic_2km` UK 2 km feed as the Met Office UKV model. Snowline now displays **UKMO UKV 2 km**. Its API identifier, forecasts and latest-only selection are unchanged.

Sources: https://open-meteo.com/en/docs/ukmo-api (Data Sources); https://registry.opendata.aws/met-office-uk-deterministic/ (Met Office-managed dataset).

## Live-feed inspection

Diagnostic workflow: https://github.com/matthewhugo81-arch/snowline/actions/runs/38033698010

| Cycle | Completed | Last supplied valid time | Horizon |
| --- | --- | --- | --- |
| 10 October 0200Z (latest.json) | true | 10 October 14:00 UTC | 12 h |
| 10 October 0100Z | true | 10 October 13:00 UTC | 12 h |
| 10 October 0000Z | true | 12 October 06:00 UTC | 54 h |
| 9 October 2300Z | true | 10 October 11:00 UTC | 12 h |
| 10 October 0300Z | metadata returned HTTP 404 | Not yet available in this feed when checked | Not inferred |

The latest 0200Z metadata contained 13 valid timestamps including T+0, with precipitation and MSLP both present. The T+12 file (14:00 UTC) returned HTTP 200; the 15:00 UTC file returned HTTP 404. The cutoff therefore reflects the end of that individual UKV cycle, not a Snowline animation limit. Latest metadata was last modified at 06:20:18 UTC.

## Run lengths

The Met Office-managed AWS catalogue documents 12-hour nowcast cycles at the intervening hourly initializations, 54-hour forecasts at 0000/0600/0900/1200/1800/2100Z, and 120-hour forecasts at 0300/1500Z. Longer scheduled duration does not prove that all those hours are already available in Open-Meteo's spatial feed. Open-Meteo documents an additional open-data delay of about four hours.

Strict latest-initialization selection can shorten the available horizon when a newer nowcast supersedes an older extended cycle. Snowline continues to honour the user's latest-only policy. The run notes describe supplied coverage and never splice older cycles into a newer run.
