# agent-blame

[![CI](https://github.com/Quigles1337/agent-blame/actions/workflows/ci.yml/badge.svg)](https://github.com/Quigles1337/agent-blame/actions/workflows/ci.yml)
![AI-assisted](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FQuigles1337%2Fagent-blame%2Fmain%2Fexamples%2Fagent-blame.json)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-blue)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Measure how much of a codebase was written with AI coding agents, line by line, from the `Co-Authored-By` trailers and author identities those agents already leave in git history. Retroactive, local, zero runtime dependencies.

AI coding agents sign their work: Claude Code, GitHub Copilot, Cursor, Codex, Aider, Devin and others add a `Co-Authored-By` trailer or commit under their own identity. `agent-blame` runs `git blame` over every tracked file, classifies each commit by that evidence, and reports the share of surviving lines that were agent-assisted, broken down by directory, file, author, agent and month. In pull-request mode it classifies only the commits of a branch and reports the share of the lines they added, and the [GitHub Action](#github-action) posts that as a sticky comment on every pull request. It answers the questions engineering managers, reviewers and compliance teams are starting to ask: where did this code come from, which parts deserve closer review, what can we say about provenance, and how is adoption changing over time.

## Quick start

```sh
npx agent-blame                       # the repository in the current directory
npx agent-blame path/to/repo --files  # per-file instead of per-directory
npx agent-blame --by-author --history # who, and how it changed month by month
npx agent-blame --json > ai.json      # stable schema for tooling
npx agent-blame --badge ai.svg        # shields-style badge
npx agent-blame --range main..HEAD    # only the commits of this branch (pull-request mode)
npx agent-blame --top 10              # the ten files with the highest AI-assisted share
npx agent-blame --explain src/x.js    # every commit behind one file's number, with the evidence
```

Requires Node 20 or later and `git` on `PATH`. Nothing is installed globally and nothing leaves your machine. Until the first npm release, run it straight from this repository:

```sh
npx github:Quigles1337/agent-blame
```

## Example output

Run against [Quigles1337/FR13DMAN](https://github.com/Quigles1337/FR13DMAN), a Rust and Markdown research repository with a mix of human and Claude Code commits (repository path shortened):

```
agent-blame …/FR13DMAN @ 7c3e5dd (main)

Summary                            Lines  Share
Lines (blame of the working tree)  3,070
  AI-assisted                        615  20.0%  ████░░░░░░░░░░░░░░░░
  Human                            2,455  80.0%

By agent       Lines  Share  Commits
  Claude Code    615  20.0%        4

15 commits across all refs: 4 AI-assisted (26.7%), 11 human, 0 bot

Path (depth 1)       Files  Lines  AI-assisted   Share
README.md                1     15           15  100.0%  ████████████████████
.gitattributes           1      9            9  100.0%  ████████████████████
PROGRAM/                11  1,684          591   35.1%  ███████░░░░░░░░░░░░░
engine/                  5  1,083            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
lab/                     1    152            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
.github/                 1     33            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
quarantine/              1     28            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
corpora/                 1     21            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
scripts/                 1     20            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
gallery/                 1     12            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
.gitignore               1     10            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
rust-toolchain.toml      1      3            0    0.0%  ░░░░░░░░░░░░░░░░░░░░
```

With `--by-author --history`:

```
Author                        Lines  AI-assisted  Share
Quigles1337 <adz@alphx.io>    3,070          615  20.0%  ████░░░░░░░░░░░░░░░░
  Lines are credited to the commit author; the share is how many of them were agent-assisted.

Month (added lines, HEAD history)  Added  AI-assisted  Share     Commits
2026-08                            3,236          656  20.3%  ▂       15
  Trend: ▂
```

The badge written by `--badge`: ![AI-assisted 20%](examples/FR13DMAN.svg)

And this repository measuring itself (`examples/agent-blame.txt`, regenerated with `npm run examples`; the self-sample excludes `examples/`, which is this very output):

```
agent-blame …/agent-blame @ 760a349 (feat/pr-mode-action)

Summary                            Lines   Share
Lines (blame of the working tree)  5,010
  AI-assisted                      5,010  100.0%  ████████████████████
  Human                                0    0.0%

By agent       Lines   Share  Commits
  Claude Code  5,010  100.0%        7

7 commits across all refs: 7 AI-assisted (100.0%), 0 human, 0 bot

Path (depth 1)  Files  Lines  AI-assisted   Share
src/               12  2,489        2,489  100.0%  ████████████████████
test/              11  1,656        1,656  100.0%  ████████████████████
README.md           1    413          413  100.0%  ████████████████████
action.yml          1    190          190  100.0%  ████████████████████
.github/            3    103          103  100.0%  ████████████████████
scripts/            1     54           54  100.0%  ████████████████████
package.json        1     53           53  100.0%  ████████████████████
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
| `--shields <file.json>` | Also write a [shields.io endpoint](#put-the-badge-in-your-readme) document for a dynamic badge |
| `--range <base>..<head>` | [Pull-request mode](#pull-request-mode): classify only the commits in the range and report the share of the lines they added. A single revision means `<rev>..HEAD` |
| `--base <rev>`, `--head <rev>` | The same as `--range <base>..<head>`; `--head` defaults to `HEAD` |
| `--files` | Per-file table instead of per-directory |
| `--top <n>` | Only the `n` files with the highest AI-assisted share (ties broken by size); implies `--files` |
| `--explain <file>` | [Dispute mode](#disputing-a-number): every commit that touched the file, with the evidence behind its classification and the lines it still owns |
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

## Pull-request mode

`--range <base>..<head>` (or `--base`/`--head`) looks at the commits of one branch instead of the whole working tree: it classifies each non-merge commit in the range and reports the share of the lines they **added** (from `git log --numstat`) that came from agent-assisted commits, per agent and per path, and lists every commit with the evidence behind its classification. Nothing is blamed, so it is fast enough for every pull request, and the result is the question a reviewer actually asks: how much of *this change* came from an agent?

```
agent-blame …/agent-blame range 5a0af37..1d3c04a

Summary                                  Lines   Share
Lines added by the commits in the range    468
  AI-assisted                              468  100.0%  ████████████████████
  Human                                      0    0.0%

By agent       Lines   Share  Commits
  Claude Code    468  100.0%        1

1 commits in the range: 1 AI-assisted (100.0%), 0 human, 0 bot

Path (depth 1)  Files  Added  AI-assisted   Share
README.md           1    324          324  100.0%  ████████████████████
examples/           5     68           68  100.0%  ████████████████████
.github/            1     35           35  100.0%  ████████████████████
test/               2     23           23  100.0%  ████████████████████
scripts/            1      9            9  100.0%  ████████████████████
src/                2      9            9  100.0%  ████████████████████

Commit   Date        Author       Class        Added  Subject                                                                Evidence
1d3c04a  2026-10-20  Quigles1337  AI-assisted   +468  Add README, refresh examples, exclude stash refs, badge workflow (#5)  Claude Code via trailer
```

`--json`, `--markdown`, `--files`, `--depth`, `--by-author`, `--include`/`--exclude`, a subdirectory scope, `--threshold`, `--badge` and `--shields` all work in this mode; `--history` does not, because the range already selects the commits. Binary files are listed but add no lines; merge commits are left out (they add no lines of their own); an empty range reports zero commits and a 0% share. In the JSON document the mode is marked with `"mode": "range"`, `range` holds the resolved endpoints and `commits` holds every commit with its `kind`, `agents`, `added` lines and `evidence` (see [JSON schema](#json-schema)).

## Disputing a number

When someone questions a figure, `--explain <file>` shows exactly where it comes from: every commit on HEAD that touched the file (renames followed), its classification, the evidence that produced it, or, for a human commit, what was checked and found wanting, and how many of the file's current lines each commit still owns.

```
agent-blame src/b.js …/repo @ 9e2f0c1 (main)

5 surviving lines: 3 AI-assisted (60.0%), 2 human
3 commits touched this file (HEAD history, renames followed)

Commit   Date        Author                  Class        Added  Deleted  Surviving  Subject
3c1d9e2  2026-03-15  copilot-swe-agent[bot]  AI-assisted     +1       -1          1  Rename and shout
         evidence: author: copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com> (GitHub Copilot)
b7a40f1  2026-02-15  Ada Lovelace            AI-assisted     +2       -0          2  Extend a.js with help
         evidence: trailer: Co-Authored-By: Claude <noreply@anthropic.com> (Claude Code)
51e0a77  2026-01-15  Ada Lovelace            human           +3       -0          2  Add a.js
         because: author Ada Lovelace <ada@example.com> matches no agent or bot pattern
         because: Co-Authored-By: Bob <bob@example.com> matches no agent pattern
         because: no message marker
```

`--json` and `--markdown` give the same information as data and as a table. `--top <n>` is the complement for the whole repository: the `n` files with the highest AI-assisted share, which is usually where a review should start.

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
- `--range` runs one `git log --no-merges --numstat <base>..<head>` and classifies exactly those commits; a path's lines are the lines each commit added to it, so the per-path and per-agent tables have the same shape as in blame mode but measure added rather than surviving lines.

### JSON schema

`--json` emits one document with `version: 1`. Keys are stable; new keys may be added in later versions.

```jsonc
{
  "version": 1,
  "generatedAt": "2026-10-20T05:26:42.539Z",
  "tool": { "name": "agent-blame", "version": "0.1.0" },
  "repo": { "path": "...", "head": "7c3e5dd", "branch": "main", "subdir": null },
  "options": { "ignoreBots": true, "defaultPatterns": true, "depth": 1, "perFile": false, "include": [], "exclude": [], "maxFileSize": 2097152, "config": null },
  "totals": { "files": 26, "lines": 3070, "counted": 3070, "ai": 615, "human": 2455, "bot": 0, "uncommitted": 0, "unknown": 0, "aiShare": 0.200326, "commits": 15, "aiCommits": 4, "humanCommits": 11, "botCommits": 0 },
  "agents": [ { "id": "claude", "label": "Claude Code", "lines": 615, "share": 0.200326, "commits": 4 } ],
  "byPath": [ { "path": "PROGRAM/", "files": 11, "lines": 1684, "counted": 1684, "ai": 591, "human": 1093, "bot": 0, "share": 0.35095 } ],
  "skipped": { "count": 0, "byReason": {}, "files": [] },
  "byAuthor": [ { "name": "...", "email": "...", "kind": "human", "lines": 3070, "ai": 615, "agents": { "claude": 615 }, "share": 0.200326 } ],   // with --by-author
  "history": { "granularity": "month", "since": null, "until": null, "periods": [ { "period": "2026-08", "added": 3236, "ai": 656, "human": 2580, "bot": 0, "counted": 3236, "commits": 15, "aiCommits": 4, "share": 0.202719 } ] },   // with --history
  "threshold": { "limit": 60, "exceeded": false }   // with --threshold
}
```

`counted` is the denominator of every share: lines minus bot lines when bots are ignored. Shares are fractions in `[0, 1]`, rounded to six decimals.

In pull-request mode the same document carries three more keys, `lines` means *added* lines, and `options.maxFileSize` is `null` because nothing is blamed:

```jsonc
{
  "mode": "range",
  "range": { "spec": "main..HEAD", "base": "main", "head": "HEAD", "baseHash": "1d3c04a", "headHash": "9e2f0c1" },
  "commits": [ { "hash": "...", "short": "9e2f0c1", "subject": "...", "authorName": "...", "authorEmail": "...", "date": "2026-10-20T06:01:02+00:00", "kind": "agent", "agents": ["claude"], "added": 120, "files": 3,
                 "evidence": [ { "agent": "claude", "source": "trailer", "value": "Co-Authored-By: Claude <noreply@anthropic.com>" } ] } ]
}
```

`evidence[].source` is one of `trailer`, `author`, `committer` or `message`.

## Limitations

Be honest about what this measures before putting a number in a report.

- **Trailers are voluntary.** An agent only shows up if it (or its user) left a trailer, committed under its own identity, or left a marker. Code pasted from a chat window, or generated by a tool that attributes nothing, is invisible and counts as human. The number is therefore a lower bound on agent involvement.
- **Squash merges keep trailers only if whoever merges preserves them.** GitHub's default squash message includes co-author trailers from the squashed commits; some teams edit them out, and some tooling drops them. `git rebase`, `git commit --amend` and history rewrites can lose them too.
- **Blame measures surviving lines, not effort.** A line counts for whichever commit last touched it. A human reformatting an agent-written file takes credit for every changed line (use `.git-blame-ignore-revs` for bulk formatting), and an agent fixing one character in a human line takes credit for that line.
- **Whole-commit granularity.** A human-authored commit with an agent trailer counts as AI-assisted in full, even if the agent contributed one function. The reverse is also true: nothing inside a commit without evidence is attributed to an agent.
- **Shallow clones.** In a clone with limited depth, blame attributes everything to the boundary commit. Use `fetch-depth: 0` in CI (see below).
- **Identity patterns are heuristics.** They are deliberately conservative for names that are also human names, so some agent commits under unusual identities will be missed. Add your own patterns in `.agent-blame.json`, and open a Discussion if a widely used agent is missing.
- **History and blame answer different questions.** `--history` counts lines *added* over time (including lines since deleted); the main report counts lines that *survive* today. `--range` counts the lines *added* by the commits in a range; a line added and deleted again inside the same pull request still counts, and lines a merge commit adds while resolving conflicts do not.

## CI

### GitHub Action

The repository doubles as a composite action. On pull requests it runs in pull-request mode and posts **one** sticky comment (identified by a hidden `<!-- agent-blame -->` marker) that is updated in place on every push; on other events it measures the whole working tree. The report also goes to the job summary.

```yaml
name: AI attribution
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write          # to post and update the comment
jobs:
  agent-blame:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # the base and head of the pull request must both be present
      - uses: Quigles1337/agent-blame@main
        with:
          threshold: 60           # optional: fail the job above this share
```

The action runs the CLI from its own checkout, so it needs no npm release and no network access beyond posting the comment. Pull requests from forks get a read-only `GITHUB_TOKEN`; the action then prints a warning instead of a comment and still produces the report and the exit code. This repository runs the action on its own pull requests ([`.github/workflows/pr-report.yml`](.github/workflows/pr-report.yml)).

| Input | Default | Description |
| --- | --- | --- |
| `path` | `.` | Repository, or a directory inside one |
| `mode` | `auto` | `pr` (the commits of the pull request, `base..head`), `repo` (blame of the working tree), or `auto`: `pr` on `pull_request` events, `repo` otherwise |
| `range` | | Explicit `<base>..<head>` for `pr` mode on other events |
| `threshold` | | Fail the job with exit code 2 when the AI-assisted share exceeds this percentage. The comment is posted first |
| `comment` | `true` | Post or update the sticky comment on pull requests |
| `badge` | | Write the SVG badge to this path |
| `shields` | | Write the shields.io endpoint document to this path |
| `args` | | Extra CLI arguments, for example `--exclude vendor/** --depth 2` |
| `node-version` | `20` | Node.js version to set up |
| `token` | `github.token` | Token used to post the comment |

Outputs: `share` (for example `46%`), `exceeded` (`true`/`false`), `mode` and `report` (path of the Markdown file).

### Without the action

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # until the first npm release: npx github:Quigles1337/agent-blame ...
      - run: npx agent-blame --threshold 60 --markdown >> "$GITHUB_STEP_SUMMARY"
```

The step fails with exit code 2 when more than 60% of the counted lines are AI-assisted, and the Markdown tables appear in the workflow summary either way. Add `--range "${{ github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha }}"` on pull requests to measure only their commits.

### Put the badge in your README

Two forms. `--badge` writes a self-contained SVG you commit and reference directly, `![AI-assisted](.github/badges/ai-assisted.svg)`. `--shields` writes a [shields.io endpoint](https://shields.io/badges/endpoint-badge) document, `{"schemaVersion": 1, "label": "AI-assisted", "message": "46%", "color": "3088ba"}`, that shields.io renders in its own style, with the same label, colour band and rounding, from wherever you serve it:

```markdown
![AI-assisted](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OWNER/REPO/main/.github/badges/ai-assisted.json)
```

Commit either file from a scheduled workflow (or on every push to `main`):

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
      - run: npx agent-blame --quiet --badge .github/badges/ai-assisted.svg --shields .github/badges/ai-assisted.json
      - name: Commit the badge if it changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .github/badges/ai-assisted.svg .github/badges/ai-assisted.json
          git diff --cached --quiet || git commit -m "Update AI-assisted badge [skip ci]"
          git push
```

That badge commit is authored by `github-actions[bot]`, so `agent-blame` itself classifies it as a bot and leaves it out of the share. The badge at the top of this README is the shields.io form, served from [`examples/agent-blame.json`](examples/agent-blame.json), which [`badge.yml`](.github/workflows/badge.yml) refreshes weekly.

## Programmatic use

```js
import { analyze, renderMarkdown, toJSON } from 'agent-blame';

const model = await analyze({ path: '.', byAuthor: true, history: true });
console.log(model.totals.aiShare);       // 0.2003...
console.log(renderMarkdown(model));
const doc = toJSON(model);               // the --json document

const pr = await analyze({ path: '.', range: 'main..HEAD' });   // pull-request mode
console.log(pr.totals.aiShare, pr.commits.length);
```

The classifier is also exported on its own (`createClassifier`, `classify`, `DEFAULT_AGENTS`, `DEFAULT_BOTS`) for tooling that already has commit objects.

## Contributing

Bug reports and pull requests are welcome. Questions, requests for new agent patterns and design discussions belong in [GitHub Discussions](https://github.com/Quigles1337/agent-blame/discussions). The test suite (`npm test`, no dependencies) covers every built-in pattern in trailer and author form; a new pattern should come with a test and, where possible, a link to the vendor documentation or a public commit that shows the identity in the wild.

## Related

- [commit-tapestry](https://github.com/Quigles1337/commit-tapestry) weaves a repository's git history into a textile-style SVG.
- [xrpl-sonic](https://github.com/Quigles1337/xrpl-sonic) turns the live XRP Ledger into sound.

## License

[MIT](LICENSE) © 2026 Quigles1337
