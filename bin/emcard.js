#!/usr/bin/env node
// emcard, the command line for emergency-info-card.
//
//   emcard build [--people people.json] [--out dist] [--today YYYY-MM-DD]
//   emcard check [--people people.json] [--today YYYY-MM-DD]
//   emcard shoot [--out dist] [--chrome /path/to/chrome]
//
// build   reads the people file, lays out every card and lock screen, writes the HTML and a
//         report, and exits nonzero if the report contains a finding.
// check   does the same without writing anything.
// shoot   turns the lock-screen HTML into PNGs at real device resolution using a local Chrome.
//         It is a separate verb because it is the only part of this tool that runs another
//         program, and everything else must stay usable on a machine with no browser.
//
// This program makes no network requests. Not "should not": scripts/netblock.cjs replaces
// every outbound primitive in Node with something that throws, verify.sh runs `build` under it
// and requires byte-identical output, and it also runs it with the DNS resolver pointed at a
// dead address. The claim is tested rather than asserted, which matters here because the input
// file holds a child's medication list.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadPeople, PeopleFileError } from '../src/schema.js';
import { buildAll } from '../src/report.js';
import { DEVICES } from '../src/design.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function usage(code) {
  process.stderr.write(`usage:
  emcard build [--people FILE] [--out DIR] [--today YYYY-MM-DD]
  emcard check [--people FILE] [--today YYYY-MM-DD]
  emcard shoot [--out DIR] [--chrome PATH]

The default people file is people.json if it exists, otherwise people.example.json.
`);
  return code;
}

function resolvePeopleFile(given) {
  if (given && given !== true) return path.resolve(given);
  const local = path.join(process.cwd(), 'people.json');
  if (fs.existsSync(local)) return local;
  const example = path.join(ROOT, 'people.example.json');
  if (fs.existsSync(example)) return example;
  throw new Error('no people file found. Copy people.example.json to people.json and edit it.');
}

