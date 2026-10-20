import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketHistory, isoWeek, nextPeriod, periodOf, sparkline } from '../src/history.js';

const idx = (entries) => new Map(Object.entries(entries).map(([hash, kind]) => [hash, { commit: {}, classification: { kind, agents: kind === 'agent' ? ['claude'] : [] } }]));

test('periodOf buckets by month or ISO week without time-zone conversion', () => {
  assert.equal(periodOf('2026-03-31T23:30:00-05:00'), '2026-03');
  assert.equal(periodOf('2026-03-31T23:30:00-05:00', true), '2026-W14');
  assert.equal(periodOf('garbage'), null);
});

test('isoWeek handles year boundaries', () => {
  assert.equal(isoWeek(2026, 1, 1), '2026-W01'); // Thursday
  assert.equal(isoWeek(2027, 1, 1), '2026-W53'); // Friday, still week 53 of 2026
  assert.equal(isoWeek(2024, 12, 30), '2025-W01'); // Monday belonging to 2025
  assert.equal(isoWeek(2021, 1, 3), '2020-W53');
});

test('nextPeriod rolls months and weeks over year ends', () => {
  assert.equal(nextPeriod('2026-11'), '2026-12');
  assert.equal(nextPeriod('2026-12'), '2027-01');
  assert.equal(nextPeriod('2026-W52'), '2026-W53');
  assert.equal(nextPeriod('2026-W53'), '2027-W01');
  assert.equal(nextPeriod('2025-W52'), '2026-W01');
  assert.throws(() => nextPeriod('nope'), TypeError);
});

test('bucketHistory sums added lines by period, classifies by commit, fills gaps and excludes bots from the denominator', () => {
  const commits = [
    { hash: 'h1', date: '2026-01-10T00:00:00Z', files: [{ added: 10, deleted: 0, path: 'src/a.js', binary: false }] },
    { hash: 'a1', date: '2026-01-20T00:00:00Z', files: [{ added: 30, deleted: 5, path: 'src/b.js', binary: false }, { added: 0, deleted: 0, path: 'x.png', binary: true }] },
    { hash: 'b1', date: '2026-01-25T00:00:00Z', files: [{ added: 60, deleted: 0, path: 'package-lock.json', binary: false }] },
    { hash: 'h2', date: '2026-03-02T00:00:00Z', files: [{ added: 5, deleted: 1, path: 'src/c.js', binary: false }, { added: 100, deleted: 0, path: 'vendor/lib.js', binary: false }] },
  ];
  const index = idx({ h1: 'human', a1: 'agent', b1: 'bot', h2: 'human' });
  const periods = bucketHistory(commits, index, { matcher: (p) => !p.startsWith('vendor/') });
  assert.deepEqual(periods.map((p) => p.period), ['2026-01', '2026-02', '2026-03']);
  assert.equal(periods[0].added, 100);
  assert.equal(periods[0].ai, 30);
  assert.equal(periods[0].bot, 60);
  assert.equal(periods[0].counted, 40);
  assert.equal(periods[0].share, 0.75);
  assert.equal(periods[0].commits, 3);
  assert.equal(periods[0].aiCommits, 1);
  assert.equal(periods[1].added, 0);
  assert.equal(periods[1].share, null);
  assert.equal(periods[2].added, 5, 'vendor/ is excluded by the matcher');
  assert.equal(periods[2].share, 0);

  const withBots = bucketHistory(commits, index, { ignoreBots: false, matcher: () => true });
  assert.equal(withBots[0].counted, 100);
  assert.equal(withBots[0].share, 0.3);

  const weekly = bucketHistory(commits.slice(0, 2), index, { weekly: true });
  assert.deepEqual(weekly.map((p) => p.period), ['2026-W02', '2026-W03', '2026-W04']);

  const unknownCommit = bucketHistory([{ hash: 'zz', date: '2026-05-01T00:00:00Z', files: [{ added: 1, deleted: 0, path: 'f', binary: false }] }], index);
  assert.equal(unknownCommit[0].human, 1, 'commits missing from the index count as human');
  assert.deepEqual(bucketHistory([], index), []);
});

test('sparkline maps shares to the eight block characters and blanks nulls', () => {
  assert.equal(sparkline([0, 1]), '▁█');
  assert.equal(sparkline([0.5, null, 0.25]), '▅ ▃');
  assert.equal(sparkline([]), '');
  assert.equal(sparkline([2, -1]), '█▁');
});
