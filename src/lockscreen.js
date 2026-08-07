// Render the lock-screen wallpaper, at real device dimensions, with the critical text kept
// clear of the operating system's own furniture.
//
// A lock screen is a different problem from a wallet card and the difference is honest to
// state. The card holds everything, paginating onto a second card if it has to, because a card
// is cheap to add. A wallpaper is one image on one screen and cannot paginate, so it carries a
// prioritised subset and says out loud how much it left out and where the rest is.
//
// The rule is that the omission is never silent. If eleven medications will not fit, the image
// carries the ones that fit and a line reading "+7 MORE ON WALLET CARD: 5 medications,
// 2 notes". The count in that line is computed from what was actually placed rather than
// stated, and checks/check_independent.py recounts it from the rendered HTML.
//
// The safe area is the other half. Text under the clock is text nobody reads, so the content
// panel is inset by a fraction of the screen height at the top for the clock, date and
// widgets, and at the bottom for the torch and camera shortcuts. Those fractions are in
// src/design.js with a note saying they are conservative configuration rather than a
// measurement from any API.

import { LOCKSCREEN, PALETTE, SECTION_ORDER, SECTION_TITLES, SECTION_NOUNS } from './design.js';
import { FONT_STACK, advancePx } from './metrics.js';
import { wrapText } from './layout.js';
import { esc, style } from './html.js';

const PANEL_PAD_PX = 14;
const SECTION_GAP_PX = 7;

const lh = (t) => t.px * t.lineHeight;

/** Geometry of the usable area on one device. */
export function safeArea(device) {
  const reserve = LOCKSCREEN.reserve[device.platform];
  if (!reserve) throw new Error(`no safe-area reserve defined for platform ${device.platform}`);
  const top = device.cssHeight * reserve.top;
  const bottom = device.cssHeight * (1 - reserve.bottom);
  const sideInset = device.cssWidth * LOCKSCREEN.sideMarginFraction;
  return {
    top,
    bottom,
    left: sideInset,
    right: device.cssWidth - sideInset,
    width: device.cssWidth - 2 * sideInset,
    height: bottom - top,
    reserveTopPx: top,
    reserveBottomPx: device.cssHeight * reserve.bottom
  };
}

function omissionNote(omitted) {
  const counts = new Map();
  for (const atom of omitted) counts.set(atom.section, (counts.get(atom.section) || 0) + 1);
  const parts = SECTION_ORDER
    .filter((s) => counts.has(s))
    .map((s) => {
      const n = counts.get(s);
      const [one, many] = SECTION_NOUNS[s];
      return `${n} ${n === 1 ? one : many}`;
    });
  return `+${omitted.length} MORE ON WALLET CARD: ${parts.join(', ')}`;
}

/**
 * Decide what goes on the screen.
 *
 * Runs to a fixed point, because the omission note itself takes space: reserving room for a
 * one-line note can push another atom off, which can make the note two lines, which can push
 * another atom off. Five passes is far more than the note's length can ever need, and not
 * converging is an error rather than a silent best effort.
 */
