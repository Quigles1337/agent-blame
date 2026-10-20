import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBadge, formatBadgePercent, bandColor, CHAR_WIDTH, PADDING } from '../src/badge.js';

/** Minimal tag-balance check: every opening tag is closed in order; self-closing tags are ignored. */
function assertBalanced(svg) {
  const stack = [];
  const re = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)[^<>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) {
      assert.equal(stack.pop(), name, `unexpected </${name}>`);
    } else {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], 'unclosed tags');
}

test('badge SVG is well formed, self-contained and sized from the text', () => {
  const svg = renderBadge({ share: 0.43 });
  assertBalanced(svg);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.match(svg, /<title>AI-assisted: 43%<\/title>/);
  assert.match(svg, /aria-label="AI-assisted: 43%"/);
  assert.equal((svg.match(/>AI-assisted</g) ?? []).length, 2, 'label text drawn twice (shadow + fill)');
  assert.equal((svg.match(/>43%</g) ?? []).length, 2);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), 'no external resources');
  assert.ok(!/<script|@import|url\((?!#)/.test(svg));

  const lw = Math.round('AI-assisted'.length * CHAR_WIDTH + PADDING * 2);
  const rw = Math.round('43%'.length * CHAR_WIDTH + PADDING * 2);
  assert.match(svg, new RegExp(`width="${lw + rw}" height="20"`));
  assert.match(svg, new RegExp(`<rect width="${lw}" height="20" fill="#555"/>`));
  assert.match(svg, new RegExp(`<rect x="${lw}" width="${rw}" height="20" fill="#[0-9a-f]{6}"/>`));
});

test('badge percent formatting', () => {
  assert.equal(formatBadgePercent(0), '0%');
  assert.equal(formatBadgePercent(0.001), '<1%');
  assert.equal(formatBadgePercent(0.004), '<1%');
  assert.equal(formatBadgePercent(0.005), '1%');
  assert.equal(formatBadgePercent(0.426), '43%');
  assert.equal(formatBadgePercent(0.995), '100%');
  assert.equal(formatBadgePercent(1), '100%');
  assert.equal(formatBadgePercent(NaN), '0%');
  assert.equal(formatBadgePercent(7), '100%');
});

test('colour band runs from grey to blue and is monotone', () => {
  assert.equal(bandColor(0), '#9f9f9f');
  assert.equal(bandColor(1), '#007ec6');
  const reds = [0, 0.25, 0.5, 0.75, 1].map((s) => parseInt(bandColor(s).slice(1, 3), 16));
  for (let i = 1; i < reds.length; i += 1) assert.ok(reds[i] <= reds[i - 1], 'red channel decreases toward blue');
  assert.match(bandColor(0.5), /^#[0-9a-f]{6}$/);
});

test('badge escapes XML in custom label and value', () => {
  const svg = renderBadge({ share: 0.5, label: 'AI <code> & "stuff"', value: "1'" });
  assertBalanced(svg);
  assert.match(svg, /AI &lt;code&gt; &amp; &quot;stuff&quot;/);
  assert.match(svg, /1&apos;/);
  assert.ok(!svg.includes('<code>'));
});
