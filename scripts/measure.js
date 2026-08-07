#!/usr/bin/env node
// Load every generated page in a real Chrome and measure it from inside.
//
// This is the step that turns "legible at wallet size" from a claim into a number.
//
// Why measuring inside the page and not from a screenshot: `chrome --headless --screenshot
// --window-size=` can render at a width different from the one it captures, so a screenshot is
// evidence about the screenshot and not about the layout. Everything here comes from
// getBoundingClientRect and getComputedStyle, evaluated in the page. The one thing measured
// from an image file is the PNG's pixel dimensions, read out of the IHDR chunk, and that is
// exactly the claim a screenshot can support.
//
// What is checked, per run of text, in the browser rather than in the model:
//
//   - the card element really is 85.60 by 53.98 mm
//   - the rendered font size in points is at or above the floor
//   - the rendered x-height in millimetres is at or above the floor, measured with
//     TextMetrics.actualBoundingBoxAscent for the glyph "x" in the element's own computed font
//   - the contrast ratio between the computed text colour and the PAINTED background, walking
//     up the ancestors to find whatever is actually behind the glyph. The sRGB formula in the
//     probe is written out again rather than imported, so this is a second implementation and
//     not a second call to the first one.
//   - the width the model predicted matches the width the browser produced, and in particular
//     the model never UNDER-predicts, because that is the direction that clips content
//   - nothing escapes the card, and on a lock screen nothing enters the clock reserve
//
// Never pass --disable-crashpad-for-testing or --disable-features=Crashpad. On this machine
// those two put Chrome into an infinite crash-restart loop. Every browser call below has an
// explicit timeout so a hang fails loudly instead of running forever.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DEVICES, LEGIBILITY, CONTRAST, CARD, LOCKSCREEN, PALETTE } from '../src/design.js';
import { readPngSize } from '../bin/emcard.js';
import { decodePng, pixelAt, near, hexToRgb } from './png.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// ------------------------------------------------------------------------------------------
// The probe. This string runs inside the page. It shares no code with src/.
// ------------------------------------------------------------------------------------------
const PROBE = String.raw`
(function () {
  function lin(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
  function parseRgb(s) {
    var m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+))?\s*\)$/.exec(String(s).trim());
    if (!m) return null;
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]),
            m[4] === undefined ? 1 : parseFloat(m[4])];
  }
  function over(a, b) {
    var alpha = a[3];
    if (alpha >= 1) return [a[0], a[1], a[2], 1];
    return [a[0] * alpha + b[0] * (1 - alpha), a[1] * alpha + b[1] * (1 - alpha),
            a[2] * alpha + b[2] * (1 - alpha), 1];
  }
  // Whatever is actually painted behind the glyph, found by walking up until something is
  // opaque. A declared background of rgba(0,0,0,0) means "the parent's", not "black".
  function paintedBackground(el) {
    var stack = [];
    var node = el;
    while (node && node.nodeType === 1) {
      var c = parseRgb(getComputedStyle(node).backgroundColor);
      if (c) {
        stack.push(c);
        if (c[3] >= 1) break;
      }
      node = node.parentElement;
    }
    var result = [255, 255, 255, 1];
    for (var i = stack.length - 1; i >= 0; i--) result = over(stack[i], result);
    return result;
  }
  function ratio(fg, bg) {
    var painted = over(fg, bg);
    var a = lum(painted), b = lum(bg);
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Millimetres are asked of the browser rather than assumed. 10 mm not 100 mm, because a
  // 100 mm probe is wider than a 360 px phone viewport and would itself create overflow.
  var ruler = document.createElement('div');
  ruler.style.cssText = 'position:fixed;left:0;top:0;width:10mm;height:0;visibility:hidden';
  document.body.appendChild(ruler);
  var pxPerMm = ruler.getBoundingClientRect().width / 10;
  ruler.remove();

  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');

  function xHeightPx(cs) {
    ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    var m = ctx.measureText('x');
    return m.actualBoundingBoxAscent;
  }

  var out = {
    ok: true,
    title: document.title,
    person: document.body.getAttribute('data-person'),
    device: document.body.getAttribute('data-device'),
    pxPerMm: pxPerMm,
    dejavu: false,
    runs: [],
    cards: [],
    screen: null,
    overflow: [],
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight
  };
  try { out.dejavu = document.fonts.check('16px "DejaVu Sans"'); } catch (e) { out.dejavu = null; }

  document.querySelectorAll('.tx[data-run]').forEach(function (el) {
    var cs = getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var fg = parseRgb(cs.color) || [0, 0, 0, 1];
    var bg = paintedBackground(el.parentElement || el);
    var fontSizePx = parseFloat(cs.fontSize);
    var xh = xHeightPx(cs);
    out.runs.push({
      id: el.getAttribute('data-run'),
      text: el.textContent,
      widthPx: rect.width,
      widthMm: rect.width / pxPerMm,
      heightPx: rect.height,
      fontSizePx: fontSizePx,
      fontSizePt: fontSizePx * 72 / 96,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      color: cs.color,
      backgroundRgb: bg,
      contrast: ratio(fg, bg),
      xHeightPx: xh,
      xHeightMm: xh / pxPerMm,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom
    });
  });

  // Card geometry, and anything escaping a card.
  document.querySelectorAll('.card').forEach(function (card) {
    var cr = card.getBoundingClientRect();
    var escapes = [];
    card.querySelectorAll('*').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      var slackPx = 0.5;
      if (r.right > cr.right + slackPx || r.left < cr.left - slackPx
          || r.bottom > cr.bottom + slackPx || r.top < cr.top - slackPx) {
        escapes.push({
          cls: el.className,
          run: el.getAttribute('data-run'),
          text: (el.textContent || '').slice(0, 60),
          overRightMm: (r.right - cr.right) / pxPerMm,
          overBottomMm: (r.bottom - cr.bottom) / pxPerMm
        });
      }
    });
    out.cards.push({
      id: card.getAttribute('data-card'),
      face: card.getAttribute('data-face'),
      cardNumber: card.getAttribute('data-card-number'),
      cardCount: card.getAttribute('data-card-count'),
      widthMm: cr.width / pxPerMm,
      heightMm: cr.height / pxPerMm,
      escapes: escapes
    });
  });

  // Lock screen: the safe area, and anything that strayed into it.
  var screenEl = document.querySelector('.screen');
  if (screenEl) {
    var b = document.body;
    var sr = screenEl.getBoundingClientRect();
    var safe = {
      top: parseFloat(b.getAttribute('data-safe-top')),
      bottom: parseFloat(b.getAttribute('data-safe-bottom')),
      left: parseFloat(b.getAttribute('data-safe-left')),
      right: parseFloat(b.getAttribute('data-safe-right'))
    };
    var intrusions = [];
    out.runs.forEach(function (r) {
      var relTop = r.top - sr.top, relBottom = r.bottom - sr.top;
      var relLeft = r.left - sr.left, relRight = r.right - sr.left;
      var why = [];
      if (relTop < safe.top - 0.5) why.push('above the safe top by ' + (safe.top - relTop).toFixed(1) + ' px');
      if (relBottom > safe.bottom + 0.5) why.push('below the safe bottom by ' + (relBottom - safe.bottom).toFixed(1) + ' px');
      if (relLeft < safe.left - 0.5) why.push('left of the safe left');
      if (relRight > safe.right + 0.5) why.push('right of the safe right by ' + (relRight - safe.right).toFixed(1) + ' px');
      if (why.length) intrusions.push({ id: r.id, text: r.text.slice(0, 50), why: why });
    });
    out.screen = {
      widthPx: sr.width,
      heightPx: sr.height,
      cssWidth: parseFloat(b.getAttribute('data-css-width')),
      cssHeight: parseFloat(b.getAttribute('data-css-height')),
      dpr: parseFloat(b.getAttribute('data-dpr')),
      placed: parseInt(b.getAttribute('data-placed'), 10),
      omitted: parseInt(b.getAttribute('data-omitted'), 10),
      safe: safe,
      intrusions: intrusions
    };
  }

  document.documentElement.setAttribute('data-probe', JSON.stringify(out));
})();
`;