export function fitLockScreen(person, device) {
  const area = safeArea(device);
  const contentWidth = area.width - 2 * PANEL_PAD_PX;
  const type = LOCKSCREEN.type;

  // The name is the one field whose length is entirely outside the tool's control, and the
  // narrowest phone here is 360 CSS px. So the name steps down through a short scale until it
  // fits without any token over-running the panel, and stops at the pixel floor rather than
  // shrinking without limit. If even the floor does not fit, the over-wide token is reported
  // and src/report.js turns it into a finding, so the build fails loudly instead of shipping a
  // name that runs off the side of a phone.
  const nameSizes = [type.name.px, 20, 18, 16, LOCKSCREEN.minPx];
  let namePx = type.name.px;
  let nameWrap = null;
  for (const size of nameSizes) {
    const attempt = wrapText(person.name, contentWidth, (t) => advancePx(t, size, type.name.weight));
    if (attempt.overWide.length === 0 && attempt.lines.length <= 3) {
      namePx = size;
      nameWrap = attempt;
      break;
    }
    nameWrap = attempt;
    namePx = size;
  }
  // Blood type gets its own line at its own size. Folding it into the same run as the date of
  // birth and the spoken language made a five line block of large red type that pushed the
  // clinical facts off a 667 px screen, which is the opposite of the point.
  const bloodWrap = person.bloodType
    ? wrapText(`BLOOD ${person.bloodType}`, contentWidth,
      (t) => advancePx(t, type.bloodType.px, type.bloodType.weight))
    : { lines: [] };
  const metaWrap = person.identityMeta
    ? wrapText(person.identityMeta, contentWidth,
      (t) => advancePx(t, type.meta.px, type.meta.weight))
    : { lines: [] };

  const nameLinePx = namePx * type.name.lineHeight;
  const fixedHeight = nameWrap.lines.length * nameLinePx
    + bloodWrap.lines.length * lh(type.bloodType)
    + metaWrap.lines.length * lh(type.meta);

  const bySection = new Map();
  for (const atom of person.atoms) {
    if (!bySection.has(atom.section)) bySection.set(atom.section, []);
    bySection.get(atom.section).push(atom);
  }

  let reservedNoteLines = 0;
  let placement = null;
  for (let pass = 0; pass < 6; pass += 1) {
    const budget = area.height - 2 * PANEL_PAD_PX - fixedHeight
      - (reservedNoteLines > 0 ? SECTION_GAP_PX + reservedNoteLines * lh(type.overflowNote) : 0);
    const blocks = [];
    const placed = [];
    const omitted = [];
    let used = 0;
    let stopped = false;

    for (const section of SECTION_ORDER) {
      const atoms = bySection.get(section);
      if (!atoms || atoms.length === 0) continue;
      if (stopped) { omitted.push(...atoms); continue; }

      const gap = blocks.length === 0 ? 0 : SECTION_GAP_PX;
      const titleCost = gap + lh(type.sectionTitle);
      if (used + titleCost + lh(type.body) > budget) {
        stopped = true;
        omitted.push(...atoms);
        continue;
      }
      const block = { section, title: SECTION_TITLES[section], gapPx: gap, atoms: [] };
      blocks.push(block);
      used += titleCost;

      for (const atom of atoms) {
        if (stopped) { omitted.push(atom); continue; }
        const wrapped = wrapText(atom.text, contentWidth - 10,
          (t) => advancePx(t, type.body.px, type.body.weight));
        const cost = wrapped.lines.length * lh(type.body);
        if (used + cost > budget) {
          stopped = true;
          omitted.push(atom);
          continue;
        }
        block.atoms.push({ atom, lines: wrapped.lines });
        placed.push(atom);
        used += cost;
      }
      if (block.atoms.length === 0) {
        // The title got room but no atom did. Drop the empty title rather than print a
        // heading over nothing.
        blocks.pop();
        used -= titleCost;
      }
    }

    const note = omitted.length > 0 ? omissionNote(omitted) : null;
    const noteLines = note
      ? wrapText(note, contentWidth, (t) => advancePx(t, type.overflowNote.px, type.overflowNote.weight)).lines
      : [];
    if (noteLines.length === reservedNoteLines) {
      placement = { area, contentWidth, namePx, nameLinePx, nameWrap, bloodWrap, metaWrap,
        blocks, placed, omitted, note, noteLines, usedPx: used, budgetPx: budget };
      break;
    }
    reservedNoteLines = noteLines.length;
  }

  if (!placement) {
    throw new Error(`${person.id}: the lock screen layout for ${device.id} did not settle in `
      + 'six passes. The omission note is oscillating, which means the budget arithmetic is wrong.');
  }
  if (placement.placed.length + placement.omitted.length !== person.atoms.length) {
    throw new Error(`${person.id}: the lock screen accounted for `
      + `${placement.placed.length + placement.omitted.length} of ${person.atoms.length} facts. `
      + 'Every fact is either shown or counted in the omission note, never neither.');
  }
  return placement;
}

function lineHtml(runId, text, opts) {
  return `<div class="ln" style="${style({
    height: `${opts.heightPx}px`,
    'line-height': `${opts.heightPx}px`,
    'font-size': `${opts.px}px`,
    'font-weight': String(opts.weight),
    color: opts.color,
    'padding-left': opts.indentPx ? `${opts.indentPx}px` : null
  })}"><span class="tx" data-run="${runId}">${esc(text)}</span></div>`;
}