function readPeople(file, today) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`could not read ${path.basename(file)}: ${err.message}`);
  }
  const sourceSha256 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${err.message}`);
  }
  return { people: loadPeople(json, { today }), sourceSha256 };
}

/**
 * The default "today" is fixed rather than the real date.
 *
 * Ages are computed from it, so using the wall clock would make every output change at
 * midnight, which would make the build non-reproducible, break the sabotage harness's
 * fingerprint, and put a date-shaped difference into every diff. Pass --today to get a real
 * age on a real card. The value used is recorded in the report.
 */
const DEFAULT_TODAY = '2026-01-01';

function printFindings(report) {
  if (report.findings.length === 0) return;
  process.stderr.write(`\n${report.findings.length} finding(s):\n`);
  for (const f of report.findings) {
    process.stderr.write(`  ${f.person} ${f.where} ${f.kind}: ${f.detail}\n`);
    process.stderr.write(`    text: ${JSON.stringify(f.text)}\n`);
  }
}

function summarise(report) {
  const lines = [];
  lines.push(`people: ${report.summary.peopleCount}, cards: ${report.summary.totalCards}, `
    + `text runs: ${report.summary.cardRunCount} on cards and ${report.summary.lockRunCount} on lock screens`);
  lines.push(`smallest type: ${report.summary.minPt} pt (floor ${report.thresholds.minPt} pt), `
    + `lowest contrast: ${report.summary.minContrast}:1 (floor ${report.thresholds.minContrast}:1)`);
  for (const p of report.people) {
    const lock = p.lockScreens.map((l) => `${l.device} ${l.placed} shown`
      + (l.omitted ? ` ${l.omitted} deferred` : '')).join(', ');
    const split = p.layout.splitAtoms.length
      ? `, ${p.layout.splitAtoms.length} long entry split across sides` : '';
    lines.push(`  ${p.id}: ${p.atomCount} facts on ${p.layout.cardCount} card(s), `
      + `${p.layout.sideCount} side(s)${split}; lock screen ${lock}`);
  }
  return lines.join('\n');
}

function cmdBuildOrCheck(args, write) {
  const today = typeof args.today === 'string' ? args.today : DEFAULT_TODAY;
  const file = resolvePeopleFile(args.people);
  const { people, sourceSha256 } = readPeople(file, today);
  const { report, files } = buildAll(people, { sourceSha256 });
  report.today = today;
  files.set('report.json', `${JSON.stringify(report, null, 2)}\n`);

  const outDir = path.resolve(typeof args.out === 'string' ? args.out : 'dist');
  if (write) {
    for (const [rel, contents] of files) {
      const target = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }
  }

  process.stdout.write(`source: ${path.basename(file)} sha256 ${sourceSha256.slice(0, 16)}\n`);
  process.stdout.write(`${summarise(report)}\n`);
  if (write) {
    process.stdout.write(`wrote ${files.size} file(s) under ${path.relative(process.cwd(), outDir) || '.'}\n`);
    process.stdout.write('lock-screen PNGs are not written by build. Run: emcard shoot\n');
  }
  printFindings(report);
  if (report.findings.length > 0) {
    process.stderr.write('\nBUILD FAILED: the tool judged its own output unreadable. '
      + 'Nothing above the legibility, contrast and fit floors was produced.\n');
    return 1;
  }
  process.stdout.write('OK: every run of text clears the point, x-height, contrast and fit floors.\n');
  return 0;
}

const CHROME_CANDIDATES = ['google-chrome', 'google-chrome-stable', 'chromium',
  'chromium-browser', 'chrome'];

function findChrome(explicit) {
  if (explicit && explicit !== true) {
    if (fs.existsSync(explicit)) return explicit;
    throw new Error(`--chrome ${explicit} does not exist`);
  }
  if (process.env.EMCARD_CHROME && fs.existsSync(process.env.EMCARD_CHROME)) {
    return process.env.EMCARD_CHROME;
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of CHROME_CANDIDATES) {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // keep looking
      }
    }
  }
  throw new Error('no Chrome or Chromium found on PATH. Install one, or pass --chrome PATH. '
    + 'Only `emcard shoot` needs it; `emcard build` does not.');
}

/**
 * Flags that keep Chrome from talking to anything. A browser is the one component here that
 * would otherwise phone home, so component updates, sync, safe browsing lookups, field trials
 * and the variations service are all switched off explicitly.
 *
 * --disable-crashpad-for-testing and --disable-features=Crashpad are deliberately NOT here.
 * On this workstation those two put Chrome into an infinite crash-restart loop.
 */
const OFFLINE_FLAGS = [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-client-side-phishing-detection',
  '--disable-sync',
  '--disable-domain-reliability',
  '--no-pings',
  '--metrics-recording-only',
  '--disable-default-apps',
  '--safebrowsing-disable-auto-update'
];

/**
 * How many CSS pixels of window height headless Chrome keeps for itself.
 *
 * This matters more than it sounds. Chrome captures a screenshot at the WINDOW size but only
 * paints the VIEWPORT, and the viewport is shorter than the window by a fixed amount (87 CSS
 * px on Chrome 145 here). Asking for a 375 by 667 screenshot therefore produced a correctly
 * sized 750 by 1334 PNG whose bottom 87 CSS pixels were unpainted background, silently cutting
 * the foot off the card. The image had exactly the right dimensions the whole time, which is
 * why nothing short of reading its pixels found it.
 *
 * So the overhead is measured rather than assumed: a probe page reports window.innerHeight for
 * a known window height, the difference is added to every shot, and the extra rows are cropped
 * off afterwards.
 */
function measureChromeChrome(chrome, execFileSync, os, fs2, path2) {
  const dir = fs2.mkdtempSync(path2.join(os.tmpdir(), 'emcard-vp-'));
  try {
    const probe = path2.join(dir, 'probe.html');
    fs2.writeFileSync(probe, '<title>vp</title><body><script>'
      + 'document.documentElement.setAttribute("data-vp", window.innerWidth + "x" + window.innerHeight);'
      + '</script></body>');
    const dom = execFileSync(chrome, [
      ...OFFLINE_FLAGS,
      `--user-data-dir=${path2.join(dir, 'profile')}`,
      '--window-size=800,900',
      '--virtual-time-budget=4000',
      '--dump-dom',
      `file://${probe}`
    ], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = dom.match(/data-vp="(\d+)x(\d+)"/);
    if (!m) throw new Error('the viewport probe page did not run in Chrome');
    return { widthOverhead: 800 - Number(m[1]), heightOverhead: 900 - Number(m[2]) };
  } finally {
    fs2.rmSync(dir, { recursive: true, force: true });
  }
}

