// Fit a person onto card sides, and never drop anything.
//
// The rule this file exists to enforce: text is never scaled below the legibility floor and is
// never clipped. When the content does not fit, the card set grows. A person with eleven
// medications gets a second card, and every side that is not the last one says so on its face.
//
// Three things follow from that and are implemented here rather than left to CSS:
//
//   1. Line breaking happens in JavaScript against a measured advance-width table, so this
//      module knows how tall a field will be before anything is rendered. CSS wrapping would
//      make the height a surprise, and a surprise height is an overflow.
//   2. An atom is indivisible. One allergy, one medication or one contact never straddles two
//      sides, except in the single case where the atom alone is taller than an empty side, and
//      that case is flagged in the report rather than handled quietly.
//   3. Every side is checked against the content box after it is built. The check is an
//      assertion in code, not a comment, and it throws.
//
// The completeness invariant is asserted at the end of layoutPerson: the multiset of atom ids
// placed equals the multiset of atom ids in. checks/check_independent.py re-derives the same
// invariant from the rendered HTML by a different route, because an invariant that only the
// producing code checks is an invariant the producing code can be wrong about.

import { CARD, TYPE, SECTION_ORDER, SECTION_TITLES, LEGIBILITY } from './design.js';
import { advanceMm, xHeightMm } from './metrics.js';
import { ptToMm } from './units.js';

/** Vertical space above a section title that is not the first thing on a side. */
const SECTION_GAP_MM = 1.0;
/** Space between the header rule and the first line of content. */
const HEADER_GAP_MM = 0.9;
/** Space between the last line of content and the footer rule. */
const FOOTER_GAP_MM = 0.9;
/** Hanging indent for the wrapped lines of a bulleted atom. */
const BULLET_INDENT_MM = 2.6;
/** Padding inside the filled allergy band, top and bottom. */
const BAND_PAD_MM = 0.5;
/** Gap between the name column and the blood type badge. */
const BADGE_GAP_MM = 2.0;
const BADGE_PAD_MM = 1.4;
/** Printed at the foot of every part of an atom that had to be split across sides. */
export const SPLIT_MARKER = '(CONTINUES ON NEXT SIDE)';

export const CONTENT_WIDTH_MM = CARD.widthMm - 2 * CARD.marginMm;
export const CONTENT_HEIGHT_MM = CARD.heightMm - 2 * CARD.marginMm;

/** Height of one line box in millimetres. */
export const lineHeightMm = (style) => ptToMm(style.pt * style.lineHeight);

/**
 * Split text into the pieces a line may end after.
 *
 * Spaces are the obvious break opportunity. Hyphens and slashes are the other one, and they
 * matter here because the content is full of hyphenated surnames and of things like
 * "Sacubitril valsartan 49/51 mg". Without a hyphen break, "Nonexistent-Fabrication" is a
 * single 23 character token that does not fit the panel on a 360 px phone, and the only
 * remaining options are to over-run the column or to shrink the name.
 *
 * The separator stays on the left piece, so a line that breaks at a hyphen still ends in one.
 */
function tokenize(text) {
  const words = String(text).split(/\s+/).filter((w) => w !== '');
  const tokens = [];
  words.forEach((word, wordIndex) => {
    const pieces = word.split(/(?<=[-/])/).filter((p) => p !== '');
    pieces.forEach((piece, pieceIndex) => {
      tokens.push({ text: piece, glue: pieceIndex === 0 && wordIndex > 0 ? ' ' : '' });
    });
  });
  return tokens;
}

/**
 * Greedy wrap against a measured width function.
 *
 * Returns at least one line, always. A token that is wider than the column even on a line of
 * its own is placed anyway and reported through `overWide`, because chopping a drug name at an
 * arbitrary letter is worse than a line that runs long, and because the caller has to know it
 * happened. Nothing downstream treats `overWide` as acceptable: src/report.js turns the
 * resulting over-wide line into a finding and the build fails.
 */
export function wrapText(text, maxWidth, measure) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { lines: [''], overWide: [] };
  const lines = [];
  const overWide = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current === '' ? token.text : current + token.glue + token.text;
    if (current === '') {
      if (measure(token.text) > maxWidth) {
        overWide.push(token.text);
        lines.push(token.text);
        continue;
      }
      current = token.text;
    } else if (measure(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      if (measure(token.text) > maxWidth) {
        overWide.push(token.text);
        lines.push(token.text);
        current = '';
      } else {
        current = token.text;
      }
    }
  }
  if (current !== '') lines.push(current);
  return { lines, overWide };
}

