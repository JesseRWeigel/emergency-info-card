// Render laid-out sides to HTML, and record what every line of text is supposed to be.
//
// Two decisions here matter more than the markup.
//
// FIRST: the browser is never asked to break a line. src/layout.js already decided where the
// breaks go, using measured advance widths, so each line is emitted as its own element with
// `white-space: pre`. If the browser were allowed to wrap, the height of a field would be a
// property of the browser rather than of the model, the model's height arithmetic would be a
// guess, and a guess that is wrong by one line is a clipped card. Emitting the lines makes the
// model's prediction directly checkable: scripts/measure.js reads the width of every one of
// these elements out of a real Chrome and compares it against what the model predicted.
//
// SECOND: every line box gets an explicit height and line-height in millimetres. The default
// line box height depends on the font's ascent and descent metrics, which vary by font, so
// leaving it to the browser would make the vertical arithmetic font-dependent in exactly the
// way the horizontal arithmetic already has to be.
//
// Nothing anywhere in this file sets overflow: hidden. A card that overflows must be visibly
// and measurably broken, because `overflow: hidden` would hide the bug and make the probe that
// looks for it vacuous.

import { CARD, PALETTE, TYPE, LEGIBILITY } from './design.js';
import { FONT_STACK, advanceMm } from './metrics.js';
import { CONTENT_WIDTH_MM, CONTENT_HEIGHT_MM, lineHeightMm } from './layout.js';
import { mm, pt, ptToMm } from './units.js';
import { esc, style } from './html.js';

const RULE_MM = 0.25;

/**
 * A run is one measurable piece of text on a card. The record carries everything a checker
 * needs to judge it without re-deriving it from the layout: what it says, how big it is, what
 * colour it is, what colour is behind it, how wide the model thinks it will be, and how wide
 * the box containing it is.
 */
function makeRunner(personId, sideIndex) {
  const runs = [];
  let n = 0;
  return {
    runs,
    add(kind, text, opts) {
      const id = `${personId}.s${sideIndex}.r${n}`;
      n += 1;
      runs.push({
        id,
        kind,
        sideIndex,
        text,
        pt: opts.pt,
        weight: opts.weight,
        color: opts.color,
        background: opts.background,
        predictedWidthMm: opts.predictedWidthMm,
        containerWidthMm: opts.containerWidthMm,
        lineHeightMm: opts.lineHeightMm,
        critical: opts.critical !== false
      });
      return id;
    }
  };
}

function lineHtml(runId, text, opts) {
  const attrs = style({
    height: mm(opts.lineHeightMm),
    'line-height': mm(opts.lineHeightMm),
    'font-size': pt(opts.pt),
    'font-weight': String(opts.weight),
    color: opts.color,
    'padding-left': opts.indentMm ? mm(opts.indentMm) : null
  });
  const bullet = opts.bullet
    ? `<span class="bu" style="width:${mm(opts.bulletWidthMm)}">${esc(opts.bullet)}</span>`
    : '';
  return `<div class="ln" style="${attrs}">${bullet}`
    + `<span class="tx" data-run="${runId}">${esc(text)}</span></div>`;
}

