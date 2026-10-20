import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRange, parseRangeLog, readRange, resolveRangeSpec } from '../src/range.js';
import { createClassifier } from '../src/classify.js';
import { bandColor } from '../src/badge.js';
import { analyze } from '../src/analyze.js';
import { renderMarkdown, renderText, toJSON } from '../src/report.js';
import { initRepo, writeFile, commitAll, removeDir, run } from './support/temp-repo.js';

const BIN = fileURLToPath(new URL('../bin/agent-blame.js', import.meta.url));

function cli(args, { cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NO_COLOR: '1', ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

/**
 * main: one human commit (the base). feature: a human commit adding 3 lines,
 * a human commit with a Claude trailer adding 5 lines, and a commit authored
 * by Copilot adding 2 lines plus a binary file. main then moves on and is
 * merged into feature: `main..HEAD` holds the three feature commits plus
 * the merge commit, which must not be counted.
 */
function fixtureRepo() {
  const dir = initRepo();
  writeFile(dir, 'src/base.js', 'base\n');
  const base = commitAll(dir, 'Base\n', { date: '2026-01-01T00:00:00Z' });
  run(dir, ['checkout', '-q', '-b', 'feature']);
  writeFile(dir, 'src/a.js', 'one\ntwo\nthree\n');
  const h1 = commitAll(dir, 'Add a.js\n', { date: '2026-01-15T12:00:00Z' });
  writeFile(dir, 'src/b.js', '1\n2\n3\n4\n5\n');
  const h2 = commitAll(dir, 'Add b.js with help\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n', { date: '2026-02-15T12:00:00Z' });
  writeFile(dir, 'docs/c.md', 'x\ny\n');
  writeFile(dir, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]));
  const h3 = commitAll(dir, 'Add docs and a logo\n', {
    author: { name: 'copilot-swe-agent[bot]', email: '198982749+Copilot@users.noreply.github.com' },
    date: '2026-03-15T12:00:00Z',
  });
  // Advance main and merge it into the feature branch.
  run(dir, ['checkout', '-q', 'main']);
  writeFile(dir, 'src/base.js', 'base\nmore\n');
  const mainTip = commitAll(dir, 'Main moves on\n', { date: '2026-03-20T12:00:00Z' });
  run(dir, ['checkout', '-q', 'feature']);
  run(dir, ['merge', '-q', '--no-edit', '--no-ff', 'main'], { env: { GIT_AUTHOR_DATE: '2026-03-21T12:00:00Z', GIT_COMMITTER_DATE: '2026-03-21T12:00:00Z' } });
  return { dir, base, h1, h2, h3, mainTip };
}

test('resolveRangeSpec normalises --range, --base/--head and a single revision', () => {
  assert.deepEqual(resolveRangeSpec({ range: 'main..HEAD' }), { spec: 'main..HEAD', base: 'main', head: 'HEAD' });
  assert.deepEqual(resolveRangeSpec({ range: 'main..' }), { spec: 'main..HEAD', base: 'main', head: 'HEAD' });
  assert.deepEqual(resolveRangeSpec({ range: 'v1.0' }), { spec: 'v1.0..HEAD', base: 'v1.0', head: 'HEAD' });
  assert.deepEqual(resolveRangeSpec({ base: 'main', head: 'topic' }), { spec: 'main..topic', base: 'main', head: 'topic' });
  assert.deepEqual(resolveRangeSpec({ base: 'main' }), { spec: 'main..HEAD', base: 'main', head: 'HEAD' });
  assert.equal(resolveRangeSpec({}), null);
  assert.equal(resolveRangeSpec({ range: '' }), null);
  assert.throws(() => resolveRangeSpec({ head: 'topic' }), /--head requires --base/);
  assert.throws(() => resolveRangeSpec({ range: 'a..b', base: 'c' }), /cannot be combined/);
  assert.throws(() => resolveRangeSpec({ range: '..b' }), /needs a base/);
  assert.throws(() => resolveRangeSpec({ range: 'a...b' }), /two dots/);
});