// ------------------------------------------------------------------------------------------
// Chrome
// ------------------------------------------------------------------------------------------
const CHROME_CANDIDATES = [process.env.EMCARD_CHROME, 'google-chrome', 'google-chrome-stable',
  'chromium', 'chromium-browser', 'chrome'].filter(Boolean);

function findChrome() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes('/')) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    for (const dir of dirs) {
      const full = path.join(dir, candidate);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

function dumpDom(chrome, file, width, height) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'emcard-measure-'));
  try {
    return execFileSync(chrome, [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=8000',
      `--user-data-dir=${profile}`,
      '--dump-dom',
      `file://${file}`
    ], { encoding: 'utf8', timeout: 120_000, maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'] });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

function unescapeAttr(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readProbe(dom) {
  const m = dom.match(/<html[^>]*\sdata-probe="([\s\S]*?)"[^>]*>/);
  if (!m) return null;
  try {
    return JSON.parse(unescapeAttr(m[1]));
  } catch (err) {
    return { parseError: err.message, raw: m[1].slice(0, 300) };
  }
}

/** Copy a page into a scratch directory with the probe appended, then load that. */
function measurePage(chrome, source, work, name, width, height) {
  const html = fs.readFileSync(source, 'utf8');
  if (!html.includes('</body>')) throw new Error(`${name}: no </body> to inject the probe before`);
  const target = path.join(work, `${name}.html`);
  fs.writeFileSync(target, html.replace('</body>', `<script>${PROBE}</script></body>`));
  const dom = dumpDom(chrome, target, width, height);
  const probe = readProbe(dom);
  if (!probe) {
    throw new Error(`${name}: the probe did not run. The page produced no data-probe attribute, `
      + 'which is what an inline script that failed to parse looks like.');
  }
  if (probe.parseError) {
    throw new Error(`${name}: the probe produced unreadable JSON: ${probe.parseError}`);
  }
  return probe;
}

// ------------------------------------------------------------------------------------------
// Judgement
// ------------------------------------------------------------------------------------------
const failures = [];
const notes = [];
let checks = 0;

function check(ok, message) {
  checks += 1;
  if (!ok) failures.push(message);
  return ok;
}

const round = (v) => Math.round(v * 1000) / 1000;

function main() {
  const distArg = process.argv.indexOf('--dist');
  const dist = path.resolve(distArg >= 0 ? process.argv[distArg + 1] : path.join(ROOT, 'dist'));
  const reportPath = path.join(dist, 'report.json');
  if (!fs.existsSync(reportPath)) {
    process.stderr.write(`${path.relative(ROOT, reportPath)} does not exist. Run `
      + '`node bin/emcard.js build` first.\n');
    return 1;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  const chrome = findChrome();
  if (!chrome) {
    process.stderr.write('MEASUREMENT FAILED: no Chrome or Chromium on PATH.\n'
      + '  Install one (Debian and Ubuntu: `sudo apt-get install chromium`) or set '
      + 'EMCARD_CHROME to its path.\n'
      + '  Without a browser the point size, x-height, contrast and safe-area numbers cannot be '
      + 'measured at all, and every legibility claim this project makes rests on them. This is '
      + 'a failure and not a skip.\n');
    return 1;
  }
  process.stdout.write(`chrome: ${chrome}\n`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'emcard-work-'));
  try {
    const deviceById = new Map(DEVICES.map((d) => [d.id, d]));

    // ---- the lock screen does not depend on the viewport ----
    //
    // This exists because headless Chrome 145 clamps --window-size to a 500 CSS px minimum, so
    // a 360, 375 or 393 px phone viewport simply cannot be asked for. Rather than assert that
    // the clamp does not matter, the same page is rendered at two window widths that differ by
    // 900 px and every run of text must land in exactly the same place relative to .screen.
    // If it does, no length in the layout is a function of the viewport, and the geometry
    // measured at 500 px is the geometry the phone gets. If a percentage or a vw unit ever
    // creeps in, this fails and the rest of the lock-screen numbers stop being trustworthy.
    {
      const probePerson = report.people[0];
      const probeDevice = DEVICES[0];
      const file = path.join(dist, probePerson.id, `lock-${probeDevice.id}.html`);
      const narrow = measurePage(chrome, file, work, 'vp-narrow', 500, 900);
      const wide = measurePage(chrome, file, work, 'vp-wide', 1400, 900);
      const key = (p) => JSON.stringify(p.runs.map((r) => [
        r.id, round(r.left), round(r.top), round(r.widthPx), round(r.fontSizePx)
      ]));
      check(narrow.runs.length > 0 && key(narrow) === key(wide),
        'the lock screen layout changes with the browser window width, so what is measured at '
        + `a clamped 500 px viewport is not what a ${probeDevice.cssWidth} px phone would show. `
        + `Narrow run count ${narrow.runs.length}, wide ${wide.runs.length}.`);
      check(Math.abs(narrow.screen.widthPx - probeDevice.cssWidth) < 0.5,
        `the .screen box measured ${round(narrow.screen.widthPx)} CSS px wide, the device is `
        + `${probeDevice.cssWidth}`);
      notes.push(`viewport independence: identical geometry at 500 px and 1400 px window widths`);
    }
    let fontSeen = null;
    let worstUnderPredictMm = 0;
    let minXHeightMm = Infinity;
    let minPt = Infinity;
    let minContrast = Infinity;
    let runsMeasured = 0;

    for (const person of report.people) {
      // ---- wallet cards ----
      const cardsFile = path.join(dist, person.id, 'cards.html');
      const probe = measurePage(chrome, cardsFile, work, `${person.id}-cards`, 900, 1400);

      // Page identity, asserted before anything is believed. The browser is shared on this
      // machine and a concurrent agent can navigate it; a measurement of the wrong page is
      // worse than no measurement.
      check(probe.person === person.id,
        `${person.id}: the page that was measured reports data-person=${JSON.stringify(probe.person)}`);
      check(probe.title === `Emergency card, ${person.name}`,
        `${person.id}: the measured page's title is ${JSON.stringify(probe.title)}`);

      if (fontSeen === null) fontSeen = probe.dejavu;
      check(probe.dejavu === true,
        `${person.id}: DejaVu Sans is not available to the browser, so the advance-width table `
        + 'in src/metrics.js describes a different font than the one that rendered. Install it '
        + '(Debian and Ubuntu: `sudo apt-get install fonts-dejavu-core`).');

      check(probe.cards.length === person.layout.sideCount,
        `${person.id}: the page has ${probe.cards.length} card sides, the report says `
        + `${person.layout.sideCount}`);

      for (const card of probe.cards) {
        check(Math.abs(card.widthMm - CARD.widthMm) < 0.05,
          `${person.id} ${card.id}: rendered ${round(card.widthMm)} mm wide, ISO/IEC 7810 ID-1 `
          + `is ${CARD.widthMm} mm`);
        check(Math.abs(card.heightMm - CARD.heightMm) < 0.05,
          `${person.id} ${card.id}: rendered ${round(card.heightMm)} mm tall, ISO/IEC 7810 ID-1 `
          + `is ${CARD.heightMm} mm`);
        check(card.escapes.length === 0,
          `${person.id} ${card.id}: ${card.escapes.length} element(s) escape the card, `
          + `worst by ${round(Math.max(...card.escapes.map((e) => Math.max(e.overRightMm, e.overBottomMm)), 0))} mm: `
          + card.escapes.slice(0, 3).map((e) => JSON.stringify(e.text)).join(', '));
      }

      const predicted = new Map(person.cardRuns.map((r) => [r.id, r]));
      check(probe.runs.length === person.cardRuns.length,
        `${person.id}: the browser found ${probe.runs.length} runs of text, the report describes `
        + `${person.cardRuns.length}`);

      for (const run of probe.runs) {
        runsMeasured += 1;
        const model = predicted.get(run.id);
        if (!check(model, `${person.id}: run ${run.id} is on the page but not in the report`)) continue;

        check(run.text === model.text,
          `${person.id} ${run.id}: the page says ${JSON.stringify(run.text)}, the report says `
          + JSON.stringify(model.text));

        // The measured point size, not the CSS one. Content that overflows can be scaled.
        minPt = Math.min(minPt, run.fontSizePt);
        check(run.fontSizePt >= LEGIBILITY.minPt - 0.02,
          `${person.id} ${run.id}: rendered at ${round(run.fontSizePt)} pt, under the `
          + `${LEGIBILITY.minPt} pt floor. Text: ${JSON.stringify(run.text.slice(0, 40))}`);

        minXHeightMm = Math.min(minXHeightMm, run.xHeightMm);
        check(run.xHeightMm >= LEGIBILITY.minXHeightMm - 0.005,
          `${person.id} ${run.id}: the rendered x-height is ${round(run.xHeightMm)} mm, under the `
          + `${LEGIBILITY.minXHeightMm} mm floor`);

        minContrast = Math.min(minContrast, run.contrast);
        check(run.contrast >= CONTRAST.min - 0.01,
          `${person.id} ${run.id}: measured contrast ${round(run.contrast)}:1 against the painted `
          + `background, under the ${CONTRAST.min}:1 floor`);

        // The model must never think a line is narrower than it renders.
        const under = run.widthMm - model.predictedWidthMm;
        if (under > worstUnderPredictMm) worstUnderPredictMm = under;
        check(under <= 0.05,
          `${person.id} ${run.id}: the model predicted ${model.predictedWidthMm} mm and the `
          + `browser rendered ${round(run.widthMm)} mm, so the model under-predicts by `
          + `${round(under)} mm. Under-prediction is the direction that clips content.`);
        check(model.predictedWidthMm - run.widthMm <= 0.35,
          `${person.id} ${run.id}: the model predicted ${model.predictedWidthMm} mm for a line `
          + `that rendered at ${round(run.widthMm)} mm, which is over-conservative enough to be `
          + 'costing card capacity');
        check(run.widthMm <= model.containerWidthMm + 0.05,
          `${person.id} ${run.id}: rendered ${round(run.widthMm)} mm wide in a `
          + `${model.containerWidthMm} mm column`);
      }

      // ---- lock screens ----
      for (const lock of person.lockScreens) {
        const device = deviceById.get(lock.device);
        const file = path.join(dist, person.id, `lock-${device.id}.html`);
        const lockProbe = measurePage(chrome, file, work,
          `${person.id}-${device.id}`, device.cssWidth, device.cssHeight);

        check(lockProbe.person === person.id && lockProbe.device === device.id,
          `${person.id} ${device.id}: measured the wrong page `
          + `(${lockProbe.person}/${lockProbe.device})`);
        if (!check(lockProbe.screen, `${person.id} ${device.id}: no .screen element found`)) continue;

        const s = lockProbe.screen;
        check(Math.abs(s.widthPx - device.cssWidth) < 0.5 && Math.abs(s.heightPx - device.cssHeight) < 0.5,
          `${person.id} ${device.id}: the screen rendered ${round(s.widthPx)}x${round(s.heightPx)} `
          + `CSS px, the device is ${device.cssWidth}x${device.cssHeight}`);
        // The layout viewport is deliberately NOT asserted to equal the device width. Headless
        // Chrome 145 clamps --window-size to a minimum of 500 CSS px, so 360, 375 and 393 all
        // come back as 500 and the flag cannot express a phone. What makes the measurement
        // valid anyway is that the lock-screen layout does not depend on the viewport: every
        // length inside .screen is a fixed pixel value. That is not assumed either, it is
        // proved once below by rendering the same page at two very different window widths and
        // requiring identical geometry.
        check(s.intrusions.length === 0,
          `${person.id} ${device.id}: ${s.intrusions.length} run(s) of text sit in the reserved `
          + `clock or shortcut area: `
          + s.intrusions.slice(0, 3).map((i) => `${JSON.stringify(i.text)} ${i.why.join(' and ')}`).join('; '));
        check(s.placed === lock.placed && s.omitted === lock.omitted,
          `${person.id} ${device.id}: the page says ${s.placed} placed and ${s.omitted} deferred, `
          + `the report says ${lock.placed} and ${lock.omitted}`);
        check(lockProbe.scrollWidth <= lockProbe.clientWidth + 0.5,
          `${person.id} ${device.id}: the page scrolls sideways `
          + `(${lockProbe.scrollWidth} px of content in a ${lockProbe.clientWidth} px viewport)`);

        const lockPredicted = new Map(lock.runs.map((r) => [r.id, r]));
        for (const run of lockProbe.runs) {
          runsMeasured += 1;
          const model = lockPredicted.get(run.id);
          if (!check(model, `${person.id} ${device.id}: run ${run.id} is not in the report`)) continue;
          check(run.fontSizePx >= LOCKSCREEN.minPx - 0.02,
            `${person.id} ${device.id} ${run.id}: rendered at ${round(run.fontSizePx)} px, under `
            + `the ${LOCKSCREEN.minPx} px floor`);
          minContrast = Math.min(minContrast, run.contrast);
          check(run.contrast >= CONTRAST.min - 0.01,
            `${person.id} ${device.id} ${run.id}: measured contrast ${round(run.contrast)}:1, `
            + `under the ${CONTRAST.min}:1 floor`);
          check(run.widthPx - model.predictedWidthPx <= 0.2,
            `${person.id} ${device.id} ${run.id}: the model predicted `
            + `${model.predictedWidthPx} px and the browser rendered ${round(run.widthPx)} px`);
          check(run.widthPx <= model.containerWidthPx + 0.2,
            `${person.id} ${device.id} ${run.id}: rendered ${round(run.widthPx)} px wide in a `
            + `${model.containerWidthPx} px column`);
        }

        // The PNG. This is the one claim a screenshot is the right evidence for, and the trap
        // it guards is exactly the one that makes screenshots useless for anything else: the
        // window size and the captured size can differ.
        const png = path.join(dist, person.id, `lock-${device.id}.png`);
        if (!check(fs.existsSync(png),
          `${person.id} ${device.id}: ${path.relative(ROOT, png)} does not exist. Run `
          + '`node bin/emcard.js shoot`.')) continue;
        const pngBytes = fs.readFileSync(png);
        const size = readPngSize(pngBytes);
        check(size.width === lock.pixelWidth && size.height === lock.pixelHeight,
          `${person.id} ${device.id}: the PNG is ${size.width}x${size.height}, the device is `
          + `${lock.pixelWidth}x${lock.pixelHeight}`);

        // And the pixels. The panel is white, the wallpaper behind it is near black, so the
        // boundary between them is readable straight out of the image. Sampling just outside
        // and just inside each edge proves the panel landed exactly in the safe area in the
        // file the user will actually set as a wallpaper, at the resolution they will set it
        // at. Measuring the HTML proves the layout; only this proves the capture.
        const image = decodePng(pngBytes);
        const paper = hexToRgb(PALETTE.paper);
        const wall = [0x10, 0x10, 0x14];
        const d = device.dpr;
        const midX = (lock.safeLeftPx + lock.safeRightPx) / 2 * d;
        // The sample points sit in the panel's own padding, which is 14 CSS px of plain paper
        // on every edge, so they say where the panel is without landing on a glyph.
        const samples = [
          ['the top left corner is wallpaper', 4, 4, wall],
          ['10 px above the panel is still wallpaper', midX, (lock.safeTopPx - 10) * d, wall],
          ['the panel starts at the top of the safe area', midX, (lock.safeTopPx + 6) * d, paper],
          ['the panel ends at the bottom of the safe area', midX, (lock.safeBottomPx - 6) * d, paper],
          ['10 px below the panel is wallpaper again', midX, (lock.safeBottomPx + 10) * d, wall],
          ['left of the panel is wallpaper', (lock.safeLeftPx - 8) * d,
            (lock.safeTopPx + lock.safeBottomPx) / 2 * d, wall],
          ['right of the panel is wallpaper', (lock.safeRightPx + 8) * d,
            (lock.safeTopPx + lock.safeBottomPx) / 2 * d, wall]
        ];
        for (const [what, x, y, want] of samples) {
          const got = pixelAt(image, x, y);
          check(near(got, want),
            `${person.id} ${device.id}: in the PNG, ${what}: pixel (${Math.round(x)}, `
            + `${Math.round(y)}) is rgb(${got.join(',')}), expected about rgb(${want.join(',')})`);
        }

        // A white panel with no text on it would pass every geometric check above. So the
        // panel interior is counted: it has to be mostly paper AND to carry a real quantity of
        // dark ink. This is the pixel-level version of "assert on something the page must have
        // produced" rather than on the file existing.
        let inkPixels = 0;
        let paperPixels = 0;
        const step = Math.max(1, Math.round(d));
        for (let y = Math.round((lock.safeTopPx + 16) * d); y < Math.round((lock.safeBottomPx - 16) * d); y += step) {
          for (let x = Math.round((lock.safeLeftPx + 16) * d); x < Math.round((lock.safeRightPx - 16) * d); x += step) {
            const px = pixelAt(image, x, y);
            if (px[0] < 100 && px[1] < 100 && px[2] < 100) inkPixels += 1;
            else if (px[0] > 230 && px[1] > 230 && px[2] > 230) paperPixels += 1;
          }
        }
        check(inkPixels > 400,
          `${person.id} ${device.id}: only ${inkPixels} dark pixels inside the panel in the PNG. `
          + 'The image is a blank card.');
        check(paperPixels > inkPixels * 2,
          `${person.id} ${device.id}: the panel interior is ${paperPixels} paper pixels against `
          + `${inkPixels} ink pixels, which is not a page of text on a white card`);
      }
    }

    notes.push(`measured ${runsMeasured} runs of text in a real browser`);
    notes.push(`smallest rendered type: ${round(minPt)} pt (floor ${LEGIBILITY.minPt})`);
    notes.push(`smallest rendered x-height: ${round(minXHeightMm)} mm (floor ${LEGIBILITY.minXHeightMm})`);
    notes.push(`lowest measured contrast: ${round(minContrast)}:1 (floor ${CONTRAST.min})`);
    notes.push(`worst model under-prediction: ${round(worstUnderPredictMm)} mm (must be at most 0.05)`);
    notes.push(`DejaVu Sans available to the browser: ${fontSeen}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  for (const note of notes) process.stdout.write(`  ${note}\n`);
  if (failures.length > 0) {
    process.stdout.write(`\nBROWSER MEASUREMENT FAILED: ${failures.length} of ${checks} checks\n`);
    for (const f of failures.slice(0, 40)) process.stdout.write(`  ${f}\n`);
    if (failures.length > 40) process.stdout.write(`  ... and ${failures.length - 40} more\n`);
    return 1;
  }
  process.stdout.write(`BROWSER MEASUREMENT PASSED: ${checks} checks\n`);
  return 0;
}

process.exitCode = main();
