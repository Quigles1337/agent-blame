import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_QUERIES,
  README_MARKERS,
  buildQuery,
  compact,
  completeMonths,
  countCell,
  createSearchClient,
  collect,
  formatGrowth,
  growth,
  methodologyNotes,
  monthWindow,
  renderReadmeBlock,
  renderTrendsMarkdown,
  renderTrendsSvg,
  updateReadme,
  weekWindows,
} from '../scripts/trends.mjs';

test('AGENT_QUERIES is one phrase query per agent, with ids from the classifier', () => {
  assert.equal(AGENT_QUERIES.length, 8);
  assert.deepEqual(AGENT_QUERIES.map((a) => a.id), ['claude', 'copilot', 'codex', 'cursor', 'aider', 'devin', 'gemini', 'jules']);
  for (const a of AGENT_QUERIES) {
    assert.match(a.query, /^".+"$/, `${a.id} is a quoted phrase`);
    assert.ok(a.label.length > 0);
  }
  assert.equal(buildQuery(AGENT_QUERIES[0], { from: '2026-09-01', to: '2026-09-30' }), '"Co-authored-by: Claude" committer-date:2026-09-01..2026-09-30');
});

test('completeMonths lists complete calendar months before now, oldest first, across year ends', () => {
  const now = new Date('2026-10-20T06:00:00Z');
  assert.deepEqual(completeMonths(3, now), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(completeMonths(18, now).slice(0, 2), ['2025-04', '2025-05']);
  assert.equal(completeMonths(18, now).length, 18);
  assert.deepEqual(completeMonths(2, new Date('2026-01-15T00:00:00Z')), ['2025-11', '2025-12']);
  assert.deepEqual(completeMonths(1, new Date('2026-01-01T00:00:00Z')), ['2025-12']);
  assert.deepEqual(completeMonths(0, now), []);
});

test('monthWindow and weekWindows cover the month exactly, including leap years', () => {
  assert.deepEqual(monthWindow('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthWindow('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthWindow('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(weekWindows('2026-09'), [
    { from: '2026-09-01', to: '2026-09-07' },
    { from: '2026-09-08', to: '2026-09-14' },
    { from: '2026-09-15', to: '2026-09-21' },
    { from: '2026-09-22', to: '2026-09-28' },
    { from: '2026-09-29', to: '2026-09-30' },
  ]);
  assert.equal(weekWindows('2026-02').length, 4);
  assert.equal(weekWindows('2026-02').at(-1).to, '2026-02-28');
});

test('number formatting: compact, growth', () => {
  assert.equal(compact(0), '0');
  assert.equal(compact(999), '999');
  assert.equal(compact(1234), '1.2K');
  assert.equal(compact(34110), '34K');
  assert.equal(compact(1000000), '1M');
  assert.equal(compact(9983514), '10M');
  assert.equal(compact(2500000), '2.5M');
  assert.equal(compact(11826968), '12M');
  assert.equal(compact(null), '–');
  assert.equal(growth(120, 100), 0.19999999999999996);
  assert.equal(growth(100, 0), null);
  assert.equal(growth(null, 100), null);
  assert.equal(formatGrowth(0.2), '+20%');
  assert.equal(formatGrowth(-0.034), '-3.4%');
  assert.equal(formatGrowth(null), '–');
});

function sampleData() {
  const months = ['2026-07', '2026-08', '2026-09'];
  const agents = AGENT_QUERIES.slice(0, 3).concat(AGENT_QUERIES.slice(4, 5));
  const counts = {
    claude: [
      { month: '2026-07', count: 9374047, incomplete: true, attempts: 1 },
      { month: '2026-08', count: 9983514, incomplete: true, attempts: 1 },
      { month: '2026-09', count: 11826968, incomplete: true, attempts: 1 },
    ],
    copilot: [
      { month: '2026-07', count: 300000, incomplete: true, attempts: 1 },
      { month: '2026-08', count: 0, incomplete: false, attempts: 1 },
      { month: '2026-09', count: 351217, incomplete: true, attempts: 1 },
    ],
    codex: [
      { month: '2026-07', count: null, incomplete: null, attempts: 0, error: 'boom' },
      { month: '2026-08', count: 90000, incomplete: true, attempts: 1 },
      { month: '2026-09', count: 104369, incomplete: true, attempts: 1 },
    ],
    aider: [
      { month: '2026-07', count: 31000, incomplete: false, attempts: 1 },
      { month: '2026-08', count: 33000, incomplete: false, attempts: 1 },
      { month: '2026-09', count: 34110, incomplete: false, attempts: 1 },
    ],
  };
  return {
    version: 1,
    generatedAt: '2026-10-20T07:00:00.000Z',
    months,
    agents,
    counts,
    calibration: { month: '2026-09', cells: [{ id: 'claude', label: 'Claude Code', monthly: 11826968, monthlyIncomplete: true, weeklySum: 25000000, weeks: 5, weeksIncomplete: 5 }] },
    methodology: { notes: methodologyNotes() },
    stats: { requests: 12, retries: 1, secondaryLimits: 1, paceMs: 30000 },
  };
}

test('renderTrendsSvg draws one line per agent on a log scale with hollow markers for partial counts and no external resources', () => {
  const svg = renderTrendsSvg(sampleData());
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(!/<script|<image|href=|url\(/i.test(svg), 'self-contained');
  assert.equal((svg.match(/<path /g) ?? []).length, 4, 'one path per agent');
  assert.match(svg, /<text[^>]*>10M<\/text>/);
  assert.match(svg, /<text[^>]*>10K<\/text>/);
  assert.match(svg, /<text[^>]*>1M<\/text>/);
  const hollow = (svg.match(/<circle [^>]*r="3" fill="none"/g) ?? []).length;
  assert.equal(hollow, 7, 'three Claude, two Copilot and two Codex partial counts are hollow');
  assert.match(svg, /Claude Code, 2026-09: 11,826,968 \(partial: search timed out\)/);
  assert.match(svg, /Aider, 2026-09: 34,110<\/title>/);
  for (const a of sampleData().agents) assert.ok(svg.includes(`>${a.label}</text>`), `legend entry for ${a.label}`);
  assert.match(svg, /Jul 26/);
  assert.match(svg, /partial count/);
  // Copilot's zero month leaves a gap: its path has two move-tos.
  const copilotPath = svg.match(/<path d="([^"]+)" fill="none" stroke="#eb6834"/)[1];
  assert.equal((copilotPath.match(/M/g) ?? []).length, 2);
  // Tag balance
  const opens = (svg.match(/<(svg|text|tspan|title|desc)\b/g) ?? []).length;
  const closes = (svg.match(/<\/(svg|text|tspan|title|desc)>/g) ?? []).length;
  assert.equal(opens, closes);
});

test('renderTrendsMarkdown has the month x agent table, dagger marks, the growth row, the query table and the calibration', () => {
  const md = renderTrendsMarkdown(sampleData());
  assert.match(md, /^# AI co-authorship on GitHub over time/);
  assert.match(md, /^\| Month \| Claude Code \| GitHub Copilot \| OpenAI Codex \| Aider \|$/m);
  assert.match(md, /^\| 2026-09 \| 11,826,968† \| 351,217† \| 104,369† \| 34,110 \|$/m);
  assert.match(md, /^\| 2026-07 \| 9,374,047† \| 300,000† \| – \| 31,000 \|$/m);
  assert.match(md, /^\| 2026-09 vs 2026-08 \| \+18% \| – \| \+16% \| \+3\.4% \|$/m);
  assert.match(md, /^\| Claude Code \| `claude` \| `"Co-authored-by: Claude"` \|$/m);
  assert.match(md, /^\| Aider \| `aider` \| `"\(aider\)"` \|$/m);
  assert.match(md, /## Calibration: 2026-09 split into weeks/);
  assert.match(md, /^\| Claude Code \| 11,826,968† \| 25,000,000 \| 5 of 5 \|$/m);
  assert.match(md, /12 search requests, 1 retries, 1 secondary-limit pauses; pace 30 s/);
  assert.match(md, /not capped at 1,000/);
});

test('renderReadmeBlock and updateReadme replace only the marked block', () => {
  const block = renderReadmeBlock(sampleData());
  assert.ok(block.startsWith(README_MARKERS[0]));
  assert.ok(block.endsWith(README_MARKERS[1]));
  assert.match(block, /\*\*2026-09\*\* .*Claude Code 12M† \(\+18%\) · GitHub Copilot 351K† \(–\) · OpenAI Codex 104K† \(\+16%\) · Aider 34K \(\+3\.4%\)\./);
  assert.match(block, /`"Co-authored-by: Claude"`, `"Co-authored-by: Copilot"`/);
  const readme = `# x\n\nintro\n\n${README_MARKERS[0]}\nold\n${README_MARKERS[1]}\n\nafter\n`;
  const updated = updateReadme(readme, block);
  assert.ok(updated.startsWith('# x\n\nintro\n\n<!-- trends:start -->\n**2026-09**'));
  assert.ok(updated.endsWith('<!-- trends:end -->\n\nafter\n'));
  assert.ok(!updated.includes('\nold\n'));
  assert.throws(() => updateReadme('no markers', block), /missing/);
});

/** A fake fetch that replays scripted responses and records calls. */
function fakeFetch(script) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const next = script.shift();
    if (!next) throw new Error('unexpected request');
    if (next.throw) throw new Error(next.throw);
    const headers = new Map(Object.entries(next.headers ?? {}));
    return {
      ok: next.status === 200,
      status: next.status,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      json: async () => next.body,
      text: async () => JSON.stringify(next.body ?? {}),
    };
  };
  return { fetchImpl, calls };
}

test('createSearchClient paces requests, honours Retry-After, backs off on secondary limits and 5xx, and sleeps out an exhausted quota', async () => {
  const sleeps = [];
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const sleepImpl = async (ms) => {
      sleeps.push(ms);
      now += ms;
    };
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { total_count: 5, incomplete_results: false }, headers: { 'x-ratelimit-remaining': '29', 'x-ratelimit-reset': '2000' } },
      { status: 403, body: { message: 'You have exceeded a secondary rate limit.' }, headers: { 'x-ratelimit-remaining': '28' } },
      { status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '7' } },
      { status: 502, body: { message: 'bad gateway' } },
      { throw: 'socket hang up' },
      { status: 200, body: { total_count: 9, incomplete_results: true }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(now / 1000) + 600) } },
    ]);
    const logs = [];
    const client = createSearchClient({ token: 't', paceMs: 30000, fetchImpl, sleepImpl, log: (s) => logs.push(s) });

    const first = await client.search('"(aider)" committer-date:2026-09-01..2026-09-30');
    assert.deepEqual(first, { totalCount: 5, incomplete: false });
    assert.deepEqual(sleeps, [], 'the first request goes out immediately');
    assert.equal(calls[0], 'https://api.github.com/search/commits?q=%22(aider)%22%20committer-date%3A2026-09-01..2026-09-30&per_page=1');

    now += 1000; // 1 s later: the pace demands a 29 s wait before the next request
    const second = await client.search('q2');
    assert.deepEqual(second, { totalCount: 9, incomplete: true });
    assert.equal(client.stats.requests, 6);
    assert.equal(client.stats.retries, 4);
    assert.equal(client.stats.secondaryLimits, 1);
    assert.equal(client.pace, 40000, 'pace grows by 10 s after a secondary limit');
    // 29 s to honour the 30 s pace, 60 s secondary back-off (longer than the new 40 s pace, so no extra pace wait),
    // 7 s Retry-After then 33 s to complete the 40 s pace, 60 s on 5xx, 30 s on a network error then 10 s to
    // complete the pace, and finally the sleep until the quota reset (header issued at t=1,000 s + 600 s).
    assert.deepEqual(sleeps, [29000, 60000, 7000, 33000, 60000, 30000, 10000, 371000]);
    assert.ok(logs.some((l) => /secondary rate limit/.test(l)));
  } finally {
    Date.now = realNow;
  }
});

