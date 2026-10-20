import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, bucketPath } from '../src/aggregate.js';
import { renderText, renderMarkdown, toJSON, formatShare, formatInt, bar, table } from '../src/report.js';
import { ZERO_HASH } from '../src/git.js';

const H = 'h'.repeat(40); // human
const A = 'a'.repeat(40); // human author + Claude trailer
const B = 'b'.repeat(40); // dependabot
const G = 'g'.repeat(40); // Copilot as author
const U = 'u'.repeat(40); // not in the log (unknown)

function commitIndex() {
  return new Map([
    [H, { commit: { authorName: 'Ada', authorEmail: 'ada@example.com' }, classification: { kind: 'human', agents: [], authorKind: 'human', assisted: false } }],
    [A, { commit: { authorName: 'Ada', authorEmail: 'ada@example.com' }, classification: { kind: 'agent', agents: ['claude'], authorKind: 'human', assisted: true } }],
    [B, { commit: { authorName: 'dependabot[bot]', authorEmail: 'dep@users.noreply.github.com' }, classification: { kind: 'bot', agents: [], authorKind: 'bot', assisted: false } }],
    [G, { commit: { authorName: 'copilot-swe-agent[bot]', authorEmail: 'copilot@users.noreply.github.com' }, classification: { kind: 'agent', agents: ['copilot', 'claude'], authorKind: 'agent', assisted: false } }],
  ]);
}

function files() {
  return [
    { path: 'src/a.js', lines: new Map([[H, 10], [A, 30]]) },
    { path: 'src/deep/b.js', lines: new Map([[G, 20]]) },
    { path: 'package-lock.json', lines: new Map([[B, 40]]) },
    { path: 'README.md', lines: new Map([[H, 5], [ZERO_HASH, 3], [U, 2]]) },
    { path: 'empty.txt', lines: new Map() },
  ];
}

const LABELS = { claude: 'Claude Code', copilot: 'GitHub Copilot' };

function model(extra = {}) {
  const agg = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS, ...extra.aggregateOptions });
  return {
    version: 1,
    generatedAt: '2026-10-20T00:00:00.000Z',
    tool: { name: 'agent-blame', version: '0.0.0' },
    repo: { path: '/repo', head: 'abc1234', branch: 'main', subdir: null },
    options: { ignoreBots: true, defaultPatterns: true, depth: 1, perFile: false, include: [], exclude: [], maxFileSize: 2097152, config: null },
    totals: agg.totals,
    agents: agg.agents,
    byPath: agg.byPath,
    byAuthor: null,
    history: null,
    skipped: { count: 2, byReason: { binary: 1, 'too-large': 1 }, files: [] },
    ignoreRevsFile: null,
    threshold: null,
    ...extra,
    ...(extra.aggregateOptions ? { _agg: agg } : {}),
  };
}

test('aggregate totals: AI, human, bot, uncommitted and unknown lines; bots excluded from the denominator', () => {
  const { totals } = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS });
  assert.equal(totals.files, 5);
  assert.equal(totals.lines, 110);
  assert.equal(totals.ai, 50);
  assert.equal(totals.bot, 40);
  assert.equal(totals.uncommitted, 3);
  assert.equal(totals.unknown, 2);
  assert.equal(totals.human, 20, 'uncommitted and unknown lines are counted as human');
  assert.equal(totals.counted, 70);
  assert.equal(totals.aiShare, 50 / 70);
  assert.equal(totals.commits, 4);
  assert.equal(totals.aiCommits, 2);
  assert.equal(totals.botCommits, 1);
  assert.equal(totals.humanCommits, 1);

  const kept = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS, ignoreBots: false }).totals;
  assert.equal(kept.counted, 110);
  assert.equal(kept.aiShare, 50 / 110);
});

test('aggregate per-agent breakdown counts multi-agent commits under each agent', () => {
  const { agents } = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS });
  assert.deepEqual(agents.map((a) => [a.id, a.label, a.lines, a.commits]), [
    ['claude', 'Claude Code', 50, 2],
    ['copilot', 'GitHub Copilot', 20, 1],
  ]);
  assert.equal(agents[0].share, 50 / 70);
});

