// Read the people file, check it, and break each person into atoms.
//
// An "atom" is one indivisible fact: one allergy, one medication, one contact. Atoms carry a
// stable id, and the completeness invariant that runs through this whole project is stated in
// terms of them:
//
//   every atom in the input appears, whole, exactly once, somewhere in the wallet card set
//
// That invariant is the reason the layout engine paginates instead of shrinking or clipping,
// it is what src/layout.js asserts before it returns, it is re-derived from the rendered HTML
// by checks/check_independent.py, and it is what four of the sabotages attack. Silently
// dropping a person's eleventh medication is the worst bug this tool could have, so it is the
// thing checked from the most directions.

const ALLOWED_BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const SEVERITIES = ['life-threatening', 'severe', 'moderate', 'mild'];

export class PeopleFileError extends Error {}

function fail(where, message) {
  throw new PeopleFileError(`${where}: ${message}`);
}

function str(value, where, { required = true, max = 400 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(where, 'is required and was empty');
    return null;
  }
  if (typeof value !== 'string') fail(where, `must be a string, got ${typeof value}`);
  const t = value.trim();
  if (required && t === '') fail(where, 'is required and was only whitespace');
  if (t.length > max) fail(where, `is ${t.length} characters, the limit is ${max}`);
  return t === '' ? null : t;
}

function arr(value, where) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(where, `must be an array, got ${typeof value}`);
  return value;
}

/** A person's age in whole years on a given date, or null if no date of birth was given. */
export function ageOn(dateOfBirth, today) {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const ref = new Date(`${today}T00:00:00Z`);
  let years = ref.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = ref.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && ref.getUTCDate() < dob.getUTCDate())) years -= 1;
  return years;
}

/** Render one atom as the single string that goes on the card. */
function allergyText(a, where) {
  const what = str(a.what, `${where}.what`);
  const reaction = str(a.reaction, `${where}.reaction`, { required: false });
  const severity = str(a.severity, `${where}.severity`, { required: false });
  if (severity && !SEVERITIES.includes(severity)) {
    fail(`${where}.severity`, `must be one of ${SEVERITIES.join(', ')}, got ${severity}`);
  }
  const inner = [reaction, severity].filter(Boolean).join(', ');
  return inner ? `${what} (${inner})` : what;
}

function conditionText(c, where) {
  const what = str(c.what, `${where}.what`);
  const detail = str(c.detail, `${where}.detail`, { required: false });
  return detail ? `${what}: ${detail}` : what;
}

function medicationText(m, where) {
  const what = str(m.what, `${where}.what`);
  const dose = str(m.dose, `${where}.dose`, { required: false });
  return dose ? `${what} ${dose}` : what;
}

function contactText(c, where) {
  const name = str(c.name, `${where}.name`);
  const relationship = str(c.relationship, `${where}.relationship`, { required: false });
  const phone = str(c.phone, `${where}.phone`);
  const who = relationship ? `${name} (${relationship})` : name;
  return `${who} ${phone}`;
}

/** True for a severity that should be set in the alert ink. */
function isUrgent(severity) {
  return severity === 'life-threatening' || severity === 'severe';
}

