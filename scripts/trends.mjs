#!/usr/bin/env node
/**
 * AI co-authorship on GitHub over time.
 *
 * For each of the last N complete calendar months and each agent, asks the
 * GitHub commit search API how many indexed commits match that agent's
 * trailer, and writes docs/trends.json, docs/trends.md and docs/trends.svg,
 * plus the generated block in README.md. No dependencies; Node 20+.
 *
 *   GITHUB_TOKEN=... node scripts/trends.mjs            # full refresh
 *   TRENDS_MONTHS=6 TRENDS_AGENTS=aider,devin ...       # a subset, for development
 *   TRENDS_RESUME=1 ...                                 # continue an interrupted run from the docs/trends.json checkpoint
 *   TRENDS_PACE_MS=30000 ...                            # milliseconds between search requests
 *   TRENDS_INCOMPLETE_RETRIES=1 ...                     # re-run timed-out queries and keep the larger count
 *   TRENDS_CALIBRATE=0 ...                              # skip the weekly split of the latest month
 *   TRENDS_RENDER_ONLY=1 node scripts/trends.mjs         # re-render .md/.svg/README from docs/trends.json, no requests
 *
 * The commit search endpoint is the most expensive one GitHub exposes: the
 * documented limit is 30 requests per minute, but a secondary limit cuts in
 * after a couple of expensive requests in quick succession, so requests are
 * paced (30 s apart by default; 20 s trips the limit) and retried with
 * back-off on 403/429.
 * Queries over large result sets routinely exceed GitHub's search time
 * budget and come back with `incomplete_results: true`: their `total_count`
 * is then a partial count. The script records that flag per cell and
 * calibrates the latest month by summing weekly windows (see docs/trends.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** One row per agent: the id matches src/classify.js, the query is sent verbatim to the search API. */
export const AGENT_QUERIES = [
  { id: 'claude', label: 'Claude Code', query: '"Co-authored-by: Claude"' },
  { id: 'copilot', label: 'GitHub Copilot', query: '"Co-authored-by: Copilot"' },
  { id: 'codex', label: 'OpenAI Codex', query: '"Co-authored-by: Codex"' },
  { id: 'cursor', label: 'Cursor', query: '"Co-authored-by: Cursor"' },
  { id: 'aider', label: 'Aider', query: '"(aider)"' },
  { id: 'devin', label: 'Devin', query: '"Co-authored-by: devin-ai-integration"' },
  { id: 'gemini', label: 'Gemini', query: '"Co-authored-by: gemini-code-assist"' },
  { id: 'jules', label: 'Jules', query: '"Co-authored-by: google-labs-jules"' },
];

export const DEFAULTS = Object.freeze({
  months: 18,
  paceMs: 30000,
  maxAttempts: 6,
  incompleteRetries: 0,
  secondaryWaitMs: 60000,
});

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DOCS = path.join(ROOT, 'docs');
const README = path.join(ROOT, 'README.md');
export const README_MARKERS = ['<!-- trends:start -->', '<!-- trends:end -->'];

const pad2 = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------- dates */

/** `YYYY-MM` labels of the `n` complete calendar months before `now` (UTC), oldest first. */
export function completeMonths(n, now = new Date()) {
  const out = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based; the current month is excluded
  for (let i = 0; i < n; i += 1) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    out.unshift(`${y}-${pad2(m + 1)}`);
  }
  return out;
}

/** First and last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function monthWindow(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad2(last)}` };
}

/** Consecutive 7-day windows covering a month (the last one is shorter). */
export function weekWindows(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= last; d += 7) {
    out.push({ from: `${month}-${pad2(d)}`, to: `${month}-${pad2(Math.min(d + 6, last))}` });
  }
  return out;
}

/** The search query for an agent over a date window (inclusive, committer date). */
export function buildQuery(agent, { from, to }) {
  return `${agent.query} committer-date:${from}..${to}`;
}

/* ---------------------------------------------------------------- GitHub search */

/**
 * Minimal paced client for GET /search/commits. `fetchImpl` and `sleepImpl`
 * are injectable for tests. Honors Retry-After, the primary rate-limit reset
 * header and backs off on 403/429/5xx.
 */
