// Every threshold this project enforces, in one file, each with the reason it has the value
// it has. A number without a justification is a number somebody will quietly relax later.

import { CARD_WIDTH_MM, CARD_HEIGHT_MM, ptToMm } from './units.js';

export const CARD = {
  widthMm: CARD_WIDTH_MM,
  heightMm: CARD_HEIGHT_MM,
  // 3 mm all round. Consumer printers lose 3 to 5 mm at the sheet edge, and this card is meant
  // to be printed on a sheet and cut out, so the margin is inside the cut line rather than
  // relying on the printer.
  marginMm: 3.0
};

// ---------------------------------------------------------------------------------------
// The legibility floor.
// ---------------------------------------------------------------------------------------
// "Legible at wallet size" is the task's done condition, so it has to be a number that can be
// measured and failed.
//
// Two floors, both enforced, because either one alone is gameable:
//
//   minPt         the nominal type size. 8 pt.
//   minXHeightMm  the height of a lower case x as actually rendered. 1.40 mm.
//
// Why the point size floor is 8 pt. There is no single legal minimum for a personal medical
// card, so the value is bracketed by the two nearest published reference points. At the low
// end, US OTC drug labelling (21 CFR 201.66) permits the Drug Facts panel to be set as small
// as 6 pt on small packages, which is the smallest size a regulator anywhere is willing to
// call readable for safety-critical text. At the high end, the RNIB Clear Print guidance asks
// for 12 pt as a minimum for general readers, which is a target for documents rather than for
// a card and does not fit on 85.60 by 53.98 mm without dropping most of the content. 8 pt sits
// a third of the way up that bracket: comfortably above the regulatory floor for safety text,
// and honestly below what a reader with reduced vision needs. That last part is not hidden.
// It is why the lock-screen output exists and why the README says so plainly.
//
// Why there is also an x-height floor. Point size describes the em box, not the letters. Two
// faces at 8 pt can differ by 25% in the height of the letters a reader actually resolves, and
// a condensed face is the obvious way to cheat a point-size check. 1.40 mm is 8 pt at an
// x-height ratio of 0.496, so any face whose lower case is at least half its em passes at 8 pt
// and a face that fakes the size fails. The floor is checked against the browser's measurement
// of the glyph, not against the CSS, because content that overflows gets scaled or clipped and
// the CSS value then describes something that is not on the card.
export const LEGIBILITY = {
  minPt: 8.0,
  minXHeightMm: 1.40,
  // Anything the tool asks a browser to render below this is a bug in the tool, not a
  // preference. Kept as a separate name so the failure message can say which floor was hit.
  get minEmMm() { return ptToMm(this.minPt); }
};

// ---------------------------------------------------------------------------------------
// Contrast.
// ---------------------------------------------------------------------------------------
// WCAG AAA for normal-size body text is 7:1. This card is read by a stranger, under stress,
// possibly at night, possibly by torchlight, possibly through a cracked phone screen, and the
// reader has no option to lean in and try again later. So the floor is 12:1, which is a large
// margin over AAA and is reachable with ordinary ink on ordinary paper: near-black on white is
// about 19:1 and the dark red used for the allergy banner is about 13:1.
//
// 12:1 also survives a monochrome laser printer, which renders the dark red as a dark grey of
// similar luminance rather than as a mid grey.
export const CONTRAST = { min: 12.0 };

// ---------------------------------------------------------------------------------------
// Palette. Two inks. Both are checked against CONTRAST.min at build time by the tool itself,
// so a palette edit that breaks the floor fails the build rather than shipping.
// ---------------------------------------------------------------------------------------
export const PALETTE = {
  paper: '#ffffff',
  ink: '#111111',        // about 18.9:1 on paper
  alert: '#6b0000',      // about 12.9:1 on paper, and white on it is the same ratio
  alertInk: '#ffffff'
};

// ---------------------------------------------------------------------------------------
// Type scale on the card. Every size is at or above the floor. There is no small print on
// this card at all, including the footer, because deciding which line is allowed to be
// unreadable is exactly the decision that goes wrong.
// ---------------------------------------------------------------------------------------
export const TYPE = {
  family: '"DejaVu Sans", "Liberation Sans", "Helvetica Neue", Arial, sans-serif',
  name: { pt: 11.0, weight: 700, lineHeight: 1.15 },
  identityMeta: { pt: 8.0, weight: 400, lineHeight: 1.2 },
  bloodType: { pt: 13.0, weight: 700, lineHeight: 1.0 },
  sectionTitle: { pt: 8.0, weight: 700, lineHeight: 1.25 },
  body: { pt: 8.0, weight: 400, lineHeight: 1.28 },
  footer: { pt: 8.0, weight: 700, lineHeight: 1.2 }
};

