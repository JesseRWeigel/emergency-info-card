// The people file is the boundary between a user's real medical data and this tool. Everything
// it rejects, it rejects loudly, because a field that is silently dropped here is a fact that
// never reaches the card.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPeople, normalizePerson, ageOn, PeopleFileError, ALLOWED_BLOOD_TYPES }
  from '../src/schema.js';

const minimal = {
  id: 'subject',
  name: 'Test Subject',
  contacts: [{ name: 'A Contact', relationship: 'parent', phone: '555-0100' }]
};

const load = (people) => loadPeople({ people }, { today: '2026-01-01' });

test('a minimal person normalises', () => {
  const [p] = load([minimal]);
  assert.equal(p.id, 'subject');
  assert.equal(p.atoms.length, 1);
  assert.equal(p.atoms[0].section, 'contacts');
  assert.equal(p.atoms[0].text, 'A Contact (parent) 555-0100');
});

test('atom ids are stable, scoped to the person, and numbered within a section', () => {
  const [p] = load([{
    ...minimal,
    allergies: [{ what: 'Penicillin' }, { what: 'Latex' }],
    medications: [{ what: 'Drug', dose: '5 mg' }]
  }]);
  assert.deepEqual(p.atoms.map((a) => a.id), [
    'subject/allergies/0',
    'subject/allergies/1',
    'subject/medications/0',
    'subject/contacts/0'
  ]);
});

test('a person with no way to reach anybody is rejected', () => {
  assert.throws(() => load([{ id: 'x', name: 'X', allergies: [{ what: 'Latex' }] }]),
    PeopleFileError);
  assert.throws(() => load([{ ...minimal, contacts: [] }]), PeopleFileError);
});

test('a person with nothing on the card at all is rejected', () => {
  assert.throws(() => load([{ id: 'x', name: 'X' }]), PeopleFileError);
});

test('a blood type must be one of the eight, or absent', () => {
  for (const type of ALLOWED_BLOOD_TYPES) {
    const [p] = load([{ ...minimal, bloodType: type }]);
    assert.equal(p.bloodType, type);
  }
  // An absent blood type is safer than a guessed one, so the field is optional and a wrong
  // value is a hard error rather than a passthrough.
  const [none] = load([minimal]);
  assert.equal(none.bloodType, null);
  assert.throws(() => load([{ ...minimal, bloodType: 'O' }]), PeopleFileError);
  assert.throws(() => load([{ ...minimal, bloodType: 'Z+' }]), PeopleFileError);
});

test('a severity outside the scale is rejected rather than shown as written', () => {
  assert.throws(
    () => load([{ ...minimal, allergies: [{ what: 'Latex', severity: 'quite bad' }] }]),
    PeopleFileError);
  const [p] = load([{ ...minimal, allergies: [{ what: 'Latex', severity: 'life-threatening' }] }]);
  assert.equal(p.atoms[0].urgent, true);
  assert.equal(p.atoms[0].text, 'Latex (life-threatening)');
});

test('only life-threatening and severe are set in the alert ink', () => {
  const [p] = load([{
    ...minimal,
    allergies: [
      { what: 'A', severity: 'life-threatening' },
      { what: 'B', severity: 'severe' },
      { what: 'C', severity: 'moderate' },
      { what: 'D', severity: 'mild' },
      { what: 'E' }
    ]
  }]);
  assert.deepEqual(p.atoms.filter((a) => a.section === 'allergies').map((a) => a.urgent),
    [true, true, false, false, false]);
});

test('two people cannot share an id', () => {
  assert.throws(() => load([minimal, { ...minimal, name: 'Other' }]), PeopleFileError);
});

test('an id must be lowercase kebab-case', () => {
  assert.throws(() => load([{ ...minimal, id: 'Subject' }]), PeopleFileError);
  assert.throws(() => load([{ ...minimal, id: 'sub ject' }]), PeopleFileError);
  assert.throws(() => load([{ ...minimal, id: '-lead' }]), PeopleFileError);
  assert.doesNotThrow(() => load([{ ...minimal, id: 'a-b-9' }]));
});

test('the file itself must have the shape the README describes', () => {
  assert.throws(() => loadPeople(null), PeopleFileError);
  assert.throws(() => loadPeople({}), PeopleFileError);
  assert.throws(() => loadPeople({ people: [] }), PeopleFileError);
  assert.throws(() => loadPeople({ people: 'wren' }), PeopleFileError);
});

test('a date of birth must be a real ISO date', () => {
  assert.throws(() => load([{ ...minimal, dateOfBirth: '3 June 2019' }]), PeopleFileError);
  assert.throws(() => load([{ ...minimal, dateOfBirth: '2019-6-3' }]), PeopleFileError);
  const [p] = load([{ ...minimal, dateOfBirth: '2019-06-03' }]);
  assert.equal(p.dateOfBirth, '2019-06-03');
});

test('age counts whole years and does not round a birthday up', () => {
  assert.equal(ageOn('2019-06-03', '2026-06-02'), 6);
  assert.equal(ageOn('2019-06-03', '2026-06-03'), 7);
  assert.equal(ageOn('2019-06-03', '2026-06-04'), 7);
  assert.equal(ageOn('2000-02-29', '2026-02-28'), 25);
  assert.equal(ageOn(null, '2026-01-01'), null);
});

test('the age on the card comes from --today and not from the wall clock', () => {
  const [young] = load([{ ...minimal, dateOfBirth: '2019-06-03' }]);
  assert.ok(young.identityMeta.includes('age 6'), young.identityMeta);
  const [older] = loadPeople({ people: [{ ...minimal, dateOfBirth: '2019-06-03' }] },
    { today: '2030-01-01' });
  assert.ok(older.identityMeta.includes('age 10'), older.identityMeta);
});

test('a note may be a paragraph, and any other field may not', () => {
  const paragraph = 'x'.repeat(999);
  assert.doesNotThrow(() => load([{ ...minimal, notes: [paragraph] }]));
  assert.throws(() => load([{ ...minimal, notes: ['x'.repeat(1001)] }]), PeopleFileError);
  assert.throws(() => load([{ ...minimal, name: 'x'.repeat(81) }]), PeopleFileError);
});

test('a field of the wrong type is named in the error', () => {
  try {
    normalizePerson({ ...minimal, allergies: 'penicillin' }, 0, {});
    assert.fail('expected a rejection');
  } catch (err) {
    assert.ok(err instanceof PeopleFileError);
    assert.ok(err.message.includes('allergies'), err.message);
  }
});