test('parseRangeLog reads identities, trailers and numstat per record, including binaries and renames', () => {
  const H = 'a'.repeat(40);
  const H2 = 'b'.repeat(40);
  const text =
    `\x01${H}\x1fAda\x1fada@example.com\x1fAda\x1fada@example.com\x1f2026-01-01T00:00:00+00:00\x1f2026-01-02T00:00:00+00:00\x1fSubject\x1fBody line\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n\x1fCo-Authored-By: Claude <noreply@anthropic.com>\n\x02\n\n3\t1\tsrc/a.js\n-\t-\timg.png\n2\t0\tsrc/{old => new}.js\n` +
    `\x01${H2}\x1fBob\x1fbob@example.com\x1fBob\x1fbob@example.com\x1f2026-01-03T00:00:00+00:00\x1f2026-01-03T00:00:00+00:00\x1fEmpty\x1f\x1f\x02\n`;
  const commits = parseRangeLog(text);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].hash, H);
  assert.equal(commits[0].subject, 'Subject');
  assert.equal(commits[0].committerDate, '2026-01-02T00:00:00+00:00');
  assert.deepEqual(commits[0].trailers, [{ key: 'Co-Authored-By', value: 'Claude <noreply@anthropic.com>' }]);
  assert.deepEqual(commits[0].files, [
    { added: 3, deleted: 1, path: 'src/a.js', binary: false },
    { added: 0, deleted: 0, path: 'img.png', binary: true },
    { added: 2, deleted: 0, path: 'src/new.js', binary: false },
  ]);
  assert.equal(commits[1].subject, 'Empty');
  assert.deepEqual(commits[1].files, []);
  assert.deepEqual(parseRangeLog(''), []);
  assert.deepEqual(parseRangeLog('\x01garbage\x02\n'), []);
});

test('collectRange builds per-path added lines, a range-only commit index, commit rows with evidence, and skips binaries', () => {
  const classify = createClassifier();
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const commits = [
    { hash: A, authorName: 'Ada', authorEmail: 'ada@example.com', committerDate: '2026-02-15T12:00:00Z', subject: 'Help', body: '', trailers: [{ key: 'Co-Authored-By', value: 'Claude <noreply@anthropic.com>' }], files: [{ added: 5, deleted: 0, path: 'src/b.js', binary: false }, { added: 0, deleted: 0, path: 'x.png', binary: true }] },
    { hash: B, authorName: 'Ada', authorEmail: 'ada@example.com', committerDate: '2026-02-16T12:00:00Z', subject: 'Plain', body: '', trailers: [], files: [{ added: 2, deleted: 0, path: 'src/b.js', binary: false }, { added: 9, deleted: 0, path: 'vendor/v.js', binary: false }] },
  ];
  const { files, commitIndex, commits: rows, skipped } = collectRange(commits, classify, { matcher: (p) => !p.startsWith('vendor/') });
  assert.deepEqual(files.map((f) => [f.path, [...f.lines.entries()]]), [['src/b.js', [[A, 5], [B, 2]]]]);
  assert.deepEqual([...commitIndex.keys()], [A, B]);
  assert.equal(commitIndex.get(A).classification.kind, 'agent');
  assert.deepEqual(skipped, [{ path: 'x.png', reason: 'binary' }]);
  assert.deepEqual(rows.map((r) => [r.short, r.kind, r.agents, r.added, r.files]), [
    ['aaaaaaa', 'agent', ['claude'], 5, 1],
    ['bbbbbbb', 'human', [], 2, 1],
  ]);
  assert.deepEqual(rows[0].evidence, [{ agent: 'claude', source: 'trailer', value: 'Co-Authored-By: Claude <noreply@anthropic.com>' }]);
});

