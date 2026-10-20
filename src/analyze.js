/**
 * Orchestration: resolve the repository, load config, classify every commit,
 * blame every eligible file and assemble the report model. This is the
 * programmatic entry point (`import { analyze } from 'agent-blame'`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createClassifier } from './classify.js';
import { loadConfig, parseSize } from './config.js';
import { createMatcher } from './glob.js';
import { blameRepo, findIgnoreRevsFile, git, readCommits, readNumstat, repoRoot } from './git.js';
import { aggregate, SCHEMA_VERSION } from './aggregate.js';
import { bucketHistory } from './history.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const TOOL = Object.freeze({ name: pkg.name, version: pkg.version });

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * @param {object} [opts]
 * @param {string}  [opts.path='.']              repository, or a directory inside one (scopes the file list)
 * @param {string}  [opts.config]                explicit config file (default: .agent-blame.json in the repo root)
 * @param {boolean} [opts.defaultPatterns=true]  false: only config-defined agents and bots
 * @param {string[]} [opts.include]              extra include globs (appended to config)
 * @param {string[]} [opts.exclude]              extra exclude globs (appended to config)
 * @param {boolean} [opts.ignoreBots]            override config.ignoreBots
 * @param {number|string} [opts.maxFileSize]     override config.maxFileSize
 * @param {number}  [opts.depth]                 override config.depth
 * @param {boolean} [opts.perFile=false]
 * @param {boolean} [opts.byAuthor=false]
 * @param {boolean} [opts.history=false]
 * @param {boolean} [opts.weekly=false]
 * @param {string}  [opts.since]                 history only
 * @param {string}  [opts.until]                 history only
 * @param {number}  [opts.jobs=4]
 * @param {number|null} [opts.threshold]         override config.threshold
 * @param {(done: number, total: number, file: string) => void} [opts.onProgress]
 */
export async function analyze(opts = {}) {
  const target = path.resolve(opts.path ?? '.');
  if (!fs.existsSync(target)) throw new Error(`path does not exist: ${target}`);
  const root = await repoRoot(target);
  if (!root) throw new Error(`not a git repository: ${target}`);
  const subdir = toPosix(path.relative(root, fs.realpathSync.native(target))).replace(/^\.$/, '');

  const config = loadConfig(root, opts.config);
  const defaultPatterns = opts.defaultPatterns ?? true;
  const ignoreBots = opts.ignoreBots ?? config.ignoreBots;
  const maxFileSize = opts.maxFileSize !== undefined ? parseSize(opts.maxFileSize, '--max-file-size') : config.maxFileSize;
  const depth = opts.depth ?? config.depth;
  const include = [...config.include, ...(opts.include ?? [])];
  const exclude = [...config.exclude, ...(opts.exclude ?? [])];
  const threshold = opts.threshold !== undefined ? opts.threshold : config.threshold;
  const jobs = Math.max(1, opts.jobs ?? 4);

  const classify = createClassifier({ config, defaultPatterns });
  const matcher = createMatcher({ include, exclude });

  const commits = await readCommits(root);
  const commitIndex = new Map();
  for (const commit of commits) commitIndex.set(commit.hash, { commit, classification: classify(commit) });

  const ignoreRevsFile = findIgnoreRevsFile(root);
  const { files, skipped } = await blameRepo(root, {
    subdir,
    matcher,
    maxFileSize,
    jobs,
    ignoreRevsFile,
    onProgress: opts.onProgress ?? null,
  });

  const agg = aggregate({ files, commitIndex, labels: classify.labels, ignoreBots, depth, perFile: Boolean(opts.perFile) });

  let history = null;
  if (opts.history) {
    const numstat = await readNumstat(root, { since: opts.since ?? null, until: opts.until ?? null });
    const scoped = subdir ? (p) => p.startsWith(`${subdir}/`) && matcher(p) : matcher;
    history = {
      granularity: opts.weekly ? 'week' : 'month',
      since: opts.since ?? null,
      until: opts.until ?? null,
      periods: bucketHistory(numstat, commitIndex, { weekly: Boolean(opts.weekly), matcher: scoped, ignoreBots }),
    };
  }

  const head = await git(['rev-parse', '--short', 'HEAD'], { cwd: root, allowFailure: true });
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, allowFailure: true });

  const byReason = {};
  for (const s of skipped) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;

  return {
    version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    tool: TOOL,
    repo: {
      path: root,
      head: head.code === 0 ? head.stdout.toString('utf8').trim() : null,
      branch: branch.code === 0 ? branch.stdout.toString('utf8').trim() : null,
      subdir: subdir || null,
    },
    options: {
      ignoreBots,
      defaultPatterns,
      depth,
      perFile: Boolean(opts.perFile),
      include,
      exclude,
      maxFileSize,
      config: config.path ? toPosix(path.relative(root, config.path)) : null,
    },
    totals: agg.totals,
    agents: agg.agents,
    byPath: agg.byPath,
    byAuthor: opts.byAuthor ? agg.byAuthor : null,
    history,
    skipped: { count: skipped.length, byReason, files: skipped },
    ignoreRevsFile: ignoreRevsFile ? toPosix(path.relative(root, ignoreRevsFile)) : null,
    threshold: threshold ?? null,
  };
}
