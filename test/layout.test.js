// The layout engine, and above all the promise that nothing falls off a card.

import test from 'node:test';
import assert from 'node:assert/strict';

import { wrapText, layoutPerson, CONTENT_WIDTH_MM, CONTENT_HEIGHT_MM, SPLIT_MARKER }
  from '../src/layout.js';
import { advanceMm } from '../src/metrics.js';
import { CARD, TYPE, LEGIBILITY } from '../src/design.js';
import { normalizePerson } from '../src/schema.js';

const measure = (pt = 8, weight = 400) => (t) => advanceMm(t, pt, weight);

/** A person built from the fields the schema requires, plus whatever the test needs. */
function person(overrides = {}) {
  return normalizePerson({
    id: 'subject',
    name: 'Test Subject',
    contacts: [{ name: 'A Contact', phone: '555-0100' }],
    ...overrides
  }, 0, { today: '2026-01-01' });
}

test('the content box is ID-1 less two margins, and nothing is rounded', () => {
  assert.equal(CARD.widthMm, 85.60);
  assert.equal(CARD.heightMm, 53.98);
  assert.ok(Math.abs(CONTENT_WIDTH_MM - (85.60 - 6)) < 1e-12);
  assert.ok(Math.abs(CONTENT_HEIGHT_MM - (53.98 - 6)) < 1e-12);
});

test('wrapText always returns at least one line', () => {
  assert.deepEqual(wrapText('', 50, measure()).lines, ['']);
  assert.deepEqual(wrapText('   ', 50, measure()).lines, ['']);
});

test('wrapText breaks at spaces, hyphens and slashes', () => {
  const wide = wrapText('Sacubitril valsartan 49/51 mg', 200, measure());
  assert.equal(wide.lines.length, 1);

  const hyphen = wrapText('Nonexistent-Fabrication', 12, measure());
  assert.ok(hyphen.lines.length > 1, 'a hyphenated surname must be breakable');
  // The separator stays on the left piece, so a line that breaks at a hyphen still ends in one
  // and the reader can tell the word continues.
  assert.ok(hyphen.lines[0].endsWith('-'), `got ${JSON.stringify(hyphen.lines[0])}`);
  assert.equal(hyphen.lines.join(''), 'Nonexistent-Fabrication');
});

test('wrapText reports an unbreakable token rather than chopping it', () => {
  const { lines, overWide } = wrapText('Pneumonoultramicroscopicsilicovolcanoconiosis', 6,
    measure());
  assert.equal(overWide.length, 1);
  // The whole word survives. Cutting a drug name at an arbitrary letter is worse than a line
  // that runs long, and the caller is told so it can fail the build.
  assert.ok(lines.join('').includes('Pneumonoultramicroscopicsilicovolcanoconiosis'));
});

/**
 * Put wrapped lines back together the way a reader does.
 *
 * A break at a space loses the space, so the pieces rejoin with one. A break after a hyphen or
 * a slash keeps the separator on the left piece and inserts nothing, which is why "875/125 mg"
 * rejoins as "875/125" and not "875/ 125".
 */
function rejoin(lines) {
  return lines.reduce((acc, line, i) => {
    if (i === 0) return line;
    return /[-/]$/.test(acc) ? acc + line : `${acc} ${line}`;
  }, '');
}

test('no line produced by wrapText exceeds the width it was given', () => {
  const text = 'Amoxicillin clavulanate 875/125 mg twice daily with food for ten days';
  for (const width of [20, 30, 45, 79.6]) {
    const { lines } = wrapText(text, width, measure());
    for (const line of lines) {
      assert.ok(measure()(line) <= width + 1e-9,
        `${JSON.stringify(line)} is ${measure()(line).toFixed(3)} mm in a ${width} mm column`);
    }
    // And not one character is lost on the way, at any column width.
    assert.equal(rejoin(lines), text, `reassembly failed at ${width} mm`);
  }
});

test('a short record fits on one card, which is the negative control', () => {
  const laid = layoutPerson(person({
    allergies: [{ what: 'Penicillin', severity: 'severe' }]
  }));
  assert.equal(laid.cardCount, 1);
  assert.equal(laid.contentSides, 1);
  assert.equal(laid.report.splitAtoms.length, 0);
  assert.equal(laid.report.overWideWords.length, 0);
  // Sides are padded to an even count so a duplex print lines up, and the padding side says so
  // rather than being left blank and ambiguous.
  assert.equal(laid.sides.length, 2);
  assert.equal(laid.sides[1].filler, true);
  assert.equal(laid.sides[1].continuation, 'END OF RECORD');
});