test('readRange lists the non-merge commits of base..head newest first, with numstat', async (t) => {
  const { dir, h1, h2, h3 } = fixtureRepo();
  t.after(() => removeDir(dir));
  const commits = await readRange(dir, 'main..HEAD');
  assert.deepEqual(commits.map((c) => c.hash), [h3, h2, h1], 'the merge commit is left out');
  assert.deepEqual(commits[2].files, [{ added: 3, deleted: 0, path: 'src/a.js', binary: false }]);
  assert.deepEqual(commits[0].files, [
    { added: 2, deleted: 0, path: 'docs/c.md', binary: false },
    { added: 0, deleted: 0, path: 'logo.png', binary: true },
  ]);
  await assert.rejects(readRange(dir, 'does-not-exist..HEAD'), /unknown revision/);
});

test('end-to-end: --range reports added lines per agent and path, lists commits with evidence, and matches --base/--head', async (t) => {
  const { dir, h1, h2, h3, mainTip } = fixtureRepo();
  t.after(() => removeDir(dir));

  const r = await cli([dir, '--json', '--range', 'main..HEAD']);
  assert.equal(r.code, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.mode, 'range');
  assert.equal(doc.range.spec, 'main..HEAD');
  assert.equal(doc.range.baseHash, mainTip.slice(0, 7));
  assert.equal(doc.totals.commits, 3, 'the merge commit is not counted');
  assert.equal(doc.totals.aiCommits, 2);
  assert.equal(doc.totals.humanCommits, 1);
  assert.equal(doc.totals.botCommits, 0);
  assert.equal(doc.totals.lines, 10);
  assert.equal(doc.totals.counted, 10);
  assert.equal(doc.totals.ai, 7);
  assert.equal(doc.totals.human, 3);
  assert.equal(doc.totals.aiShare, 0.7);
  assert.equal(doc.totals.files, 3);
  assert.deepEqual(doc.agents.map((a) => [a.id, a.lines, a.share, a.commits]), [
    ['claude', 5, 0.5, 1],
    ['copilot', 2, 0.2, 1],
  ]);
  assert.deepEqual(doc.byPath.map((p) => [p.path, p.files, p.lines, p.ai, p.share]), [
    ['docs/', 1, 2, 2, 1],
    ['src/', 2, 8, 5, 0.625],
  ]);
  assert.deepEqual(doc.skipped, { count: 1, byReason: { binary: 1 }, files: [{ path: 'logo.png', reason: 'binary' }] });
  assert.deepEqual(doc.commits.map((c) => [c.hash, c.kind, c.agents, c.added]), [
    [h3, 'agent', ['copilot'], 2],
    [h2, 'agent', ['claude'], 5],
    [h1, 'human', [], 3],
  ]);
  assert.deepEqual(doc.commits[1].evidence, [{ agent: 'claude', source: 'trailer', value: 'Co-Authored-By: Claude <noreply@anthropic.com>' }]);
  assert.equal(doc.commits[0].evidence[0].source, 'author');
  assert.ok(!('history' in doc));
  assert.ok(!('byAuthor' in doc));

  const alias = JSON.parse((await cli([dir, '--json', '--base', 'main', '--head', 'HEAD'])).stdout);
  assert.deepEqual(alias.totals, doc.totals);
  const single = JSON.parse((await cli([dir, '--json', '--range', 'main'])).stdout);
  assert.equal(single.range.spec, 'main..HEAD');
  assert.equal(single.totals.lines, 10);

  const text = await cli([dir, '--range', 'main..HEAD']);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /range main\.\.HEAD \([0-9a-f]{7}\.\.[0-9a-f]{7}\)/);
  assert.match(text.stdout, /Lines added by the commits in the range\s+10/);
  assert.match(text.stdout, /AI-assisted\s+7\s+70\.0%\s+█{14}░{6}/);
  assert.match(text.stdout, /Claude Code\s+5\s+50\.0%\s+1/);
  assert.match(text.stdout, /3 commits in the range: 2 AI-assisted \(66\.7%\), 1 human, 0 bot/);
  assert.match(text.stdout, /1 file not counted \(1 binary\)/);
  assert.match(text.stdout, /src\/\s+2\s+8\s+5\s+62\.5%/);
  assert.match(text.stdout, new RegExp(`${h2.slice(0, 7)}\\s+2026-02-15\\s+Ada Lovelace\\s+AI-assisted\\s+\\+5\\s+Add b\\.js with help\\s+Claude Code via trailer`));
  assert.match(text.stdout, new RegExp(`${h1.slice(0, 7)}\\s+2026-01-15\\s+Ada Lovelace\\s+human\\s+\\+3\\s+Add a\\.js\\s+no agent evidence`));
  assert.match(text.stdout, /copilot-swe-agent\[bot\]\s+AI-assisted\s+\+2\s+Add docs and a logo\s+GitHub Copilot via author/);

  const md = await cli([dir, '--markdown', '--range', 'main..HEAD', '--by-author']);
  assert.equal(md.code, 0, md.stderr);
  assert.match(md.stdout, /^### AI-assisted code in this pull request$/m);
  assert.match(md.stdout, /\*\*70\.0%\*\* of 10 added lines come from agent-assisted commits \(7 lines across 3 files; 1 binary file not counted\)\. 2 of 3 commits carry agent evidence\./);
  assert.match(md.stdout, /^\| `src\/` \| 2 \| 8 \| 5 \| 62\.5% \|$/m);
  assert.match(md.stdout, /^\| Ada Lovelace \| human \| 8 \| 5 \| 62\.5% \|$/m);
  assert.match(md.stdout, /<summary>3 commits<\/summary>/);
  assert.match(md.stdout, new RegExp(`^\\| \`${h2.slice(0, 7)}\` \\| AI-assisted \\| \\+5 \\| Add b\\.js with help \\| Claude Code via trailer \\|$`, 'm'));
  assert.match(md.stdout, /<sub>range `main\.\.HEAD` · added lines of non-merge commits · Generated by agent-blame on \d{4}-\d{2}-\d{2}<\/sub>/);
});