test('createSearchClient gives up after maxAttempts and surfaces other errors', async () => {
  const { fetchImpl } = fakeFetch([
    { status: 403, body: { message: 'secondary' } },
    { status: 403, body: { message: 'secondary' } },
  ]);
  const client = createSearchClient({ token: 't', paceMs: 0, maxAttempts: 2, fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(client.search('q'), /gave up after 2 attempts/);
  const bad = fakeFetch([{ status: 422, body: { message: 'Validation Failed' } }]);
  const client2 = createSearchClient({ token: 't', paceMs: 0, fetchImpl: bad.fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(client2.search('q'), /search failed \(422\)/);
});

test('countCell keeps the larger of repeated partial counts and stops early on a complete one', async () => {
  const { fetchImpl } = fakeFetch([
    { status: 200, body: { total_count: 100, incomplete_results: true } },
    { status: 200, body: { total_count: 90, incomplete_results: true } },
    { status: 200, body: { total_count: 50, incomplete_results: false } },
  ]);
  const client = createSearchClient({ token: 't', paceMs: 0, fetchImpl, sleepImpl: async () => {} });
  assert.deepEqual(await countCell(client, AGENT_QUERIES[0], { from: '2026-09-01', to: '2026-09-30' }, { incompleteRetries: 1 }), { count: 100, incomplete: true, attempts: 2 });
  assert.deepEqual(await countCell(client, AGENT_QUERIES[0], { from: '2026-09-01', to: '2026-09-30' }, { incompleteRetries: 1 }), { count: 50, incomplete: false, attempts: 1 });
});

test('collect fills every month x agent cell, reuses cells on resume, keeps stale values on failure and calibrates the latest month weekly', async () => {
  const script = [];
  const push = (count, incomplete) => script.push({ status: 200, body: { total_count: count, incomplete_results: incomplete } });
  // aider: 2 months complete; devin: 2 months partial; then devin's 5 weekly windows for 2026-09
  push(31000, false);
  push(34110, false);
  push(400, true);
  push(519, true);
  for (let i = 0; i < 5; i += 1) push(100 + i, i === 4);
  const { fetchImpl, calls } = fakeFetch(script);
  const client = createSearchClient({ token: 't', paceMs: 0, fetchImpl, sleepImpl: async () => {} });
  const agents = AGENT_QUERIES.filter((a) => a.id === 'aider' || a.id === 'devin');
  const months = ['2026-08', '2026-09'];
  const { counts, calibration } = await collect({ client, months, agents });
  assert.deepEqual(counts.aider.map((c) => [c.month, c.count, c.incomplete]), [['2026-08', 31000, false], ['2026-09', 34110, false]]);
  assert.deepEqual(counts.devin.map((c) => [c.month, c.count, c.incomplete]), [['2026-08', 400, true], ['2026-09', 519, true]]);
  assert.deepEqual(calibration, { month: '2026-09', cells: [{ id: 'devin', label: 'Devin', monthly: 519, monthlyIncomplete: true, weeklySum: 510, weeks: 5, weeksIncomplete: 1 }] });
  assert.equal(calls.length, 9);

  // resume: nothing is fetched for cells that already exist; a failing cell keeps the previous value as stale
  const previous = { counts };
  const failing = fakeFetch([{ status: 422, body: { message: 'nope' } }]);
  const client2 = createSearchClient({ token: 't', paceMs: 0, fetchImpl: failing.fetchImpl, sleepImpl: async () => {} });
  const resumed = await collect({ client: client2, months, agents, previous, resume: true, calibrate: false });
  assert.equal(failing.calls.length, 0);
  assert.ok(resumed.counts.aider.every((c) => c.reused));
  const client3 = createSearchClient({ token: 't', paceMs: 0, fetchImpl: fakeFetch([{ status: 422, body: { message: 'nope' } }, { status: 422, body: { message: 'nope' } }]).fetchImpl, sleepImpl: async () => {} });
  const stale = await collect({ client: client3, months: ['2026-09'], agents: agents.slice(0, 1), previous, calibrate: false });
  assert.deepEqual(stale.counts.aider.map((c) => [c.month, c.count, c.stale]), [['2026-09', 34110, true]]);
  const client4 = createSearchClient({ token: 't', paceMs: 0, fetchImpl: fakeFetch([{ status: 422, body: { message: 'nope' } }]).fetchImpl, sleepImpl: async () => {} });
  const nothing = await collect({ client: client4, months: ['2026-09'], agents: agents.slice(0, 1), calibrate: false });
  assert.equal(nothing.counts.aider[0].count, null);
  assert.match(nothing.counts.aider[0].error, /422/);
});