test('aggregate byPath groups by directory depth, keeps root files by name, sorts by share, and can go per file', () => {
  assert.equal(bucketPath('src/deep/b.js', 1), 'src/');
  assert.equal(bucketPath('src/deep/b.js', 2), 'src/deep/');
  assert.equal(bucketPath('src/deep/b.js', 5), 'src/deep/b.js');
  assert.equal(bucketPath('README.md', 1), 'README.md');
  assert.equal(bucketPath('anything', 0), '.');

  const { byPath } = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS, depth: 1 });
  assert.deepEqual(byPath.map((p) => [p.path, p.files, p.lines, p.ai, p.share]), [
    ['src/', 2, 60, 50, 50 / 60],
    ['package-lock.json', 1, 40, 0, 0],
    ['README.md', 1, 10, 0, 0],
    ['empty.txt', 1, 0, 0, 0],
  ]);

  const perFile = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS, perFile: true }).byPath;
  assert.deepEqual(perFile.map((p) => p.path), ['src/deep/b.js', 'src/a.js', 'package-lock.json', 'README.md', 'empty.txt']);

  const whole = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS, depth: 0 }).byPath;
  assert.deepEqual(whole.map((p) => [p.path, p.files]), [['.', 5]]);
});

test('aggregate byAuthor credits the human author for assisted lines and lists agents and bots as authors', () => {
  const { byAuthor } = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS });
  assert.deepEqual(byAuthor.map((a) => [a.name, a.kind, a.lines, a.ai]), [
    ['Ada', 'human', 45, 30],
    ['dependabot[bot]', 'bot', 40, 0],
    ['copilot-swe-agent[bot]', 'agent', 20, 20],
  ]);
  assert.equal(byAuthor[0].share, 30 / 45);
  assert.deepEqual(byAuthor[0].agents, { claude: 30 });
});

test('aggregate with no files and no commits (zero-commit repository) yields zeros without throwing', () => {
  const agg = aggregate({ files: [], commitIndex: new Map(), labels: {} });
  assert.equal(agg.totals.lines, 0);
  assert.equal(agg.totals.aiShare, 0);
  assert.deepEqual(agg.agents, []);
  assert.deepEqual(agg.byPath, []);
  assert.deepEqual(agg.byAuthor, []);
  const text = renderText({ ...model(), totals: agg.totals, agents: [], byPath: [], skipped: { count: 0, byReason: {} } });
  assert.match(text, /No blameable files/);
});

test('formatting helpers', () => {
  assert.equal(formatShare(0.4286), '42.9%');
  assert.equal(formatShare(null), '-');
  assert.equal(formatInt(1234567), '1,234,567');
  assert.equal(bar(0.5, 10), '█████░░░░░');
  assert.equal(bar(0, 4), '░░░░');
  const t = table([{ a: 'x', b: '1' }, { a: 'long', b: '22' }], [{ key: 'a', title: 'A' }, { key: 'b', title: 'B', align: 'r' }]);
  assert.equal(t, 'A      B\nx      1\nlong  22');
});

test('renderText contains the summary, agents, path table, bars and the threshold verdict', () => {
  const text = renderText(model({ threshold: 50 }));
  assert.match(text, /agent-blame \/repo @ abc1234 \(main\)/);
  assert.match(text, /AI-assisted\s+50\s+71\.4%\s+█+░+/);
  assert.match(text, /Bot\s+40\s+excluded from the share/);
  assert.match(text, /Uncommitted\s+3/);
  assert.match(text, /Claude Code\s+50\s+71\.4%\s+2/);
  assert.match(text, /4 commits across all refs: 2 AI-assisted \(50\.0%\), 1 human, 1 bot/);
  assert.match(text, /2 files skipped \(1 binary, 1 too-large\)/);
  assert.match(text, /Path \(depth 1\)\s+Files\s+Lines\s+AI-assisted\s+Share/);
  assert.match(text, /src\/\s+2\s+60\s+50\s+83\.3%/);
  assert.match(text, /Threshold 50% exceeded: AI-assisted share is 71\.4%/);
  assert.ok(!text.includes('\x1b['), 'no ANSI codes without color');

  const colored = renderText(model(), { color: true });
  assert.ok(colored.includes('\x1b[1m'));

  const notExceeded = renderText(model({ threshold: 90 }));
  assert.match(notExceeded, /Threshold 90% not exceeded/);
});

