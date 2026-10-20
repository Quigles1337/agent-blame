/**
 * Hand-written shields-style flat badge: "AI-assisted | 43%". No fonts,
 * scripts or external resources; text width is estimated at 6.5 px per
 * character, which is what shields.io assumes for Verdana 11px on average.
 */

export const CHAR_WIDTH = 6.5;
export const PADDING = 5;

const GREY = [0x9f, 0x9f, 0x9f];
const BLUE = [0x00, 0x7e, 0xc6];

/** Integer percent string for a share in [0, 1]; tiny non-zero shares print as "<1%". */
export function formatBadgePercent(shareValue) {
  const v = Math.max(0, Math.min(1, Number(shareValue) || 0));
  const pct = v * 100;
  if (pct > 0 && pct < 0.5) return '<1%';
  return `${Math.round(pct)}%`;
}

/** Colour band from grey (0%) to blue (100%), as a CSS hex colour. */
export function bandColor(shareValue) {
  const t = Math.max(0, Math.min(1, Number(shareValue) || 0));
  const rgb = GREY.map((g, i) => Math.round(g + (BLUE[i] - g) * t));
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]);
}

function textWidth(s) {
  return Math.round([...String(s)].length * CHAR_WIDTH * 10) / 10;
}

/**
 * @param {object} opts
 * @param {number} opts.share   AI-assisted share in [0, 1]
 * @param {string} [opts.label='AI-assisted']
 * @param {string} [opts.value] override the rendered value text
 * @param {string} [opts.color] override the right-hand colour
 */
export function renderBadge({ share, label = 'AI-assisted', value, color } = {}) {
  const valueText = value ?? formatBadgePercent(share);
  const fill = color ?? bandColor(share);
  const lw = Math.round(textWidth(label) + PADDING * 2);
  const rw = Math.round(textWidth(valueText) + PADDING * 2);
  const w = lw + rw;
  const title = `${label}: ${valueText}`;
  const lx = Math.round((lw / 2) * 10);
  const rx = Math.round((lw + rw / 2) * 10);
  const ltl = Math.round(textWidth(label) * 10);
  const rtl = Math.round(textWidth(valueText) * 10);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="20" role="img" aria-label="${escapeXml(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>',
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>`,
    '<g clip-path="url(#r)">',
    `<rect width="${lw}" height="20" fill="#555"/>`,
    `<rect x="${lw}" width="${rw}" height="20" fill="${fill}"/>`,
    `<rect width="${w}" height="20" fill="url(#s)"/>`,
    '</g>',
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">',
    `<text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${ltl}">${escapeXml(label)}</text>`,
    `<text x="${lx}" y="140" transform="scale(.1)" fill="#fff" textLength="${ltl}">${escapeXml(label)}</text>`,
    `<text aria-hidden="true" x="${rx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${rtl}">${escapeXml(valueText)}</text>`,
    `<text x="${rx}" y="140" transform="scale(.1)" fill="#fff" textLength="${rtl}">${escapeXml(valueText)}</text>`,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
