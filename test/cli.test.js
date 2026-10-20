import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRepo, writeFile, commitAll, removeDir, makeTempDir } from './support/temp-repo.js';

const BIN = fileURLToPath(new URL('../bin/agent-blame.js', import.meta.url));
const PKG = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

function cli(args, { cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NO_COLOR: '1', ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

/**
 * Three commits: a human one, a human one with a Claude Co-Authored-By
 * trailer, and one authored by dependabot[bot].
 */
function fixtureRepo() {
  const dir = initRepo();
  writeFile(dir, 'src/a.js', 'one\ntwo\nthree\n');
  commitAll(dir, 'Add a.js\n', { date: '2026-01-15T12:00:00Z' });
  writeFile(dir, 'src/b.js', '1\n2\n3\n4\n5\n');
  commitAll(dir, 'Add b.js with help\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n', { date: '2026-02-15T12:00:00Z' });
  writeFile(dir, 'package-lock.json', '{\n  "a": 1,\n  "b": 2\n}\n');
  commitAll(dir, 'Bump deps\n', {
    author: { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' },
    date: '2026-03-15T12:00:00Z',
  });
  return dir;
}

test('end-to-end: --json on a repository with human, human+Claude and dependabot commits', async (t) => {
  const dir = fixtureRepo();
  t.after(() => removeDir(dir));
  const r = await cli([dir, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.version, 1);
  assert.equal(doc.tool.version, PKG.version);
  assert.equal(doc.repo.branch, 'main');
  assert.equal(doc.totals.files, 3);
  assert.equal(doc.totals.lines, 12);
  assert.equal(doc.totals.ai, 5);
  assert.equal(doc.totals.human, 3);
  assert.equal(doc.totals.bot, 4);
  assert.equal(doc.totals.counted, 8);
  assert.equal(doc.totals.aiShare, 0.625);
  assert.equal(doc.totals.commits, 3);
  assert.equal(doc.totals.aiCommits, 1);
  assert.equal(doc.totals.humanCommits, 1);
  assert.equal(doc.totals.botCommits, 1);
  assert.deepEqual(doc.agents, [{ id: 'claude', label: 'Claude Code', lines: 5, share: 0.625, commits: 1 }]);
  assert.deepEqual(doc.byPath.map((p) => [p.path, p.files, p.lines, p.ai, p.share]), [
    ['src/', 2, 8, 5, 0.625],
    ['package-lock.json', 1, 4, 0, 0],
  ]);
  assert.equal(doc.skipped.count, 0);
  assert.ok(!('byAuthor' in doc));
  assert.ok(!('history' in doc));
});

test('end-to-end: --by-author, --history, --files and --no-ignore-bots', async (t) => {
  const dir = fixtureRepo();
  t.after(() => removeDir(dir));
  const r = await cli(['--json', '--by-author', '--history', '--files'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(doc.byAuthor.map((a) => [a.name, a.kind, a.lines, a.ai, a.share]), [
    ['Ada Lovelace', 'human', 8, 5, 0.625],
    ['dependabot[bot]', 'bot', 4, 0, 0],
  ]);
  assert.equal(doc.history.granularity, 'month');
  assert.deepEqual(doc.history.periods.map((p) => [p.period, p.added, p.ai, p.bot, p.share]), [
    ['2026-01', 3, 0, 0, 0],
    ['2026-02', 5, 5, 0, 1],
    ['2026-03', 4, 0, 4, null],
  ]);
  assert.deepEqual(doc.byPath.map((p) => p.path), ['src/b.js', 'package-lock.json', 'src/a.js']);

  const bots = JSON.parse((await cli(['--json', '--no-ignore-bots'], { cwd: dir })).stdout);
  assert.equal(bots.totals.counted, 12);
  assert.equal(bots.totals.aiShare, 0.416667);

  const weekly = JSON.parse((await cli(['--json', '--weekly', '--since', '2026-02-01'], { cwd: dir })).stdout);
  assert.equal(weekly.history.granularity, 'week');
  assert.equal(weekly.history.since, '2026-02-01');
  assert.equal(weekly.history.periods[0].period, '2026-W07');
  assert.equal(weekly.history.periods.at(-1).period, '2026-W11');
});

test('end-to-end: text and markdown output, badge file, and the threshold exit code', async (t) => {
  const dir = fixtureRepo();
  t.after(() => removeDir(dir));

  const text = await cli([dir]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /AI-assisted\s+5\s+62\.5%\s+█{13}░{7}/);
  assert.match(text.stdout, /Claude Code\s+5\s+62\.5%\s+1/);
  assert.match(text.stdout, /src\/\s+2\s+8\s+5\s+62\.5%/);
  assert.ok(!text.stdout.includes('\x1b['));

  const md = await cli([dir, '--markdown']);
  assert.equal(md.code, 0);
  assert.match(md.stdout, /\*\*62\.5%\*\* of 8 lines are AI-assisted/);
  assert.match(md.stdout, /^\| Agent \| Lines \| Share \| Commits \|$/m);
  assert.match(md.stdout, /^\| `src\/` \| 2 \| 8 \| 5 \| 62\.5% \|$/m);

  const badgePath = path.join(dir, 'out', 'ai.svg');
  const badge = await cli([dir, '--badge', badgePath, '--quiet']);
  assert.equal(badge.code, 0, badge.stderr);
  assert.equal(badge.stderr, '');
  const svg = fs.readFileSync(badgePath, 'utf8');
  assert.match(svg, /<title>AI-assisted: 63%<\/title>/);

  const over = await cli([dir, '--threshold', '50', '--json']);
  assert.equal(over.code, 2);
  assert.match(over.stderr, /62\.5% exceeds threshold 50%/);
  assert.ok(JSON.parse(over.stdout).threshold.exceeded);

  const under = await cli([dir, '--threshold', '62.5']);
  assert.equal(under.code, 0, 'equal to the threshold does not exceed it');
  assert.match(under.stdout, /Threshold 62\.5% not exceeded/);
});

test('end-to-end: config file, --include/--exclude, --no-default-patterns and a custom agent', async (t) => {
  const dir = fixtureRepo();
  t.after(() => removeDir(dir));
  writeFile(dir, 'src/c.js', 'x\ny\n');
  commitAll(dir, 'Internal tool output\n\nAssisted-by: CorpBot <bot@corp.example>\n', { date: '2026-04-01T00:00:00Z' });

  const excluded = JSON.parse((await cli([dir, '--json', '--exclude', 'src/b.js'])).stdout);
  assert.equal(excluded.totals.ai, 2, 'the Assisted-by trailer counts as other-agent before the config names it');
  assert.deepEqual(excluded.agents.map((a) => [a.id, a.lines, a.commits]), [['other-agent', 2, 1], ['claude', 0, 1]], 'commit counts are repository-wide, lines follow the path scope');
  assert.equal(excluded.totals.lines, 9);

  const included = JSON.parse((await cli([dir, '--json', '--include', '*.js'])).stdout);
  assert.equal(included.totals.lines, 10);
  assert.equal(included.totals.bot, 0);

  fs.writeFileSync(path.join(dir, '.agent-blame.json'), JSON.stringify({
    agents: { 'corp-bot': { label: 'CorpBot', emails: ['bot@corp.example'] } },
    exclude: ['*.json'],
    threshold: 10,
  }));
  const withConfig = await cli([dir, '--json']);
  assert.equal(withConfig.code, 2, 'config threshold applies');
  const cfgDoc = JSON.parse(withConfig.stdout);
  assert.equal(cfgDoc.options.config, '.agent-blame.json');
  assert.deepEqual(cfgDoc.options.exclude, ['*.json']);
  assert.equal(cfgDoc.totals.bot, 0, 'package-lock.json excluded; .agent-blame.json itself is *.json too');
  assert.deepEqual(cfgDoc.agents.map((a) => [a.id, a.label, a.lines]), [['claude', 'Claude Code', 5], ['corp-bot', 'CorpBot', 2]]);

  const onlyConfig = JSON.parse((await cli([dir, '--json', '--no-default-patterns', '--threshold', '100'])).stdout);
  assert.deepEqual(onlyConfig.agents.map((a) => [a.id, a.lines]), [['corp-bot', 2]]);
  assert.equal(onlyConfig.totals.ai, 2);
  assert.equal(onlyConfig.totals.bot, 0, 'dependabot is not a bot without the default patterns');
});

test('end-to-end: zero-commit repository, non-repository directory, bad arguments, --help and --version', async (t) => {
  const empty = initRepo();
  t.after(() => removeDir(empty));
  const r = await cli(['--json'], { cwd: empty });
  assert.equal(r.code, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.totals.lines, 0);
  assert.equal(doc.totals.commits, 0);
  assert.equal(doc.totals.aiShare, 0);
  assert.equal(doc.repo.head, null);
  const text = await cli([], { cwd: empty });
  assert.equal(text.code, 0);
  assert.match(text.stdout, /No blameable files/);

  const plain = makeTempDir('agent-blame-plain-');
  t.after(() => removeDir(plain));
  const notRepo = await cli([plain]);
  assert.equal(notRepo.code, 1);
  assert.match(notRepo.stderr, /not a git repository/);

  const missing = await cli([path.join(plain, 'nope')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /does not exist/);

  const badFlag = await cli(['--bogus'], { cwd: empty });
  assert.equal(badFlag.code, 1);
  assert.match(badFlag.stderr, /Usage: agent-blame/);

  const badNumber = await cli(['--jobs', 'many'], { cwd: empty });
  assert.equal(badNumber.code, 1);
  assert.match(badNumber.stderr, /--jobs expects a number/);

  const both = await cli(['--json', '--markdown'], { cwd: empty });
  assert.equal(both.code, 1);

  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: agent-blame \[path\] \[options\]/);
  assert.match(help.stdout, /--threshold <percent>/);

  const version = await cli(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), PKG.version);
});

test('colour is used only on a TTY without NO_COLOR, and FORCE_COLOR overrides', async (t) => {
  const { wantColor } = await import('../src/cli.js');
  assert.equal(wantColor({ stdout: { isTTY: true }, env: {}, noColorFlag: false }), true);
  assert.equal(wantColor({ stdout: { isTTY: false }, env: {}, noColorFlag: false }), false);
  assert.equal(wantColor({ stdout: { isTTY: true }, env: { NO_COLOR: '1' }, noColorFlag: false }), false);
  assert.equal(wantColor({ stdout: { isTTY: true }, env: {}, noColorFlag: true }), false);
  assert.equal(wantColor({ stdout: { isTTY: true }, env: { TERM: 'dumb' }, noColorFlag: false }), false);
  assert.equal(wantColor({ stdout: { isTTY: false }, env: { FORCE_COLOR: '1' }, noColorFlag: false }), true);

  const dir = fixtureRepo();
  t.after(() => removeDir(dir));
  const forced = await cli([dir], { env: { NO_COLOR: '', FORCE_COLOR: '1' } });
  assert.ok(forced.stdout.includes('\x1b[1m'), 'FORCE_COLOR enables ANSI on a pipe');
});

test('--since without --history prints a note on stderr but still succeeds', async (t) => {
  const dir = fixtureRepo();
  t.after(() => removeDir(dir));
  const r = await cli([dir, '--since', '2026-01-01', '--json']);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /--since\/--until only affect --history/);
  assert.ok(!('history' in JSON.parse(r.stdout)));
  const quiet = await cli([dir, '--since', '2026-01-01', '--json', '--quiet']);
  assert.equal(quiet.stderr, '');
});
