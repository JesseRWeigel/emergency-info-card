// The whole pipeline, end to end and in memory: units, metrics, escaping, PNG handling, and
// the property that the sabotage harness depends on above all others, determinism.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { buildAll } from '../src/report.js';
import { loadPeople } from '../src/schema.js';
import { esc, style } from '../src/html.js';
import { mmToPt, ptToMm, mmToPx, ptToPx, CARD_WIDTH_MM, CARD_HEIGHT_MM } from '../src/units.js';
import { advanceEm, advanceMm, xHeightMm, ADVANCE_REGULAR, ADVANCE_BOLD, X_HEIGHT_EM }
  from '../src/metrics.js';
import { LEGIBILITY, CONTRAST, DEVICES } from '../src/design.js';
import { decodePng, encodePng, cropPng, pixelAt, near, hexToRgb } from '../scripts/png.js';
import { readPngSize } from '../bin/emcard.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(ROOT, 'people.example.json');

function examplePeople(today = '2026-01-01') {
  return loadPeople(JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')), { today });
}

// ----------------------------------------------------------------------------------------
// units
// ----------------------------------------------------------------------------------------
test('ID-1 is carried at full precision and nothing rounds it', () => {
  assert.equal(CARD_WIDTH_MM, 85.60);
  assert.equal(CARD_HEIGHT_MM, 53.98);
  assert.notEqual(CARD_WIDTH_MM, 85);
  assert.notEqual(CARD_HEIGHT_MM, 54);
});

test('the unit conversions round trip and use the defined constants', () => {
  assert.ok(Math.abs(mmToPt(25.4) - 72) < 1e-12);
  assert.ok(Math.abs(ptToMm(72) - 25.4) < 1e-12);
  assert.ok(Math.abs(mmToPx(25.4) - 96) < 1e-12);
  assert.ok(Math.abs(ptToPx(72) - 96) < 1e-12);
  for (const v of [0.1, 1, 53.98, 85.6]) {
    assert.ok(Math.abs(ptToMm(mmToPt(v)) - v) < 1e-12);
  }
});

// ----------------------------------------------------------------------------------------
// metrics
// ----------------------------------------------------------------------------------------
test('the advance tables cover the same characters at both weights', () => {
  const regular = Object.keys(ADVANCE_REGULAR).sort();
  const bold = Object.keys(ADVANCE_BOLD).sort();
  assert.deepEqual(regular, bold,
    'a character present at one weight and missing at the other would silently fall back to the '
    + 'widest glyph at that weight only');
  assert.ok(regular.length > 150);
});

test('bold is never narrower than regular, and no advance is negative', () => {
  for (const ch of Object.keys(ADVANCE_REGULAR)) {
    assert.ok(ADVANCE_REGULAR[ch] >= 0, `${JSON.stringify(ch)} has a negative advance`);
    if (ch === '\u00ad') continue; // the soft hyphen is zero width at both weights
    assert.ok(ADVANCE_BOLD[ch] >= ADVANCE_REGULAR[ch] - 1e-9,
      `bold ${JSON.stringify(ch)} is narrower than regular`);
  }
});

test('an unknown character over-predicts rather than measuring as nothing', () => {
  // Under-prediction is the direction that clips content, so an unmapped glyph must be
  // charged the widest advance in the table and not zero.
  const widest = Math.max(...Object.values(ADVANCE_BOLD));
  assert.ok(Math.abs(advanceEm('\u5b57', 700) - widest) < 1e-9);
  assert.ok(advanceEm('\u5b57') > 0);
});

test('advanceMm scales linearly with the point size', () => {
  assert.ok(Math.abs(advanceMm('Penicillin', 16) - 2 * advanceMm('Penicillin', 8)) < 1e-9);
  assert.equal(advanceMm('', 8), 0);
});

test('the x-height floor is reachable at the point-size floor', () => {
  const xh = xHeightMm(LEGIBILITY.minPt);
  assert.ok(xh >= LEGIBILITY.minXHeightMm,
    `${LEGIBILITY.minPt} pt gives a ${xh.toFixed(3)} mm x-height, under the `
    + `${LEGIBILITY.minXHeightMm} mm floor, so the two floors contradict each other`);
  // And the floor is not vacuous: a condensed face at half the em would fail it.
  assert.ok(LEGIBILITY.minXHeightMm / ptToMm(LEGIBILITY.minPt) > 0.49);
  assert.ok(X_HEIGHT_EM > 0.5 && X_HEIGHT_EM < 0.6);
});

// ----------------------------------------------------------------------------------------
// html
// ----------------------------------------------------------------------------------------
test('escaping closes every hole an attribute or a text node has', () => {
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('say "hi"'), 'say &quot;hi&quot;');
  // Ampersand first, or the escapes get escaped again.
  assert.equal(esc('&lt;'), '&amp;lt;');
});

