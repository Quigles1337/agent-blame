# AI co-authorship on GitHub over time

Generated 2026-11-09 by [`scripts/trends.mjs`](../scripts/trends.mjs); refreshed weekly by [`trends.yml`](../.github/workflows/trends.yml). Raw numbers in [`trends.json`](trends.json).

![Commits per month by agent](trends.svg)

## Indexed commits per month

Commits indexed by GitHub search whose message matches each agent's query (below), by committer date. † marks a partial count: GitHub's search timed out before scanning everything (`incomplete_results: true`), so the true number is higher by an unknown factor.

| Month | Claude Code | GitHub Copilot | OpenAI Codex | Cursor | Aider | Devin | Gemini | Jules |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2025-05 | 43,031† | 42,107† | 20† | 222† | 5,389† | 481† | 446† | 2,021† |
| 2025-06 | 259,615† | 44,240† | 17 | 10,576† | 6,134 | 103 | 5,112 | 3,112 |
| 2025-07 | 427,049† | 60,655 | 35† | 14,156† | 15,274 | 709 | 17,165 | 2,279† |
| 2025-08 | 562,887† | 65,283† | 42 | 14,467 | 16,884 | 160 | 30,317† | 2,623 |
| 2025-09 | 485,947† | 60,497† | 1,164† | 9,127† | 13,491 | 127† | 29,087† | 3,037† |
| 2025-10 | 797,913† | 106,803† | 4,273 | 10,872 | 14,012 | 110† | 31,997 | 3,318† |
| 2025-11 | 1,036,850† | 122,474 | 1,139† | 8,701† | 17,127 | 103 | 30,554 | 2,766 |
| 2025-12 | 1,383,107† | 105,491† | 1,054† | 9,441 | 12,584 | 108† | 29,819† | 5,849 |
| 2026-01 | 2,138,281† | 124,310† | 4,025† | 26,907† | 11,017 | 125† | 26,085 | 12,859 |
| 2026-02 | 5,015,985† | 221,825† | 26,808† | 562,831† | 12,248 | 2,376† | 23,610 | 24,704 |
| 2026-03 | 8,674,562† | 448,847† | 72,977† | 21,165† | 20,103 | 2,974 | 25,172† | 28,564 |
| 2026-04 | 5,991,056† | 639,259† | 52,960† | 21,564† | 24,342 | 2,766 | 19,531 | 27,506 |
| 2026-05 | 6,973,602† | 583,529† | 93,082 | 1,120,527† | 29,512 | 1,084† | 18,830 | 26,174 |
| 2026-06 | 8,582,171† | 251,212† | 118,123† | 1,059,540† | 24,113 | 651† | 10,740 | 23,335 |
| 2026-07 | 9,862,656† | 303,466† | 99,233† | 1,457,267† | 27,814 | 858† | 5,483 | 21,294 |
| 2026-08 | 9,783,514† | 298,643† | 98,612† | 1,350,663† | 29,638† | 894† | 1,325 | 22,300 |
| 2026-09 | 14,520,442† | 361,424† | 123,844† | 906,875† | 34,281 | 985† | 960 | 24,720 |
| 2026-10 | 15,061,692† | 744,180† | 256,954† | 727,663† | 44,878 | 775† | 918 | 24,228† |
| 2026-10 vs 2026-09 | +3.7% | +106% | +107% | -20% | +31% | -21% | -4.4% | -2.0% |

## Queries

One commit-search query per agent and month, `<query> committer-date:<first day>..<last day>`; the number is the API's `total_count`. The same table is exported as `AGENT_QUERIES` from `scripts/trends.mjs` and quoted in the README.

| Agent | id | Query |
| --- | --- | --- |
| Claude Code | `claude` | `"Co-authored-by: Claude"` |
| GitHub Copilot | `copilot` | `"Co-authored-by: Copilot"` |
| OpenAI Codex | `codex` | `"Co-authored-by: Codex"` |
| Cursor | `cursor` | `"Co-authored-by: Cursor"` |
| Aider | `aider` | `"(aider)"` |
| Devin | `devin` | `"Co-authored-by: devin-ai-integration"` |
| Gemini | `gemini` | `"Co-authored-by: gemini-code-assist"` |
| Jules | `jules` | `"Co-authored-by: google-labs-jules"` |

## Methodology and caveats

- Source: the GitHub REST commit search API (`GET /search/commits`), which indexes commits on the default branch of repositories GitHub has indexed; forks and other branches are not counted, and private repositories are invisible.
- A commit counts for an agent when its message matches the agent's query as a phrase. Trailers are voluntary and some workflows strip them, so every number is a lower bound on the agent's real activity, and the queries do not cover agents that commit under their own author identity without a trailer.
- Windows are calendar months by committer date (`committer-date:YYYY-MM-01..YYYY-MM-DD`), oldest to newest; the current, incomplete month is left out. Each number is the API's `total_count`, which is not capped at 1,000 (values in the millions are returned).
- GitHub limits the time a search may take. When a query exceeds it the response carries `incomplete_results: true` and `total_count` is only what was found before the cut-off; such cells are marked † and understate the truth by an unknown factor. Every `"Co-authored-by: ..."` phrase query observed so far times out, whatever the result size (the phrase is scanned across the whole index), while the single-token `"(aider)"` query completes. The weekly-split calibration below measures the gap for the latest month.
- Partial counts of the same query vary from run to run by tens of percent, so month-over-month changes of the † series should be read as noise unless they are large.
- Requests are paced (30 s apart, slower after a secondary rate limit; 20 s apart already trips GitHub's secondary limit for these queries) and retried with back-off on 403/429, using the Retry-After header when GitHub sends one.

## Calibration: 2026-10 split into weeks

Whether `total_count` can be trusted is checked each run: the latest month is re-counted as the sum of 7-day windows for every agent whose monthly query was flagged incomplete. A weekly sum far above the monthly figure shows how much the monthly search was cut short; a complete weekly window (no †) is exact as far as the index goes.

| Agent | Monthly total_count | Sum of weekly windows | Weekly windows flagged incomplete |
| --- | ---: | ---: | ---: |
| Claude Code | 15,061,692† | 38,045,897 | 5 of 5 |
| GitHub Copilot | 744,180† | 782,096 | 4 of 5 |
| OpenAI Codex | 256,954† | 301,599 | 5 of 5 |
| Cursor | 727,663† | 1,098,734 | 5 of 5 |
| Devin | 775† | 955 | 0 of 5 |
| Jules | 24,228† | 24,229 | 1 of 5 |

<sub>175 search requests, 1 retries, 1 secondary-limit pauses; pace 40 s.</sub>