export function renderLockScreen(person, device, meta) {
  const fit = fitLockScreen(person, device);
  const type = LOCKSCREEN.type;
  const runs = [];
  let n = 0;
  const add = (kind, text, opts) => {
    const id = `${person.id}.${device.id}.r${n}`;
    n += 1;
    runs.push({
      id, kind, device: device.id, text,
      px: opts.px, weight: opts.weight, color: opts.color, background: opts.background,
      predictedWidthPx: advancePx(text, opts.px, opts.weight),
      containerWidthPx: opts.containerWidthPx,
      critical: opts.critical !== false
    });
    return id;
  };

  const body = [];
  for (const line of fit.nameWrap.lines) {
    const id = add('name', line, {
      px: fit.namePx, weight: type.name.weight, color: PALETTE.ink,
      background: PALETTE.paper, containerWidthPx: fit.contentWidth
    });
    body.push(lineHtml(id, line, {
      heightPx: fit.nameLinePx, px: fit.namePx, weight: type.name.weight, color: PALETTE.ink
    }));
  }
  for (const line of fit.bloodWrap.lines) {
    const id = add('bloodType', line, {
      px: type.bloodType.px, weight: type.bloodType.weight, color: PALETTE.alert,
      background: PALETTE.paper, containerWidthPx: fit.contentWidth
    });
    body.push(lineHtml(id, line, {
      heightPx: lh(type.bloodType), px: type.bloodType.px, weight: type.bloodType.weight,
      color: PALETTE.alert
    }));
  }
  for (const line of fit.metaWrap.lines) {
    const id = add('meta', line, {
      px: type.meta.px, weight: type.meta.weight, color: PALETTE.ink,
      background: PALETTE.paper, containerWidthPx: fit.contentWidth
    });
    body.push(lineHtml(id, line, {
      heightPx: lh(type.meta), px: type.meta.px, weight: type.meta.weight, color: PALETTE.ink
    }));
  }

  for (const block of fit.blocks) {
    const titleId = add('sectionTitle', block.title, {
      px: type.sectionTitle.px, weight: type.sectionTitle.weight, color: PALETTE.ink,
      background: PALETTE.paper, containerWidthPx: fit.contentWidth
    });
    body.push(`<div class="sec" style="${block.gapPx ? `margin-top:${block.gapPx}px` : ''}">`
      + lineHtml(titleId, block.title, {
        heightPx: lh(type.sectionTitle), px: type.sectionTitle.px,
        weight: type.sectionTitle.weight, color: PALETTE.ink
      }) + '</div>');
    for (const entry of block.atoms) {
      const color = entry.atom.urgent ? PALETTE.alert : PALETTE.ink;
      const lines = entry.lines.map((text, i) => {
        const id = add('atom', text, {
          px: type.body.px, weight: type.body.weight, color,
          background: PALETTE.paper, containerWidthPx: fit.contentWidth - 10
        });
        return lineHtml(id, text, {
          heightPx: lh(type.body), px: type.body.px, weight: type.body.weight, color,
          indentPx: i === 0 ? 0 : 10
        });
      });
      body.push(`<div class="atom" data-atom="${esc(entry.atom.id)}">${lines.join('')}</div>`);
    }
  }

  if (fit.note) {
    const noteHtml = fit.noteLines.map((text) => {
      const id = add('overflowNote', text, {
        px: type.overflowNote.px, weight: type.overflowNote.weight, color: PALETTE.alert,
        background: PALETTE.paper, containerWidthPx: fit.contentWidth
      });
      return lineHtml(id, text, {
        heightPx: lh(type.overflowNote), px: type.overflowNote.px,
        weight: type.overflowNote.weight, color: PALETTE.alert
      });
    }).join('');
    body.push(`<div class="note" style="margin-top:${SECTION_GAP_PX}px">${noteHtml}</div>`);
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(`Lock screen, ${person.name}, ${device.label}`)}</title>
<meta name="generator" content="emergency-info-card">
<meta name="source-sha256" content="${esc(meta.sourceSha256)}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${device.cssWidth}px;height:${device.cssHeight}px;overflow:visible}
body{background:#101014;font-family:${FONT_STACK};-webkit-font-smoothing:antialiased;
  font-kerning:none;font-variant-ligatures:none;letter-spacing:0;word-spacing:0}
.screen{position:relative;width:${device.cssWidth}px;height:${device.cssHeight}px;overflow:visible}
.panel{position:absolute;background:${PALETTE.paper};border-radius:14px;
  padding:${PANEL_PAD_PX}px;overflow:visible}
.ln{white-space:pre;overflow:visible}
.tx{white-space:pre}
.sec,.atom,.note{overflow:visible}
</style>
</head><body data-person="${esc(person.id)}" data-device="${esc(device.id)}"
 data-css-width="${device.cssWidth}" data-css-height="${device.cssHeight}" data-dpr="${device.dpr}"
 data-safe-top="${fit.area.top}" data-safe-bottom="${fit.area.bottom}"
 data-safe-left="${fit.area.left}" data-safe-right="${fit.area.right}"
 data-omitted="${fit.omitted.length}" data-placed="${fit.placed.length}">
<div class="screen"><div class="panel" style="${style({
    left: `${fit.area.left}px`, top: `${fit.area.top}px`,
    width: `${fit.area.width}px`, height: `${fit.area.height}px`
  })}">${body.join('')}</div></div>
</body></html>
`;

  return { html, runs, fit };
}
