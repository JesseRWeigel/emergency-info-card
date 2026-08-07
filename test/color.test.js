// The sRGB arithmetic, against values worked out from the specification by hand.
//
// Every expected number here was computed from IEC 61966-2-1 and the WCAG 2.x definition rather
// than from a run of the code, so these tests can fail. A test whose expectation was pasted
// from the output it checks is a record of what the code did, not of what it should do.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseColor, channelToLinear, relativeLuminance, contrastRatio, composite }
  from '../src/color.js';
import { PALETTE, CONTRAST } from '../src/design.js';

test('parseColor reads the three notations and refuses everything else', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#6b0000'), { r: 107, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.equal(parseColor('rgba(0, 0, 0, 0.5)').a, 0.5);
  // "could not read this colour" must not collapse into "black". If it did, an unparseable
  // colour would score 21:1 against white and pass the contrast floor.
  assert.equal(parseColor('rebeccapurple'), null);
  assert.equal(parseColor(''), null);
  assert.equal(parseColor(undefined), null);
  assert.equal(parseColor('#ff'), null);
});

test('the transfer function keeps its linear segment near black', () => {
  // The breakpoint is 0.03928, which is channel 10.0164. Channel 10 is below it and takes the
  // linear branch: 10/255/12.92 = 0.0030352...
  assert.ok(Math.abs(channelToLinear(10) - (10 / 255 / 12.92)) < 1e-15);
  // Channel 11 is above it and takes the power branch.
  const c = 11 / 255;
  assert.ok(Math.abs(channelToLinear(11) - ((c + 0.055) / 1.055) ** 2.4) < 1e-15);
  // Dropping the segment is the classic simplification. It would make channel 10 come out at
  // ((10/255 + 0.055)/1.055)^2.4 = 0.00300... which is LOWER than the correct value, so every
  // ratio involving a near-black colour comes out inflated. The two must differ.
  assert.notEqual(channelToLinear(10), ((10 / 255 + 0.055) / 1.055) ** 2.4);
  assert.equal(channelToLinear(0), 0);
  assert.ok(Math.abs(channelToLinear(255) - 1) < 1e-12);
});

test('luminance uses the per-channel weights, not an average', () => {
  assert.ok(Math.abs(relativeLuminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-12);
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  // Pure green is 0.7152, pure red 0.2126, pure blue 0.0722. Equal weights would make all
  // three 0.3333 and would pass a test that only checked black and white.
  assert.ok(Math.abs(relativeLuminance({ r: 0, g: 255, b: 0 }) - 0.7152) < 1e-12);
  assert.ok(Math.abs(relativeLuminance({ r: 255, g: 0, b: 0 }) - 0.2126) < 1e-12);
  assert.ok(Math.abs(relativeLuminance({ r: 0, g: 0, b: 255 }) - 0.0722) < 1e-12);
});

test('contrast is (L1 + 0.05) / (L2 + 0.05)', () => {
  // Black on white: (1 + 0.05) / (0 + 0.05) = 21 exactly.
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-12);
  assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 1e-12);
  // Anything against itself is 1:1.
  assert.ok(Math.abs(contrastRatio('#6b0000', '#6b0000') - 1) < 1e-12);
  // Without the +0.05 flare offsets, black on white would be 1/0 and this would be Infinity.
  assert.ok(Number.isFinite(contrastRatio('#000000', '#ffffff')));
  assert.equal(contrastRatio('nonsense', '#ffffff'), null);
});

test('a translucent foreground is composited before it is judged', () => {
  const over = composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(over, { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  // 50% black on white is mid grey, which is nowhere near 21:1. Judging the declared colour
  // rather than the painted one would say it was.
  const ratio = contrastRatio('rgba(0,0,0,0.5)', '#ffffff');
  assert.ok(ratio > 3 && ratio < 5, `expected a mid-grey ratio, got ${ratio}`);
});

test('the shipped palette clears the contrast floor on both ink pairs', () => {
  const inkOnPaper = contrastRatio(PALETTE.ink, PALETTE.paper);
  const alertOnPaper = contrastRatio(PALETTE.alert, PALETTE.paper);
  const paperOnAlert = contrastRatio(PALETTE.alertInk, PALETTE.alert);
  for (const [name, ratio] of [['ink on paper', inkOnPaper], ['alert on paper', alertOnPaper],
    ['alert ink on alert', paperOnAlert]]) {
    assert.ok(ratio >= CONTRAST.min,
      `${name} is ${ratio.toFixed(3)}:1, under the ${CONTRAST.min}:1 floor`);
  }
  // And the floor itself is well above WCAG AAA, which is the claim the README makes.
  assert.ok(CONTRAST.min > 7);
});