/** Choose a name size and wrapping that fits the header without going below the floor. */
function fitName(name, columnWidthMm) {
  const candidates = [TYPE.name.pt, 10.0, 9.0, LEGIBILITY.minPt];
  for (const size of candidates) {
    const { lines, overWide } = wrapText(name, columnWidthMm,
      (t) => advanceMm(t, size, TYPE.name.weight));
    if (lines.length <= 2 && overWide.length === 0) {
      return { pt: size, lines, grew: false };
    }
  }
  // Nothing fit in two lines at or above the floor. The name is not shrunk further and it is
  // not truncated: the header grows and the content box shrinks. A card that says who it
  // belongs to and needs a second side is correct. A card with a cut-off name is not.
  const { lines } = wrapText(name, columnWidthMm,
    (t) => advanceMm(t, LEGIBILITY.minPt, TYPE.name.weight));
  return { pt: LEGIBILITY.minPt, lines, grew: true };
}

/** Geometry of the identity header, which repeats on every side. */
export function buildHeader(person) {
  let badge = null;
  let nameColumn = CONTENT_WIDTH_MM;
  if (person.bloodType) {
    const labelW = advanceMm('BLOOD', TYPE.sectionTitle.pt, TYPE.sectionTitle.weight);
    const valueW = advanceMm(person.bloodType, TYPE.bloodType.pt, TYPE.bloodType.weight);
    const boxW = Math.max(labelW, valueW) + 2 * BADGE_PAD_MM;
    badge = {
      widthMm: boxW,
      heightMm: lineHeightMm(TYPE.sectionTitle) + lineHeightMm(TYPE.bloodType) + 2 * BADGE_PAD_MM,
      label: 'BLOOD',
      value: person.bloodType
    };
    nameColumn = CONTENT_WIDTH_MM - boxW - BADGE_GAP_MM;
  }

  const name = fitName(person.name, nameColumn);
  const metaWrap = person.identityMeta
    ? wrapText(person.identityMeta, nameColumn,
      (t) => advanceMm(t, TYPE.identityMeta.pt, TYPE.identityMeta.weight))
    : { lines: [], overWide: [] };

  const textHeight = name.lines.length * ptToMm(name.pt * TYPE.name.lineHeight)
    + metaWrap.lines.length * lineHeightMm(TYPE.identityMeta);
  const heightMm = Math.max(textHeight, badge ? badge.heightMm : 0) + HEADER_GAP_MM;

  return {
    namePt: name.pt,
    nameLines: name.lines,
    nameGrew: name.grew,
    metaLines: metaWrap.lines,
    nameColumnMm: nameColumn,
    badge,
    heightMm
  };
}

function footerHeightMm() {
  return lineHeightMm(TYPE.footer) + FOOTER_GAP_MM;
}

/** Turn one atom into the lines it occupies, and the height of those lines. */
function measureAtom(atom, widthMm) {
  const style = TYPE.body;
  const firstWidth = widthMm - BULLET_INDENT_MM;
  const { lines, overWide } = wrapText(atom.text, firstWidth,
    (t) => advanceMm(t, style.pt, style.weight));
  return {
    lines,
    overWide,
    heightMm: lines.length * lineHeightMm(style),
    indentMm: BULLET_INDENT_MM
  };
}

function titleHeightMm(section) {
  const base = lineHeightMm(TYPE.sectionTitle);
  return section === 'allergies' ? base + 2 * BAND_PAD_MM : base;
}

/**
 * The atom ids a laid-out set of sides actually carries.
 *
 * A split atom is rendered once per part and counted once, at its first part, because it is
 * still one fact.
 */
export function placedAtomIds(sides) {
  const ids = [];
  for (const side of sides) {
    for (const block of side.blocks) {
      for (const entry of block.atoms) {
        if (entry.part === null || entry.part.first) ids.push(entry.atom.id);
      }
    }
  }
  return ids;
}

/**
 * Every side must fit its content box.
 *
 * An assertion rather than a warning: a side that does not fit is a clipped card, and a clipped
 * card is the failure this whole file exists to prevent.
 *
 * Exported and taking plain data rather than living inline in layoutPerson, because a guard
 * that only fires when the surrounding code is already broken cannot be tested where it sits.
 * The sabotage harness found exactly that: deleting this check changed no output and no test
 * noticed, which makes it a comment rather than a guard. Now test/layout.test.js hands it a
 * side that overflows and requires it to throw.
 */
