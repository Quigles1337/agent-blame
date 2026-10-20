import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  readCommits,
  listFiles,
  inspectFile,
  blameFile,
  blameRepo,
  readNumstat,
  repoRoot,
  findIgnoreRevsFile,
  ZERO_HASH,
} from '../src/git.js';
import { createMatcher } from '../src/glob.js';
import { initRepo, writeFile, commitAll, removeDir, makeTempDir, run } from './support/temp-repo.js';

const CLAUDE = 'Co-Authored-By: Claude <noreply@anthropic.com>';

test('readCommits parses identities, dates and trailers from a real repository', async (t) => {
  const dir = initRepo();
  t.after(() => removeDir(dir));
  writeFile(dir, 'a.txt', 'one\n');
  const h1 = commitAll(dir, 'First\n');
  writeFile(dir, 'a.txt', 'one\ntwo\n');
  const h2 = commitAll(dir, `Second\n\nLonger body.\n\n${CLAUDE}\n`, { date: '2026-02-01T00:00:00Z' });

  const commits = await readCommits(dir);
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  assert.equal(commits.length, 2);
  assert.equal(byHash.get(h1).subject, 'First');
  assert.deepEqual(byHash.get(h1).trailers, []);
  assert.equal(byHash.get(h2).authorName, 'Ada Lovelace');
  assert.equal(byHash.get(h2).authorEmail, 'ada@example.com');
  assert.deepEqual(byHash.get(h2).trailers, [{ key: 'Co-Authored-By', value: 'Claude <noreply@anthropic.com>' }]);
  assert.match(byHash.get(h2).committerDate, /^2026-02-01T/);
  assert.equal(await repoRoot(dir), fs.realpathSync.native(dir));
});

test('a repository with zero commits yields no commits, no files and no numstat', async (t) => {
  const dir = initRepo();
  t.after(() => removeDir(dir));
  assert.deepEqual(await readCommits(dir), []);
  assert.deepEqual(await listFiles(dir), []);
  assert.deepEqual(await readNumstat(dir), []);
  const { files, skipped } = await blameRepo(dir);
  assert.deepEqual(files, []);
  assert.deepEqual(skipped, []);
});

test('a directory that is not a repository has no root', async (t) => {
  const dir = makeTempDir('agent-blame-norepo-');
  t.after(() => removeDir(dir));
  assert.equal(await repoRoot(dir), null);
});

test('inspectFile flags binaries, oversized files and missing files, and accepts empty files', async (t) => {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  fs.writeFileSync(path.join(dir, 'text.txt'), 'hello\n');
  fs.writeFileSync(path.join(dir, 'empty.txt'), '');
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(5000));
  assert.deepEqual(await inspectFile(path.join(dir, 'bin.dat')), { skip: true, reason: 'binary', size: 6 });
  assert.deepEqual(await inspectFile(path.join(dir, 'text.txt')), { skip: false, size: 6 });
  assert.deepEqual(await inspectFile(path.join(dir, 'empty.txt')), { skip: false, size: 0 });
  assert.deepEqual(await inspectFile(path.join(dir, 'big.txt'), { maxFileSize: 4096 }), { skip: true, reason: 'too-large', size: 5000 });
  assert.deepEqual(await inspectFile(path.join(dir, 'nope.txt')), { skip: true, reason: 'missing' });
  assert.deepEqual(await inspectFile(dir), { skip: true, reason: 'missing' });
});

test('blameFile counts surviving lines per commit, including uncommitted edits and empty files', async (t) => {
  const dir = initRepo();
  t.after(() => removeDir(dir));
  writeFile(dir, 'src/a.js', 'line1\nline2\nline3\n');
  const h1 = commitAll(dir, 'Add a.js\n');
  writeFile(dir, 'src/a.js', 'line1\nchanged\nline3\nline4\n');
  const h2 = commitAll(dir, `Edit a.js\n\n${CLAUDE}\n`);
  writeFile(dir, 'empty.txt', '');
  commitAll(dir, 'Add empty file\n');

  const a = await blameFile(dir, 'src/a.js');
  assert.equal(a.lines.get(h1), 2);
  assert.equal(a.lines.get(h2), 2);

  const empty = await blameFile(dir, 'empty.txt');
  assert.equal(empty.lines.size, 0);

  fs.appendFileSync(path.join(dir, 'src', 'a.js'), 'uncommitted\n');
  const dirty = await blameFile(dir, 'src/a.js');
  assert.equal(dirty.lines.get(ZERO_HASH), 1);

  const missing = await blameFile(dir, 'does/not/exist.js');
  assert.ok(missing.error);
});

