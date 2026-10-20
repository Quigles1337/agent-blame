import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLog,
  parseBlamePorcelain,
  parseNumstatLog,
  unquotePath,
  renameTarget,
  mapPool,
  ZERO_HASH,
} from '../src/git.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

test('parseLog splits NUL-separated records and unit-separated fields, and parses trailers', () => {
  const rec = (hash, body, trailers) =>
    [hash, 'Ada', 'ada@example.com', 'GitHub', 'noreply@github.com', '2026-01-02T03:04:05+00:00', '2026-01-02T03:04:06+00:00', 'Subject line', body, trailers].join('\x1f');
  const text = `${rec(A, 'Body text\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n', 'Co-Authored-By: Claude <noreply@anthropic.com>\n')}\0${rec(B, '', '')}\0`;
  const commits = parseLog(text);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].hash, A);
  assert.equal(commits[0].authorName, 'Ada');
  assert.equal(commits[0].committerEmail, 'noreply@github.com');
  assert.equal(commits[0].committerDate, '2026-01-02T03:04:06+00:00');
  assert.equal(commits[0].subject, 'Subject line');
  assert.match(commits[0].body, /^Body text/);
  assert.deepEqual(commits[0].trailers, [{ key: 'Co-Authored-By', value: 'Claude <noreply@anthropic.com>' }]);
  assert.deepEqual(commits[1].trailers, []);
  assert.deepEqual(parseLog(''), []);
});

test('parseBlamePorcelain counts header lines per commit across grouped and per-line formats', () => {
  // --porcelain: first line of a group carries the group size, later lines do not;
  // --line-porcelain: every line carries full headers. Both are mixed here on
  // purpose, together with an uncommitted (all-zero) boundary line and content
  // lines that happen to look like headers but are tab-prefixed.
  const fixture = [
    `${A} 1 1 2`,
    'author Ada',
    'author-mail <ada@example.com>',
    'summary first',
    'boundary',
    'filename src/a.js',
    '\tconst x = 1;',
    `${A} 2 2`,
    '\tconst y = 2;',
    `${B} 1 3 1`,
    'author Claude',
    'filename src/a.js',
    `\t${C} 9 9 9`,
    `${ZERO_HASH} 1 4 1`,
    'author Not Committed Yet',
    'author-mail <not.committed.yet>',
    'summary Version of src/a.js from src/a.js',
    'filename src/a.js',
    '\tuncommitted edit',
    `${B} 2 5 1`,
    'author Claude',
    'previous aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa src/a.js',
    'filename src/a.js',
    '\tmore',
    '',
  ].join('\n');
  const counts = parseBlamePorcelain(fixture);
  assert.equal(counts.get(A), 2);
  assert.equal(counts.get(B), 2);
  assert.equal(counts.get(ZERO_HASH), 1);
  assert.equal(counts.has(C), false, 'tab-prefixed content must not be counted');
  assert.equal([...counts.values()].reduce((s, n) => s + n, 0), 5);
  assert.equal(parseBlamePorcelain('').size, 0);
});

test('parseBlamePorcelain handles CRLF output and a second file concatenated', () => {
  const text = `${A} 1 1 1\r\nauthor Ada\r\n\tline\r\n${B} 1 1 3\r\nauthor X\r\n\tl1\r\n${B} 2 2\r\n\tl2\r\n${B} 3 3\r\n\tl3\r\n`;
  const counts = parseBlamePorcelain(text);
  assert.equal(counts.get(A), 1);
  assert.equal(counts.get(B), 3);
});

test('parseNumstatLog reads commits, binary entries, renames and quoted paths', () => {
  const text = [
    `\x01${A}\x1f2026-03-01T10:00:00+00:00`,
    '',
    '10\t2\tsrc/a.js',
    '-\t-\tassets/logo.png',
    '3\t0\tsrc/{old => new}.js',
    '1\t1\tdocs/old-name.md => docs/new-name.md',
    '2\t0\t"caf\\303\\251.txt"',
    `\x01${B}\x1f2026-04-15T10:00:00+00:00`,
    '',
    `\x01${C}\x1f2026-04-16T10:00:00+00:00`,
    '',
    '5\t5\tREADME.md',
    '',
  ].join('\n');
  const commits = parseNumstatLog(text);
  assert.equal(commits.length, 3);
  assert.equal(commits[0].hash, A);
  assert.equal(commits[0].date, '2026-03-01T10:00:00+00:00');
  assert.deepEqual(commits[0].files, [
    { added: 10, deleted: 2, path: 'src/a.js', binary: false },
    { added: 0, deleted: 0, path: 'assets/logo.png', binary: true },
    { added: 3, deleted: 0, path: 'src/new.js', binary: false },
    { added: 1, deleted: 1, path: 'docs/new-name.md', binary: false },
    { added: 2, deleted: 0, path: 'café.txt', binary: false },
  ]);
  assert.deepEqual(commits[1].files, []);
  assert.equal(commits[2].files[0].path, 'README.md');
});

test('unquotePath and renameTarget edge cases', () => {
  assert.equal(unquotePath('plain/path.js'), 'plain/path.js');
  assert.equal(unquotePath('"a\\tb\\"c"'), 'a\tb"c');
  assert.equal(renameTarget('src/{a/b => c}/d.js'), 'src/c/d.js');
  assert.equal(renameTarget('src/{ => lib}/d.js'), 'src/lib/d.js');
  assert.equal(renameTarget('no-rename.js'), 'no-rename.js');
});

test('mapPool keeps result order and bounds concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapPool([5, 1, 4, 2, 3], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, n * 2));
    inFlight -= 1;
    return n * 10;
  });
  assert.deepEqual(results, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapPool([], 4, async () => 1), []);
});
