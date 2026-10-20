/**
 * Turn per-file blame counts plus per-commit classifications into the report
 * model: totals, per-agent breakdown, per-path and per-author tables.
 * Pure: no I/O.
 */
import { ZERO_HASH } from './git.js';

export const SCHEMA_VERSION = 1;

function emptyCounts() {
  return { lines: 0, ai: 0, human: 0, bot: 0, uncommitted: 0, unknown: 0, agents: {} };
}

function addCounts(target, src) {
  target.lines += src.lines;
  target.ai += src.ai;
  target.human += src.human;
  target.bot += src.bot;
  target.uncommitted += src.uncommitted;
  target.unknown += src.unknown;
  for (const [id, n] of Object.entries(src.agents)) target.agents[id] = (target.agents[id] ?? 0) + n;
}

/** Directory bucket for a path at the given depth (0 = whole tree). */
export function bucketPath(filePath, depth) {
  if (depth <= 0) return '.';
  const parts = filePath.split('/');
  if (parts.length - 1 < depth) return filePath;
  return `${parts.slice(0, depth).join('/')}/`;
}

export function share(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * @param {object} input
 * @param {Array<{path: string, lines: Map<string, number>}>} input.files
 * @param {Map<string, {commit: object, classification: object}>} input.commitIndex
 * @param {Record<string, string>} input.labels agent id -> display label
 * @param {boolean} [input.ignoreBots=true] exclude bot lines from the denominator
 * @param {number} [input.depth=1]
 * @param {boolean} [input.perFile=false]
 */
export function aggregate({ files, commitIndex, labels = {}, ignoreBots = true, depth = 1, perFile = false }) {
  const totals = emptyCounts();
  const fileRows = [];

  for (const file of files) {
    const counts = emptyCounts();
    for (const [hash, n] of file.lines) {
      counts.lines += n;
      if (hash === ZERO_HASH) {
        counts.uncommitted += n;
        counts.human += n;
        continue;
      }
      const entry = commitIndex.get(hash);
      if (!entry) {
        counts.unknown += n;
        counts.human += n;
        continue;
      }
      const c = entry.classification;
      if (c.kind === 'agent') {
        counts.ai += n;
        for (const id of c.agents) counts.agents[id] = (counts.agents[id] ?? 0) + n;
      } else if (c.kind === 'bot') {
        counts.bot += n;
      } else {
        counts.human += n;
      }
    }
    fileRows.push({ path: file.path, ...counts });
    addCounts(totals, counts);
  }

  const denominator = (c) => c.lines - (ignoreBots ? c.bot : 0);

  // Per-path table
  const buckets = new Map();
  for (const row of fileRows) {
    const key = perFile ? row.path : bucketPath(row.path, depth);
    if (!buckets.has(key)) buckets.set(key, { path: key, files: 0, ...emptyCounts() });
    const b = buckets.get(key);
    b.files += 1;
    addCounts(b, row);
  }
  const byPath = [...buckets.values()].map((b) => ({
    path: b.path,
    files: b.files,
    lines: b.lines,
    counted: denominator(b),
    ai: b.ai,
    human: b.human,
    bot: b.bot,
    share: share(b.ai, denominator(b)),
  }));
  byPath.sort((a, b) => b.share - a.share || b.lines - a.lines || (a.path < b.path ? -1 : 1));

  // Per-author table (keyed by e-mail, falling back to name)
  const authors = new Map();
  for (const file of files) {
    for (const [hash, n] of file.lines) {
      const entry = commitIndex.get(hash);
      if (!entry) continue;
      const { commit, classification } = entry;
      const email = (commit.authorEmail ?? '').trim().toLowerCase();
      const key = email || (commit.authorName ?? '').trim().toLowerCase();
      if (!key) continue;
      if (!authors.has(key)) {
        authors.set(key, {
          name: commit.authorName,
          email: commit.authorEmail,
          kind: classification.authorKind,
          lines: 0,
          ai: 0,
          agents: {},
          names: new Map(),
        });
      }
      const a = authors.get(key);
      a.lines += n;
      a.names.set(commit.authorName, (a.names.get(commit.authorName) ?? 0) + n);
      if (classification.kind === 'agent') {
        a.ai += n;
        for (const id of classification.agents) a.agents[id] = (a.agents[id] ?? 0) + n;
      }
    }
  }
  // Several display names on one e-mail: show the one that carries the most lines.
  const byAuthor = [...authors.values()]
    .map(({ names, ...a }) => ({
      ...a,
      name: [...names.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0],
      share: share(a.ai, a.lines),
    }))
    .sort((a, b) => b.lines - a.lines || (a.name < b.name ? -1 : 1));

  // Per-agent breakdown (lines and commit counts)
  const commitsByAgent = {};
  let aiCommits = 0;
  let botCommits = 0;
  let humanCommits = 0;
  for (const { classification } of commitIndex.values()) {
    if (classification.kind === 'agent') {
      aiCommits += 1;
      for (const id of classification.agents) commitsByAgent[id] = (commitsByAgent[id] ?? 0) + 1;
    } else if (classification.kind === 'bot') botCommits += 1;
    else humanCommits += 1;
  }
  const agentIds = new Set([...Object.keys(totals.agents), ...Object.keys(commitsByAgent)]);
  const agents = [...agentIds]
    .map((id) => ({
      id,
      label: labels[id] ?? id,
      lines: totals.agents[id] ?? 0,
      share: share(totals.agents[id] ?? 0, denominator(totals)),
      commits: commitsByAgent[id] ?? 0,
    }))
    .sort((a, b) => b.lines - a.lines || b.commits - a.commits || (a.id < b.id ? -1 : 1));

  return {
    totals: {
      files: files.length,
      lines: totals.lines,
      counted: denominator(totals),
      ai: totals.ai,
      human: totals.human,
      bot: totals.bot,
      uncommitted: totals.uncommitted,
      unknown: totals.unknown,
      aiShare: share(totals.ai, denominator(totals)),
      commits: commitIndex.size,
      aiCommits,
      humanCommits,
      botCommits,
    },
    agents,
    byPath,
    byAuthor,
    files: fileRows,
  };
}