/** Render one side. Returns { html, runs }. */
export function renderSide(laid, side) {
  const person = laid.person;
  const header = laid.header;
  const runner = makeRunner(person.id, side.index);
  const parts = [];

  // --- identity header, repeated on every side so a loose card 2 still says whose it is ---
  const headerTextH = header.heightMm - 0.9;
  const nameLineMm = ptToMm(header.namePt * TYPE.name.lineHeight);
  const nameCol = [];
  for (const line of header.nameLines) {
    const id = runner.add('name', line, {
      pt: header.namePt,
      weight: TYPE.name.weight,
      color: PALETTE.ink,
      background: PALETTE.paper,
      predictedWidthMm: predict(line, header.namePt, TYPE.name.weight),
      containerWidthMm: header.nameColumnMm,
      lineHeightMm: nameLineMm
    });
    nameCol.push(lineHtml(id, line, {
      lineHeightMm: nameLineMm, pt: header.namePt, weight: TYPE.name.weight, color: PALETTE.ink
    }));
  }
  for (const line of header.metaLines) {
    const id = runner.add('meta', line, {
      pt: TYPE.identityMeta.pt,
      weight: TYPE.identityMeta.weight,
      color: PALETTE.ink,
      background: PALETTE.paper,
      predictedWidthMm: predict(line, TYPE.identityMeta.pt, TYPE.identityMeta.weight),
      containerWidthMm: header.nameColumnMm,
      lineHeightMm: lineHeightMm(TYPE.identityMeta)
    });
    nameCol.push(lineHtml(id, line, {
      lineHeightMm: lineHeightMm(TYPE.identityMeta),
      pt: TYPE.identityMeta.pt,
      weight: TYPE.identityMeta.weight,
      color: PALETTE.ink
    }));
  }

  let badgeHtml = '';
  if (header.badge) {
    const b = header.badge;
    const labelId = runner.add('bloodLabel', b.label, {
      pt: TYPE.sectionTitle.pt,
      weight: TYPE.sectionTitle.weight,
      color: PALETTE.alertInk,
      background: PALETTE.alert,
      predictedWidthMm: predict(b.label, TYPE.sectionTitle.pt, TYPE.sectionTitle.weight),
      containerWidthMm: b.widthMm - 2 * 1.4,
      lineHeightMm: lineHeightMm(TYPE.sectionTitle)
    });
    const valueId = runner.add('bloodType', b.value, {
      pt: TYPE.bloodType.pt,
      weight: TYPE.bloodType.weight,
      color: PALETTE.alertInk,
      background: PALETTE.alert,
      predictedWidthMm: predict(b.value, TYPE.bloodType.pt, TYPE.bloodType.weight),
      containerWidthMm: b.widthMm - 2 * 1.4,
      lineHeightMm: lineHeightMm(TYPE.bloodType)
    });
    badgeHtml = `<div class="badge" style="${style({
      width: mm(b.widthMm), height: mm(b.heightMm), background: PALETTE.alert
    })}">`
      + lineHtml(labelId, b.label, {
        lineHeightMm: lineHeightMm(TYPE.sectionTitle),
        pt: TYPE.sectionTitle.pt,
        weight: TYPE.sectionTitle.weight,
        color: PALETTE.alertInk
      })
      + lineHtml(valueId, b.value, {
        lineHeightMm: lineHeightMm(TYPE.bloodType),
        pt: TYPE.bloodType.pt,
        weight: TYPE.bloodType.weight,
        color: PALETTE.alertInk
      })
      + '</div>';
  }

  parts.push(`<div class="hdr" style="${style({
    height: mm(headerTextH), width: mm(CONTENT_WIDTH_MM)
  })}"><div class="who" style="width:${mm(header.nameColumnMm)}">${nameCol.join('')}</div>`
    + `${badgeHtml}</div>`);
  parts.push(`<div class="rule" style="${style({
    top: mm(header.heightMm - 0.45), width: mm(CONTENT_WIDTH_MM),
    height: mm(RULE_MM), background: PALETTE.ink
  })}"></div>`);

  // --- body ---
  const body = [];
  for (const block of side.blocks) {
    const isAllergy = block.section === 'allergies';
    const titleColor = isAllergy ? PALETTE.alertInk : PALETTE.ink;
    const titleBg = isAllergy ? PALETTE.alert : PALETTE.paper;
    const titleId = runner.add('sectionTitle', block.title, {
      pt: TYPE.sectionTitle.pt,
      weight: TYPE.sectionTitle.weight,
      color: titleColor,
      background: titleBg,
      predictedWidthMm: predict(block.title, TYPE.sectionTitle.pt, TYPE.sectionTitle.weight),
      containerWidthMm: CONTENT_WIDTH_MM,
      lineHeightMm: lineHeightMm(TYPE.sectionTitle)
    });
    const titleInner = lineHtml(titleId, block.title, {
      lineHeightMm: lineHeightMm(TYPE.sectionTitle),
      pt: TYPE.sectionTitle.pt,
      weight: TYPE.sectionTitle.weight,
      color: titleColor,
      indentMm: isAllergy ? 1.0 : 0
    });
    body.push(`<div class="sec" style="${style({
      'margin-top': block.gapMm ? mm(block.gapMm) : null,
      background: isAllergy ? PALETTE.alert : null,
      padding: isAllergy ? `${mm(0.5)} 0` : null
    })}">${titleInner}</div>`);

    for (const entry of block.atoms) {
      const atomColor = entry.atom.urgent ? PALETTE.alert : PALETTE.ink;
      const lines = entry.lines.map((text, i) => {
        const id = runner.add('atom', text, {
          pt: TYPE.body.pt,
          weight: TYPE.body.weight,
          color: atomColor,
          background: PALETTE.paper,
          predictedWidthMm: predict(text, TYPE.body.pt, TYPE.body.weight),
          containerWidthMm: CONTENT_WIDTH_MM - entry.indentMm,
          lineHeightMm: lineHeightMm(TYPE.body)
        });
        return lineHtml(id, text, {
          lineHeightMm: lineHeightMm(TYPE.body),
          pt: TYPE.body.pt,
          weight: TYPE.body.weight,
          color: atomColor,
          indentMm: i === 0 ? 0 : entry.indentMm,
          bullet: i === 0 ? bulletFor(entry) : null,
          bulletWidthMm: entry.indentMm
        });
      });
      if (entry.continuesMarker) {
        const id = runner.add('splitMarker', entry.continuesMarker, {
          pt: TYPE.body.pt,
          weight: 700,
          color: PALETTE.alert,
          background: PALETTE.paper,
          predictedWidthMm: predict(entry.continuesMarker, TYPE.body.pt, 700),
          containerWidthMm: CONTENT_WIDTH_MM - entry.indentMm,
          lineHeightMm: lineHeightMm(TYPE.body)
        });
        lines.push(lineHtml(id, entry.continuesMarker, {
          lineHeightMm: lineHeightMm(TYPE.body),
          pt: TYPE.body.pt,
          weight: 700,
          color: PALETTE.alert,
          indentMm: entry.indentMm
        }));
      }
      body.push(`<div class="atom" data-atom="${esc(entry.atom.id)}"`
        + `${entry.part ? ` data-part="${entry.part.index}"` : ''}>${lines.join('')}</div>`);
    }
  }

  if (side.filler) {
    const id = runner.add('endMarker', 'END OF RECORD', {
      pt: TYPE.sectionTitle.pt,
      weight: TYPE.sectionTitle.weight,
      color: PALETTE.ink,
      background: PALETTE.paper,
      predictedWidthMm: predict('END OF RECORD', TYPE.sectionTitle.pt, TYPE.sectionTitle.weight),
      containerWidthMm: CONTENT_WIDTH_MM,
      lineHeightMm: lineHeightMm(TYPE.sectionTitle)
    });
    body.push(lineHtml(id, 'END OF RECORD', {
      lineHeightMm: lineHeightMm(TYPE.sectionTitle),
      pt: TYPE.sectionTitle.pt,
      weight: TYPE.sectionTitle.weight,
      color: PALETTE.ink
    }));
  }

  parts.push(`<div class="body" data-side="${side.index}" style="${style({
    top: mm(header.heightMm), width: mm(CONTENT_WIDTH_MM), height: mm(side.capacityMm)
  })}">${body.join('')}</div>`);

  // --- footer ---
  const footerTop = header.heightMm + side.capacityMm + 0.45;
  parts.push(`<div class="rule" style="${style({
    top: mm(footerTop), width: mm(CONTENT_WIDTH_MM), height: mm(RULE_MM), background: PALETTE.ink
  })}"></div>`);
  const footId = runner.add('footer', side.footer, {
    pt: TYPE.footer.pt,
    weight: TYPE.footer.weight,
    color: PALETTE.ink,
    background: PALETTE.paper,
    predictedWidthMm: predict(side.footer, TYPE.footer.pt, TYPE.footer.weight),
    containerWidthMm: CONTENT_WIDTH_MM,
    lineHeightMm: lineHeightMm(TYPE.footer)
  });
  parts.push(`<div class="ft" style="${style({
    top: mm(header.heightMm + side.capacityMm + 0.9), width: mm(CONTENT_WIDTH_MM)
  })}">${lineHtml(footId, side.footer, {
    lineHeightMm: lineHeightMm(TYPE.footer),
    pt: TYPE.footer.pt,
    weight: TYPE.footer.weight,
    color: PALETTE.ink
  })}</div>`);

  const html = `<div class="card" data-card="${esc(person.id)}-${side.index}" `
    + `data-face="${side.face}" data-card-number="${side.cardNumber}" `
    + `data-card-count="${side.cardCount}" style="${style({
      width: mm(CARD.widthMm), height: mm(CARD.heightMm), background: PALETTE.paper
    })}"><div class="pad" style="${style({
      left: mm(CARD.marginMm), top: mm(CARD.marginMm),
      width: mm(CONTENT_WIDTH_MM), height: mm(CONTENT_HEIGHT_MM)
    })}">${parts.join('')}</div></div>`;

  return { html, runs: runner.runs };
}

