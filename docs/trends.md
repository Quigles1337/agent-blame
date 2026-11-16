# AI co-authorship on GitHub over time

Generated 2026-11-16 by [`scripts/trends.mjs`](../scripts/trends.mjs); refreshed weekly by [`trends.yml`](../.github/workflows/trends.yml). Raw numbers in [`trends.json`](trends.json).

![Commits per month by agent](trends.svg)

## Indexed commits per month

Commits indexed by GitHub search whose message matches each agent's query (below), by committer date. † marks a partial count: GitHub's search timed out before scanning everything (`incomplete_results: true`), so the true number is higher by an unknown factor.

| Month | Claude Code | GitHub Copilot | OpenAI Codex | Cursor | Aider | Devin | Gemini | Jules |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2025-05 | 41,206† | 41,830† | 18† | 212† | 5,504† | 450† | 471† | 2,038† |
| 2025-06 | 250,589† | 44,594† | 17 | 10,520† | 6,175† | 102† | 5,174† | 3,141 |
| 2025-07 | 433,601† | 47,023† | 35† | 14,279† | 15,206 | 705 | 16,906† | 2,396† |
| 2025-08 | 551,068† | 65,747† | 42 | 14,376† | 16,923 | 162† | 30,862 | 2,620 |
| 2025-09 | 479,421† | 72,692† | 1,493† | 8,863† | 13,488 | 126† | 29,547 | 3,028† |
| 2025-10 | 879,100† | 107,397† | 4,275† | 10,648† | 14,050 | 108† | 32,443† | 3,324† |
| 2025-11 | 963,968† | 121,261† | 1,143 | 8,702† | 17,216 | 102† | 31,031 | 2,778 |
| 2025-12 | 1,250,162† | 112,858† | 1,050† | 8,849† | 12,624 | 106† | 30,387† | 5,862 |
| 2026-01 | 3,123,281† | 124,419† | 4,115† | 28,340† | 13,269 | 122† | 26,553 | 12,902 |
| 2026-02 | 4,053,367† | 214,189† | 28,009† | 578,606† | 13,937 | 2,544† | 24,020 | 24,845 |
| 2026-03 | 7,208,111† | 459,923† | 73,833† | 19,299† | 20,138† | 3,059† | 26,679 | 28,676 |
| 2026-04 | 8,818,774† | 630,347† | 74,177† | 13,084† | 24,306 | 2,824† | 19,992† | 27,490 |
| 2026-05 | 4,799,249† | 509,320† | 93,582† | 833,219† | 29,479 | 1,103† | 19,262 | 26,110† |
| 2026-06 | 4,904,801† | 308,099† | 130,239† | 899,020† | 24,236 | 681 | 10,898† | 22,953† |
| 2026-07 | 3,793,387† | 273,669† | 99,225† | 1,811,335† | 27,797 | 924† | 5,616 | 21,318 |
| 2026-08 | 5,321,225† | 290,082† | 93,693† | 1,235,934† | 29,478 | 910† | 1,388 | 22,322 |
| 2026-09 | 9,972,014† | 302,549† | 87,303† | 996,214† | 33,998 | 1,047† | 954† | 24,749 |
| 2026-10 | 11,915,811† | 688,745† | 269,602† | 924,571† | 45,302 | 1,054† | 944 | 24,298 |
| 2026-10 vs 2026-09 | +19% | +128% | +209% | -7.2% | +33% | +0.7% | -1.0% | -1.8% |

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
| Claude Code | 11,915,811† | 34,266,885 | 5 of 5 |
| GitHub Copilot | 688,745† | 785,361 | 4 of 5 |
| OpenAI Codex | 269,602† | 313,288 | 5 of 5 |
| Cursor | 924,571† | 1,075,115 | 5 of 5 |
| Devin | 1,054† | 1,052 | 5 of 5 |

<sub>170 search requests, 1 retries, 1 secondary-limit pauses; pace 40 s.</sub>
