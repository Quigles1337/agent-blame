/**
 * `--explain <file>`: every commit that touched one file, with the evidence
 * behind its classification, so a disputed number can be traced to the
 * commits and trailers that produced it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClassifier } from './classify.js';
import { loadConfig } from './config.js';
import { blameFile, findIgnoreRevsFile, git, repoRoot, ZERO_HASH } from './git.js';
import { parseRangeLog } from './range.js';
import { TOOL } from './analyze.js';
import { SCHEMA_VERSION } from './aggregate.js';

const LOG_FORMAT = '%x01' + ['%H', '%an', '%ae', '%cn', '%ce', '%aI', '%cI', '%s', '%b', '%(trailers:only,unfold)'].join('%x1f') + '%x02';

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Every commit on HEAD that touched `filePath` (renames followed), newest first, with numstat. */
export async function readFileLog(root, filePath) {
  const r = await git(['log', '--follow', '--numstat', `--format=${LOG_FORMAT}`, '--', filePath], { cwd: root, allowFailure: true });
  if (r.code !== 0) {
    if (/does not have any commits|bad default revision|unknown revision/i.test(r.stderr)) return [];
    throw new Error(`git log failed (exit ${r.code}): ${r.stderr}`);
  }
  return parseRangeLog(r.stdout.toString('utf8'));
}

/**
 * Why a commit was (or was not) classified as agent-assisted, as a list of
 * human-readable reasons. Agent commits list their evidence; human commits
 * list what was checked and found wanting; bot commits name the matching
 * author.
 */
export function explainClassification(commit, classification, labels = {}) {
  const reasons = [];
  if (classification.kind === 'agent') {
    for (const ev of classification.evidence) {
      reasons.push(`${ev.source}: ${ev.value} (${labels[ev.agent] ?? ev.agent})`);
    }
    return reasons;
  }
  if (classification.kind === 'bot') {
    reasons.push(`author ${commit.authorName} <${commit.authorEmail}> matches a bot pattern; no agent evidence`);
    return reasons;
  }
  reasons.push(`author ${commit.authorName} <${commit.authorEmail}> matches no agent or bot pattern`);
  const coauthors = (commit.trailers ?? []).filter((t) => /^(co-authored-by|assisted-by|ai-assisted-by|generated-by|ai-generated-by|ai-agent)$/i.test(t.key));
  if (coauthors.length === 0) reasons.push('no Co-Authored-By or AI-assistance trailer');
  for (const t of coauthors) reasons.push(`${t.key}: ${t.value} matches no agent pattern`);
  reasons.push('no message marker');
  return reasons;
}

/**
 * @param {object} opts
 * @param {string} opts.file          the file, relative to opts.path (or absolute)
 * @param {string} [opts.path='.']    repository, or a directory inside one
 * @param {string} [opts.config]
 * @param {boolean} [opts.defaultPatterns=true]
 * @param {boolean} [opts.ignoreBots]
 */
export async function explainFile(opts = {}) {
  if (!opts.file) throw new Error('--explain needs a file');
  const target = path.resolve(opts.path ?? '.');
  if (!fs.existsSync(target)) throw new Error(`path does not exist: ${target}`);
  const root = await repoRoot(target);
  if (!root) throw new Error(`not a git repository: ${target}`);
  const base = fs.statSync(target).isDirectory() ? target : path.dirname(target);
  let abs = path.resolve(base, opts.file);
  if (!fs.existsSync(abs) && fs.existsSync(path.resolve(opts.file))) abs = path.resolve(opts.file);
  const rel = toPosix(path.relative(root, abs));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${opts.file} is outside the repository ${root}`);
  const tracked = await git(['ls-files', '--error-unmatch', '--', rel], { cwd: root, allowFailure: true });
  if (tracked.code !== 0) throw new Error(`${rel} is not tracked by git`);

  const config = loadConfig(root, opts.config);
  const defaultPatterns = opts.defaultPatterns ?? true;
  const ignoreBots = opts.ignoreBots ?? config.ignoreBots;
  const classify = createClassifier({ config, defaultPatterns });

  const log = await readFileLog(root, rel);
  const ignoreRevsFile = findIgnoreRevsFile(root);
  const blame = fs.existsSync(abs) ? await blameFile(root, rel, { ignoreRevsFile }) : { lines: new Map() };
  const surviving = blame.lines ?? new Map();

  const totals = { lines: 0, ai: 0, human: 0, bot: 0, uncommitted: 0, unknown: 0 };
  const known = new Map(log.map((c) => [c.hash, c]));
  for (const [hash, n] of surviving) {
    totals.lines += n;
    if (hash === ZERO_HASH) {
      totals.uncommitted += n;
      totals.human += n;
      continue;
    }
    const c = known.get(hash);
    if (!c) {
      totals.unknown += n;
      totals.human += n;
      continue;
    }
    const kind = classify(c).kind;
    if (kind === 'agent') totals.ai += n;
    else if (kind === 'bot') totals.bot += n;
    else totals.human += n;
  }
  const counted = totals.lines - (ignoreBots ? totals.bot : 0);

  const commits = log.map((c) => {
    const classification = classify(c);
    let added = 0;
    let deleted = 0;
    for (const f of c.files) {
      added += f.added;
      deleted += f.deleted;
    }
    return {
      hash: c.hash,
      short: c.hash.slice(0, 7),
      date: c.committerDate,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      subject: c.subject,
      kind: classification.kind,
      agents: classification.agents,
      evidence: classification.evidence,
      reasons: explainClassification(c, classification, classify.labels),
      added,
      deleted,
      surviving: surviving.get(c.hash) ?? 0,
    };
  });

  const head = await git(['rev-parse', '--short', 'HEAD'], { cwd: root, allowFailure: true });
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, allowFailure: true });
  return {
    version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    tool: TOOL,
    mode: 'explain',
    repo: {
      path: root,
      head: head.code === 0 ? head.stdout.toString('utf8').trim() : null,
      branch: branch.code === 0 ? branch.stdout.toString('utf8').trim() : null,
      subdir: null,
    },
    file: rel,
    options: { ignoreBots, defaultPatterns, config: config.path ? toPosix(path.relative(root, config.path)) : null },
    totals: { ...totals, counted, share: counted > 0 ? totals.ai / counted : 0 },
    commits,
    blameError: blame.error ?? null,
    ignoreRevsFile: ignoreRevsFile ? toPosix(path.relative(root, ignoreRevsFile)) : null,
  };
}
