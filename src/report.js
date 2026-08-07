// Judge the cards the tool just built, and write down the judgement.
//
// The report is the tool's own verdict on its own output: every run of text on every card and
// every lock screen, checked against the legibility floor, the x-height floor, the contrast
// floor and the width of the box it sits in. `emcard build` exits nonzero when there is a
// finding, so a palette edit that drops contrast below the floor or a type-scale edit that
// drops a label under 8 pt fails the build rather than shipping.
//
// It is also the measured output that scripts/sabotage.py fingerprints. That has one hard
// requirement: the report must be a function of the input and the code, and of nothing else.
// No timestamps, no absolute paths, no hostnames, no iteration order that depends on a hash
// seed. The null control in the sabotage harness exists to catch a violation of that, and
// scripts/fingerprint.js refuses to emit anything containing a filesystem path.

import { CARD, CONTRAST, LEGIBILITY, DEVICES, LOCKSCREEN } from './design.js';
import { contrastRatio } from './color.js';
import { xHeightMm } from './metrics.js';
import { layoutPerson, round } from './layout.js';
import { renderCardsPage } from './card.js';
import { renderLockScreen } from './lockscreen.js';
import { ptToMm } from './units.js';

/** Width tolerance in millimetres. Zero would make floating point noise a finding. */
const WIDTH_EPS_MM = 0.01;
const WIDTH_EPS_PX = 0.05;

function judgeCardRun(run) {
  const findings = [];
  if (run.pt < LEGIBILITY.minPt - 1e-9) {
    findings.push({
      kind: 'below-point-floor',
      run: run.id,
      detail: `${run.pt} pt is under the ${LEGIBILITY.minPt} pt floor`,
      text: run.text
    });
  }
  const xh = xHeightMm(run.pt);
  if (xh < LEGIBILITY.minXHeightMm - 1e-9) {
    findings.push({
      kind: 'below-x-height-floor',
      run: run.id,
      detail: `x-height ${round(xh)} mm is under the ${LEGIBILITY.minXHeightMm} mm floor`,
      text: run.text
    });
  }
  const ratio = contrastRatio(run.color, run.background);
  if (ratio === null) {
    findings.push({
      kind: 'unreadable-colour',
      run: run.id,
      detail: `could not parse ${JSON.stringify(run.color)} on ${JSON.stringify(run.background)}`,
      text: run.text
    });
  } else if (ratio < CONTRAST.min - 1e-9) {
    findings.push({
      kind: 'below-contrast-floor',
      run: run.id,
      detail: `${round(ratio)}:1 is under the ${CONTRAST.min}:1 floor`,
      text: run.text
    });
  }
  if (run.predictedWidthMm > run.containerWidthMm + WIDTH_EPS_MM) {
    findings.push({
      kind: 'predicted-overflow',
      run: run.id,
      detail: `the model puts this line at ${round(run.predictedWidthMm)} mm in a `
        + `${round(run.containerWidthMm)} mm column`,
      text: run.text
    });
  }
  return { findings, ratio, xHeightMm: round(xh) };
}

function judgeLockRun(run) {
  const findings = [];
  if (run.px < LOCKSCREEN.minPx - 1e-9) {
    findings.push({
      kind: 'below-pixel-floor',
      run: run.id,
      detail: `${run.px} px is under the ${LOCKSCREEN.minPx} px floor`,
      text: run.text
    });
  }
  const ratio = contrastRatio(run.color, run.background);
  if (ratio === null) {
    findings.push({ kind: 'unreadable-colour', run: run.id, detail: 'colour did not parse', text: run.text });
  } else if (ratio < CONTRAST.min - 1e-9) {
    findings.push({
      kind: 'below-contrast-floor',
      run: run.id,
      detail: `${round(ratio)}:1 is under the ${CONTRAST.min}:1 floor`,
      text: run.text
    });
  }
  if (run.predictedWidthPx > run.containerWidthPx + WIDTH_EPS_PX) {
    findings.push({
      kind: 'predicted-overflow',
      run: run.id,
      detail: `the model puts this line at ${round(run.predictedWidthPx)} px in a `
        + `${round(run.containerWidthPx)} px column`,
      text: run.text
    });
  }
  return { findings, ratio };
}

/**
 * Build every artefact for every person and judge all of it.
 *
 * Returns { report, files, runs }. `files` is a map of relative path to file contents, so the
 * caller decides whether to write to disk. Nothing in here touches the filesystem.
 */
