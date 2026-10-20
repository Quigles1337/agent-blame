/**
 * Pull-request mode: classify only the commits in a revision range
 * (`<base>..<head>`) and measure the share of ADDED lines that came from
 * agent-assisted commits. Nothing is blamed; the numbers come from
 * `git log --numstat <range>`.
 */
import { parseTrailers } from './classify.js';
import { git, renameTarget, unquotePath } from './git.js';

const US = '\x1f';
const RECORD_START = '\x01';
const HEADER_END = '\x02';

const RANGE_LOG_FORMAT =
  '%x01' + ['%H', '%an', '%ae', '%cn', '%ce', '%aI', '%cI', '%s', '%b', '%(trailers:only,unfold)'].join('%x1f') + '%x02';

/**
 * Normalise a range specification. `a..b` is kept, a single revision `a`
 * becomes `a..HEAD`. `--base`/`--head` are combined the same way.
 */
export function resolveRangeSpec({ range, base, head } = {}) {
  if (range !== undefined && range !== null && range !== '') {
    if (base || head) throw new Error('--range cannot be combined with --base/--head');
    const spec = String(range).trim();
    if (!spec) throw new Error('--range expects <base>..<head>');
    if (spec.includes('...')) throw new Error(`--range expects <base>..<head> (two dots), got ${JSON.stringify(spec)}`);
    if (!spec.includes('..')) return { spec: `${spec}..HEAD`, base: spec, head: 'HEAD' };
    const [b, h] = spec.split('..');
    if (!b) throw new Error(`--range needs a base revision before "..": ${JSON.stringify(spec)}`);
    return { spec: `${b}..${h || 'HEAD'}`, base: b, head: h || 'HEAD' };
  }
  if (head && !base) throw new Error('--head requires --base');
  if (!base) return null;
  return { spec: `${base}..${head || 'HEAD'}`, base, head: head || 'HEAD' };
}

/**
 * Parse the output of `git log --numstat --format=RANGE_LOG_FORMAT`: each
 * record is `\x01<fields separated by \x1f>\x02` followed by numstat lines
 * until the next record. Binary entries (`-\t-\tpath`) are kept with
 * `binary: true` and zero counts; renames are recorded under the new path.
 */
export function parseRangeLog(text) {
  const commits = [];
  for (const record of String(text).split(RECORD_START)) {
    if (!record.trim()) continue;
    const end = record.indexOf(HEADER_END);
    if (end < 0) continue;
    const f = record.slice(0, end).split(US);
    if (f.length < 10 || !/^[0-9a-f]{40}$/.test(f[0])) continue;
    const files = [];
    for (const rawLine of record.slice(end + 1).split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      const binary = m[1] === '-' || m[2] === '-';
      files.push({
        added: binary ? 0 : Number(m[1]),
        deleted: binary ? 0 : Number(m[2]),
        path: renameTarget(unquotePath(m[3])),
        binary,
      });
    }
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
      files,
    });
  }
  return commits;
}

/**
 * The non-merge commits in `spec` (newest first), each with its identities,
 * trailers and per-file numstat. Throws when a revision does not resolve.
 */
export async function readRange(root, spec) {
  const args = ['log', '--no-merges', '--numstat', `--format=${RANGE_LOG_FORMAT}`, spec, '--'];
  const r = await git(args, { cwd: root, allowFailure: true });
  if (r.code !== 0) {
    const m = /(?:bad revision|unknown revision|ambiguous argument) '([^']*)'/i.exec(r.stderr);
    if (m) throw new Error(`unknown revision ${JSON.stringify(m[1])} in range ${spec}`);
    throw new Error(`git log ${spec} failed (exit ${r.code}): ${r.stderr}`);
  }
  return parseRangeLog(r.stdout.toString('utf8'));
}

/** Short hash of a revision, or null when it does not resolve. */
export async function shortRev(root, rev) {
  const r = await git(['rev-parse', '--short', '--verify', '--quiet', `${rev}^{commit}`], { cwd: root, allowFailure: true });
  return r.code === 0 ? r.stdout.toString('utf8').trim() : null;
}

/**
 * Turn the range commits into the inputs of aggregate(): one pseudo-file
 * per touched path whose "lines" are the lines each commit added to it,
 * plus a commit index limited to the range. Binary entries are reported as
 * skipped; paths outside `matcher` are ignored.
 */
export function collectRange(commits, classify, { matcher = () => true } = {}) {
  const byPath = new Map();
  const commitIndex = new Map();
  const skipped = new Map();
  const rows = [];
  for (const commit of commits) {
    const classification = classify(commit);
    commitIndex.set(commit.hash, { commit, classification });
    let added = 0;
    let touched = 0;
    for (const f of commit.files) {
      if (!matcher(f.path)) continue;
      if (f.binary) {
        skipped.set(f.path, { path: f.path, reason: 'binary' });
        continue;
      }
      touched += 1;
      added += f.added;
      if (!byPath.has(f.path)) byPath.set(f.path, new Map());
      const lines = byPath.get(f.path);
      lines.set(commit.hash, (lines.get(commit.hash) ?? 0) + f.added);
    }
    rows.push({
      hash: commit.hash,
      short: commit.hash.slice(0, 7),
      subject: commit.subject,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      date: commit.committerDate,
      kind: classification.kind,
      agents: classification.agents,
      evidence: classification.evidence,
      added,
      files: touched,
    });
  }
  const files = [...byPath.entries()].map(([p, lines]) => ({ path: p, lines })).sort((a, b) => (a.path < b.path ? -1 : 1));
  const skippedList = [...skipped.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, commitIndex, commits: rows, skipped: skippedList };
}

/** Restrict a matcher to paths below `subdir` (the scope given on the command line). */
export function scopedMatcher(subdir, matcher) {
  if (!subdir) return matcher;
  return (p) => p.startsWith(`${subdir}/`) && matcher(p);
}
