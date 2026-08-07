#!/usr/bin/env node
// One number that stands for everything the build produced.
//
//   node scripts/fingerprint.js --dist DIR
//
// scripts/sabotage.py uses this as the "measured output" in gate 2: break something, rebuild,
// and require the number to move. That puts one hard requirement on it, and the requirement is
// easier to state than to keep:
//
//   the fingerprint must be a function of the input and the code, and of nothing else.
//
// If it also tracks the working directory, then copying the tree changes it, gate 2 passes for
// free for every sabotage, and the whole run is void. AGENTS.md records the day that happened
// to another project in this fleet and the eleven sabotages it invalidated. So two defences:
//
//   1. The null control in sabotage.py runs this against an unmodified copy first and aborts
//      if the number differs.
//   2. This script refuses to emit a fingerprint for a tree whose files contain an absolute
//      filesystem path at all. That is the mechanism by which a working-directory dependence
//      would get in, and it is cheaper to forbid it than to detect it later.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Every file under `dir`, as paths relative to it, sorted so the order is not the OS's. */
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

/**
 * Absolute paths that must not appear inside a generated file.
 *
 * `/home/` and `/Users/` and `/tmp/` cover the three places a tree gets built, and the dist
 * directory's own path covers the case where the build helpfully writes down where it put
 * things. A hostname would be just as poisonous but does not have a reliable shape, which is
 * why the null control exists as well rather than instead.
 */
function pathLeaks(text, distDir) {
  const found = [];
  for (const needle of ['/home/', '/Users/', '/tmp/', '/var/folders/', distDir]) {
    if (needle && text.includes(needle)) found.push(needle);
  }
  return found;
}

const TEXT_EXTENSIONS = new Set(['.html', '.json', '.txt', '.css', '.js', '.svg']);

function main() {
  const distArg = process.argv.indexOf('--dist');
  if (distArg < 0 || !process.argv[distArg + 1]) {
    process.stderr.write('usage: fingerprint.js --dist DIR\n');
    return 2;
  }
  const dist = path.resolve(process.argv[distArg + 1]);
  if (!fs.existsSync(dist)) {
    process.stderr.write(`${dist} does not exist. There is nothing to fingerprint, and an empty `
      + 'tree must not produce a fingerprint that looks like a successful one.\n');
    return 1;
  }

  const files = walk(dist);
  if (files.length === 0) {
    process.stderr.write('the output directory is empty. Refusing to emit a fingerprint of '
      + 'nothing, because a fingerprint of nothing is stable and would pass every gate.\n');
    return 1;
  }

  const overall = crypto.createHash('sha256');
  const perFile = [];
  const leaks = [];
  for (const rel of files) {
    const bytes = fs.readFileSync(path.join(dist, rel));
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    // The relative path is part of the digest, so renaming or dropping a file moves it.
    overall.update(rel).update('\0').update(digest).update('\n');
    perFile.push({ file: rel, bytes: bytes.length, sha256: digest.slice(0, 16) });
    if (TEXT_EXTENSIONS.has(path.extname(rel))) {
      const bad = pathLeaks(bytes.toString('utf8'), dist);
      if (bad.length > 0) leaks.push({ file: rel, contains: bad });
    }
  }

  if (leaks.length > 0) {
    process.stderr.write('FINGERPRINT REFUSED: generated files contain absolute filesystem '
      + 'paths, so this fingerprint would track where the tree was built rather than what the '
      + 'code does. Gate 2 of every sabotage would pass for free.\n');
    for (const leak of leaks.slice(0, 10)) {
      process.stderr.write(`  ${leak.file} contains ${leak.contains.join(', ')}\n`);
    }
    return 1;
  }

  // Headline numbers, pulled out so a human reading two fingerprints side by side can see what
  // moved rather than only that something did.
  let headline = null;
  const reportPath = path.join(dist, 'report.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    headline = {
      sourceSha256: report.sourceSha256.slice(0, 16),
      people: report.summary.peopleCount,
      cards: report.summary.totalCards,
      cardRuns: report.summary.cardRunCount,
      lockRuns: report.summary.lockRunCount,
      findings: report.summary.findingCount,
      minPt: report.summary.minPt,
      minContrast: report.summary.minContrast,
      atomsPerPerson: report.people.map((p) => [p.id, p.atomCount, p.layout.cardCount]),
      lockOmissions: report.people.flatMap((p) =>
        p.lockScreens.map((l) => [p.id, l.device, l.placed, l.omitted]))
    };
  }

  process.stdout.write(`${JSON.stringify({
    fingerprint: overall.digest('hex'),
    fileCount: files.length,
    headline,
    files: perFile
  }, null, 2)}\n`);
  return 0;
}

process.exitCode = main();