async function cmdShoot(args) {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const { decodePng, cropPng, encodePng } = await import('../scripts/png.js');
  const chrome = findChrome(args.chrome);
  const outDir = path.resolve(typeof args.out === 'string' ? args.out : 'dist');
  const reportPath = path.join(outDir, 'report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`${path.relative(process.cwd(), reportPath)} does not exist. Run `
      + '`emcard build` first.');
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const byId = new Map(DEVICES.map((d) => [d.id, d]));

  let count = 0;
  for (const person of report.people) {
    for (const lock of person.lockScreens) {
      const device = byId.get(lock.device);
      const source = path.join(outDir, person.id, `lock-${device.id}.html`);
      const target = path.join(outDir, person.id, `lock-${device.id}.png`);
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'emcard-chrome-'));
      try {
        execFileSync(chrome, [
          ...OFFLINE_FLAGS,
          `--user-data-dir=${profile}`,
          `--force-device-scale-factor=${device.dpr}`,
          `--window-size=${device.cssWidth},${device.cssHeight}`,
          '--hide-scrollbars',
          '--virtual-time-budget=6000',
          `--screenshot=${target}`,
          `file://${source}`
        ], { timeout: 120_000, stdio: ['ignore', 'ignore', 'ignore'] });
      } finally {
        fs.rmSync(profile, { recursive: true, force: true });
      }
      if (!fs.existsSync(target)) {
        throw new Error(`Chrome did not produce ${path.relative(process.cwd(), target)}`);
      }
      const size = readPngSize(fs.readFileSync(target));
      const want = { w: device.cssWidth * device.dpr, h: device.cssHeight * device.dpr };
      if (size.width !== want.w || size.height !== want.h) {
        throw new Error(`${device.id}: the PNG is ${size.width}x${size.height} but the device is `
          + `${want.w}x${want.h}. The window size and the captured size disagree, which is the `
          + 'exact trap that makes a screenshot an unreliable measurement.');
      }
      process.stdout.write(`  ${person.id} ${device.id} ${size.width}x${size.height}\n`);
      count += 1;
    }
  }
  process.stdout.write(`wrote ${count} lock-screen PNG(s) at real device resolution\n`);
  return 0;
}

/** Read width and height out of a PNG's IHDR chunk. Twelve lines, and no dependency. */
export function readPngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('not a PNG: the eight byte signature is wrong');
  }
  if (buffer.subarray(12, 16).toString('latin1') !== 'IHDR') {
    throw new Error('not a PNG: the first chunk is not IHDR');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  try {
    if (command === 'build') return cmdBuildOrCheck(args, true);
    if (command === 'check') return cmdBuildOrCheck(args, false);
    if (command === 'shoot') return await cmdShoot(args);
    if (command === undefined) return usage(2);
    process.stderr.write(`unknown command ${JSON.stringify(command)}\n`);
    return usage(2);
  } catch (err) {
    if (err instanceof PeopleFileError) {
      process.stderr.write(`people file rejected: ${err.message}\n`);
      return 1;
    }
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; });
}
