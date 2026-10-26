# AI co-authorship on GitHub over time

Generated 2026-10-26 by [`scripts/trends.mjs`](../scripts/trends.mjs); refreshed weekly by [`trends.yml`](../.github/workflows/trends.yml). Raw numbers in [`trends.json`](trends.json).

![Commits per month by agent](trends.svg)

## Indexed commits per month

Commits indexed by GitHub search whose message matches each agent's query (below), by committer date. † marks a partial count: GitHub's search timed out before scanning everything (`incomplete_results: true`), so the true number is higher by an unknown factor.

| Month | Claude Code | GitHub Copilot | OpenAI Codex | Cursor | Aider | Devin | Gemini | Jules |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2025-04 | 17,116† | 19,670† | 4† | 107† | 6,575 | 461† | 260† | 49 |
| 2025-05 | 42,035† | 41,626† | 7 | 197† | 5,520 | 479† | 467 | 2,018 |
| 2025-06 | 255,359† | 43,564† | 15† | 10,642† | 6,086 | 103† | 4,987† | 3,088 |
| 2025-07 | 336,098† | 50,414† | 35† | 12,531† | 15,178 | 702† | 16,802 | 2,334 |
| 2025-08 | 538,825† | 59,114† | 44† | 13,636† | 16,821 | 160† | 29,521 | 2,611† |
| 2025-09 | 505,385† | 72,210† | 1,451† | 9,340† | 13,498 | 131 | 28,527 | 3,039 |
| 2025-10 | 571,533† | 103,608† | 4,310† | 10,544† | 13,961 | 110† | 31,069† | 3,287 |
| 2025-11 | 957,737† | 111,950† | 1,148† | 8,391† | 17,078 | 104† | 29,823† | 2,752 |
| 2025-12 | 1,420,933† | 106,452† | 1,058 | 9,418† | 12,587 | 110 | 29,015 | 5,819 |
| 2026-01 | 3,041,195† | 121,173† | 4,104† | 29,059† | 11,024 | 126 | 25,492† | 12,829 |
| 2026-02 | 4,706,737† | 215,890† | 25,085† | 523,641† | 12,297 | 2,325 | 22,829 | 24,713 |
| 2026-03 | 6,410,317† | 434,262† | 67,862† | 20,690† | 19,480 | 2,912 | 25,092 | 28,910† |
| 2026-04 | 6,674,370† | 734,883† | 67,447† | 13,517† | 24,092 | 2,731† | 18,817† | 27,410† |
| 2026-05 | 9,074,837† | 577,650† | 82,769† | 855,890† | 29,485 | 1,072† | 18,157 | 26,964 |
| 2026-06 | 8,797,837† | 282,934† | 109,942† | 878,315† | 24,204 | 638 | 10,264† | 23,988 |
| 2026-07 | 9,400,987† | 304,464† | 96,597† | 1,106,924† | 27,922 | 838† | 5,217 | 23,153 |
| 2026-08 | 10,152,901† | 269,121† | 93,556† | 1,228,238† | 29,846 | 897† | 1,210 | 22,670† |
| 2026-09 | 9,891,103† | 341,723† | 127,649† | 1,134,277† | 34,100 | 770† | 895 | 24,952 |
| 2026-09 vs 2026-08 | -2.6% | +27% | +36% | -7.7% | +14% | -14% | -26% | +10% |

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

## Calibration: 2026-09 split into weeks

Whether `total_count` can be trusted is checked each run: the latest month is re-counted as the sum of 7-day windows for every agent whose monthly query was flagged incomplete. A weekly sum far above the monthly figure shows how much the monthly search was cut short; a complete weekly window (no †) is exact as far as the index goes.

| Agent | Monthly total_count | Sum of weekly windows | Weekly windows flagged incomplete |
| --- | ---: | ---: | ---: |
| Claude Code | 9,891,103† | 25,038,901 | 5 of 5 |
| GitHub Copilot | 341,723† | 355,410 | 5 of 5 |
| OpenAI Codex | 127,649† | 130,565 | 5 of 5 |
| Cursor | 1,134,277† | 1,301,413 | 5 of 5 |
| Devin | 770† | 764 | 4 of 5 |

<sub>170 search requests, 1 retries, 1 secondary-limit pauses; pace 40 s.</sub>
