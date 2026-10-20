/**
 * Report rendering: text (with optional ANSI colour), GitHub-flavoured
 * Markdown, and the stable JSON document. Pure functions of the model
 * produced by analyze().
 */
import { sparkline } from './history.js';
import { SCHEMA_VERSION } from './aggregate.js';

const BAR_WIDTH = 20;

export function formatInt(n) {
  return Number(n).toLocaleString('en-US');
}

export function formatShare(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '-';
  return `${(x * 100).toFixed(digits)}%`;
}

export function bar(shareValue, width = BAR_WIDTH) {
  const v = Math.max(0, Math.min(1, Number(shareValue) || 0));
  const filled = Math.round(v * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function makeColors(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    blue: wrap(34, 39),
    cyan: wrap(36, 39),
    yellow: wrap(33, 39),
  };
}

/** Visible width of a string (ANSI escapes stripped, code points counted). */
function visibleWidth(s) {
  return [...String(s).replace(/\x1b\[[0-9;]*m/g, '')].length;
}

function padTo(s, width, align) {
  const gap = Math.max(0, width - visibleWidth(s));
  return align === 'r' ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}

/**
 * Render an aligned table. `columns` is `[{key, title, align}]`; cells are
 * taken from `rows[i][key]` (already formatted strings).
 */
export function table(rows, columns, { indent = '', gap = '  ', color } = {}) {
  const c = color ?? makeColors(false);
  const widths = columns.map((col) => Math.max(visibleWidth(col.title), ...rows.map((r) => visibleWidth(r[col.key] ?? ''))));
  const line = (cells, isHeader) =>
    indent +
    columns
      .map((col, i) => {
        const cell = padTo(cells[i] ?? '', widths[i], col.align ?? 'l');
        return isHeader ? c.bold(cell) : cell;
      })
      .join(gap)
      .replace(/\s+$/, '');
  const out = [line(columns.map((col) => col.title), true)];
  for (const r of rows) out.push(line(columns.map((col) => r[col.key] ?? ''), false));
  return out.join('\n');
}

function skippedSummary(skipped) {
  if (!skipped || skipped.count === 0) return null;
  const parts = Object.entries(skipped.byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${reason}`);
  return `${formatInt(skipped.count)} file${skipped.count === 1 ? '' : 's'} skipped (${parts.join(', ')})`;
}

/** The default human-readable report. */
export function renderText(model, { color = false } = {}) {
  if (model.mode === 'range') return renderRangeText(model, { color });
  const c = makeColors(color);
  const t = model.totals;
  const out = [];

  const where = [model.repo?.path, model.repo?.head ? `@ ${model.repo.head}` : null, model.repo?.branch && model.repo.branch !== 'HEAD' ? `(${model.repo.branch})` : null]
    .filter(Boolean)
    .join(' ');
  out.push(`${c.bold('agent-blame')} ${c.dim(where)}`);
  if (model.repo?.subdir) out.push(c.dim(`  scope: ${model.repo.subdir}/`));
  out.push('');

  const summaryRows = [
    { k: 'Lines (blame of the working tree)', v: formatInt(t.lines), s: '', b: '' },
    { k: '  AI-assisted', v: formatInt(t.ai), s: formatShare(t.aiShare), b: c.blue(bar(t.aiShare)) },
    { k: '  Human', v: formatInt(t.human - t.uncommitted), s: formatShare(t.counted ? (t.human - t.uncommitted) / t.counted : 0), b: '' },
  ];
  if (t.uncommitted > 0) summaryRows.push({ k: '  Uncommitted', v: formatInt(t.uncommitted), s: formatShare(t.counted ? t.uncommitted / t.counted : 0), b: c.dim('counted as human') });
  if (t.bot > 0) {
    summaryRows.push(
      model.options?.ignoreBots
        ? { k: '  Bot', v: formatInt(t.bot), s: '', b: c.dim('excluded from the share (dependabot, renovate, ...)') }
        : { k: '  Bot', v: formatInt(t.bot), s: formatShare(t.counted ? t.bot / t.counted : 0), b: c.dim('counted as non-AI (--no-ignore-bots)') },
    );
  }
  out.push(table(summaryRows, [{ key: 'k', title: 'Summary' }, { key: 'v', title: 'Lines', align: 'r' }, { key: 's', title: 'Share', align: 'r' }, { key: 'b', title: '' }], { color: c }));
  out.push('');

  if (model.agents.length > 0) {
    out.push(
      table(
        model.agents.map((a) => ({ k: `  ${a.label}`, v: formatInt(a.lines), s: formatShare(a.share), n: formatInt(a.commits) })),
        [{ key: 'k', title: 'By agent' }, { key: 'v', title: 'Lines', align: 'r' }, { key: 's', title: 'Share', align: 'r' }, { key: 'n', title: 'Commits', align: 'r' }],
        { color: c },
      ),
    );
    if (model.agents.length > 1) out.push(c.dim('  A commit that names several agents is counted under each of them.'));
    out.push('');
  }

  const commitLine = `${formatInt(t.commits)} commits across all refs: ${formatInt(t.aiCommits)} AI-assisted (${formatShare(t.commits ? t.aiCommits / t.commits : 0)}), ${formatInt(t.humanCommits)} human, ${formatInt(t.botCommits)} bot`;
  out.push(c.dim(commitLine));
  const sk = skippedSummary(model.skipped);
  if (sk) out.push(c.dim(sk));
  if (model.ignoreRevsFile) out.push(c.dim(`using ${model.ignoreRevsFile}`));
  out.push('');

  if (model.byPath.length > 0) {
    const pathTitle = model.options?.perFile ? 'File' : `Path (depth ${model.options?.depth ?? 1})`;
    out.push(
      table(
        model.byPath.map((p) => ({
          path: p.path,
          files: model.options?.perFile ? '' : formatInt(p.files),
          lines: formatInt(p.lines),
          ai: formatInt(p.ai),
          share: formatShare(p.share),
          bar: c.blue(bar(p.share)),
        })),
        [
          { key: 'path', title: pathTitle },
          ...(model.options?.perFile ? [] : [{ key: 'files', title: 'Files', align: 'r' }]),
          { key: 'lines', title: 'Lines', align: 'r' },
          { key: 'ai', title: 'AI-assisted', align: 'r' },
          { key: 'share', title: 'Share', align: 'r' },
          { key: 'bar', title: '' },
        ],
        { color: c },
      ),
    );
    out.push('');
  } else {
    out.push(c.dim('No blameable files.'));
    out.push('');
  }

  if (model.byAuthor) {
    out.push(
      table(
        model.byAuthor.map((a) => ({
          who: a.email ? `${a.name} <${a.email}>` : a.name,
          kind: a.kind === 'human' ? '' : c.dim(`(${a.kind})`),
          lines: formatInt(a.lines),
          ai: formatInt(a.ai),
          share: formatShare(a.share),
          bar: c.blue(bar(a.share)),
        })),
        [
          { key: 'who', title: 'Author' },
          { key: 'kind', title: '' },
          { key: 'lines', title: 'Lines', align: 'r' },
          { key: 'ai', title: 'AI-assisted', align: 'r' },
          { key: 'share', title: 'Share', align: 'r' },
          { key: 'bar', title: '' },
        ],
        { color: c },
      ),
    );
    out.push(c.dim('  Lines are credited to the commit author; the share is how many of them were agent-assisted.'));
    out.push('');
  }

  if (model.history) {
    const h = model.history;
    const label = h.granularity === 'week' ? 'Week' : 'Month';
    const shares = h.periods.map((p) => p.share);
    out.push(
      table(
        h.periods.map((p, i) => ({
          period: p.period,
          added: formatInt(p.added),
          ai: formatInt(p.ai),
          share: formatShare(p.share),
          spark: c.blue(sparkline([shares[i]])),
          commits: formatInt(p.commits),
        })),
        [
          { key: 'period', title: `${label} (added lines, HEAD history)` },
          { key: 'added', title: 'Added', align: 'r' },
          { key: 'ai', title: 'AI-assisted', align: 'r' },
          { key: 'share', title: 'Share', align: 'r' },
          { key: 'spark', title: '' },
          { key: 'commits', title: 'Commits', align: 'r' },
        ],
        { color: c },
      ),
    );
    if (h.periods.length > 0) out.push(`  Trend: ${c.blue(sparkline(shares))}`);
    const range = [h.since ? `since ${h.since}` : null, h.until ? `until ${h.until}` : null].filter(Boolean).join(', ');
    if (range) out.push(c.dim(`  ${range}`));
    out.push('');
  }

  if (model.threshold !== null && model.threshold !== undefined) {
    const exceeded = t.aiShare * 100 > model.threshold;
    out.push(
      exceeded
        ? c.yellow(`Threshold ${model.threshold}% exceeded: AI-assisted share is ${formatShare(t.aiShare)}.`)
        : c.dim(`Threshold ${model.threshold}% not exceeded (AI-assisted share ${formatShare(t.aiShare)}).`),
    );
    out.push('');
  }

  return out.join('\n').replace(/\n+$/, '\n');
}

/** One-line description of why a commit was classified the way it was. */
export function describeEvidence(commit, labels = {}) {
  if (commit.kind === 'agent') {
    const parts = [];
    for (const ev of commit.evidence ?? []) {
      const label = labels[ev.agent] ?? ev.agent;
      parts.push(`${label} via ${ev.source}`);
    }
    return [...new Set(parts)].join(', ') || 'agent';
  }
  if (commit.kind === 'bot') return `bot author ${commit.authorName}`;
  return 'no agent evidence';
}

/** Short classification label for a commit row. */
export function kindLabel(kind) {
  return kind === 'agent' ? 'AI-assisted' : kind === 'bot' ? 'bot' : 'human';
}

function rangeTitle(model) {
  const r = model.range ?? {};
  const resolved = r.baseHash && r.headHash ? ` (${r.baseHash}..${r.headHash})` : '';
  return `${r.spec ?? ''}${resolved}`;
}

/** Text report for pull-request mode (`--range`). */
export function renderRangeText(model, { color = false } = {}) {
  const c = makeColors(color);
  const t = model.totals;
  const labels = Object.fromEntries((model.agents ?? []).map((a) => [a.id, a.label]));
  const out = [];

  out.push(`${c.bold('agent-blame')} ${c.dim(model.repo?.path ?? '')} ${c.dim(`range ${rangeTitle(model)}`)}`);
  if (model.repo?.subdir) out.push(c.dim(`  scope: ${model.repo.subdir}/`));
  out.push('');

  if (t.commits === 0) {
    out.push(c.dim('No commits in the range.'));
    out.push('');
    return out.join('\n');
  }

  const summaryRows = [
    { k: 'Lines added by the commits in the range', v: formatInt(t.lines), s: '', b: '' },
    { k: '  AI-assisted', v: formatInt(t.ai), s: formatShare(t.aiShare), b: c.blue(bar(t.aiShare)) },
    { k: '  Human', v: formatInt(t.human), s: formatShare(t.counted ? t.human / t.counted : 0), b: '' },
  ];
  if (t.bot > 0) {
    summaryRows.push(
      model.options?.ignoreBots
        ? { k: '  Bot', v: formatInt(t.bot), s: '', b: c.dim('excluded from the share') }
        : { k: '  Bot', v: formatInt(t.bot), s: formatShare(t.counted ? t.bot / t.counted : 0), b: c.dim('counted as non-AI (--no-ignore-bots)') },
    );
  }
  out.push(table(summaryRows, [{ key: 'k', title: 'Summary' }, { key: 'v', title: 'Lines', align: 'r' }, { key: 's', title: 'Share', align: 'r' }, { key: 'b', title: '' }], { color: c }));
  out.push('');

  if (model.agents.length > 0) {
    out.push(
      table(
        model.agents.map((a) => ({ k: `  ${a.label}`, v: formatInt(a.lines), s: formatShare(a.share), n: formatInt(a.commits) })),
        [{ key: 'k', title: 'By agent' }, { key: 'v', title: 'Lines', align: 'r' }, { key: 's', title: 'Share', align: 'r' }, { key: 'n', title: 'Commits', align: 'r' }],
        { color: c },
      ),
    );
    out.push('');
  }

  out.push(c.dim(`${formatInt(t.commits)} commits in the range: ${formatInt(t.aiCommits)} AI-assisted (${formatShare(t.commits ? t.aiCommits / t.commits : 0)}), ${formatInt(t.humanCommits)} human, ${formatInt(t.botCommits)} bot`));
  const sk = skippedSummary(model.skipped);
  if (sk) out.push(c.dim(sk.replace('skipped', 'not counted')));
  if (t.lines === 0) out.push(c.dim('No text lines were added in the range.'));
  out.push('');

  if (model.byPath.length > 0) {
    const pathTitle = model.options?.perFile ? 'File' : `Path (depth ${model.options?.depth ?? 1})`;
    out.push(
      table(
        model.byPath.map((p) => ({
          path: p.path,
          files: model.options?.perFile ? '' : formatInt(p.files),
          lines: formatInt(p.lines),
          ai: formatInt(p.ai),
          share: formatShare(p.share),
          bar: c.blue(bar(p.share)),
        })),
        [
          { key: 'path', title: pathTitle },
          ...(model.options?.perFile ? [] : [{ key: 'files', title: 'Files', align: 'r' }]),
          { key: 'lines', title: 'Added', align: 'r' },
          { key: 'ai', title: 'AI-assisted', align: 'r' },
          { key: 'share', title: 'Share', align: 'r' },
          { key: 'bar', title: '' },
        ],
        { color: c },
      ),
    );
    out.push('');
  }

  if (model.byAuthor) {
    out.push(
      table(
        model.byAuthor.map((a) => ({
          who: a.email ? `${a.name} <${a.email}>` : a.name,
          kind: a.kind === 'human' ? '' : c.dim(`(${a.kind})`),
          lines: formatInt(a.lines),
          ai: formatInt(a.ai),
          share: formatShare(a.share),
          bar: c.blue(bar(a.share)),
        })),
        [
          { key: 'who', title: 'Author' },
          { key: 'kind', title: '' },
          { key: 'lines', title: 'Added', align: 'r' },
          { key: 'ai', title: 'AI-assisted', align: 'r' },
          { key: 'share', title: 'Share', align: 'r' },
          { key: 'bar', title: '' },
        ],
        { color: c },
      ),
    );
    out.push('');
  }

  out.push(
    table(
      model.commits.map((cm) => ({
        hash: cm.short,
        date: String(cm.date ?? '').slice(0, 10),
        author: cm.authorName,
        kind: cm.kind === 'agent' ? c.blue(kindLabel(cm.kind)) : c.dim(kindLabel(cm.kind)),
        added: `+${formatInt(cm.added)}`,
        subject: cm.subject,
        why: c.dim(describeEvidence(cm, labels)),
      })),
      [
        { key: 'hash', title: 'Commit' },
        { key: 'date', title: 'Date' },
        { key: 'author', title: 'Author' },
        { key: 'kind', title: 'Class' },
        { key: 'added', title: 'Added', align: 'r' },
        { key: 'subject', title: 'Subject' },
        { key: 'why', title: 'Evidence' },
      ],
      { color: c },
    ),
  );
  out.push('');

  if (model.threshold !== null && model.threshold !== undefined) {
    const exceeded = t.aiShare * 100 > model.threshold;
    out.push(
      exceeded
        ? c.yellow(`Threshold ${model.threshold}% exceeded: AI-assisted share is ${formatShare(t.aiShare)}.`)
        : c.dim(`Threshold ${model.threshold}% not exceeded (AI-assisted share ${formatShare(t.aiShare)}).`),
    );
    out.push('');
  }

  return out.join('\n').replace(/\n+$/, '\n');
}

/** Markdown report for pull-request mode, written for a sticky PR comment. */
export function renderRangeMarkdown(model) {
  const t = model.totals;
  const labels = Object.fromEntries((model.agents ?? []).map((a) => [a.id, a.label]));
  const out = [];
  out.push('### AI-assisted code in this pull request');
  out.push('');
  if (t.commits === 0) {
    out.push(`No commits in the range \`${model.range?.spec ?? ''}\`.`);
    out.push('');
  } else {
    const botNote = t.bot > 0 && model.options?.ignoreBots ? `; ${formatInt(t.bot)} bot lines excluded` : '';
    const binary = model.skipped?.byReason?.binary ?? 0;
    const binaryNote = binary > 0 ? `; ${formatInt(binary)} binary file${binary === 1 ? '' : 's'} not counted` : '';
    out.push(
      `**${formatShare(t.aiShare)}** of ${formatInt(t.counted)} added lines come from agent-assisted commits (${formatInt(t.ai)} lines across ${formatInt(t.files)} files${botNote}${binaryNote}). ` +
        `${formatInt(t.aiCommits)} of ${formatInt(t.commits)} commits carry agent evidence.`,
    );
    out.push('');
    if (model.agents.length > 0) {
      out.push(mdTable(['Agent', 'Lines', 'Share', 'Commits'], ['l', 'r', 'r', 'r'], model.agents.map((a) => [a.label, formatInt(a.lines), formatShare(a.share), formatInt(a.commits)])));
      out.push('');
    }
    if (model.byPath.length > 0) {
      const headers = model.options?.perFile ? ['File', 'Added', 'AI-assisted', 'Share'] : ['Path', 'Files', 'Added', 'AI-assisted', 'Share'];
      const aligns = model.options?.perFile ? ['l', 'r', 'r', 'r'] : ['l', 'r', 'r', 'r', 'r'];
      out.push(
        mdTable(
          headers,
          aligns,
          model.byPath.map((p) =>
            model.options?.perFile
              ? [`\`${p.path}\``, formatInt(p.lines), formatInt(p.ai), formatShare(p.share)]
              : [`\`${p.path}\``, formatInt(p.files), formatInt(p.lines), formatInt(p.ai), formatShare(p.share)],
          ),
        ),
      );
      out.push('');
    }
    if (model.byAuthor) {
      out.push(
        mdTable(
          ['Author', 'Kind', 'Added', 'AI-assisted', 'Share'],
          ['l', 'l', 'r', 'r', 'r'],
          model.byAuthor.map((a) => [a.name, a.kind, formatInt(a.lines), formatInt(a.ai), formatShare(a.share)]),
        ),
      );
      out.push('');
    }
    out.push('<details>');
    out.push(`<summary>${formatInt(t.commits)} commit${t.commits === 1 ? '' : 's'}</summary>`);
    out.push('');
    out.push(
      mdTable(
        ['Commit', 'Class', 'Added', 'Subject', 'Evidence'],
        ['l', 'l', 'r', 'l', 'l'],
        model.commits.map((cm) => [`\`${cm.short}\``, kindLabel(cm.kind), `+${formatInt(cm.added)}`, cm.subject, describeEvidence(cm, labels)]),
      ),
    );
    out.push('');
    out.push('</details>');
    out.push('');
  }
  if (model.threshold !== null && model.threshold !== undefined) {
    const exceeded = t.aiShare * 100 > model.threshold;
    out.push(exceeded ? `**Threshold ${model.threshold}% exceeded.**` : `Threshold ${model.threshold}% not exceeded.`);
    out.push('');
  }
  const notes = [`range \`${model.range?.spec ?? ''}\``, 'added lines of non-merge commits', `Generated by agent-blame${model.generatedAt ? ` on ${model.generatedAt.slice(0, 10)}` : ''}`];
  out.push(`<sub>${notes.join(' · ')}</sub>`);
  out.push('');
  return out.join('\n');
}

function mdCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function mdTable(headers, aligns, rows) {
  const line = (cells) => `| ${cells.map(mdCell).join(' | ')} |`;
  const sep = `| ${aligns.map((a) => (a === 'r' ? '---:' : '---')).join(' | ')} |`;
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

/** GitHub-flavoured Markdown suitable for a PR comment, a README or $GITHUB_STEP_SUMMARY. */
export function renderMarkdown(model) {
  if (model.mode === 'range') return renderRangeMarkdown(model);
  const t = model.totals;
  const out = [];
  out.push('### AI-assisted code');
  out.push('');
  const botNote = t.bot > 0 && model.options?.ignoreBots ? `; ${formatInt(t.bot)} bot lines excluded` : '';
  out.push(
    `**${formatShare(t.aiShare)}** of ${formatInt(t.counted)} lines are AI-assisted (${formatInt(t.ai)} lines across ${formatInt(t.files)} files${botNote}). ` +
      `${formatInt(t.aiCommits)} of ${formatInt(t.commits)} commits carry agent evidence.`,
  );
  out.push('');
  if (model.agents.length > 0) {
    out.push(mdTable(['Agent', 'Lines', 'Share', 'Commits'], ['l', 'r', 'r', 'r'], model.agents.map((a) => [a.label, formatInt(a.lines), formatShare(a.share), formatInt(a.commits)])));
    out.push('');
  }
  if (model.byPath.length > 0) {
    const headers = model.options?.perFile ? ['File', 'Lines', 'AI-assisted', 'Share'] : ['Path', 'Files', 'Lines', 'AI-assisted', 'Share'];
    const aligns = model.options?.perFile ? ['l', 'r', 'r', 'r'] : ['l', 'r', 'r', 'r', 'r'];
    out.push(
      mdTable(
        headers,
        aligns,
        model.byPath.map((p) =>
          model.options?.perFile
            ? [`\`${p.path}\``, formatInt(p.lines), formatInt(p.ai), formatShare(p.share)]
            : [`\`${p.path}\``, formatInt(p.files), formatInt(p.lines), formatInt(p.ai), formatShare(p.share)],
        ),
      ),
    );
    out.push('');
  }
  if (model.byAuthor) {
    out.push(
      mdTable(
        ['Author', 'Kind', 'Lines', 'AI-assisted', 'Share'],
        ['l', 'l', 'r', 'r', 'r'],
        model.byAuthor.map((a) => [a.name, a.kind, formatInt(a.lines), formatInt(a.ai), formatShare(a.share)]),
      ),
    );
    out.push('');
  }
  if (model.history) {
    const label = model.history.granularity === 'week' ? 'Week' : 'Month';
    out.push(
      mdTable(
        [label, 'Added', 'AI-assisted', 'Share', 'Commits'],
        ['l', 'r', 'r', 'r', 'r'],
        model.history.periods.map((p) => [p.period, formatInt(p.added), formatInt(p.ai), formatShare(p.share), formatInt(p.commits)]),
      ),
    );
    out.push('');
    out.push(`Trend: \`${sparkline(model.history.periods.map((p) => p.share))}\``);
    out.push('');
  }
  const sk = skippedSummary(model.skipped);
  const notes = [sk, `Generated by agent-blame${model.generatedAt ? ` on ${model.generatedAt.slice(0, 10)}` : ''}`].filter(Boolean);
  out.push(`<sub>${notes.join(' · ')}</sub>`);
  out.push('');
  return out.join('\n');
}

const round = (x) => (x === null || x === undefined ? null : Math.round(x * 1e6) / 1e6);

/** The stable JSON document (schema version SCHEMA_VERSION). */
export function toJSON(model) {
  const doc = {
    version: SCHEMA_VERSION,
    generatedAt: model.generatedAt,
    tool: model.tool,
    repo: model.repo,
    options: model.options,
    totals: { ...model.totals, aiShare: round(model.totals.aiShare) },
    agents: model.agents.map((a) => ({ ...a, share: round(a.share) })),
    byPath: model.byPath.map((p) => ({ ...p, share: round(p.share) })),
    skipped: model.skipped,
  };
  if (model.mode === 'range') {
    doc.mode = 'range';
    doc.range = model.range;
    doc.commits = model.commits;
  }
  if (model.byAuthor) doc.byAuthor = model.byAuthor.map((a) => ({ ...a, share: round(a.share) }));
  if (model.history) doc.history = { ...model.history, periods: model.history.periods.map((p) => ({ ...p, share: round(p.share) })) };
  if (model.threshold !== null && model.threshold !== undefined) {
    doc.threshold = { limit: model.threshold, exceeded: model.totals.aiShare * 100 > model.threshold };
  }
  return doc;
}
