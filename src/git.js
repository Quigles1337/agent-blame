/**
 * Git plumbing: commit log, file listing, blame and numstat, plus a small
 * worker pool so blame can run several child processes at once.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseTrailers } from './classify.js';

const NUL = '\0';
const US = '\x1f';
export const ZERO_HASH = '0'.repeat(40);

/**
 * Run git and collect stdout as a Buffer. Rejects with a descriptive error on
 * a non-zero exit unless `allowFailure` is set, in which case the result
 * carries `code` and `stderr`.
 */
export function git(args, { cwd, allowFailure = false, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env },
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (e) => {
      if (e.code === 'ENOENT') reject(new Error('git executable not found on PATH'));
      else reject(e);
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (code !== 0 && !allowFailure) {
        reject(new Error(`git ${args.slice(0, 3).join(' ')} failed (exit ${code})${stderr ? `: ${stderr}` : ''}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

/** Absolute path of the repository that contains `dir`, or null. */
export async function repoRoot(dir) {
  const r = await git(['rev-parse', '--show-toplevel'], { cwd: dir, allowFailure: true });
  if (r.code !== 0) return null;
  return r.stdout.toString('utf8').trim().replace(/\//g, path.sep);
}

const LOG_FORMAT = ['%H', '%an', '%ae', '%cn', '%ce', '%aI', '%cI', '%s', '%b', '%(trailers:only,unfold)'].join('%x1f');

/** Parse the `-z` separated output of `git log --format=LOG_FORMAT`. */
export function parseLog(text) {
  const commits = [];
  for (const record of String(text).split(NUL)) {
    if (!record.trim()) continue;
    const f = record.split(US);
    if (f.length < 10 || !/^[0-9a-f]{40}$/.test(f[0])) continue;
    commits.push({
      hash: f[0],
      authorName: f[1],
      authorEmail: f[2],
      committerName: f[3],
      committerEmail: f[4],
      authorDate: f[5],
      committerDate: f[6],
      subject: f[7],
      body: f[8],
      trailers: parseTrailers(f.slice(9).join(US)),
    });
  }
  return commits;
}

/**
 * Every commit reachable from any ref, as parsed commit objects. Stash
 * entries and notes are not part of the project's history and are left out.
 */
export async function readCommits(root) {
  const args = ['log', '--exclude=refs/stash', '--exclude=refs/notes/*', '--all', '-z', `--format=${LOG_FORMAT}`];
  const r = await git(args, { cwd: root, allowFailure: true });
  if (r.code !== 0) {
    if (/does not have any commits|bad default revision|unknown revision/i.test(r.stderr)) return [];
    throw new Error(`git log failed (exit ${r.code}): ${r.stderr}`);
  }
  return parseLog(r.stdout.toString('utf8'));
}

/**
 * Tracked regular files (mode 100644/100755) under `subdir`, as repo-relative
 * forward-slash paths. Symlinks and submodules are skipped.
 */
export async function listFiles(root, subdir = '') {
  const args = ['ls-files', '-z', '-s'];
  if (subdir && subdir !== '.') args.push('--', subdir);
  const r = await git(args, { cwd: root });
  const files = [];
  for (const entry of r.stdout.toString('utf8').split(NUL)) {
    if (!entry) continue;
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const [mode] = entry.slice(0, tab).split(' ');
    const filePath = entry.slice(tab + 1);
    if (mode === '100644' || mode === '100755') files.push(filePath);
  }
  return files;
}

/**
 * Decide whether a file should be blamed. Returns `{skip: false}` or
 * `{skip: true, reason}` where reason is `binary`, `too-large` or `missing`.
 */
export async function inspectFile(absPath, { maxFileSize = 2 * 1024 * 1024, probeBytes = 8192 } = {}) {
  let stat;
  try {
    stat = await fsp.stat(absPath);
  } catch {
    return { skip: true, reason: 'missing' };
  }
  if (!stat.isFile()) return { skip: true, reason: 'missing' };
  if (stat.size > maxFileSize) return { skip: true, reason: 'too-large', size: stat.size };
  if (stat.size === 0) return { skip: false, size: 0 };
  const fh = await fsp.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(probeBytes, stat.size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (buf.subarray(0, bytesRead).includes(0)) return { skip: true, reason: 'binary', size: stat.size };
  } finally {
    await fh.close();
  }
  return { skip: false, size: stat.size };
}

/**
 * Count blamed lines per commit from `git blame --porcelain` or
 * `--line-porcelain` output. Only the `<40-hex> <orig> <final> [<n>]` header
 * lines are consulted; in both formats every blamed line has one, so the
 * count of headers is the count of lines. Content lines are tab-prefixed and
 * can never match.
 */
export function parseBlamePorcelain(text) {
  const counts = new Map();
  const re = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

/** Path of `.git-blame-ignore-revs` in the repo root, if it exists. */
export function findIgnoreRevsFile(root) {
  const candidate = path.join(root, '.git-blame-ignore-revs');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Blame one file. Resolves to `{lines: Map<hash, count>}` or `{error}` when
 * git could not blame the file (for example a path only present in the
 * index). An unusable ignore-revs file is retried without it.
 */
export async function blameFile(root, filePath, { ignoreRevsFile = null } = {}) {
  const base = ['blame', '--porcelain'];
  const attempt = async (withIgnore) => {
    const args = [...base];
    if (withIgnore && ignoreRevsFile) args.push('--ignore-revs-file', ignoreRevsFile);
    args.push('--', filePath);
    return git(args, { cwd: root, allowFailure: true });
  };
  let r = await attempt(true);
  if (r.code !== 0 && ignoreRevsFile) r = await attempt(false);
  if (r.code !== 0) return { error: r.stderr || `exit ${r.code}` };
  return { lines: parseBlamePorcelain(r.stdout.toString('utf8')) };
}

/**
 * Unquote a C-style quoted git path (`"caf\303\251.txt"`), returning other
 * strings unchanged.
 */
export function unquotePath(p) {
  if (!(p.length >= 2 && p.startsWith('"') && p.endsWith('"'))) return p;
  const inner = p.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = inner[i + 1];
    if (/[0-7]/.test(next ?? '')) {
      const oct = inner.slice(i + 1, i + 4);
      bytes.push(parseInt(oct, 8));
      i += oct.length;
    } else {
      const map = { n: 10, t: 9, r: 13, '\\': 92, '"': 34, a: 7, b: 8, f: 12, v: 11 };
      bytes.push(map[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Resolve a rename path (`src/{old => new}.js`, `old => new`) to the new name. */
export function renameTarget(p) {
  if (p.includes('{') && p.includes(' => ')) {
    return p.replace(/\{([^{}]*) => ([^{}]*)\}/g, '$2').replace(/\/{2,}/g, '/');
  }
  if (p.includes(' => ')) return p.slice(p.indexOf(' => ') + 4);
  return p;
}

const NUMSTAT_LOG_FORMAT = '%x01%H%x1f%cI';

/**
 * Parse `git log --numstat --format=%x01%H%x1f%cI` output into
 * `[{hash, date, files: [{added, deleted, path, binary}]}]`. Binary entries
 * (`-\t-\tpath`) are kept with `binary: true` and zero counts; renames are
 * recorded under the new path.
 */
export function parseNumstatLog(text) {
  const commits = [];
  let current = null;
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('\x01')) {
      const [hash, date] = line.slice(1).split(US);
      current = { hash, date: date ?? '', files: [] };
      commits.push(current);
      continue;
    }
    if (!current || !line) continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const binary = m[1] === '-' || m[2] === '-';
    commits[commits.length - 1].files.push({
      added: binary ? 0 : Number(m[1]),
      deleted: binary ? 0 : Number(m[2]),
      path: renameTarget(unquotePath(m[3])),
      binary,
    });
  }
  return commits;
}

/** Commits reachable from HEAD (no merges) with per-file numstat. */
export async function readNumstat(root, { since = null, until = null } = {}) {
  const args = ['log', 'HEAD', '--no-merges', '--numstat', `--format=${NUMSTAT_LOG_FORMAT}`];
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);
  const r = await git(args, { cwd: root, allowFailure: true });
  if (r.code !== 0) {
    if (/does not have any commits|bad default revision|unknown revision|ambiguous argument 'HEAD'/i.test(r.stderr)) return [];
    throw new Error(`git log --numstat failed (exit ${r.code}): ${r.stderr}`);
  }
  return parseNumstatLog(r.stdout.toString('utf8'));
}

/** Map `items` through `worker` with at most `concurrency` in flight; results keep input order. */
export async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(concurrency | 0, items.length || 1));
  async function lane() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, lane));
  return results;
}

/**
 * Blame every eligible tracked file under `root`. Returns
 * `{files: [{path, lines, size}], skipped: [{path, reason}]}`.
 */
export async function blameRepo(root, {
  subdir = '',
  matcher = () => true,
  maxFileSize = 2 * 1024 * 1024,
  jobs = 4,
  ignoreRevsFile = findIgnoreRevsFile(root),
  onProgress = null,
} = {}) {
  const all = await listFiles(root, subdir);
  const candidates = all.filter((p) => matcher(p));
  const skipped = [];
  const files = [];
  let done = 0;
  await mapPool(candidates, jobs, async (filePath) => {
    const abs = path.join(root, ...filePath.split('/'));
    const info = await inspectFile(abs, { maxFileSize });
    if (info.skip) {
      skipped.push({ path: filePath, reason: info.reason });
    } else {
      const result = await blameFile(root, filePath, { ignoreRevsFile });
      if (result.error) skipped.push({ path: filePath, reason: 'blame-failed', detail: result.error });
      else files.push({ path: filePath, lines: result.lines, size: info.size });
    }
    done += 1;
    if (onProgress) onProgress(done, candidates.length, filePath);
  });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, skipped, ignoreRevsFile };
}