test('eleven medications produce more sides and not fewer facts', () => {
  const medications = Array.from({ length: 11 }, (_, i) => ({
    what: `Medication Number ${i + 1}`,
    dose: '500 mg twice daily'
  }));
  const subject = person({ medications });
  const laid = layoutPerson(subject);

  // A card has two faces, so eleven medications overflow the FRONT and land on the back
  // without needing a second card. The property that matters is that the paginator broke at
  // all rather than compressing eleven entries into a space that holds ten.
  assert.ok(laid.contentSides > 1,
    `eleven medications were placed on ${laid.contentSides} side, which means the paginator did `
    + 'not break where it had to');

  // Every atom, exactly once. This is the invariant the whole file exists for.
  const placed = [];
  for (const side of laid.sides) {
    for (const block of side.blocks) {
      for (const entry of block.atoms) {
        if (entry.part === null || entry.part.first) placed.push(entry.atom.id);
      }
    }
  }
  assert.deepEqual(placed.slice().sort(), subject.atoms.map((a) => a.id).sort());
  assert.equal(new Set(placed).size, placed.length, 'no fact may appear twice');

  // The eleventh medication specifically. Naming it is the point: this is the bug that would
  // otherwise be invisible.
  const eleventh = subject.atoms.find((a) => a.text.startsWith('Medication Number 11'));
  assert.ok(eleventh, 'the eleventh medication is in the input');
  assert.ok(placed.includes(eleventh.id), 'the eleventh medication reached a card');
});

test('every side fits its content box, on a record that needs several', () => {
  const laid = layoutPerson(person({
    allergies: Array.from({ length: 6 }, (_, i) => ({ what: `Allergen ${i}`, reaction: 'rash' })),
    conditions: Array.from({ length: 5 }, (_, i) => ({ what: `Condition ${i}` })),
    medications: Array.from({ length: 12 }, (_, i) => ({ what: `Drug ${i}`, dose: '10 mg' })),
    notes: ['A note that runs on for a while so it takes more than one line of the card.']
  }));
  for (const side of laid.sides) {
    assert.ok(side.usedMm <= side.capacityMm + 1e-6,
      `side ${side.index} uses ${side.usedMm.toFixed(2)} of ${side.capacityMm.toFixed(2)} mm`);
  }
});

test('a section title is never left orphaned at the foot of a side', () => {
  const laid = layoutPerson(person({
    medications: Array.from({ length: 14 }, (_, i) => ({ what: `Drug ${i}`, dose: '10 mg' })),
    notes: ['One note.']
  }));
  for (const side of laid.sides) {
    for (const block of side.blocks) {
      assert.ok(block.atoms.length > 0,
        `side ${side.index} carries the heading ${JSON.stringify(block.title)} with nothing `
        + 'under it, which sends a responder looking for a list that is not there');
    }
  }
});

test('an entry taller than a whole side is split and marked, never truncated', () => {
  // Under the 1000 character limit the schema puts on a note, and still far taller than the
  // roughly ten lines a card side holds.
  const long = Array.from({ length: 26 },
    (_, i) => `clause ${i} of an advance directive`).join(', ');
  assert.ok(long.length < 1000 && long.length > 700, `note is ${long.length} characters`);
  const subject = person({ notes: [long] });
  const laid = layoutPerson(subject);

  assert.equal(laid.report.splitAtoms.length, 1);
  assert.ok(laid.report.splitAtoms[0].parts > 1);

  // Reassemble the note from its parts and require the original text back, word for word.
  const parts = [];
  for (const side of laid.sides) {
    for (const block of side.blocks) {
      for (const entry of block.atoms) {
        if (entry.atom.text === long) parts.push(...entry.lines);
      }
    }
  }
  assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(), long);

  // And every part except the last says so on its face.
  const markers = [];
  for (const side of laid.sides) {
    for (const block of side.blocks) {
      for (const entry of block.atoms) {
        if (entry.atom.text === long && entry.continuesMarker) markers.push(entry.continuesMarker);
      }
    }
  }
  assert.equal(markers.length, laid.report.splitAtoms[0].parts - 1);
  for (const marker of markers) assert.equal(marker, SPLIT_MARKER);
});

test('every side says where the reader goes next', () => {
  const laid = layoutPerson(person({
    medications: Array.from({ length: 16 }, (_, i) => ({ what: `Drug ${i}`, dose: '10 mg' }))
  }));
  const last = laid.sides[laid.sides.length - 1];
  assert.equal(last.continuation, 'END OF RECORD');
  for (const side of laid.sides.slice(0, -1)) {
    assert.ok(side.continuation !== 'END OF RECORD' || side.index >= laid.contentSides - 1,
      `side ${side.index} claims to be the end and is not`);
    assert.ok(side.footer.includes(`CARD ${side.cardNumber}/${side.cardCount}`));
  }
});

test('a name too long for two lines grows the header rather than shrinking below the floor', () => {
  const laid = layoutPerson(person({
    name: 'Wilhelmina Bartholomew Fictitious-Nonexistent-Fabrication-Placeholder'
  }));
  assert.ok(laid.header.namePt >= LEGIBILITY.minPt,
    `the name was set at ${laid.header.namePt} pt, under the ${LEGIBILITY.minPt} pt floor`);
  const rejoined = laid.header.nameLines.join(' ').replace(/\s+/g, ' ');
  assert.ok(rejoined.includes('Wilhelmina'), 'the name is not truncated');
  assert.ok(rejoined.endsWith('Placeholder'), `the end of the name survived: ${rejoined}`);
});

test('the type scale has no size below the legibility floor', () => {
  for (const [name, style] of Object.entries(TYPE)) {
    if (name === 'family') continue;
    assert.ok(style.pt >= LEGIBILITY.minPt,
      `TYPE.${name} is ${style.pt} pt, under the ${LEGIBILITY.minPt} pt floor. There is no small `
      + 'print on this card, including the footer.');
  }
});