export function assertSidesFit(sides, personId) {
  for (const s of sides) {
    if (s.usedMm > s.capacityMm + 1e-6) {
      throw new Error(
        `${personId}: side ${s.index + 1} needs ${s.usedMm.toFixed(2)} mm of a `
        + `${s.capacityMm.toFixed(2)} mm content box. The paginator failed to break, which `
        + 'means content would be clipped.');
    }
  }
}

/**
 * Placed atom ids, counted, against input atom ids, counted.
 *
 * Exported for the same reason as assertSidesFit: this is the check that catches a silently
 * dropped eleventh medication, so it is the last thing that may go untested.
 */
export function assertComplete(placedIds, inputIds, personId) {
  const missing = inputIds.filter((id) => !placedIds.includes(id));
  const duplicated = placedIds.filter((id, i) => placedIds.indexOf(id) !== i);
  const unexpected = placedIds.filter((id) => !inputIds.includes(id));
  if (missing.length > 0 || duplicated.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${personId}: the layout lost or repeated content. Missing: `
      + `${missing.join(', ') || 'none'}. Duplicated: ${duplicated.join(', ') || 'none'}. `
      + `Unexpected: ${unexpected.join(', ') || 'none'}. `
      + 'Nothing is allowed to fall off a card.');
  }
}

/**
 * Lay one person out onto sides.
 *
 * Returns { sides, cards, report }. Throws if the completeness invariant fails, because a
 * layout engine that can lose a fact and return successfully is a layout engine whose output
 * cannot be trusted at all.
 */
export function layoutPerson(person) {
  const header = buildHeader(person);
  const footerH = footerHeightMm();
  const bodyHeightMm = CONTENT_HEIGHT_MM - header.heightMm - footerH;
  // Three lines, not one. Two of the paths below need a side that can hold a title plus a line
  // of content, and the split path needs to be able to make progress on every iteration. A
  // content box that cannot do that would loop rather than fail, so it fails here instead.
  if (bodyHeightMm < 3 * lineHeightMm(TYPE.body)) {
    throw new Error(
      `${person.id}: the identity header for ${JSON.stringify(person.name)} leaves `
      + `${bodyHeightMm.toFixed(2)} mm for content, which is under three lines. Shorten the `
      + 'name, the pronouns or the language field.');
  }

  const sides = [];
  const splitAtoms = [];
  const overWideWords = [];
  let side = null;

  const newSide = () => {
    side = { blocks: [], usedMm: 0 };
    sides.push(side);
    return side;
  };
  const remaining = () => bodyHeightMm - side.usedMm;

  const bySection = new Map();
  for (const atom of person.atoms) {
    if (!bySection.has(atom.section)) bySection.set(atom.section, []);
    bySection.get(atom.section).push(atom);
  }

  for (const section of SECTION_ORDER) {
    const atoms = bySection.get(section);
    if (!atoms || atoms.length === 0) continue;

    let block = null;
    let emittedAny = false;

    // A section title with nothing under it is an orphan, and an orphan is not merely ugly: it
    // makes a responder turn the card over looking for a list that is not there. Two guards.
    //
    // The first is predictive, in openBlock: a title is only placed if the side can also hold
    // one line of body text. That is not sufficient on its own, because the next atom may need
    // two lines, which is exactly how "EMERGENCY CONTACTS" ended up alone at the foot of a
    // side during development. So the second guard is retrospective: whenever the paginator
    // gives up on a side, any block on it that never received an atom is removed and its
    // height refunded.
    const closeEmptyBlock = () => {
      if (block && block.atoms.length === 0) {
        const at = side.blocks.indexOf(block);
        if (at >= 0) {
          side.blocks.splice(at, 1);
          side.usedMm -= block.gapMm + block.titleHeightMm;
        }
        block = null;
      }
    };

    const openBlock = () => {
      if (side === null) newSide();
      const gap = side.blocks.length === 0 ? 0 : SECTION_GAP_MM;
      if (remaining() < gap + titleHeightMm(section) + lineHeightMm(TYPE.body)) newSide();
      const realGap = side.blocks.length === 0 ? 0 : SECTION_GAP_MM;
      block = {
        section,
        // (CONT.) only when an atom of this section has already been printed somewhere. A
        // title that was placed and then removed as an orphan never counts as printed.
        title: emittedAny ? `${SECTION_TITLES[section]} (CONT.)` : SECTION_TITLES[section],
        gapMm: realGap,
        titleHeightMm: titleHeightMm(section),
        atoms: []
      };
      side.blocks.push(block);
      side.usedMm += realGap + titleHeightMm(section);
    };

    openBlock();

    for (const atom of atoms) {
      let placed = measureAtom(atom, CONTENT_WIDTH_MM);
      overWideWords.push(...placed.overWide.map((w) => ({ atomId: atom.id, word: w })));

      if (placed.heightMm <= remaining()) {
        block.atoms.push({ atom, ...placed, continuesMarker: null, part: null });
        side.usedMm += placed.heightMm;
        emittedAny = true;
        continue;
      }

      // Does the whole atom fit on a side of its own, under a continued title?
      const freshCapacity = bodyHeightMm - titleHeightMm(section);
      if (placed.heightMm <= freshCapacity) {
        closeEmptyBlock();
        newSide();
        openBlock();
        block.atoms.push({ atom, ...placed, continuesMarker: null, part: null });
        side.usedMm += placed.heightMm;
        emittedAny = true;
        continue;
      }

      // Last resort. One atom is taller than an entire empty side, so it is split across sides
      // rather than truncated, and the split is recorded so the report and the README can both
      // be honest about it. Every part that is not the last one spends a line on an explicit
      // marker, and the next side repeats the section title with (CONT.). The reader is never
      // left to guess whether a sentence simply ended.
      const lineH = lineHeightMm(TYPE.body);
      let cursor = 0;
      let partIndex = 0;
      while (cursor < placed.lines.length) {
        if (remaining() < lineH * 2) {
          closeEmptyBlock();
          newSide();
          openBlock();
        }
        const room = Math.floor((remaining() + 1e-9) / lineH);
        const finishesWithoutMarker = cursor + room >= placed.lines.length;
        const take = Math.max(1, finishesWithoutMarker ? room : room - 1);
        const chunk = placed.lines.slice(cursor, cursor + take);
        const last = cursor + chunk.length >= placed.lines.length;
        block.atoms.push({
          atom,
          lines: chunk,
          overWide: [],
          heightMm: (chunk.length + (last ? 0 : 1)) * lineH,
          indentMm: BULLET_INDENT_MM,
          continuesMarker: last ? null : SPLIT_MARKER,
          part: { index: partIndex, first: cursor === 0, last }
        });
        side.usedMm += (chunk.length + (last ? 0 : 1)) * lineH;
        emittedAny = true;
        cursor += chunk.length;
        partIndex += 1;
      }
      splitAtoms.push({ atomId: atom.id, parts: partIndex });
    }
    // Belt and braces. Every path above that abandons a side already prunes, but a section
    // whose last atom moved elsewhere can still leave a title behind, and the cost of checking
    // once more per section is nothing.
    closeEmptyBlock();
  }

  if (sides.length === 0) newSide();

  // A physical card has two faces. Sides are padded to an even count so a duplex print lines
  // up, and the padding side is rendered with an explicit end marker rather than left blank
  // and ambiguous.
  const contentSides = sides.length;
  if (sides.length % 2 === 1) sides.push({ blocks: [], usedMm: 0, filler: true });

  const cardCount = sides.length / 2;
  const laid = sides.map((s, index) => {
    const face = index % 2 === 0 ? 'FRONT' : 'BACK';
    const cardNumber = Math.floor(index / 2) + 1;
    const isLastContent = index === contentSides - 1;
    let continuation;
    if (index >= contentSides) {
      continuation = 'END OF RECORD';
    } else if (isLastContent) {
      continuation = 'END OF RECORD';
    } else if (face === 'FRONT') {
      continuation = 'CONTINUED ON BACK';
    } else {
      continuation = `CONTINUED ON CARD ${cardNumber + 1}`;
    }
    return {
      index,
      cardNumber,
      cardCount,
      face,
      filler: Boolean(s.filler),
      blocks: s.blocks,
      usedMm: s.usedMm,
      capacityMm: bodyHeightMm,
      footer: `CARD ${cardNumber}/${cardCount} ${face} · ${continuation}`,
      continuation
    };
  });

  assertSidesFit(laid, person.id);
  assertComplete(placedAtomIds(laid), person.atoms.map((a) => a.id), person.id);

  return {
    person,
    header,
    sides: laid,
    cardCount,
    contentSides,
    report: {
      personId: person.id,
      atomCount: person.atoms.length,
      sideCount: laid.length,
      contentSides,
      cardCount,
      bodyHeightMm: round(bodyHeightMm),
      headerHeightMm: round(header.heightMm),
      namePt: header.namePt,
      nameLines: header.nameLines.length,
      nameGrew: header.nameGrew,
      splitAtoms,
      overWideWords,
      minXHeightMm: round(xHeightMm(LEGIBILITY.minPt)),
      fill: laid.map((s) => round(s.usedMm / s.capacityMm))
    }
  };
}

export const round = (v) => Math.round(v * 1000) / 1000;
