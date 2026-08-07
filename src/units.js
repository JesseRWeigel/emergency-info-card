// Physical units, and the one place any conversion between them happens.
//
// A wallet card is a physical object with a legal size, so every dimension in this project is
// carried in millimetres and converted at the edges. Point sizes are typographic points
// (1/72 inch), not CSS "pt" guesses, and CSS pixels are the reference pixel the browser uses
// when it lays out a `mm` length (96 per inch by definition in CSS Values 3).
//
// Nothing here rounds. Rounding a card dimension is how a 85.60 mm card becomes an 85 mm card
// and every downstream fit calculation quietly gains half a millimetre of slack it does not
// have.

export const MM_PER_INCH = 25.4;
export const POINTS_PER_INCH = 72;
export const CSS_PX_PER_INCH = 96;

/** ISO/IEC 7810 ID-1, the size of a credit card, a driving licence and a bank card. */
export const CARD_WIDTH_MM = 85.60;
export const CARD_HEIGHT_MM = 53.98;

export const mmToPt = (mm) => (mm * POINTS_PER_INCH) / MM_PER_INCH;
export const ptToMm = (pt) => (pt * MM_PER_INCH) / POINTS_PER_INCH;
export const mmToPx = (mm) => (mm * CSS_PX_PER_INCH) / MM_PER_INCH;
export const pxToMm = (px) => (px * MM_PER_INCH) / CSS_PX_PER_INCH;
export const ptToPx = (pt) => (pt * CSS_PX_PER_INCH) / POINTS_PER_INCH;
export const pxToPt = (px) => (px * POINTS_PER_INCH) / CSS_PX_PER_INCH;

/**
 * Round a millimetre value for printing into CSS, keeping enough decimals that the sum of
 * many rounded lengths cannot drift past a tenth of a millimetre across a whole card.
 */
export const mm = (value) => `${Number(value.toFixed(4))}mm`;
export const pt = (value) => `${Number(value.toFixed(4))}pt`;
