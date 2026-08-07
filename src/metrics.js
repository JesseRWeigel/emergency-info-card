// Advance widths for the card typeface, so the layout engine can decide how many lines a
// field takes without a browser.
//
// Where these numbers came from: each glyph was measured once in headless Chrome with
// CanvasRenderingContext2D.measureText at 1000 px, then divided by 1000 to give a width in em.
// The font stack resolved to DejaVu Sans, which is what a Linux box and most CI images have.
// tools/remeasure-font.js reproduces the measurement.
//
// This table is a claim about how text will render, and a claim is worth exactly as much as
// the check behind it. scripts/measure.js renders every real line of every real card in a real
// browser and compares the model's predicted width against the width the browser actually
// produced. The model is required never to UNDER-predict, because under-prediction is the bug
// that puts an eleventh medication onto a card that has no room for it and then clips it.
// Over-prediction is allowed within a stated tolerance: it costs capacity, and paginating one
// atom earlier than strictly necessary is a cost worth paying to never clip.
//
// If the font stack resolves to something else on your machine the browser check fails and
// names the font it got. That is the intended behaviour. Install DejaVu Sans (on Debian and
// Ubuntu: `sudo apt-get install fonts-dejavu-core`) rather than relaxing the tolerance.

export const FONT_STACK = '"DejaVu Sans", "Liberation Sans", "Helvetica Neue", Arial, sans-serif';
export const MEASURED_FONT = 'DejaVu Sans';

/** Height of a lower case x, as a fraction of the em, measured on the same run. */
export const X_HEIGHT_EM = 0.54688;
/** Height of a capital H, as a fraction of the em. */
export const CAP_HEIGHT_EM = 0.73438;

/** Fallback for any character not in the table. This is the widest glyph measured, so an
 *  unknown character over-predicts rather than under-predicts. */
export const FALLBACK_ADVANCE_EM = 1.10303;

export const ADVANCE_REGULAR = {
  " ": 0.31787, "!": 0.40088, "\"": 0.45996, "#": 0.83789,
  "$": 0.63623, "%": 0.95020, "&": 0.77979, "'": 0.27490,
  "(": 0.39014, ")": 0.39014, "*": 0.50000, "+": 0.83789,
  ",": 0.31787, "-": 0.36084, ".": 0.31787, "/": 0.33691,
  "0": 0.63623, "1": 0.63623, "2": 0.63623, "3": 0.63623,
  "4": 0.63623, "5": 0.63623, "6": 0.63623, "7": 0.63623,
  "8": 0.63623, "9": 0.63623, ":": 0.33691, ";": 0.33691,
  "<": 0.83789, "=": 0.83789, ">": 0.83789, "?": 0.53076,
  "@": 1.00000, "A": 0.68408, "B": 0.68604, "C": 0.69824,
  "D": 0.77002, "E": 0.63184, "F": 0.57520, "G": 0.77490,
  "H": 0.75195, "I": 0.29492, "J": 0.29492, "K": 0.65576,
  "L": 0.55713, "M": 0.86279, "N": 0.74805, "O": 0.78711,
  "P": 0.60303, "Q": 0.78711, "R": 0.69482, "S": 0.63477,
  "T": 0.61084, "U": 0.73193, "V": 0.68408, "W": 0.98877,
  "X": 0.68506, "Y": 0.61084, "Z": 0.68506, "[": 0.39014,
  "\\": 0.33691, "]": 0.39014, "^": 0.83789, "_": 0.50000,
  "`": 0.50000, "a": 0.61279, "b": 0.63477, "c": 0.54980,
  "d": 0.63477, "e": 0.61523, "f": 0.35205, "g": 0.63477,
  "h": 0.63379, "i": 0.27783, "j": 0.27783, "k": 0.57910,
  "l": 0.27783, "m": 0.97412, "n": 0.63379, "o": 0.61182,
  "p": 0.63477, "q": 0.63477, "r": 0.41113, "s": 0.52100,
  "t": 0.39209, "u": 0.63379, "v": 0.59180, "w": 0.81787,
  "x": 0.59180, "y": 0.59180, "z": 0.52490, "{": 0.63623,
  "|": 0.33691, "}": 0.63623, "~": 0.83789, "\u00a0": 0.31787,
  "\u00a1": 0.40088, "\u00a2": 0.63623, "\u00a3": 0.63623, "\u00a4": 0.63623,
  "\u00a5": 0.63623, "\u00a6": 0.33691, "\u00a7": 0.50000, "\u00a8": 0.50000,
  "\u00a9": 1.00000, "\u00aa": 0.47119, "\u00ab": 0.61182, "\u00ac": 0.83789,
  "\u00ad": 0.00000, "\u00ae": 1.00000, "\u00af": 0.50000, "\u00b0": 0.50000,
  "\u00b1": 0.83789, "\u00b2": 0.40088, "\u00b3": 0.40088, "\u00b4": 0.50000,
  "\u00b5": 0.63623, "\u00b6": 0.63623, "\u00b7": 0.31787, "\u00b8": 0.50000,
  "\u00b9": 0.40088, "\u00ba": 0.47119, "\u00bb": 0.61182, "\u00bc": 0.96924,
  "\u00bd": 0.96924, "\u00be": 0.96924, "\u00bf": 0.53076, "\u00c0": 0.68408,
  "\u00c1": 0.68408, "\u00c2": 0.68408, "\u00c3": 0.68408, "\u00c4": 0.68408,
  "\u00c5": 0.68408, "\u00c6": 0.97412, "\u00c7": 0.69824, "\u00c8": 0.63184,
  "\u00c9": 0.63184, "\u00ca": 0.63184, "\u00cb": 0.63184, "\u00cc": 0.29492,
  "\u00cd": 0.29492, "\u00ce": 0.29492, "\u00cf": 0.29492, "\u00d0": 0.77490,
  "\u00d1": 0.74805, "\u00d2": 0.78711, "\u00d3": 0.78711, "\u00d4": 0.78711,
  "\u00d5": 0.78711, "\u00d6": 0.78711, "\u00d7": 0.83789, "\u00d8": 0.78711,
  "\u00d9": 0.73193, "\u00da": 0.73193, "\u00db": 0.73193, "\u00dc": 0.73193,
  "\u00dd": 0.61084, "\u00de": 0.60498, "\u00df": 0.62988, "\u00e0": 0.61279,
  "\u00e1": 0.61279, "\u00e2": 0.61279, "\u00e3": 0.61279, "\u00e4": 0.61279,
  "\u00e5": 0.61279, "\u00e6": 0.98193, "\u00e7": 0.54980, "\u00e8": 0.61523,
  "\u00e9": 0.61523, "\u00ea": 0.61523, "\u00eb": 0.61523, "\u00ec": 0.27783,
  "\u00ed": 0.27783, "\u00ee": 0.27783, "\u00ef": 0.27783, "\u00f0": 0.61182,
  "\u00f1": 0.63379, "\u00f2": 0.61182, "\u00f3": 0.61182, "\u00f4": 0.61182,
  "\u00f5": 0.61182, "\u00f6": 0.61182, "\u00f7": 0.83789, "\u00f8": 0.61182,
  "\u00f9": 0.63379, "\u00fa": 0.63379, "\u00fb": 0.63379, "\u00fc": 0.63379,
  "\u00fd": 0.59180, "\u00fe": 0.63477, "\u00ff": 0.59180, "\u2013": 0.50000,
  "\u2014": 1.00000, "\u2018": 0.31787, "\u2019": 0.31787, "\u201c": 0.51807,
  "\u201d": 0.51807, "\u2022": 0.58984, "\u2026": 1.00000, "\u2032": 0.22705,
  "\u20ac": 0.63623, "\u2192": 0.83789,
};