test('end-to-end: --range with --files, --include, a subdirectory scope, --threshold, --badge and --shields', async (t) => {
  const { dir } = fixtureRepo();
  t.after(() => removeDir(dir));

  const perFile = JSON.parse((await cli([dir, '--json', '--range', 'main..HEAD', '--files'])).stdout);
  assert.deepEqual(perFile.byPath.map((p) => [p.path, p.lines, p.ai]), [['src/b.js', 5, 5], ['docs/c.md', 2, 2], ['src/a.js', 3, 0]]);

  const scoped = JSON.parse((await cli([path.join(dir, 'src'), '--json', '--range', 'main..HEAD'])).stdout);
  assert.equal(scoped.repo.subdir, 'src');
  assert.equal(scoped.totals.lines, 8);
  assert.equal(scoped.totals.ai, 5);
  assert.equal(scoped.totals.commits, 3, 'commit counts are range-wide, lines follow the scope');
  assert.equal(scoped.skipped.count, 0);

  const included = JSON.parse((await cli([dir, '--json', '--range', 'main..HEAD', '--include', '*.md'])).stdout);
  assert.equal(included.totals.lines, 2);
  assert.equal(included.totals.aiShare, 1);

  const over = await cli([dir, '--range', 'main..HEAD', '--threshold', '50', '--markdown']);
  assert.equal(over.code, 2);
  assert.match(over.stderr, /70\.0% exceeds threshold 50%/);
  assert.match(over.stdout, /\*\*Threshold 50% exceeded\.\*\*/);
  const under = await cli([dir, '--range', 'main..HEAD', '--threshold', '70']);
  assert.equal(under.code, 0);
  assert.match(under.stdout, /Threshold 70% not exceeded/);

  const badge = path.join(dir, 'out', 'pr.svg');
  const shields = path.join(dir, 'out', 'pr.json');
  const side = await cli([dir, '--range', 'main..HEAD', '--badge', badge, '--shields', shields, '--quiet']);
  assert.equal(side.code, 0, side.stderr);
  assert.equal(side.stderr, '');
  assert.match(fs.readFileSync(badge, 'utf8'), /<title>AI-assisted: 70%<\/title>/);
  assert.deepEqual(JSON.parse(fs.readFileSync(shields, 'utf8')), { schemaVersion: 1, label: 'AI-assisted', message: '70%', color: bandColor(0.7).slice(1) });
});

