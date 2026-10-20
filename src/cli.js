/**
 * Command-line front end. `main(argv, io)` returns the process exit code:
 * 0 success, 1 usage or runtime error, 2 threshold exceeded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze, TOOL } from './analyze.js';
import { renderBadge, renderShields } from './badge.js';
import { formatShare, renderMarkdown, renderText, toJSON } from './report.js';

export const USAGE = 'Usage: agent-blame [path] [options]';

export const HELP = `${USAGE}

Measure how much of a repository was written with AI coding agents, line by
line, from the Co-Authored-By trailers and author identities they leave in
git history. Blame reflects the current working tree; history reflects the
commits reachable from HEAD; a range reflects only the commits in it.

Arguments
  path                      Repository, or a directory inside one (default: .)

Pull-request mode
  --range <base>..<head>    Classify only the commits in the range and report the
                            share of lines they added (no blame). A single
                            revision means <rev>..HEAD
  --base <rev>, --head <rev>
                            The same as --range <base>..<head> (head defaults to HEAD)

Output
  --json                    Machine-readable report (stable schema, version 1)
  --markdown                GitHub-flavoured Markdown tables
  --badge <file.svg>        Also write a shields-style "AI-assisted | NN%" badge
  --shields <file.json>     Also write a shields.io endpoint document for a dynamic badge
  --files                   Per-file table instead of per-directory
  --depth <n>               Directory depth for the path table (default: 1)
  --by-author               Per-author table: lines and how many were agent-assisted
  --history                 Monthly share of added lines that were agent-assisted
  --weekly                  Use ISO weeks for --history
  --since <date>            Only count history from this date (git syntax)
  --until <date>            Only count history up to this date
  --no-color                Disable ANSI colour (also honours NO_COLOR)
  -q, --quiet               No progress or notes on stderr

Scope and classification
  --include <glob>          Only these paths (repeatable; * ** ? supported)
  --exclude <glob>          Skip these paths (repeatable)
  --max-file-size <size>    Skip larger files (default: 2mb)
  --config <file>           Config file (default: .agent-blame.json in the repo root)
  --no-default-patterns     Use only the agents and bots defined in the config
  --no-ignore-bots          Count bot-authored lines as non-AI instead of excluding them
  -j, --jobs <n>            Concurrent git blame processes (default: 4)

CI
  --threshold <percent>     Exit with code 2 when the AI-assisted share exceeds this

  -h, --help                Show this help
  -v, --version             Print the version

Exit codes: 0 success, 1 error, 2 threshold exceeded.
Documentation: https://github.com/Quigles1337/agent-blame
`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  markdown: { type: 'boolean' },
  badge: { type: 'string' },
  shields: { type: 'string' },
  range: { type: 'string' },
  base: { type: 'string' },
  head: { type: 'string' },
  files: { type: 'boolean' },
  depth: { type: 'string' },
  'by-author': { type: 'boolean' },
  history: { type: 'boolean' },
  weekly: { type: 'boolean' },
  since: { type: 'string' },
  until: { type: 'string' },
  threshold: { type: 'string' },
  jobs: { type: 'string', short: 'j' },
  'max-file-size': { type: 'string' },
  include: { type: 'string', multiple: true },
  exclude: { type: 'string', multiple: true },
  config: { type: 'string' },
  'no-default-patterns': { type: 'boolean' },
  'no-ignore-bots': { type: 'boolean' },
  'no-color': { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
};

function intOption(name, value, { min = 0, max = Infinity, float = false } = {}) {
  if (value === undefined) return undefined;
  const n = float ? Number(value) : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max || (!float && String(n) !== String(value).trim())) {
    throw new Error(`--${name} expects a number between ${min} and ${max === Infinity ? 'infinity' : max}, got ${JSON.stringify(value)}`);
  }
  return n;
}

export function wantColor({ stdout, env, noColorFlag }) {
  if (noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== '') return true;
  return Boolean(stdout.isTTY) && env.TERM !== 'dumb';
}

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, cwd = process.cwd() } = {}) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }));
  } catch (err) {
    stderr.write(`agent-blame: ${err.message}\n${USAGE}\nTry 'agent-blame --help' for the full option list.\n`);
    return 1;
  }

  if (values.help) {
    stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    stdout.write(`${TOOL.version}\n`);
    return 0;
  }
  if (positionals.length > 1) {
    stderr.write(`agent-blame: expected at most one path, got ${positionals.length}\n${USAGE}\n`);
    return 1;
  }
  if (values.json && values.markdown) {
    stderr.write('agent-blame: choose one of --json or --markdown\n');
    return 1;
  }

  const quiet = Boolean(values.quiet);
  if (!quiet && (values.since || values.until) && !values.history && !values.weekly && !values.range && !values.base) {
    stderr.write('agent-blame: note: --since/--until only affect --history; blame always reflects the current state\n');
  }
  const progressEnabled = !quiet && Boolean(stderr.isTTY);
  let lastProgress = 0;

  let model;
  try {
    const target = path.resolve(cwd, positionals[0] ?? '.');
    model = await analyze({
      path: target,
      config: values.config,
      defaultPatterns: !values['no-default-patterns'],
      include: values.include,
      exclude: values.exclude,
      ignoreBots: values['no-ignore-bots'] ? false : undefined,
      maxFileSize: values['max-file-size'],
      depth: intOption('depth', values.depth, { min: 0, max: 64 }),
      perFile: Boolean(values.files),
      byAuthor: Boolean(values['by-author']),
      history: Boolean(values.history || values.weekly),
      weekly: Boolean(values.weekly),
      since: values.since,
      until: values.until,
      jobs: intOption('jobs', values.jobs, { min: 1, max: 256 }),
      threshold: intOption('threshold', values.threshold, { min: 0, max: 100, float: true }),
      range: values.range,
      base: values.base,
      head: values.head,
      onProgress: progressEnabled
        ? (done, total) => {
            const now = Date.now();
            if (done === total || now - lastProgress > 100) {
              lastProgress = now;
              stderr.write(`\r  blaming ${done}/${total} files`);
              if (done === total) stderr.write('\r\x1b[2K');
            }
          }
        : null,
    });
  } catch (err) {
    if (progressEnabled) stderr.write('\r\x1b[2K');
    stderr.write(`agent-blame: ${err.message}\n`);
    return 1;
  }

  if (values.json) {
    stdout.write(`${JSON.stringify(toJSON(model), null, 2)}\n`);
  } else if (values.markdown) {
    stdout.write(renderMarkdown(model));
  } else {
    stdout.write(renderText(model, { color: wantColor({ stdout, env, noColorFlag: values['no-color'] }) }));
  }

  if (values.badge) {
    const out = path.resolve(cwd, values.badge);
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, renderBadge({ share: model.totals.aiShare }));
    } catch (err) {
      stderr.write(`agent-blame: cannot write badge ${out}: ${err.message}\n`);
      return 1;
    }
    if (!quiet) stderr.write(`badge written to ${out}\n`);
  }

  if (values.shields) {
    const out = path.resolve(cwd, values.shields);
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `${JSON.stringify(renderShields({ share: model.totals.aiShare }), null, 2)}\n`);
    } catch (err) {
      stderr.write(`agent-blame: cannot write shields endpoint ${out}: ${err.message}\n`);
      return 1;
    }
    if (!quiet) stderr.write(`shields endpoint written to ${out}\n`);
  }

  if (model.threshold !== null && model.threshold !== undefined && model.totals.aiShare * 100 > model.threshold) {
    if (values.json || values.markdown || quiet) {
      stderr.write(`agent-blame: AI-assisted share ${formatShare(model.totals.aiShare)} exceeds threshold ${model.threshold}%\n`);
    }
    return 2;
  }
  return 0;
}