export const ADVANCE_BOLD = {
  " ": 0.34814, "!": 0.45605, "\"": 0.52100, "#": 0.83789,
  "$": 0.69580, "%": 1.00195, "&": 0.87207, "'": 0.30615,
  "(": 0.45703, ")": 0.45703, "*": 0.52295, "+": 0.83789,
  ",": 0.37988, "-": 0.41504, ".": 0.37988, "/": 0.36523,
  "0": 0.69580, "1": 0.69580, "2": 0.69580, "3": 0.69580,
  "4": 0.69580, "5": 0.69580, "6": 0.69580, "7": 0.69580,
  "8": 0.69580, "9": 0.69580, ":": 0.39990, ";": 0.39990,
  "<": 0.83789, "=": 0.83789, ">": 0.83789, "?": 0.58008,
  "@": 1.00000, "A": 0.77393, "B": 0.76221, "C": 0.73389,
  "D": 0.83008, "E": 0.68311, "F": 0.68311, "G": 0.82080,
  "H": 0.83691, "I": 0.37207, "J": 0.37207, "K": 0.77490,
  "L": 0.63721, "M": 0.99512, "N": 0.83691, "O": 0.85010,
  "P": 0.73291, "Q": 0.85010, "R": 0.77002, "S": 0.72021,
  "T": 0.68213, "U": 0.81201, "V": 0.77393, "W": 1.10303,
  "X": 0.77100, "Y": 0.72412, "Z": 0.72510, "[": 0.45703,
  "\\": 0.36523, "]": 0.45703, "^": 0.83789, "_": 0.50000,
  "`": 0.50000, "a": 0.67480, "b": 0.71582, "c": 0.59277,
  "d": 0.71582, "e": 0.67822, "f": 0.43506, "g": 0.71582,
  "h": 0.71191, "i": 0.34277, "j": 0.34277, "k": 0.66504,
  "l": 0.34277, "m": 1.04199, "n": 0.71191, "o": 0.68701,
  "p": 0.71582, "q": 0.71582, "r": 0.49316, "s": 0.59521,
  "t": 0.47803, "u": 0.71191, "v": 0.65186, "w": 0.92383,
  "x": 0.64502, "y": 0.65186, "z": 0.58203, "{": 0.71191,
  "|": 0.36523, "}": 0.71191, "~": 0.83789, "\u00a0": 0.34814,
  "\u00a1": 0.45605, "\u00a2": 0.69580, "\u00a3": 0.69580, "\u00a4": 0.63623,
  "\u00a5": 0.69580, "\u00a6": 0.36523, "\u00a7": 0.50000, "\u00a8": 0.50000,
  "\u00a9": 1.00000, "\u00aa": 0.56396, "\u00ab": 0.64600, "\u00ac": 0.83789,
  "\u00ad": 0.00000, "\u00ae": 1.00000, "\u00af": 0.50000, "\u00b0": 0.50000,
  "\u00b1": 0.83789, "\u00b2": 0.43799, "\u00b3": 0.43799, "\u00b4": 0.50000,
  "\u00b5": 0.73584, "\u00b6": 0.63623, "\u00b7": 0.37988, "\u00b8": 0.50000,
  "\u00b9": 0.43799, "\u00ba": 0.56396, "\u00bb": 0.64600, "\u00bc": 1.03516,
  "\u00bd": 1.03516, "\u00be": 1.03516, "\u00bf": 0.58008, "\u00c0": 0.77393,
  "\u00c1": 0.77393, "\u00c2": 0.77393, "\u00c3": 0.77393, "\u00c4": 0.77393,
  "\u00c5": 0.77393, "\u00c6": 1.08496, "\u00c7": 0.73389, "\u00c8": 0.68311,
  "\u00c9": 0.68311, "\u00ca": 0.68311, "\u00cb": 0.68311, "\u00cc": 0.37207,
  "\u00cd": 0.37207, "\u00ce": 0.37207, "\u00cf": 0.37207, "\u00d0": 0.83789,
  "\u00d1": 0.83691, "\u00d2": 0.85010, "\u00d3": 0.85010, "\u00d4": 0.85010,
  "\u00d5": 0.85010, "\u00d6": 0.85010, "\u00d7": 0.83789, "\u00d8": 0.85010,
  "\u00d9": 0.81201, "\u00da": 0.81201, "\u00db": 0.81201, "\u00dc": 0.81201,
  "\u00dd": 0.72412, "\u00de": 0.73779, "\u00df": 0.71924, "\u00e0": 0.67480,
  "\u00e1": 0.67480, "\u00e2": 0.67480, "\u00e3": 0.67480, "\u00e4": 0.67480,
  "\u00e5": 0.67480, "\u00e6": 1.04785, "\u00e7": 0.59277, "\u00e8": 0.67822,
  "\u00e9": 0.67822, "\u00ea": 0.67822, "\u00eb": 0.67822, "\u00ec": 0.34277,
  "\u00ed": 0.34277, "\u00ee": 0.34277, "\u00ef": 0.34277, "\u00f0": 0.68701,
  "\u00f1": 0.71191, "\u00f2": 0.68701, "\u00f3": 0.68701, "\u00f4": 0.68701,
  "\u00f5": 0.68701, "\u00f6": 0.68701, "\u00f7": 0.83789, "\u00f8": 0.68701,
  "\u00f9": 0.71191, "\u00fa": 0.71191, "\u00fb": 0.71191, "\u00fc": 0.71191,
  "\u00fd": 0.65186, "\u00fe": 0.71582, "\u00ff": 0.65186, "\u2013": 0.50000,
  "\u2014": 1.00000, "\u2018": 0.37988, "\u2019": 0.37988, "\u201c": 0.65723,
  "\u201d": 0.65723, "\u2022": 0.63916, "\u2026": 1.00000, "\u2032": 0.26367,
  "\u20ac": 0.69580, "\u2192": 0.83789,
};

/** Width of a string in em, at weight 400 or 700. */
export function advanceEm(text, weight = 400) {
  const table = weight >= 700 ? ADVANCE_BOLD : ADVANCE_REGULAR;
  let total = 0;
  for (const ch of String(text)) {
    const w = table[ch];
    total += w === undefined ? FALLBACK_ADVANCE_EM : w;
  }
  return total;
}

/** Width of a string in millimetres at a given point size. */
export function advanceMm(text, sizePt, weight = 400) {
  return advanceEm(text, weight) * (sizePt * 25.4 / 72);
}

/** Width of a string in CSS pixels at a given pixel font size. */
export function advancePx(text, sizePx, weight = 400) {
  return advanceEm(text, weight) * sizePx;
}

/** Rendered x-height in millimetres at a given point size. */
export function xHeightMm(sizePt) {
  return X_HEIGHT_EM * (sizePt * 25.4 / 72);
}