export function buildAll(people, options = {}) {
  const sourceSha256 = options.sourceSha256 || '';
  const meta = { sourceSha256, minContrast: CONTRAST.min };
  const files = new Map();
  const peopleReports = [];
  const allFindings = [];
  const allCardRuns = [];
  const allLockRuns = [];

  for (const person of people) {
    const laid = layoutPerson(person);
    const page = renderCardsPage(laid, meta);
    files.set(`${person.id}/cards.html`, page.html);

    const cardRunReports = [];
    let minRatio = Infinity;
    let minPt = Infinity;
    for (const run of page.runs) {
      const judged = judgeCardRun(run);
      allFindings.push(...judged.findings.map((f) => ({ person: person.id, where: 'card', ...f })));
      if (judged.ratio !== null) minRatio = Math.min(minRatio, judged.ratio);
      minPt = Math.min(minPt, run.pt);
      cardRunReports.push({
        id: run.id,
        kind: run.kind,
        sideIndex: run.sideIndex,
        text: run.text,
        pt: run.pt,
        weight: run.weight,
        color: run.color,
        background: run.background,
        contrast: judged.ratio === null ? null : round(judged.ratio),
        xHeightMm: judged.xHeightMm,
        predictedWidthMm: round(run.predictedWidthMm),
        containerWidthMm: round(run.containerWidthMm),
        lineHeightMm: round(run.lineHeightMm)
      });
    }
    allCardRuns.push(...cardRunReports);

    const lockReports = [];
    for (const device of DEVICES) {
      const screen = renderLockScreen(person, device, meta);
      files.set(`${person.id}/lock-${device.id}.html`, screen.html);
      const runReports = [];
      let lockMinRatio = Infinity;
      let lockMinPx = Infinity;
      for (const run of screen.runs) {
        const judged = judgeLockRun(run);
        allFindings.push(...judged.findings.map((f) => ({
          person: person.id, where: `lock/${device.id}`, ...f
        })));
        if (judged.ratio !== null) lockMinRatio = Math.min(lockMinRatio, judged.ratio);
        lockMinPx = Math.min(lockMinPx, run.px);
        runReports.push({
          id: run.id,
          kind: run.kind,
          device: device.id,
          text: run.text,
          px: run.px,
          weight: run.weight,
          color: run.color,
          background: run.background,
          contrast: judged.ratio === null ? null : round(judged.ratio),
          predictedWidthPx: round(run.predictedWidthPx),
          containerWidthPx: round(run.containerWidthPx)
        });
      }
      allLockRuns.push(...runReports);
      lockReports.push({
        device: device.id,
        label: device.label,
        cssWidth: device.cssWidth,
        cssHeight: device.cssHeight,
        dpr: device.dpr,
        pixelWidth: device.cssWidth * device.dpr,
        pixelHeight: device.cssHeight * device.dpr,
        safeTopPx: round(screen.fit.area.top),
        safeBottomPx: round(screen.fit.area.bottom),
        safeLeftPx: round(screen.fit.area.left),
        safeRightPx: round(screen.fit.area.right),
        placed: screen.fit.placed.length,
        omitted: screen.fit.omitted.length,
        omittedIds: screen.fit.omitted.map((a) => a.id),
        note: screen.fit.note,
        usedPx: round(screen.fit.usedPx),
        budgetPx: round(screen.fit.budgetPx),
        runs: runReports,
        minContrast: lockMinRatio === Infinity ? null : round(lockMinRatio),
        minPx: lockMinPx === Infinity ? null : lockMinPx
      });
    }

    peopleReports.push({
      id: person.id,
      name: person.name,
      bloodType: person.bloodType,
      atomCount: person.atoms.length,
      atomIds: person.atoms.map((a) => a.id),
      layout: laid.report,
      cardRuns: cardRunReports,
      minContrast: minRatio === Infinity ? null : round(minRatio),
      minPt: minPt === Infinity ? null : minPt,
      lockScreens: lockReports
    });
  }

  const report = {
    tool: 'emergency-info-card',
    reportVersion: 1,
    sourceSha256,
    thresholds: {
      cardWidthMm: CARD.widthMm,
      cardHeightMm: CARD.heightMm,
      marginMm: CARD.marginMm,
      minPt: LEGIBILITY.minPt,
      minEmMm: round(ptToMm(LEGIBILITY.minPt)),
      minXHeightMm: LEGIBILITY.minXHeightMm,
      minContrast: CONTRAST.min,
      lockMinPx: LOCKSCREEN.minPx
    },
    people: peopleReports,
    findings: allFindings,
    summary: {
      peopleCount: peopleReports.length,
      cardRunCount: allCardRuns.length,
      lockRunCount: allLockRuns.length,
      findingCount: allFindings.length,
      totalCards: peopleReports.reduce((a, p) => a + p.layout.cardCount, 0),
      minContrast: peopleReports.length
        ? round(Math.min(...peopleReports.flatMap((p) => [
          p.minContrast, ...p.lockScreens.map((l) => l.minContrast)
        ].filter((v) => v !== null))))
        : null,
      minPt: peopleReports.length ? Math.min(...peopleReports.map((p) => p.minPt)) : null
    }
  };

  files.set('report.json', `${JSON.stringify(report, null, 2)}\n`);
  return { report, files };
}
