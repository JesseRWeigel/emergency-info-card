// The lock screen carries a subset, so the only thing that makes it safe is that the omission
// is never silent and never miscounted.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fitLockScreen, safeArea, renderLockScreen } from '../src/lockscreen.js';
import { DEVICES, LOCKSCREEN, SECTION_ORDER } from '../src/design.js';
import { normalizePerson } from '../src/schema.js';

function person(overrides = {}) {
  return normalizePerson({
    id: 'subject',
    name: 'Test Subject',
    bloodType: 'O+',
    contacts: [{ name: 'A Contact', relationship: 'parent', phone: '555-0100' }],
    ...overrides
  }, 0, { today: '2026-01-01' });
}

const crowded = () => person({
  allergies: Array.from({ length: 5 }, (_, i) => ({ what: `Allergen ${i}`, severity: 'severe' })),
  conditions: Array.from({ length: 4 }, (_, i) => ({ what: `Condition ${i}` })),
  medications: Array.from({ length: 11 }, (_, i) => ({ what: `Drug ${i}`, dose: '10 mg daily' })),
  notes: ['One note.', 'Another note.']
});

test('the safe area keeps clear of the clock and the shortcut row', () => {
  for (const device of DEVICES) {
    const area = safeArea(device);
    const reserve = LOCKSCREEN.reserve[device.platform];
    assert.ok(area.top >= device.cssHeight * reserve.top - 1e-9,
      `${device.id}: the panel starts at ${area.top} px, inside the clock reserve`);
    assert.ok(area.bottom <= device.cssHeight * (1 - reserve.bottom) + 1e-9,
      `${device.id}: the panel ends at ${area.bottom} px, inside the shortcut reserve`);
    assert.ok(area.height > 0 && area.width > 0);
    assert.ok(area.left > 0 && area.right < device.cssWidth);
  }
});

test('every device is exercised at a different aspect ratio', () => {
  const ratios = DEVICES.map((d) => (d.cssHeight / d.cssWidth).toFixed(3));
  assert.ok(new Set(ratios).size >= 2,
    `the devices cover ${new Set(ratios).size} aspect ratio(s); the safe-area claim needs at `
    + 'least two, because a panel that fits a tall screen can fall off a short one');
  // The short one matters most: 667 px is where the omission path is forced.
  assert.ok(DEVICES.some((d) => d.cssHeight <= 700), 'a short phone is in the device list');
  assert.ok(DEVICES.some((d) => d.cssHeight >= 850), 'a tall phone is in the device list');
});

test('every fact is either shown or counted, on every device', () => {
  const subject = crowded();
  for (const device of DEVICES) {
    const fit = fitLockScreen(subject, device);
    assert.equal(fit.placed.length + fit.omitted.length, subject.atoms.length,
      `${device.id}: ${fit.placed.length} shown and ${fit.omitted.length} deferred is not the `
      + `${subject.atoms.length} facts this person has`);
    const ids = new Set([...fit.placed, ...fit.omitted].map((a) => a.id));
    assert.equal(ids.size, subject.atoms.length, `${device.id}: a fact was counted twice`);
  }
});

test('a crowded record does overflow, so the omission path is really exercised', () => {
  const subject = crowded();
  for (const device of DEVICES) {
    const fit = fitLockScreen(subject, device);
    assert.ok(fit.omitted.length > 0,
      `${device.id}: 26 facts all fit on a phone screen, which means this test is not testing `
      + 'the overflow path');
    assert.ok(fit.note, `${device.id}: facts were deferred with no note`);
  }
});