export function normalizePerson(raw, index, options = {}) {
  const today = options.today || '1970-01-01';
  const where = `people[${index}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(where, 'must be an object');
  }

  const id = str(raw.id, `${where}.id`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    fail(`${where}.id`, `must be lowercase kebab-case, got ${JSON.stringify(id)}`);
  }
  const name = str(raw.name, `${where}.name`, { max: 80 });
  const dateOfBirth = str(raw.dateOfBirth, `${where}.dateOfBirth`, { required: false });
  if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    fail(`${where}.dateOfBirth`, `must be YYYY-MM-DD, got ${JSON.stringify(dateOfBirth)}`);
  }
  const bloodType = str(raw.bloodType, `${where}.bloodType`, { required: false });
  if (bloodType && !ALLOWED_BLOOD_TYPES.includes(bloodType)) {
    fail(`${where}.bloodType`, `must be one of ${ALLOWED_BLOOD_TYPES.join(', ')}, `
      + `got ${JSON.stringify(bloodType)}. Leave it out if it is not known: an absent blood `
      + 'type is safer than a guessed one.');
  }

  const atoms = [];
  const push = (section, text, extra = {}) => {
    atoms.push({
      id: `${id}/${section}/${atoms.filter((a) => a.section === section).length}`,
      section,
      text,
      urgent: false,
      ...extra
    });
  };

  arr(raw.allergies, `${where}.allergies`).forEach((a, i) => {
    const w = `${where}.allergies[${i}]`;
    if (typeof a !== 'object' || a === null) fail(w, 'must be an object with a "what" field');
    push('allergies', allergyText(a, w), { urgent: isUrgent(a.severity) });
  });
  arr(raw.conditions, `${where}.conditions`).forEach((c, i) => {
    const w = `${where}.conditions[${i}]`;
    if (typeof c !== 'object' || c === null) fail(w, 'must be an object with a "what" field');
    push('conditions', conditionText(c, w));
  });
  arr(raw.medications, `${where}.medications`).forEach((m, i) => {
    const w = `${where}.medications[${i}]`;
    if (typeof m !== 'object' || m === null) fail(w, 'must be an object with a "what" field');
    push('medications', medicationText(m, w));
  });
  arr(raw.contacts, `${where}.contacts`).forEach((c, i) => {
    const w = `${where}.contacts[${i}]`;
    if (typeof c !== 'object' || c === null) fail(w, 'must be an object with name and phone');
    push('contacts', contactText(c, w));
  });
  // Notes get a much larger limit than the other fields because an advance directive summary
  // legitimately runs to a paragraph. src/layout.js splits an atom that is taller than a whole
  // card side rather than truncating it, so a long note costs cards rather than content.
  arr(raw.notes, `${where}.notes`).forEach((n, i) => {
    push('notes', str(n, `${where}.notes[${i}]`, { max: 1000 }));
  });

  if (atoms.length === 0) {
    fail(where, 'has no allergies, conditions, medications, contacts or notes, so the card '
      + 'would carry nothing a responder could act on. Add at least one, or remove the person.');
  }
  if (!raw.contacts || arr(raw.contacts, `${where}.contacts`).length === 0) {
    fail(`${where}.contacts`, 'is empty. A card with no way to reach anybody is the one field '
      + 'a responder will look for and not find, so it is required.');
  }

  const age = ageOn(dateOfBirth, today);
  const metaParts = [];
  if (dateOfBirth) metaParts.push(`DOB ${dateOfBirth}`);
  if (age !== null && age >= 0) metaParts.push(`age ${age}`);
  const pronouns = str(raw.pronouns, `${where}.pronouns`, { required: false });
  if (pronouns) metaParts.push(pronouns);
  const language = str(raw.language, `${where}.language`, { required: false });
  if (language) metaParts.push(`speaks ${language}`);

  return {
    id,
    name,
    dateOfBirth,
    age,
    bloodType: bloodType || null,
    identityMeta: metaParts.join(' · '),
    atoms
  };
}

export function loadPeople(json, options = {}) {
  if (typeof json !== 'object' || json === null) fail('people file', 'must be a JSON object');
  const people = json.people;
  if (!Array.isArray(people)) {
    fail('people file', 'must have a top level "people" array. See people.example.json.');
  }
  if (people.length === 0) fail('people file', 'has an empty "people" array');
  const out = people.map((p, i) => normalizePerson(p, i, options));
  const seen = new Set();
  for (const person of out) {
    if (seen.has(person.id)) fail('people file', `two people share the id ${person.id}`);
    seen.add(person.id);
  }
  return out;
}

export { ALLOWED_BLOOD_TYPES, SEVERITIES };
