import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainClassification, explainFile } from '../src/explain.js';
import { createClassifier } from '../src/classify.js';
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
 * src/a.js is written by a human, extended with a Claude trailer, then edited
 * by Copilot under its own identity and renamed to src/b.js; dependabot adds
 * a lock file; src/c.js is fully human; src/d.js is fully agent-written.
 */
function fixtureRepo() {
  const dir = initRepo();
  writeFile(dir, 'src/a.js', 'one\ntwo\nthree\n');
  const h1 = commitAll(dir, 'Add a.js\n\nCo-Authored-By: Bob <bob@example.com>\n', { date: '2026-01-15T12:00:00Z' });
  writeFile(dir, 'src/a.js', 'one\ntwo\nthree\nfour\nfive\n');
  const h2 = commitAll(dir, 'Extend a.js with help\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n', { date: '2026-02-15T12:00:00Z' });
  run(dir, ['mv', 'src/a.js', 'src/b.js']);
  writeFile(dir, 'src/b.js', 'ONE\ntwo\nthree\nfour\nfive\n');
  const h3 = commitAll(dir, 'Rename and shout\n', {
    author: { name: 'copilot-swe-agent[bot]', email: '198982749+Copilot@users.noreply.github.com' },
    date: '2026-03-15T12:00:00Z',
  });
  writeFile(dir, 'package-lock.json', '{\n  "a": 1\n}\n');
  commitAll(dir, 'Bump deps\n', { author: { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' }, date: '2026-03-16T12:00:00Z' });
  writeFile(dir, 'src/c.js', 'c1\nc2\nc3\nc4\n');
  commitAll(dir, 'Add c.js\n', { date: '2026-03-17T12:00:00Z' });
  writeFile(dir, 'src/d.js', 'd1\nd2\n');
  const h4 = commitAll(dir, 'Add d.js\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n', { date: '2026-03-18T12:00:00Z' });
  return { dir, h1, h2, h3, h4 };
}

test('explainClassification spells out the evidence for agents and what was checked for humans and bots', () => {
  const classify = createClassifier();
  const agent = { authorName: 'Ada', authorEmail: 'ada@example.com', subject: 'x', body: '', trailers: [{ key: 'Co-Authored-By', value: 'Claude <noreply@anthropic.com>' }] };
  assert.deepEqual(explainClassification(agent, classify(agent), classify.labels), ['trailer: Co-Authored-By: Claude <noreply@anthropic.com> (Claude Code)']);
  const human = { authorName: 'Ada', authorEmail: 'ada@example.com', subject: 'x', body: '', trailers: [{ key: 'Co-Authored-By', value: 'Bob <bob@example.com>' }, { key: 'Signed-off-by', value: 'Ada' }] };
  assert.deepEqual(explainClassification(human, classify(human), classify.labels), [
    'author Ada <ada@example.com> matches no agent or bot pattern',
    'Co-Authored-By: Bob <bob@example.com> matches no agent pattern',
    'no message marker',
  ]);
  const plain = { authorName: 'Ada', authorEmail: 'ada@example.com', subject: 'x', body: '', trailers: [] };
  assert.deepEqual(explainClassification(plain, classify(plain), classify.labels), [
    'author Ada <ada@example.com> matches no agent or bot pattern',
    'no Co-Authored-By or AI-assistance trailer',
    'no message marker',
  ]);
  const bot = { authorName: 'dependabot[bot]', authorEmail: 'dep@users.noreply.github.com', subject: 'x', body: '', trailers: [] };
  assert.deepEqual(explainClassification(bot, classify(bot), classify.labels), ['author dependabot[bot] <dep@users.noreply.github.com> matches a bot pattern; no agent evidence']);
});

test('explainFile follows renames, lists every commit with evidence and surviving lines, and sums the blame', async (t) => {
  const { dir, h1, h2, h3 } = fixtureRepo();
  t.after(() => removeDir(dir));
  const model = await explainFile({ path: dir, file: 'src/b.js' });
  assert.equal(model.mode, 'explain');
  assert.equal(model.file, 'src/b.js');
  assert.deepEqual(model.commits.map((c) => [c.hash, c.kind, c.agents, c.added, c.deleted, c.surviving]), [
    [h3, 'agent', ['copilot'], 1, 1, 1],
    [h2, 'agent', ['claude'], 2, 0, 2],
    [h1, 'human', [], 3, 0, 2],
  ]);
  assert.deepEqual(model.commits[0].reasons, ['author: copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com> (GitHub Copilot)']);
  assert.deepEqual(model.commits[2].reasons, [
    'author Ada Lovelace <ada@example.com> matches no agent or bot pattern',
    'Co-Authored-By: Bob <bob@example.com> matches no agent pattern',
    'no message marker',
  ]);
  assert.deepEqual(model.totals, { lines: 5, ai: 3, human: 2, bot: 0, uncommitted: 0, unknown: 0, counted: 5, share: 0.6 });

  const text = renderText(model);
  assert.match(text, /agent-blame src\/b\.js/);
  assert.match(text, /5 surviving lines: 3 AI-assisted \(60\.0%\), 2 human/);
  assert.match(text, /3 commits touched this file/);
  assert.match(text, new RegExp(`${h3.slice(0, 7)}\\s+2026-03-15\\s+copilot-swe-agent\\[bot\\]\\s+AI-assisted\\s+\\+1\\s+-1\\s+1\\s+Rename and shout\\n\\s+evidence: author: copilot-swe-agent`));
  assert.match(text, new RegExp(`${h1.slice(0, 7)}\\s+2026-01-15\\s+Ada Lovelace\\s+human\\s+\\+3\\s+-0\\s+2\\s+Add a\\.js\\n\\s+because: author Ada Lovelace`));
  const md = renderMarkdown(model);
  assert.match(md, /^### `src\/b\.js`$/m);
  assert.match(md, /\*\*60\.0%\*\* of 5 surviving lines are AI-assisted \(3 lines\); 3 commits touched the file\./);
  assert.match(md, new RegExp(`^\\| \`${h2.slice(0, 7)}\` \\| 2026-02-15 \\| Ada Lovelace \\| AI-assisted \\| \\+2 \\| -0 \\| 2 \\| Extend a\\.js with help \\| trailer: Co-Authored-By: Claude <noreply@anthropic\\.com> \\(Claude Code\\) \\|$`, 'm'));
  const doc = toJSON(model);
  assert.equal(doc.mode, 'explain');
  assert.equal(doc.totals.share, 0.6);
  assert.equal(doc.commits.length, 3);
  assert.ok(!('byPath' in doc));
});

test('end-to-end: --explain resolves the file against the path argument, honours config, and rejects untracked files and conflicting options', async (t) => {
  const { dir, h2 } = fixtureRepo();
  t.after(() => removeDir(dir));
  const r = await cli([dir, '--explain', 'src/b.js', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.file, 'src/b.js');
  assert.equal(doc.commits[1].hash, h2);

  const fromInside = await cli(['--explain', 'b.js', '--json'], { cwd: path.join(dir, 'src') });
  assert.equal(fromInside.code, 0, fromInside.stderr);
  assert.equal(JSON.parse(fromInside.stdout).file, 'src/b.js');

  const absolute = await cli(['--explain', path.join(dir, 'src', 'c.js')], { cwd: dir });
  assert.equal(absolute.code, 0, absolute.stderr);
  assert.match(absolute.stdout, /4 surviving lines: 0 AI-assisted \(0\.0%\), 4 human/);

  writeFile(dir, '.agent-blame.json', JSON.stringify({ agents: { copilot: false } }));
  const noCopilot = JSON.parse((await cli([dir, '--explain', 'src/b.js', '--json'])).stdout);
  assert.equal(noCopilot.commits[0].kind, 'bot', 'without the Copilot patterns the [bot] author is plain automation');
  assert.equal(noCopilot.totals.ai, 2);
  assert.equal(noCopilot.totals.bot, 1);
  assert.equal(noCopilot.totals.share, 0.5);
  assert.equal(noCopilot.options.config, '.agent-blame.json');

  const bots = await cli([dir, '--explain', 'package-lock.json']);
  assert.match(bots.stdout, /3 surviving lines: 0 AI-assisted \(0\.0%\), 0 human, 3 bot, excluded from the share/);
  assert.match(bots.stdout, /because: author dependabot\[bot\] .* matches a bot pattern/);

  const untracked = await cli([dir, '--explain', 'nope.js']);
  assert.equal(untracked.code, 1);
  assert.match(untracked.stderr, /nope\.js is not tracked by git/);
  const outside = await cli([dir, '--explain', path.join(dir, '..', 'elsewhere.js')]);
  assert.equal(outside.code, 1);
  const conflict = await cli([dir, '--explain', 'src/b.js', '--history']);
  assert.equal(conflict.code, 1);
  assert.match(conflict.stderr, /--explain only takes/);
});

test('end-to-end: --top N lists the N files with the highest AI-assisted share in blame and range mode', async (t) => {
  const { dir, h1 } = fixtureRepo();
  t.after(() => removeDir(dir));
  const r = await cli([dir, '--json', '--top', '2']);
  assert.equal(r.code, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.options.top, 2);
  assert.equal(doc.options.perFile, true);
  assert.deepEqual(doc.byPath.map((p) => [p.path, p.lines, p.ai, p.share]), [
    ['src/d.js', 2, 2, 1],
    ['src/b.js', 5, 3, 0.6],
  ]);
  assert.equal(doc.totals.files, 4, 'totals still cover every file');

  const text = await cli([dir, '--top', '1']);
  assert.match(text.stdout, /Top 1 files by AI-assisted share\s+Lines\s+AI-assisted\s+Share/);
  assert.match(text.stdout, /src\/d\.js\s+2\s+2\s+100\.0%/);
  assert.ok(!text.stdout.includes('src/b.js'));
  const md = await cli([dir, '--top', '1', '--markdown']);
  assert.match(md.stdout, /^Top 1 files by AI-assisted share:$/m);
  assert.match(md.stdout, /^\| File \| Lines \| AI-assisted \| Share \|$/m);

  const range = JSON.parse((await cli([dir, '--json', '--top', '2', '--range', `${h1}..HEAD`])).stdout);
  assert.equal(range.mode, 'range');
  assert.equal(range.options.top, 2);
  // Range mode records added lines under the path each commit used, so the pre-rename src/a.js keeps its own row.
  assert.deepEqual(range.byPath.map((p) => [p.path, p.lines, p.ai]), [['src/a.js', 2, 2], ['src/d.js', 2, 2]]);

  const bad = await cli([dir, '--top', '0']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /--top expects a number between 1/);
});