test('the omission note states the true count and a breakdown that adds up', () => {
  const subject = crowded();
  for (const device of DEVICES) {
    const fit = fitLockScreen(subject, device);
    const stated = /^\+(\d+) MORE ON WALLET CARD: (.*)$/.exec(fit.note);
    assert.ok(stated, `${device.id}: the note does not have the expected shape: ${fit.note}`);
    assert.equal(Number(stated[1]), fit.omitted.length);

    const parts = stated[2].split(', ').map((p) => {
      const m = /^(\d+) (.+)$/.exec(p);
      assert.ok(m, `${device.id}: unreadable part ${JSON.stringify(p)}`);
      return { n: Number(m[1]), noun: m[2] };
    });
    assert.equal(parts.reduce((a, p) => a + p.n, 0), fit.omitted.length,
      `${device.id}: the breakdown does not add up to the stated total`);
    // Singular and plural. "1 allergies" makes a reader trust the rest of the card less.
    const singular = new Set(['allergy', 'condition', 'medication', 'contact', 'note']);
    const plural = new Set(['allergies', 'conditions', 'medications', 'contacts', 'notes']);
    for (const part of parts) {
      const want = part.n === 1 ? singular : plural;
      assert.ok(want.has(part.noun),
        `${device.id}: "${part.n} ${part.noun}" uses the wrong number`);
    }
  }
});

test('a record that fits produces no note at all', () => {
  const subject = person({ allergies: [{ what: 'Penicillin', severity: 'severe' }] });
  for (const device of DEVICES) {
    const fit = fitLockScreen(subject, device);
    assert.equal(fit.omitted.length, 0, `${device.id}: a two-fact record deferred something`);
    assert.equal(fit.note, null, `${device.id}: a note appeared with nothing to report`);
  }
});

test('the most urgent sections survive the truncation', () => {
  // Truncation is from the bottom of a priority order, so an allergy is the last thing to go.
  const subject = crowded();
  for (const device of DEVICES) {
    const fit = fitLockScreen(subject, device);
    const placedSections = new Set(fit.placed.map((a) => a.section));
    assert.ok(placedSections.has('allergies'),
      `${device.id}: allergies were dropped from the lock screen. A drug allergy changes what a `
      + 'responder gives in the first two minutes, so it is the one thing that must survive.');
    // Nothing may be placed from a section that ranks below the first omitted one.
    const omittedRanks = fit.omitted.map((a) => SECTION_ORDER.indexOf(a.section));
    const placedRanks = fit.placed.map((a) => SECTION_ORDER.indexOf(a.section));
    if (omittedRanks.length > 0) {
      assert.ok(Math.min(...omittedRanks) >= Math.max(...placedRanks) - 0,
        `${device.id}: a lower priority fact was kept over a higher priority one`);
    }
  }
});

test('nothing rendered on the screen is below the pixel floor', () => {
  const subject = crowded();
  for (const device of DEVICES) {
    const { runs } = renderLockScreen(subject, device, { sourceSha256: 'x', minContrast: 12 });
    assert.ok(runs.length > 0);
    for (const run of runs) {
      assert.ok(run.px >= LOCKSCREEN.minPx,
        `${device.id} ${run.id}: ${run.px} px is under the ${LOCKSCREEN.minPx} px floor`);
      assert.ok(run.predictedWidthPx <= run.containerWidthPx + 0.05,
        `${device.id} ${run.id}: ${run.predictedWidthPx.toFixed(2)} px of text in a `
        + `${run.containerWidthPx.toFixed(2)} px column`);
    }
  }
});

test('the rendered page declares the device it was built for', () => {
  for (const device of DEVICES) {
    const { html } = renderLockScreen(person(), device, { sourceSha256: 'abc', minContrast: 12 });
    assert.ok(html.includes(`data-device="${device.id}"`));
    assert.ok(html.includes(`data-css-width="${device.cssWidth}"`));
    assert.ok(html.includes(`data-dpr="${device.dpr}"`));
    // No overflow:hidden anywhere. Hiding an overflow would make the probe that looks for one
    // vacuous, which is worse than the overflow.
    assert.ok(!/overflow\s*:\s*hidden/.test(html),
      `${device.id}: the page hides overflow, so a card that runs off the screen would look fine`);
  }
});

test('an unknown platform is an error rather than a default safe area', () => {
  assert.throws(() => safeArea({ id: 'x', cssWidth: 400, cssHeight: 800, platform: 'symbian' }),
    /safe-area reserve/);
});