export function createSearchClient({
  token,
  paceMs = DEFAULTS.paceMs,
  maxAttempts = DEFAULTS.maxAttempts,
  secondaryWaitMs = DEFAULTS.secondaryWaitMs,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  log = () => {},
} = {}) {
  let lastRequestAt = 0;
  let pace = paceMs;
  const stats = { requests: 0, retries: 0, secondaryLimits: 0 };

  async function search(q) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const wait = lastRequestAt + pace - Date.now();
      if (wait > 0) await sleepImpl(wait);
      lastRequestAt = Date.now();
      stats.requests += 1;
      const url = `https://api.github.com/search/commits?q=${encodeURIComponent(q)}&per_page=1`;
      let res;
      try {
        res = await fetchImpl(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'agent-blame-trends (https://github.com/Quigles1337/agent-blame)',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
      } catch (err) {
        stats.retries += 1;
        log(`network error (${err.message}); retrying in 30 s`);
        await sleepImpl(30000);
        continue;
      }
      const remaining = Number(res.headers.get('x-ratelimit-remaining'));
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      if (res.ok) {
        const body = await res.json();
        if (remaining === 0 && Number.isFinite(reset)) {
          const ms = Math.max(0, reset * 1000 - Date.now()) + 1000;
          log(`search quota exhausted; sleeping ${Math.round(ms / 1000)} s`);
          await sleepImpl(ms);
        }
        return { totalCount: body.total_count, incomplete: Boolean(body.incomplete_results) };
      }
      const text = await res.text();
      const retryAfter = Number(res.headers.get('retry-after'));
      if (res.status === 403 || res.status === 429) {
        stats.retries += 1;
        let ms;
        if (Number.isFinite(retryAfter) && retryAfter > 0) ms = retryAfter * 1000;
        else if (remaining === 0 && Number.isFinite(reset)) ms = Math.max(0, reset * 1000 - Date.now()) + 1000;
        else ms = Math.min(300000, secondaryWaitMs * attempt);
        if (/secondary rate limit/i.test(text)) {
          stats.secondaryLimits += 1;
          pace = Math.min(60000, pace + 10000);
        }
        log(`${res.status} (${/secondary/i.test(text) ? 'secondary rate limit' : 'rate limited'}); waiting ${Math.round(ms / 1000)} s, pace now ${pace / 1000} s`);
        await sleepImpl(ms);
        continue;
      }
      if (res.status >= 500) {
        stats.retries += 1;
        log(`${res.status} from the search API; retrying in 60 s`);
        await sleepImpl(60000);
        continue;
      }
      throw new Error(`search failed (${res.status}): ${text.slice(0, 200)}`);
    }
    throw new Error(`search gave up after ${maxAttempts} attempts: ${q}`);
  }

  return { search, stats, get pace() { return pace; } };
}

/**
 * Count one cell. With `incompleteRetries` > 0, timed-out queries are re-run
 * that many times and the largest count wins (a timed-out search undercounts,
 * never overcounts).
 */
export async function countCell(client, agent, window, { incompleteRetries = DEFAULTS.incompleteRetries } = {}) {
  const q = buildQuery(agent, window);
  let best = null;
  let attempts = 0;
  for (let i = 0; i <= incompleteRetries; i += 1) {
    const r = await client.search(q);
    attempts += 1;
    if (!best || r.totalCount > best.totalCount) best = r;
    if (!r.incomplete) {
      best = r;
      break;
    }
  }
  return { count: best.totalCount, incomplete: best.incomplete, attempts };
}

/* ---------------------------------------------------------------- numbers */

/** 1234 -> "1.2K", 12345678 -> "12.3M"; exact below 1,000. */
export function compact(n) {
  if (n === null || n === undefined) return '–';
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  if (abs < 1e6) return `${trimZero((n / 1e3).toFixed(abs < 1e4 ? 1 : 0))}K`;
  if (abs < 1e9) return `${trimZero((n / 1e6).toFixed(abs < 1e7 ? 1 : 0))}M`;
  return `${trimZero((n / 1e9).toFixed(1))}B`;
}
const trimZero = (s) => s.replace(/\.0$/, '');

export function formatInt(n) {
  return n === null || n === undefined ? '–' : Number(n).toLocaleString('en-US');
}

