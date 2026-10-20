/**
 * Time-bucketed history: the share of ADDED lines that were agent-assisted,
 * per month or per ISO week, from `git log --numstat` data. Pure.
 */

const SPARK = '▁▂▃▄▅▆▇█'; // ▁▂▃▄▅▆▇█

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` of the local (offset-bearing) ISO 8601 string, without time-zone conversion. */
function datePart(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** ISO-8601 week label `YYYY-Www` for a calendar date. */
export function isoWeek(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7; // Monday=1 ... Sunday=7
  date.setUTCDate(date.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const year = date.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date - jan1) / 86400000 + 1) / 7);
  return `${year}-W${pad2(week)}`;
}

/** Bucket label for a commit date. */
export function periodOf(iso, weekly = false) {
  const p = datePart(iso);
  if (!p) return null;
  return weekly ? isoWeek(p.y, p.m, p.d) : `${p.y}-${pad2(p.m)}`;
}

/** The period that follows `label` (month or ISO week). */
export function nextPeriod(label) {
  const w = /^(\d{4})-W(\d{2})$/.exec(label);
  if (w) {
    // Move from the Monday of this ISO week forward seven days.
    const year = Number(w[1]);
    const week = Number(w[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7 + 7);
    return isoWeek(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
  }
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) throw new TypeError(`unrecognised period ${label}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad2(mo + 1)}`;
}

/**
 * @param {Array<{hash, date, files: Array<{added, deleted, path, binary}>}>} numstatCommits
 * @param {Map<string, {commit, classification}>} commitIndex
 * @param {object} [opts]
 * @param {boolean} [opts.weekly=false]
 * @param {(path: string) => boolean} [opts.matcher]
 * @param {boolean} [opts.ignoreBots=true]  bot-added lines are left out of the denominator
 * @param {boolean} [opts.fillGaps=true]    emit empty periods between the first and last
 * @returns {Array<{period, added, ai, human, bot, share, commits, aiCommits}>}
 */
export function bucketHistory(numstatCommits, commitIndex, { weekly = false, matcher = () => true, ignoreBots = true, fillGaps = true } = {}) {
  const buckets = new Map();
  for (const c of numstatCommits) {
    const period = periodOf(c.date, weekly);
    if (!period) continue;
    const entry = commitIndex.get(c.hash);
    const kind = entry?.classification.kind ?? 'human';
    let added = 0;
    for (const f of c.files) {
      if (f.binary || !matcher(f.path)) continue;
      added += f.added;
    }
    if (!buckets.has(period)) buckets.set(period, { period, added: 0, ai: 0, human: 0, bot: 0, commits: 0, aiCommits: 0 });
    const b = buckets.get(period);
    b.commits += 1;
    if (kind === 'agent') b.aiCommits += 1;
    if (kind === 'agent') b.ai += added;
    else if (kind === 'bot') b.bot += added;
    else b.human += added;
    b.added += added;
  }

  let labels = [...buckets.keys()].sort();
  if (fillGaps && labels.length > 1) {
    const filled = [];
    let cur = labels[0];
    const last = labels[labels.length - 1];
    let guard = 0;
    while (cur <= last && guard < 100000) {
      filled.push(cur);
      if (cur === last) break;
      cur = nextPeriod(cur);
      guard += 1;
    }
    labels = filled;
  }

  return labels.map((period) => {
    const b = buckets.get(period) ?? { period, added: 0, ai: 0, human: 0, bot: 0, commits: 0, aiCommits: 0 };
    const counted = b.added - (ignoreBots ? b.bot : 0);
    return { ...b, counted, share: counted > 0 ? b.ai / counted : null };
  });
}

/** Text sparkline from shares in [0, 1]; null renders as a space. */
export function sparkline(values) {
  return values
    .map((v) => {
      if (v === null || v === undefined || Number.isNaN(v)) return ' ';
      const idx = Math.min(SPARK.length - 1, Math.max(0, Math.round(v * (SPARK.length - 1))));
      return SPARK[idx];
    })
    .join('');
}
