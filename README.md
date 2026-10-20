# agent-blame

[![CI](https://github.com/Quigles1337/agent-blame/actions/workflows/ci.yml/badge.svg)](https://github.com/Quigles1337/agent-blame/actions/workflows/ci.yml)
![AI-assisted](examples/agent-blame.svg)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-blue)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Measure how much of a codebase was written with AI coding agents, line by line, from the `Co-Authored-By` trailers and author identities those agents already leave in git history. Retroactive, local, zero runtime dependencies.

AI coding agents sign their work: Claude Code, GitHub Copilot, Cursor, Codex, Aider, Devin and others add a `Co-Authored-By` trailer or commit under their own identity. `agent-blame` runs `git blame` over every tracked file, classifies each commit by that evidence, and reports the share of surviving lines that were agent-assisted, broken down by directory, file, author, agent and month. It answers the questions engineering managers, reviewers and compliance teams are starting to ask: where did this code come from, which parts deserve closer review, what can we say about provenance, and how is adoption changing over time.

## Quick start

```sh
npx agent-blame                       # the repository in the current directory
npx agent-blame path/to/repo --files  # per-file instead of per-directory
npx agent-blame --by-author --history # who, and how it changed month by month
npx agent-blame --json > ai.json      # stable schema for tooling
npx agent-blame --badge ai.svg        # shields-style badge
```

Requires Node 20 or later and `git` on `PATH`. Nothing is installed globally and nothing leaves your machine. Until the first npm release, run it straight from this repository:

```sh
npx github:Quigles1337/agent-blame
```

## Example output

Run against [Quigles1337/G-del](https://github.com/Quigles1337/G-del), a Lean 4 project with a mix of human and Claude Code commits (repository path shortened):

```
agent-blame …/G-del @ f0178b9 (main)

Summary                            Lines  Share
Lines (blame of the working tree)  5,254
  AI-assisted                      2,429  46.2%  █████████░░░░░░░░░░░
  Human                            2,825  53.8%

By agent       Lines  Share  Commits
  Claude Code  2,429  46.2%        3

12 commits across all refs: 3 AI-assisted (25.0%), 9 human, 0 bot

Path (depth 1)      Files  Lines  AI-assisted   Share
Main.lean               1     82           82  100.0%  ████████████████████
.github/                1     73           73  100.0%  ████████████████████
CITATION.cff            1     29           29  100.0%  ████████████████████
LICENSE                 1     21           21  100.0%  ████████████████████
.gitignore              1     14           14  100.0%  ████████████████████
lakefile.toml           1     10           10  100.0%  ████████████████████
.gitattributes          1      6            6  100.0%  ████████████████████
lake-manifest.json      1      5            5  100.0%  ████████████████████
lean-toolchain          1      1            1  100.0%  ████████████████████
scripts/                3    103           96   93.2%  ███████████████████░
Godel.lean              1     16           13   81.3%  ████████████████░░░░
README.md               1    327          205   62.7%  █████████████░░░░░░░
docs/                   9  1,595          874   54.8%  ███████████░░░░░░░░░
THEOREMS.md             1    165           86   52.1%  ██████████░░░░░░░░░░
Godel/                 10  1,616          579   35.8%  ███████░░░░░░░░░░░░░
standalone/             1  1,191          335   28.1%  ██████░░░░░░░░░░░░░░
```

With `--by-author --history`:

```
Author                        Lines  AI-assisted  Share
Quigles1337 <adz@alphx.io>    5,254        2,429  46.2%  █████████░░░░░░░░░░░
  Lines are credited to the commit author; the share is how many of them were agent-assisted.

Month (added lines, HEAD history)  Added  AI-assisted  Share     Commits
2026-08                            5,374        2,529  47.1%  ▄       10
  Trend: ▄
```

The badge written by `--badge`: ![AI-assisted 46%](examples/G-del.svg)

And this repository measuring itself (`examples/agent-blame.txt`, regenerated with `npm run examples`; the self-sample excludes `examples/`, which is this very output):

```
agent-blame …/agent-blame @ f8da0f2 (docs/readme-ci)

Summary                            Lines   Share
Lines (blame of the working tree)  3,553
  AI-assisted                      3,553  100.0%  ████████████████████
  Human                                0    0.0%

By agent       Lines   Share  Commits
  Claude Code  3,553  100.0%       12

12 commits across all refs: 12 AI-assisted (100.0%), 0 human, 0 bot

Path (depth 1)  Files  Lines  AI-assisted   Share
src/               11  1,960        1,960  100.0%  ████████████████████
test/              10  1,361        1,361  100.0%  ████████████████████
.github/            2     76           76  100.0%  ████████████████████
package.json        1     53           53  100.0%  ████████████████████
scripts/            1     51           51  100.0%  ████████████████████
LICENSE             1     21           21  100.0%  ████████████████████
.editorconfig       1     12           12  100.0%  ████████████████████
bin/                1     12           12  100.0%  ████████████████████
.gitignore          1      5            5  100.0%  ████████████████████
.gitattributes      1      2            2  100.0%  ████████████████████
```

More samples, including `--markdown` and `--json`, are in [`examples/`](examples/).

## Options

```
agent-blame [path] [options]
```

| Option | Description |
| --- | --- |
| `path` | Repository, or a directory inside one (scopes the file list to that subtree). Default `.` |
| `--json` | Machine-readable report with a stable schema (see below) |
| `--markdown` | GitHub-flavoured Markdown tables, for PR comments, READMEs or `$GITHUB_STEP_SUMMARY` |
| `--badge <file.svg>` | Also write a shields-style "AI-assisted \| NN%" badge (self-contained SVG) |
| `--files` | Per-file table instead of per-directory |
| `--depth <n>` | Directory depth of the path table (default `1`; `0` collapses everything) |
| `--by-author` | Per-author table: lines credited to each author and how many were agent-assisted |
| `--history` | Monthly share of added lines that were agent-assisted, with a sparkline |
| `--weekly` | ISO weeks instead of months for `--history` |
| `--since <date>`, `--until <date>` | Limit `--history` (git date syntax). Blame is always the current state |
| `--include <glob>` | Only these paths; repeatable. `*`, `**`, `?`; a pattern without `/` matches basenames anywhere |
| `--exclude <glob>` | Skip these paths; repeatable |
| `--max-file-size <size>` | Skip larger files (default `2mb`) |
| `--config <file>` | Config file (default `.agent-blame.json` in the repository root) |
| `--no-default-patterns` | Use only the agents and bots defined in the config |
| `--no-ignore-bots` | Count bot-authored lines as non-AI instead of leaving them out of the share |
| `-j, --jobs <n>` | Concurrent `git blame` processes (default `4`) |
| `--threshold <percent>` | Exit with code 2 when the AI-assisted share exceeds this |
| `--no-color` | Disable ANSI colour. Colour is only used on a TTY and never when `NO_COLOR` is set |
| `-q, --quiet` | No progress or notes on stderr |
| `-h, --help`, `-v, --version` | |

Exit codes: `0` success, `1` error (not a repository, bad option, unreadable config), `2` threshold exceeded.

## Configuration file

Put `.agent-blame.json` in the repository root (or point `--config` at it). Every key is optional.

```json
{
  "agents": {
    "my-internal-bot": {
      "label": "Internal refactoring bot",
      "emails": ["refactor-bot@corp.example"],
      "names": ["/^refactor-bot/"],
      "markers": ["[auto-refactor]"]
    },
    "claude": { "emails": ["claude-proxy@corp.example"] },
    "copilot": false
  },
  "bots": {
    "names": ["/^ci-deployer$/"],
    "emails": ["deploy@corp.example"]
  },
  "ignoreBots": true,
  "include": ["src/**", "lib/**"],
  "exclude": ["vendor/**", "*.lock", "**/*.generated.*"],
  "maxFileSize": "2mb",
  "depth": 1,
  "threshold": 60
}
```

- `agents.<id>`: a new agent, or extra patterns for a built-in one (`claude`, `copilot`, `codex`, `cursor`, `aider`, `devin`, `gemini`, `jules`, `windsurf`, `kiro`, `other-agent`). `false` disables a built-in agent. Each pattern is either a plain string (case-insensitive, whole-string match for `emails` and `names`, substring match for `markers`) or a `/regular expression/` with optional flags. `pairs: [{"name": ..., "email": ...}]` requires both to match the same identity.
- `bots`: additional non-AI automation to exclude.
- `ignoreBots`: `true` (default) leaves bot-authored lines out of the share; `false` counts them as non-AI.
- `include` / `exclude`: glob lists, also extended by `--include` / `--exclude` on the command line.
- `maxFileSize`, `depth`, `threshold`: defaults for the matching options.

## What counts as evidence

A commit is classified `agent` when any of the following matches, case-insensitively. Evidence is recorded per commit and is visible in `--json` through the per-agent commit counts.

1. **Trailers.** The identity in each `Co-Authored-By:` trailer is matched against the agent patterns. `Assisted-by:`, `AI-assisted-by:`, `Generated-by:`, `AI-generated-by:` and `AI-agent:` trailers are also read; if their value names no known agent they count as `other-agent`.
2. **Author and committer identity.** The commit's author and committer name/e-mail are matched the same way (an agent that commits under its own identity).
3. **Message markers.** A few agents leave a fixed phrase in the message body.

| Agent | id | E-mail patterns | Name patterns | Name + e-mail pairs | Message markers |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude` | `noreply@anthropic.com`, `claude*@anthropic.com` | `Claude`, `claude[bot]`, `Claude Code…`, `Claude Opus/Sonnet/Haiku/Fable/N…` | name starts with `claude` and e-mail is `@anthropic.com` or `@users.noreply.github.com` | `Generated with [Claude Code]`, `🤖 Generated with Claude` |
| GitHub Copilot | `copilot` | ends with `copilot@users.noreply.github.com` (incl. `NNN+Copilot@…`), `copilot-swe-agent[bot]@users.noreply.github.com`, `copilot@github.com` | starts with `copilot`, `github copilot`, `copilot-swe-agent` | | |
| OpenAI Codex | `codex` | `codex*`, `chatgpt*`, `openai-codex*`, `noreply*`, `no-reply*` `@openai.com` | starts with `codex`, `chatgpt`, `openai codex`, `gpt-N` | name contains `codex` or `chatgpt` and e-mail is `@openai.com` | `Generated by Codex`, a `Co-authored-by: Codex` line |
| Cursor | `cursor` | `cursoragent@cursor.com`; `cursor*`, `agent*`, `noreply*` `@cursor.com` / `@cursor.sh` | starts with `cursor`, `cursor agent`, `cursor ai` | | |
| Aider | `aider` | `@aider.chat` | starts with `aider`; ends with ` (aider)` | | a line ending in `(aider)`; message starting `aider: ` |
| Devin | `devin` | `devin-ai-integration[bot]@users.noreply.github.com`; `devin*`, `noreply*` `@devin.ai` | starts with `devin-ai-integration` | name starts with `devin` and e-mail is `@devin.ai` or `@cognition.ai` | |
| Gemini | `gemini` | `gemini-code-assist[bot]@users.noreply.github.com` | starts with `gemini-code-assist` / `gemini code assist` | name starts with `gemini` and e-mail is `@google.com` or `@users.noreply.github.com` | |
| Jules | `jules` | `google-labs-jules[bot]@users.noreply.github.com` | starts with `google-labs-jules` | name starts with `jules` and e-mail is `@google.com` or `@users.noreply.github.com` | |
| Windsurf / Codeium | `windsurf` | `windsurf*`, `codeium*`, `cascade*`, `agent*`, `noreply*` `@windsurf.com` / `@windsurf.ai` / `@codeium.com` | starts with `windsurf`, `codeium` | | |
| Kiro / Amazon Q | `kiro` | `amazon-q-developer[bot]@users.noreply.github.com`; `kiro*`, `amazonq*`, `amazon-q*`, `noreply*` `@kiro.dev` / `@amazon.com` / `@amazonaws.com` | starts with `kiro`, `amazon q`, `amazon-q` | | |
| Other agents | `other-agent` | `openhands@all-hands.dev`; `noreply`/`bot`/`agent` at `all-hands.dev`, `sweep.dev`, `cline.bot`, `tabnine.com`, `qodo.ai`, `augmentcode.com`, `roocode.com`, `ampcode.com`; `sweep-ai[bot]@…`, `sourcery-ai[bot]@…` | starts with `openhands`, `all-hands`, `sweep-ai`, `cline`, `roo code`, `augment code`/`augment agent`, `tabnine`, `qodo`, `codiumai`, `sourcery-ai` | `amp` + `@ampcode.com`/`@sourcegraph.com`; `cody` + `@sourcegraph.com` | any `Assisted-by:`-style trailer naming an unknown tool |

Names that are also ordinary human names (Claude, Devin, Gemini, Jules, Amp, Cody) are deliberately only matched together with a vendor e-mail, so a contributor called Claude Dupont is not misclassified. A plain `@openai.com` address is not Codex on its own for the same reason.

**Bots.** A commit whose *author* is non-AI automation is classified `bot` and left out of the AI share by default (`--no-ignore-bots` counts it as non-AI instead): any name ending in `[bot]` or e-mail ending in `[bot]@users.noreply.github.com`, plus `dependabot`, `renovate`, `github-actions`, `greenkeeper`, `semantic-release-bot`, `snyk-bot`, `pre-commit-ci`, `imgbot`, `allcontributors`, `mergify`, `codecov`, `pyup-bot`, `travis`, `weblate`, `transifex`, and the `noreply@github.com` / `actions@github.com` addresses. Agent evidence takes precedence: `copilot-swe-agent[bot]` is an agent, and a `github-actions[bot]` commit carrying a Claude trailer is agent-assisted. The committer identity never makes a commit a bot, because web merges and CI pipelines routinely commit on behalf of humans.

**Precedence and credit.** A human-authored commit with an agent trailer is `agent` (AI-assisted); every line it contributes counts as AI-assisted and, in `--by-author`, is still credited to the human author. A commit naming several agents is counted under each of them in the per-agent table.

## How the numbers are produced

- One `git log --all` pass reads every commit (hash, author, committer, dates, subject, body and `%(trailers:only,unfold)`) and classifies it once.
- `git ls-files` provides the file list; symlinks and submodules are skipped, then `include`/`exclude` globs are applied. Files with a NUL byte in the first 8 KB (binaries) or larger than `--max-file-size` are skipped and reported.
- `git blame --porcelain` runs per file, `--jobs` at a time. Only the `<hash> <orig> <final>` header lines are read; every blamed line has one, so counting headers counts lines. `.git-blame-ignore-revs` in the repository root is honoured automatically (formatting commits are blamed through to the original authors); if git rejects the file, blame is retried without it.
- Blame reflects the working tree, so uncommitted edits appear as `Uncommitted` and are counted as human. Lines whose commit is not in the log (for example beyond a shallow-clone boundary) are `unknown` and also counted as human.
- `--history` runs `git log HEAD --no-merges --numstat` (with `--since`/`--until`) and buckets *added* lines by the committer date, per month or ISO week; renames and binary entries are handled; months with no activity are filled in so the sparkline is continuous.

### JSON schema

`--json` emits one document with `version: 1`. Keys are stable; new keys may be added in later versions.

```jsonc
{
  "version": 1,
  "generatedAt": "2026-10-20T05:26:42.539Z",
  "tool": { "name": "agent-blame", "version": "0.1.0" },
  "repo": { "path": "...", "head": "f0178b9", "branch": "main", "subdir": null },
  "options": { "ignoreBots": true, "defaultPatterns": true, "depth": 1, "perFile": false, "include": [], "exclude": [], "maxFileSize": 2097152, "config": null },
  "totals": { "files": 35, "lines": 5254, "counted": 5254, "ai": 2429, "human": 2825, "bot": 0, "uncommitted": 0, "unknown": 0, "aiShare": 0.462314, "commits": 12, "aiCommits": 3, "humanCommits": 9, "botCommits": 0 },
  "agents": [ { "id": "claude", "label": "Claude Code", "lines": 2429, "share": 0.462314, "commits": 3 } ],
  "byPath": [ { "path": "docs/", "files": 9, "lines": 1595, "counted": 1595, "ai": 874, "human": 721, "bot": 0, "share": 0.547962 } ],
  "skipped": { "count": 0, "byReason": {}, "files": [] },
  "byAuthor": [ { "name": "...", "email": "...", "kind": "human", "lines": 5254, "ai": 2429, "agents": { "claude": 2429 }, "share": 0.462314 } ],   // with --by-author
  "history": { "granularity": "month", "since": null, "until": null, "periods": [ { "period": "2026-08", "added": 5374, "ai": 2529, "human": 2845, "bot": 0, "counted": 5374, "commits": 10, "aiCommits": 3, "share": 0.470599 } ] },   // with --history
  "threshold": { "limit": 60, "exceeded": false }   // with --threshold
}
```

`counted` is the denominator of every share: lines minus bot lines when bots are ignored. Shares are fractions in `[0, 1]`, rounded to six decimals.

## Limitations

Be honest about what this measures before putting a number in a report.

- **Trailers are voluntary.** An agent only shows up if it (or its user) left a trailer, committed under its own identity, or left a marker. Code pasted from a chat window, or generated by a tool that attributes nothing, is invisible and counts as human. The number is therefore a lower bound on agent involvement.
- **Squash merges keep trailers only if whoever merges preserves them.** GitHub's default squash message includes co-author trailers from the squashed commits; some teams edit them out, and some tooling drops them. `git rebase`, `git commit --amend` and history rewrites can lose them too.
- **Blame measures surviving lines, not effort.** A line counts for whichever commit last touched it. A human reformatting an agent-written file takes credit for every changed line (use `.git-blame-ignore-revs` for bulk formatting), and an agent fixing one character in a human line takes credit for that line.
- **Whole-commit granularity.** A human-authored commit with an agent trailer counts as AI-assisted in full, even if the agent contributed one function. The reverse is also true: nothing inside a commit without evidence is attributed to an agent.
- **Shallow clones.** In a clone with limited depth, blame attributes everything to the boundary commit. Use `fetch-depth: 0` in CI (see below).
- **Identity patterns are heuristics.** They are deliberately conservative for names that are also human names, so some agent commits under unusual identities will be missed. Add your own patterns in `.agent-blame.json`, and open a Discussion if a widely used agent is missing.
- **History and blame answer different questions.** `--history` counts lines *added* over time (including lines since deleted); the main report counts lines that *survive* today.

## CI

### Fail a build above a threshold, and show the table in the job summary

```yaml
name: AI attribution
on: [pull_request]
jobs:
  agent-blame:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # blame needs the full history
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # until the first npm release: npx github:Quigles1337/agent-blame ...
      - run: npx agent-blame --threshold 60 --markdown >> "$GITHUB_STEP_SUMMARY"
```

The step fails with exit code 2 when more than 60% of the counted lines are AI-assisted, and the Markdown tables appear in the workflow summary either way.

### Put the badge in your README

Commit the SVG from a scheduled workflow (or on every push to `main`) and reference it from the README as `![AI-assisted](.github/badges/ai-assisted.svg)`.

```yaml
name: AI-assisted badge
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'
permissions:
  contents: write
jobs:
  badge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx agent-blame --quiet --badge .github/badges/ai-assisted.svg
      - name: Commit the badge if it changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .github/badges/ai-assisted.svg
          git diff --cached --quiet || git commit -m "Update AI-assisted badge [skip ci]"
          git push
```

That badge commit is authored by `github-actions[bot]`, so `agent-blame` itself classifies it as a bot and leaves it out of the share.

## Programmatic use

```js
import { analyze, renderMarkdown, toJSON } from 'agent-blame';

const model = await analyze({ path: '.', byAuthor: true, history: true });
console.log(model.totals.aiShare);       // 0.4623...
console.log(renderMarkdown(model));
const doc = toJSON(model);               // the --json document
```

The classifier is also exported on its own (`createClassifier`, `classify`, `DEFAULT_AGENTS`, `DEFAULT_BOTS`) for tooling that already has commit objects.

## Contributing

Bug reports and pull requests are welcome. Questions, requests for new agent patterns and design discussions belong in [GitHub Discussions](https://github.com/Quigles1337/agent-blame/discussions). The test suite (`npm test`, no dependencies) covers every built-in pattern in trailer and author form; a new pattern should come with a test and, where possible, a link to the vendor documentation or a public commit that shows the identity in the wild.

## License

[MIT](LICENSE) © 2026 Quigles1337