test('end-to-end: an empty range, a range with only binary changes, and a range that rejects history options', async (t) => {
  const { dir } = fixtureRepo();
  t.after(() => removeDir(dir));

  const empty = await cli([dir, '--json', '--range', 'HEAD..HEAD']);
  assert.equal(empty.code, 0, empty.stderr);
  const emptyDoc = JSON.parse(empty.stdout);
  assert.equal(emptyDoc.totals.commits, 0);
  assert.equal(emptyDoc.totals.lines, 0);
  assert.equal(emptyDoc.totals.aiShare, 0);
  assert.deepEqual(emptyDoc.commits, []);
  assert.deepEqual(emptyDoc.byPath, []);
  const emptyText = await cli([dir, '--range', 'HEAD..HEAD']);
  assert.match(emptyText.stdout, /No commits in the range\./);
  const emptyMd = await cli([dir, '--markdown', '--range', 'HEAD..HEAD']);
  assert.match(emptyMd.stdout, /No commits in the range `HEAD\.\.HEAD`\./);
  const emptyThreshold = await cli([dir, '--range', 'HEAD..HEAD', '--threshold', '0']);
  assert.equal(emptyThreshold.code, 0, 'an empty range never exceeds a threshold');

  writeFile(dir, 'icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const binTip = commitAll(dir, 'Add an icon\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n', { date: '2026-04-01T00:00:00Z' });
  const binary = await cli([dir, '--json', '--range', `${binTip}~1..${binTip}`]);
  assert.equal(binary.code, 0, binary.stderr);
  const binDoc = JSON.parse(binary.stdout);
  assert.equal(binDoc.totals.commits, 1);
  assert.equal(binDoc.totals.aiCommits, 1);
  assert.equal(binDoc.totals.lines, 0);
  assert.equal(binDoc.totals.aiShare, 0);
  assert.deepEqual(binDoc.agents.map((a) => [a.id, a.lines, a.commits]), [['claude', 0, 1]]);
  assert.deepEqual(binDoc.skipped.files, [{ path: 'icon.png', reason: 'binary' }]);
  const binText = await cli([dir, '--range', `${binTip}~1..${binTip}`]);
  assert.match(binText.stdout, /1 commits in the range: 1 AI-assisted \(100\.0%\)/);
  assert.match(binText.stdout, /No text lines were added in the range\./);

  const missing = await cli([dir, '--range', `nope..HEAD`]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /unknown revision "nope"/);
  const history = await cli([dir, '--range', 'main..HEAD', '--history']);
  assert.equal(history.code, 1);
  assert.match(history.stderr, /cannot be combined with --range/);
  const headOnly = await cli([dir, '--head', 'HEAD']);
  assert.equal(headOnly.code, 1);
  assert.match(headOnly.stderr, /--head requires --base/);
});

test('programmatic: analyze({ range }) returns the range model and the renderers dispatch on it', async (t) => {
  const { dir } = fixtureRepo();
  t.after(() => removeDir(dir));
  const model = await analyze({ path: dir, range: 'main..HEAD' });
  assert.equal(model.mode, 'range');
  assert.equal(model.totals.aiShare, 0.7);
  assert.match(renderText(model), /Lines added by the commits in the range/);
  assert.match(renderMarkdown(model), /in this pull request/);
  const doc = toJSON(model);
  assert.equal(doc.mode, 'range');
  assert.equal(doc.commits.length, 3);
  assert.equal(doc.totals.aiShare, 0.7);
});