// ---------------------------------------------------------------------------------------
// Lock screen.
// ---------------------------------------------------------------------------------------
// Real devices, at their real CSS viewport and their real device pixel ratio, so the produced
// PNG is exactly the wallpaper resolution of the phone and nothing has to be resampled.
//
// The reserves are the fraction of the screen height that the operating system's own lock
// screen furniture covers: the clock and date and any widgets at the top, the torch and camera
// shortcuts at the bottom. They are conservative estimates taken from the stock layouts, not
// measurements from an API, and they are configuration rather than fact. Check yours against
// your own phone before trusting the bottom of the card.
export const DEVICES = [
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', cssWidth: 393, cssHeight: 852, dpr: 3,
    platform: 'ios' },
  { id: 'galaxy-s23', label: 'Galaxy S23', cssWidth: 360, cssHeight: 780, dpr: 3,
    platform: 'android' },
  { id: 'iphone-se-3', label: 'iPhone SE (3rd gen)', cssWidth: 375, cssHeight: 667, dpr: 2,
    platform: 'ios' }
];

export const LOCKSCREEN = {
  // On a stock iOS lock screen the clock block ends around 28% of the screen height and the
  // optional widget row below it ends around 34%, so 34% keeps the panel clear even when
  // widgets are turned on. The bottom 12% covers the torch and camera buttons and the home
  // indicator. Android's clock sits higher and its shortcut row is shallower, hence 30 and 10.
  //
  // These are estimates from the stock layouts. They are configuration, not measurement, and
  // no API reports them. Put your own wallpaper on your own phone and look before you trust
  // the bottom of the panel.
  reserve: {
    ios: { top: 0.34, bottom: 0.12 },
    android: { top: 0.30, bottom: 0.10 }
  },
  sideMarginFraction: 0.05,
  // A screen is read at arm's length rather than held up to the eye, and it can be zoomed,
  // so the floor here is expressed in CSS pixels rather than in millimetres of paper.
  minPx: 12,
  type: {
    name: { px: 22, weight: 700, lineHeight: 1.1 },
    bloodType: { px: 20, weight: 700, lineHeight: 1.15 },
    meta: { px: 13, weight: 400, lineHeight: 1.25 },
    sectionTitle: { px: 13, weight: 700, lineHeight: 1.25 },
    body: { px: 14, weight: 400, lineHeight: 1.3 },
    overflowNote: { px: 13, weight: 700, lineHeight: 1.25 }
  }
};

// ---------------------------------------------------------------------------------------
// What a first responder reads first. The order is the order the sections are laid out in and
// the order the lock screen truncates from the bottom of.
// ---------------------------------------------------------------------------------------
//
// Allergies lead because a drug allergy changes what is given in the first two minutes.
// Conditions come next because they change the differential. Medications follow because they
// change interactions and explain findings. Contacts come after the clinical facts because
// they matter to the patient and not to the resuscitation. Notes are last because they are the
// catch-all.
//
// Blood type is carried in the identity header because the task asks for it, and the README
// says out loud what it is worth: a hospital types and cross-matches the patient and will not
// transfuse on the strength of a card.
export const SECTION_ORDER = ['allergies', 'conditions', 'medications', 'contacts', 'notes'];

/** Singular and plural, for the lock screen's "+7 more" line. "1 allergies" is the kind of
 *  detail that makes a reader trust the rest of the card less. */
export const SECTION_NOUNS = {
  allergies: ['allergy', 'allergies'],
  conditions: ['condition', 'conditions'],
  medications: ['medication', 'medications'],
  contacts: ['contact', 'contacts'],
  notes: ['note', 'notes']
};

export const SECTION_TITLES = {
  allergies: 'ALLERGIES',
  conditions: 'CONDITIONS',
  medications: 'MEDICATIONS',
  contacts: 'EMERGENCY CONTACTS',
  notes: 'NOTES'
};