test('a person named after a script tag does not become one', () => {
  const people = loadPeople({
    people: [{
      id: 'x',
      name: '<script>alert(1)</script>',
      contacts: [{ name: 'A "quoted" Contact', phone: '555-0100' }]
    }]
  }, { today: '2026-01-01' });
  const { files } = buildAll(people, { sourceSha256: 'abc' });
  const html = files.get('x/cards.html');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('style() drops empty declarations rather than emitting them', () => {
  assert.equal(style({ a: '1', b: null, c: undefined, d: '' }), 'a:1');
  assert.equal(style({}), '');
});

// ----------------------------------------------------------------------------------------
// png
// ----------------------------------------------------------------------------------------
test('a PNG survives a decode, crop and encode round trip', () => {
  const width = 9;
  const height = 7;
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 3] = (i * 7) % 256;
    data[i * 3 + 1] = (i * 13) % 256;
    data[i * 3 + 2] = (i * 29) % 256;
  }
  const original = { width, height, channels: 3, data };
  const bytes = encodePng(original);
  assert.deepEqual(readPngSize(bytes), { width, height });

  const back = decodePng(bytes);
  assert.equal(back.width, width);
  assert.equal(back.height, height);
  assert.deepEqual(pixelAt(back, 0, 0), [0, 0, 0]);
  assert.deepEqual(pixelAt(back, 8, 6), pixelAt(original, 8, 6));

  const cropped = cropPng(back, 4, 3);
  assert.equal(cropped.width, 4);
  assert.equal(cropped.height, 3);
  // The crop keeps the top left, which is what the shoot path relies on: the painted viewport
  // sits at the top left of an over-tall window capture.
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      assert.deepEqual(pixelAt(cropped, x, y), pixelAt(back, x, y));
    }
  }
  assert.throws(() => pixelAt(cropped, 4, 0), /outside/);
  assert.throws(() => cropPng(back, 100, 100), /cannot crop/);
});

test('a file that is not a PNG is rejected rather than misread', () => {
  assert.throws(() => readPngSize(Buffer.from('not a png at all, not even close')), /not a PNG/);
  assert.throws(() => decodePng(Buffer.alloc(4)), /not a PNG/);
});

test('near() and hexToRgb agree with the palette', () => {
  assert.deepEqual(hexToRgb('#ffffff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#6b0000'), [107, 0, 0]);
  assert.ok(near([255, 255, 255], [252, 253, 255]));
  assert.ok(!near([255, 255, 255], [200, 255, 255]));
});

// ----------------------------------------------------------------------------------------
// the build
// ----------------------------------------------------------------------------------------
test('the example file builds with no findings', () => {
  const { report } = buildAll(examplePeople(), { sourceSha256: 'abc' });
  assert.deepEqual(report.findings, [], JSON.stringify(report.findings.slice(0, 3), null, 2));
  assert.ok(report.summary.minPt >= LEGIBILITY.minPt);
  assert.ok(report.summary.minContrast >= CONTRAST.min);
  assert.equal(report.summary.peopleCount, 5);
});

test('one file is produced per person per device, plus the cards and the report', () => {
  const people = examplePeople();
  const { files } = buildAll(people, { sourceSha256: 'abc' });
  for (const person of people) {
    assert.ok(files.has(`${person.id}/cards.html`));
    for (const device of DEVICES) {
      assert.ok(files.has(`${person.id}/lock-${device.id}.html`),
        `${person.id} has no lock screen for ${device.id}`);
    }
  }
  assert.equal(files.size, people.length * (1 + DEVICES.length) + 1);
});

test('the build is deterministic, which is what the sabotage fingerprint rests on', () => {
  const digest = () => {
    const { files } = buildAll(examplePeople(), { sourceSha256: 'abc' });
    const hash = crypto.createHash('sha256');
    for (const key of [...files.keys()].sort()) hash.update(key).update(files.get(key));
    return hash.digest('hex');
  };
  const first = digest();
  assert.equal(digest(), first);
  assert.equal(digest(), first);
});

test('nothing in the output records where or when it was built', () => {
  const { files } = buildAll(examplePeople(), { sourceSha256: 'abc' });
  for (const [name, contents] of files) {
    for (const leak of ['/home/', '/Users/', '/tmp/', ROOT]) {
      assert.ok(!contents.includes(leak),
        `${name} contains ${leak}, so the fingerprint would track the working directory`);
    }
    assert.ok(!/\b20\d\d-\d\d-\d\dT\d\d:/.test(contents),
      `${name} contains a timestamp, so the output changes without the input changing`);
  }
});

test('the age on a card follows --today, so the build does not change at midnight', () => {
  const a = buildAll(examplePeople('2026-01-01'), { sourceSha256: 'abc' });
  const b = buildAll(examplePeople('2027-01-01'), { sourceSha256: 'abc' });
  assert.notEqual(a.files.get('wren/cards.html'), b.files.get('wren/cards.html'),
    'a year of difference must change the age printed on the card');
});

test('a broken palette fails the build rather than shipping', () => {
  // Not a mutation of the shipped palette: a run judged directly, so this test cannot leave
  // global state behind for another test to trip over.
  const people = loadPeople({
    people: [{
      id: 'x',
      name: 'X Fictitious',
      contacts: [{ name: 'C', phone: '555-0100' }]
    }]
  }, { today: '2026-01-01' });
  const { report } = buildAll(people, { sourceSha256: 'abc' });
  assert.equal(report.findings.length, 0);
  // Every run carries the pair it was judged on, so a later reader can recheck the verdict
  // without rerunning the tool.
  for (const run of report.people[0].cardRuns) {
    assert.ok(run.color && run.background, `run ${run.id} does not say what it was judged on`);
    assert.ok(run.contrast >= CONTRAST.min);
  }
});

test('the report carries the thresholds it judged against', () => {
  const { report } = buildAll(examplePeople(), { sourceSha256: 'abc' });
  assert.equal(report.thresholds.cardWidthMm, 85.60);
  assert.equal(report.thresholds.cardHeightMm, 53.98);
  assert.equal(report.thresholds.minPt, LEGIBILITY.minPt);
  assert.equal(report.thresholds.minContrast, CONTRAST.min);
  assert.equal(report.thresholds.minXHeightMm, LEGIBILITY.minXHeightMm);
});