test('blameRepo lists tracked regular files, applies include/exclude, skips binaries and large files, and reports them', async (t) => {
  const dir = initRepo();
  t.after(() => removeDir(dir));
  writeFile(dir, 'src/a.js', 'a\nb\n');
  writeFile(dir, 'src/b.js', 'c\n');
  writeFile(dir, 'vendor/lib.js', 'v\n');
  writeFile(dir, 'logo.png', Buffer.from([0x89, 0x50, 0x00, 0x0a]));
  writeFile(dir, 'huge.txt', 'h\n'.repeat(3000));
  writeFile(dir, 'yarn.lock', 'lock\n');
  commitAll(dir, 'Initial\n');

  const matcher = createMatcher({ exclude: ['vendor/**', '*.lock'] });
  const { files, skipped } = await blameRepo(dir, { matcher, maxFileSize: 4096, jobs: 2 });
  assert.deepEqual(files.map((f) => f.path), ['src/a.js', 'src/b.js']);
  assert.equal(files[0].lines.size, 1);
  assert.equal([...files[0].lines.values()][0], 2);
  assert.deepEqual(skipped, [
    { path: 'huge.txt', reason: 'too-large' },
    { path: 'logo.png', reason: 'binary' },
  ]);

  const sub = await blameRepo(dir, { subdir: 'vendor' });
  assert.deepEqual(sub.files.map((f) => f.path), ['vendor/lib.js']);
});

test('findIgnoreRevsFile and blameRepo honour .git-blame-ignore-revs, and recover from an unusable one', async (t) => {
  const dir = initRepo();
  t.after(() => removeDir(dir));
  writeFile(dir, 'f.txt', 'x\ny\n');
  const h1 = commitAll(dir, 'Add\n');
  assert.equal(findIgnoreRevsFile(dir), null);
  writeFile(dir, 'f.txt', 'x\nY\n');
  const h2 = commitAll(dir, 'Reformat\n');
  writeFile(dir, '.git-blame-ignore-revs', `${h2}\n`);
  commitAll(dir, 'Ignore reformat\n');

  assert.equal(findIgnoreRevsFile(dir), path.join(dir, '.git-blame-ignore-revs'));
  const { files } = await blameRepo(dir, { matcher: (p) => p === 'f.txt' });
  assert.equal(files[0].lines.get(h1), 2, 'the ignored reformat commit is blamed through to the original');

  writeFile(dir, '.git-blame-ignore-revs', 'not-a-revision\n');
  const recovered = await blameRepo(dir, { matcher: (p) => p === 'f.txt' });
  assert.equal(recovered.files.length, 1);
  assert.equal(recovered.files[0].lines.get(h2), 1);
});

test('readNumstat reports added/deleted lines per commit on HEAD, honouring --since and --until', async (t) => {
  const dir = initRepo();
  t.after(() => removeDir(dir));
  writeFile(dir, 'a.txt', 'one\ntwo\n');
  const h1 = commitAll(dir, 'First\n', { date: '2026-01-10T00:00:00Z' });
  writeFile(dir, 'a.txt', 'one\ntwo\nthree\n');
  writeFile(dir, 'img.bin', Buffer.from([0, 1, 2]));
  const h2 = commitAll(dir, 'Second\n', { date: '2026-02-10T00:00:00Z' });

  const all = await readNumstat(dir);
  assert.deepEqual(all.map((c) => c.hash), [h2, h1]);
  assert.deepEqual(all[1].files, [{ added: 2, deleted: 0, path: 'a.txt', binary: false }]);
  assert.deepEqual(all[0].files, [
    { added: 1, deleted: 0, path: 'a.txt', binary: false },
    { added: 0, deleted: 0, path: 'img.bin', binary: true },
  ]);

  const since = await readNumstat(dir, { since: '2026-02-01' });
  assert.deepEqual(since.map((c) => c.hash), [h2]);
  const until = await readNumstat(dir, { until: '2026-02-01' });
  assert.deepEqual(until.map((c) => c.hash), [h1]);
});

test('readCommits leaves stash entries out of the commit set', async (t) => {
  const dir = initRepo();
  t.after(() => removeDir(dir));
  writeFile(dir, 'a.txt', 'one\n');
  const h1 = commitAll(dir, 'First\n');
  writeFile(dir, 'a.txt', 'one\ntwo\n');
  run(dir, ['stash', 'push', '-q', '-m', 'wip']);
  const commits = await readCommits(dir);
  assert.deepEqual(commits.map((c) => c.hash), [h1]);
});