test('renderText with --by-author and --history sections', () => {
  const agg = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS });
  const text = renderText(model({
    byAuthor: agg.byAuthor,
    history: { granularity: 'month', since: '2026-01-01', until: null, periods: [
      { period: '2026-01', added: 100, ai: 25, human: 75, bot: 0, counted: 100, share: 0.25, commits: 3, aiCommits: 1 },
      { period: '2026-02', added: 0, ai: 0, human: 0, bot: 0, counted: 0, share: null, commits: 0, aiCommits: 0 },
      { period: '2026-03', added: 10, ai: 10, human: 0, bot: 0, counted: 10, share: 1, commits: 1, aiCommits: 1 },
    ] },
  }));
  assert.match(text, /Author\s+Lines\s+AI-assisted\s+Share/);
  assert.match(text, /Ada <ada@example\.com>\s+45\s+30\s+66\.7%/);
  assert.match(text, /copilot-swe-agent\[bot\] <copilot@users\.noreply\.github\.com>\s+\(agent\)\s+20\s+20\s+100\.0%/);
  assert.match(text, /Month \(added lines, HEAD history\)/);
  assert.match(text, /2026-01\s+100\s+25\s+25\.0%/);
  assert.match(text, /2026-02\s+0\s+0\s+-/);
  assert.match(text, /Trend: ▃ █/);
  assert.match(text, /since 2026-01-01/);
});

test('renderMarkdown emits GitHub-flavoured tables', () => {
  const md = renderMarkdown(model({ byAuthor: aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS }).byAuthor }));
  assert.match(md, /^### AI-assisted code/m);
  assert.match(md, /\*\*71\.4%\*\* of 70 lines are AI-assisted \(50 lines across 5 files; 40 bot lines excluded\)\. 2 of 4 commits carry agent evidence\./);
  assert.match(md, /^\| Agent \| Lines \| Share \| Commits \|\n\| --- \| ---: \| ---: \| ---: \|\n\| Claude Code \| 50 \| 71\.4% \| 2 \|/m);
  assert.match(md, /^\| Path \| Files \| Lines \| AI-assisted \| Share \|/m);
  assert.match(md, /^\| `src\/` \| 2 \| 60 \| 50 \| 83\.3% \|/m);
  assert.match(md, /^\| Author \| Kind \| Lines \| AI-assisted \| Share \|/m);
  assert.match(md, /<sub>2 files skipped \(1 binary, 1 too-large\) · Generated by agent-blame on 2026-10-20<\/sub>/);
});

test('toJSON has the stable schema keys and rounds shares', () => {
  const agg = aggregate({ files: files(), commitIndex: commitIndex(), labels: LABELS });
  const doc = toJSON(model({ byAuthor: agg.byAuthor, history: { granularity: 'month', since: null, until: null, periods: [] }, threshold: 60 }));
  assert.deepEqual(Object.keys(doc), ['version', 'generatedAt', 'tool', 'repo', 'options', 'totals', 'agents', 'byPath', 'skipped', 'byAuthor', 'history', 'threshold']);
  assert.equal(doc.version, 1);
  assert.deepEqual(Object.keys(doc.totals), ['files', 'lines', 'counted', 'ai', 'human', 'bot', 'uncommitted', 'unknown', 'aiShare', 'commits', 'aiCommits', 'humanCommits', 'botCommits']);
  assert.equal(doc.totals.aiShare, 0.714286);
  assert.deepEqual(Object.keys(doc.agents[0]), ['id', 'label', 'lines', 'share', 'commits']);
  assert.deepEqual(Object.keys(doc.byPath[0]), ['path', 'files', 'lines', 'counted', 'ai', 'human', 'bot', 'share']);
  assert.deepEqual(doc.threshold, { limit: 60, exceeded: true });
  assert.ok(JSON.stringify(doc).length > 0);

  const minimal = toJSON(model());
  assert.ok(!('byAuthor' in minimal));
  assert.ok(!('history' in minimal));
  assert.ok(!('threshold' in minimal));
});

test('aggregate byAuthor merges display names on one e-mail and shows the name with the most lines', () => {
  const index = new Map([
    [H, { commit: { authorName: 'Ada', authorEmail: 'Ada@Example.com' }, classification: { kind: 'human', agents: [], authorKind: 'human', assisted: false } }],
    [A, { commit: { authorName: 'A. Lovelace', authorEmail: 'ada@example.com' }, classification: { kind: 'agent', agents: ['claude'], authorKind: 'human', assisted: true } }],
  ]);
  const { byAuthor } = aggregate({ files: [{ path: 'f', lines: new Map([[H, 2], [A, 9]]) }], commitIndex: index, labels: LABELS });
  assert.equal(byAuthor.length, 1);
  assert.equal(byAuthor[0].name, 'A. Lovelace');
  assert.equal(byAuthor[0].lines, 11);
  assert.ok(!('names' in byAuthor[0]));
});