function bulletFor(entry) {
  if (entry.part && !entry.part.first) return '…';
  return '•';
}

function predict(text, sizePt, weight) {
  return advanceMm(text, sizePt, weight);
}

export const CARD_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#e9e9ec;font-family:${FONT_STACK};-webkit-font-smoothing:antialiased;
  /* The layout engine adds up per-glyph advance widths from a measured table. Kerning pairs
     and ligatures would make the browser render narrower than that sum, which sounds harmless
     and is not: it means the model and the rendering disagree, and a disagreement in the other
     direction is a clipped card. Turning both off makes the rendered width equal the sum of
     advances, so the model's prediction is checkable to a hundredth of a millimetre. */
  font-kerning:none;font-variant-ligatures:none;letter-spacing:0;word-spacing:0}
body{padding:6mm;display:flex;flex-wrap:wrap;gap:6mm;align-items:flex-start}
.card{position:relative;border:0.25mm solid #999;overflow:visible;page-break-inside:avoid;
  break-inside:avoid}
.pad{position:absolute;overflow:visible}
.hdr{position:absolute;top:0;left:0;display:flex;justify-content:space-between;
  align-items:flex-start;overflow:visible}
.who{overflow:visible}
.badge{display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:1.4mm 0;overflow:visible}
.rule{position:absolute;left:0}
.body{position:absolute;left:0;overflow:visible}
.ft{position:absolute;left:0;overflow:visible}
.ln{white-space:pre;overflow:visible}
.bu{display:inline-block;text-align:left}
.tx{white-space:pre}
.sec{overflow:visible}
.atom{overflow:visible}
@media print{
  html,body{background:#fff}
  body{padding:8mm;gap:8mm}
  .card{border:0.2mm dashed #666}
}
`;

/** A whole page of sides for one person. */
export function renderCardsPage(laid, meta) {
  const sides = laid.sides.map((side) => renderSide(laid, side));
  const runs = sides.flatMap((s) => s.runs);
  const title = `Emergency card, ${laid.person.name}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="generator" content="emergency-info-card">
<meta name="source-sha256" content="${esc(meta.sourceSha256)}">
<meta name="min-pt" content="${LEGIBILITY.minPt}">
<meta name="min-contrast" content="${meta.minContrast}">
<style>${CARD_CSS}</style>
</head><body data-person="${esc(laid.person.id)}" data-sides="${laid.sides.length}">
${sides.map((s) => s.html).join('\n')}
</body></html>
`;
  return { html, runs };
}