/** Month-over-month growth as a fraction, or null when the previous value is 0 or missing. */
export function growth(current, previous) {
  if (current === null || current === undefined || !previous) return null;
  return current / previous - 1;
}

export function formatGrowth(g) {
  if (g === null || g === undefined || !Number.isFinite(g)) return '–';
  const pct = g * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}

/* ---------------------------------------------------------------- SVG chart */

const PALETTE = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  border: 'rgba(11,11,11,0.10)',
  // Categorical slots, fixed order (validated: adjacent CVD dE >= 9.1, normal-vision >= 19.6 on the light surface).
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
};

const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

function esc(s) {
  return String(s).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]);
}

const r1 = (x) => Math.round(x * 10) / 10;

/** Short month label: "Apr 25", with the year only on January and the first point. */
function monthLabel(month, first) {
  const [y, m] = month.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m === 1 || first ? `${names[m - 1]} ${String(y).slice(2)}` : names[m - 1];
}

/**
 * Multi-line chart, one line per agent, log10 y-axis (the agents differ by
 * orders of magnitude). Filled markers are complete counts; hollow markers
 * are partial counts (the search timed out). Zero and missing cells leave a
 * gap. Self-contained: no fonts, scripts or external resources.
 */
export function renderTrendsSvg(data, { width = 960, height = 520 } = {}) {
  const { months, agents, counts } = data;
  const m = { top: 64, right: 150, bottom: 118, left: 64 };
  const pw = width - m.left - m.right;
  const ph = height - m.top - m.bottom;

  const values = [];
  for (const a of agents) for (const c of counts[a.id] ?? []) if (c.count > 0) values.push(c.count);
  const lo = values.length ? Math.pow(10, Math.floor(Math.log10(Math.min(...values)))) : 1;
  const hi = values.length ? Math.pow(10, Math.ceil(Math.log10(Math.max(...values)))) : 10;
  const ymin = Math.log10(lo);
  const ymax = Math.log10(Math.max(hi, lo * 10));
  const x = (i) => m.left + (months.length === 1 ? pw / 2 : (i * pw) / (months.length - 1));
  const y = (v) => m.top + ph - ((Math.log10(v) - ymin) / (ymax - ymin)) * ph;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d" font-family="${FONT}">`);
  out.push(`<title id="t">AI co-authorship on GitHub: indexed commits per month by agent</title>`);
  out.push(`<desc id="d">Commits indexed by GitHub code search whose message carries each agent's Co-authored-by trailer, per calendar month, log scale. Hollow markers are partial counts where the search timed out.</desc>`);
  out.push(`<rect width="${width}" height="${height}" rx="8" fill="${PALETTE.surface}" stroke="${PALETTE.border}"/>`);
  out.push(`<text x="${m.left}" y="28" font-size="16" font-weight="600" fill="${PALETTE.ink}">AI co-authorship on GitHub, by agent</text>`);
  out.push(`<text x="${m.left}" y="48" font-size="12" fill="${PALETTE.ink2}">Commits indexed by GitHub search whose message carries the agent's trailer, per calendar month (committer date). Log scale.</text>`);

  // gridlines at decades
  for (let e = Math.ceil(ymin); e <= ymax; e += 1) {
    const v = Math.pow(10, e);
    const yy = r1(y(v));
    out.push(`<line x1="${m.left}" x2="${m.left + pw}" y1="${yy}" y2="${yy}" stroke="${PALETTE.grid}" stroke-width="1"/>`);
    out.push(`<text x="${m.left - 8}" y="${yy + 4}" font-size="11" text-anchor="end" fill="${PALETTE.muted}" font-variant-numeric="tabular-nums">${compact(v)}</text>`);
  }
  out.push(`<line x1="${m.left}" x2="${m.left + pw}" y1="${r1(m.top + ph)}" y2="${r1(m.top + ph)}" stroke="${PALETTE.axis}" stroke-width="1"/>`);

  // x labels
  months.forEach((mo, i) => {
    const xx = r1(x(i));
    out.push(`<text x="${xx}" y="${m.top + ph + 18}" font-size="11" text-anchor="middle" fill="${PALETTE.muted}">${esc(monthLabel(mo, i === 0))}</text>`);
  });

  // series: lines first, then markers (rings on top of lines)
  const ends = [];
  agents.forEach((a, si) => {
    const color = PALETTE.series[si % PALETTE.series.length];
    const cells = counts[a.id] ?? [];
    const pts = months.map((mo, i) => {
      const c = cells.find((cell) => cell.month === mo);
      return c && c.count > 0 ? { i, x: r1(x(i)), y: r1(y(c.count)), c } : null;
    });
    let d = '';
    let pen = false;
    for (const p of pts) {
      if (!p) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${p.x} ${p.y} `;
      pen = true;
    }
    if (d) out.push(`<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    const last = [...pts].reverse().find(Boolean);
    if (last) ends.push({ label: a.label, y: last.y, x: last.x, color, value: last.c.count });
    pts.forEach((p) => {
      if (!p) return;
      const fill = p.c.incomplete ? PALETTE.surface : color;
      const tip = `<title>${esc(`${a.label}, ${p.c.month}: ${formatInt(p.c.count)}${p.c.incomplete ? ' (partial: search timed out)' : ''}`)}</title>`;
      out.push(`<circle cx="${p.x}" cy="${p.y}" r="4" fill="${fill}" stroke="${PALETTE.surface}" stroke-width="2">${tip}</circle>`);
      if (p.c.incomplete) out.push(`<circle cx="${p.x}" cy="${p.y}" r="3" fill="none" stroke="${color}" stroke-width="2">${tip}</circle>`);
    });
  });

  // end labels, nudged apart so they never overlap; a leader line keeps each with its line
  ends.sort((p, q) => p.y - q.y);
  let prev = -Infinity;
  for (const e of ends) {
    const ly = Math.max(e.y, prev + 14);
    prev = ly;
    const lx = m.left + pw + 12;
    if (Math.abs(ly - e.y) > 1) out.push(`<line x1="${e.x + 6}" y1="${e.y}" x2="${lx - 4}" y2="${r1(ly)}" stroke="${PALETTE.axis}" stroke-width="1"/>`);
    out.push(`<text x="${lx}" y="${r1(ly + 4)}" font-size="11" fill="${PALETTE.ink2}">${esc(e.label)} <tspan fill="${PALETTE.muted}" font-variant-numeric="tabular-nums">${esc(compact(e.value))}</tspan></text>`);
  }

  // legend: two rows of four, fixed slot order
  const legendY = m.top + ph + 46;
  agents.forEach((a, si) => {
    const color = PALETTE.series[si % PALETTE.series.length];
    const col = si % 4;
    const row = Math.floor(si / 4);
    const lx = m.left + col * 200;
    const ly = legendY + row * 20;
    out.push(`<line x1="${lx}" x2="${lx + 18}" y1="${ly}" y2="${ly}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
    out.push(`<circle cx="${lx + 9}" cy="${ly}" r="3.5" fill="${color}" stroke="${PALETTE.surface}" stroke-width="1.5"/>`);
    out.push(`<text x="${lx + 26}" y="${ly + 4}" font-size="12" fill="${PALETTE.ink2}">${esc(a.label)}</text>`);
  });
  const noteY = legendY + 2 * 20 + 6;
  const nx = m.left;
  out.push(`<circle cx="${nx + 4}" cy="${noteY}" r="3.5" fill="${PALETTE.ink2}"/>`);
  out.push(`<text x="${nx + 14}" y="${noteY + 4}" font-size="11" fill="${PALETTE.muted}">complete count</text>`);
  out.push(`<circle cx="${nx + 120}" cy="${noteY}" r="3" fill="${PALETTE.surface}" stroke="${PALETTE.ink2}" stroke-width="2"/>`);
  out.push(`<text x="${nx + 130}" y="${noteY + 4}" font-size="11" fill="${PALETTE.muted}">partial count: GitHub's search timed out (incomplete_results), the true number is higher</text>`);
  out.push(`<text x="${width - 16}" y="${height - 12}" font-size="10" text-anchor="end" fill="${PALETTE.muted}">github.com/Quigles1337/agent-blame · ${esc(String(data.generatedAt).slice(0, 10))}</text>`);
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

/* ---------------------------------------------------------------- Markdown */

function mdRow(cells) {
  return `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`;
}

export function renderTrendsMarkdown(data) {
  const { months, agents, counts, calibration, methodology, generatedAt } = data;
  const cell = (id, mo) => (counts[id] ?? []).find((c) => c.month === mo);
  const fmt = (c) => (!c || c.count === null ? '–' : `${formatInt(c.count)}${c.incomplete ? '†' : ''}`);
  const out = [];
  out.push('# AI co-authorship on GitHub over time');
  out.push('');
  out.push(`Generated ${generatedAt.slice(0, 10)} by [\`scripts/trends.mjs\`](../scripts/trends.mjs); refreshed weekly by [\`trends.yml\`](../.github/workflows/trends.yml). Raw numbers in [\`trends.json\`](trends.json).`);
  out.push('');
  out.push('![Commits per month by agent](trends.svg)');
  out.push('');
  out.push('## Indexed commits per month');
  out.push('');
  out.push('Commits indexed by GitHub search whose message matches each agent\'s query (below), by committer date. † marks a partial count: GitHub\'s search timed out before scanning everything (`incomplete_results: true`), so the true number is higher by an unknown factor.');
  out.push('');
  out.push(mdRow(['Month', ...agents.map((a) => a.label)]));
  out.push(mdRow(['---', ...agents.map(() => '---:')]));
  for (const mo of months) out.push(mdRow([mo, ...agents.map((a) => fmt(cell(a.id, mo)))]));
  if (months.length >= 2) {
    const last = months[months.length - 1];
    const prev = months[months.length - 2];
    out.push(mdRow([`${last} vs ${prev}`, ...agents.map((a) => formatGrowth(growth(cell(a.id, last)?.count, cell(a.id, prev)?.count)))]));
  }
  out.push('');
  out.push('## Queries');
  out.push('');
  out.push('One commit-search query per agent and month, `<query> committer-date:<first day>..<last day>`; the number is the API\'s `total_count`. The same table is exported as `AGENT_QUERIES` from `scripts/trends.mjs` and quoted in the README.');
  out.push('');
  out.push(mdRow(['Agent', 'id', 'Query']));
  out.push(mdRow(['---', '---', '---']));
  for (const a of agents) out.push(mdRow([a.label, `\`${a.id}\``, `\`${a.query}\``]));
  out.push('');
  out.push('## Methodology and caveats');
  out.push('');
  for (const line of methodology.notes) out.push(`- ${line}`);
  out.push('');
  if (calibration && calibration.cells.length > 0) {
    out.push(`## Calibration: ${calibration.month} split into weeks`);
    out.push('');
    out.push('Whether `total_count` can be trusted is checked each run: the latest month is re-counted as the sum of 7-day windows for every agent whose monthly query was flagged incomplete. A weekly sum far above the monthly figure shows how much the monthly search was cut short; a complete weekly window (no †) is exact as far as the index goes.');
    out.push('');
    out.push(mdRow(['Agent', 'Monthly total_count', 'Sum of weekly windows', 'Weekly windows flagged incomplete']));
    out.push(mdRow(['---', '---:', '---:', '---:']));
    for (const c of calibration.cells) {
      out.push(mdRow([c.label, `${formatInt(c.monthly)}${c.monthlyIncomplete ? '†' : ''}`, formatInt(c.weeklySum), `${c.weeksIncomplete} of ${c.weeks}`]));
    }
    out.push('');
  }
  out.push(`<sub>${formatInt(data.stats.requests)} search requests, ${formatInt(data.stats.retries)} retries, ${formatInt(data.stats.secondaryLimits)} secondary-limit pauses; pace ${Math.round(data.stats.paceMs / 1000)} s.</sub>`);
  out.push('');
  return out.join('\n');
}

/** The generated block for the README: headline line plus the query list. */
export function renderReadmeBlock(data) {
  const { months, agents, counts } = data;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const cell = (id, mo) => (counts[id] ?? []).find((c) => c.month === mo);
  const parts = agents
    .map((a) => {
      const c = cell(a.id, last);
      if (!c || c.count === null) return null;
      const g = formatGrowth(growth(c.count, cell(a.id, prev)?.count));
      return `${a.label} ${compact(c.count)}${c.incomplete ? '†' : ''} (${g})`;
    })
    .filter(Boolean);
  const queries = agents.map((a) => `\`${a.query}\``).join(', ');
  return [
    README_MARKERS[0],
    `**${last}** (month-over-month in parentheses; † = partial count, GitHub's search timed out): ${parts.join(' · ')}.`,
    '',
    `Queries, one per agent and calendar month: ${queries}; each is run as \`<query> committer-date:<first day>..<last day>\` against the commit search API and the \`total_count\` is recorded. Updated ${data.generatedAt.slice(0, 10)}.`,
    README_MARKERS[1],
  ].join('\n');
}

export function updateReadme(text, block) {
  const [start, end] = README_MARKERS;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`README is missing the ${start} / ${end} markers`);
  return `${text.slice(0, a)}${block}${text.slice(b + end.length)}`;
}

/* ---------------------------------------------------------------- main */

export async function collect({
  client,
  months,
  agents = AGENT_QUERIES,
  previous = null,
  resume = false,
  calibrate = true,
  incompleteRetries = DEFAULTS.incompleteRetries,
  onCheckpoint = null,
  log = () => {},
} = {}) {
  const counts = {};
  for (const a of agents) {
    counts[a.id] = [];
    for (const mo of months) {
      const old = previous?.counts?.[a.id]?.find((c) => c.month === mo);
      if (resume && old && old.count !== null) {
        counts[a.id].push({ ...old, reused: true });
        continue;
      }
      let cell;
      try {
        cell = await countCell(client, a, monthWindow(mo), { incompleteRetries });
      } catch (err) {
        log(`  ${a.id} ${mo}: ${err.message}`);
        cell = old && old.count !== null ? { ...old, stale: true } : { count: null, incomplete: null, attempts: 0, error: err.message };
      }
      counts[a.id].push({ month: mo, ...cell });
      log(`  ${a.id.padEnd(8)} ${mo}  ${cell.count === null ? 'failed' : formatInt(cell.count)}${cell.incomplete ? ' (partial)' : ''}`);
      if (onCheckpoint) onCheckpoint(counts);
    }
  }

  let calibration = null;
  if (calibrate && months.length > 0) {
    const month = months[months.length - 1];
    const cells = [];
    for (const a of agents) {
      const monthly = counts[a.id].find((c) => c.month === month);
      if (!monthly || !monthly.incomplete) continue;
      const weeks = weekWindows(month);
      let weeklySum = 0;
      let weeksIncomplete = 0;
      for (const w of weeks) {
        const r = await countCell(client, a, w, { incompleteRetries: 0 });
        weeklySum += r.count;
        if (r.incomplete) weeksIncomplete += 1;
        log(`  ${a.id.padEnd(8)} ${w.from}..${w.to}  ${formatInt(r.count)}${r.incomplete ? ' (partial)' : ''}`);
      }
      cells.push({ id: a.id, label: a.label, monthly: monthly.count, monthlyIncomplete: monthly.incomplete, weeklySum, weeks: weeks.length, weeksIncomplete });
    }
    calibration = { month, cells };
  }
  return { counts, calibration };
}

export function methodologyNotes() {
  return [
    'Source: the GitHub REST commit search API (`GET /search/commits`), which indexes commits on the default branch of repositories GitHub has indexed; forks and other branches are not counted, and private repositories are invisible.',
    'A commit counts for an agent when its message matches the agent\'s query as a phrase. Trailers are voluntary and some workflows strip them, so every number is a lower bound on the agent\'s real activity, and the queries do not cover agents that commit under their own author identity without a trailer.',
    'Windows are calendar months by committer date (`committer-date:YYYY-MM-01..YYYY-MM-DD`), oldest to newest; the current, incomplete month is left out. Each number is the API\'s `total_count`, which is not capped at 1,000 (values in the millions are returned).',
    'GitHub limits the time a search may take. When a query exceeds it the response carries `incomplete_results: true` and `total_count` is only what was found before the cut-off; such cells are marked † and understate the truth by an unknown factor. Every `"Co-authored-by: ..."` phrase query observed so far times out, whatever the result size (the phrase is scanned across the whole index), while the single-token `"(aider)"` query completes. The weekly-split calibration below measures the gap for the latest month.',
    'Partial counts of the same query vary from run to run by tens of percent, so month-over-month changes of the † series should be read as noise unless they are large.',
    `Requests are paced (${DEFAULTS.paceMs / 1000} s apart, slower after a secondary rate limit; 20 s apart already trips GitHub's secondary limit for these queries) and retried with back-off on 403/429, using the Retry-After header when GitHub sends one.`,
  ];
}

/** Write docs/trends.md, docs/trends.svg and the README block from a data document. */
export function writeOutputs(data, { docs = DOCS, readme = README } = {}) {
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'trends.md'), renderTrendsMarkdown(data));
  fs.writeFileSync(path.join(docs, 'trends.svg'), renderTrendsSvg(data));
  if (fs.existsSync(readme)) {
    const text = fs.readFileSync(readme, 'utf8');
    if (text.includes(README_MARKERS[0])) fs.writeFileSync(readme, updateReadme(text, renderReadmeBlock(data)));
  }
}

async function main() {
  const jsonPath = path.join(DOCS, 'trends.json');
  if (process.env.TRENDS_RENDER_ONLY === '1') {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    writeOutputs(data);
    process.stderr.write('trends: re-rendered docs/trends.{md,svg} and the README block from docs/trends.json\n');
    return;
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    process.stderr.write('trends: set GITHUB_TOKEN or GH_TOKEN (commit search needs authentication)\n');
    process.exit(1);
  }
  const nMonths = Number(process.env.TRENDS_MONTHS || DEFAULTS.months);
  const paceMs = Number(process.env.TRENDS_PACE_MS || DEFAULTS.paceMs);
  const subset = process.env.TRENDS_AGENTS ? process.env.TRENDS_AGENTS.split(',').map((s) => s.trim()) : null;
  const agents = subset ? AGENT_QUERIES.filter((a) => subset.includes(a.id)) : AGENT_QUERIES;
  const resume = process.env.TRENDS_RESUME === '1';
  const calibrate = process.env.TRENDS_CALIBRATE !== '0';
  const incompleteRetries = Number(process.env.TRENDS_INCOMPLETE_RETRIES || DEFAULTS.incompleteRetries);
  const months = completeMonths(nMonths);
  const log = (s) => process.stderr.write(`${s}\n`);

  let previous = null;
  if (fs.existsSync(jsonPath)) {
    try {
      previous = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      previous = null;
    }
  }

  const client = createSearchClient({ token, paceMs, log });
  log(`trends: ${agents.length} agents x ${months.length} months (${months[0]}..${months[months.length - 1]}), pace ${paceMs / 1000} s${resume ? ', resuming' : ''}`);
  const started = Date.now();
  fs.mkdirSync(DOCS, { recursive: true });
  // After every cell the counts so far go to docs/trends.json (marked partial), so an interrupted run can resume.
  const onCheckpoint = (counts) => {
    const checkpoint = { ...(previous ?? {}), version: 1, partial: true, checkpointAt: new Date().toISOString(), months, agents, counts };
    fs.writeFileSync(jsonPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  };
  const { counts, calibration } = await collect({ client, months, agents, previous, resume, calibrate, incompleteRetries, onCheckpoint, log });

  const data = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'https://api.github.com/search/commits',
    months,
    agents: agents.map((a) => ({ id: a.id, label: a.label, query: a.query })),
    counts,
    calibration,
    methodology: {
      dateField: 'committer-date',
      window: 'calendar month, UTC, complete months only',
      countField: 'total_count',
      incompleteFlag: 'incomplete_results',
      incompleteHandling: incompleteRetries > 0 ? `re-run ${incompleteRetries}x, larger count kept, marked per cell` : 'marked per cell',
      incompleteRetries,
      totalCountCapped: false,
      notes: methodologyNotes(),
    },
    stats: { ...client.stats, paceMs: client.pace, durationSeconds: Math.round((Date.now() - started) / 1000) },
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
  writeOutputs(data);
  log(`trends: wrote docs/trends.{json,md,svg} in ${data.stats.durationSeconds} s (${client.stats.requests} requests)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`trends: ${err.stack || err}\n`);
    process.exit(1);
  });
}
