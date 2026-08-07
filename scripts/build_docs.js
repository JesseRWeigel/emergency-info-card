#!/usr/bin/env node
// Build docs/index.html from the committed example file, and nothing else.
//
//   node scripts/build_docs.js            write docs/index.html
//   node scripts/build_docs.js --check    exit 1 if the committed page is not what this
//                                         produces right now
//
// The --check mode is the important one and it exists for a privacy reason rather than a
// tidiness one. The published page shows real rendered cards. If it could be built from any
// file the author happened to have lying around, the obvious accident is publishing a page
// built from the author's own people.json, and a page is a much worse place for a child's
// medication list than a git object is.
//
// So the page is a pure function of people.example.json, the source digest of that file is
// stamped into the page, and verify.sh rebuilds and diffs. A page built from anything else
// fails the diff and fails the digest check, and both failures name the reason.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadPeople } from '../src/schema.js';
import { buildAll } from '../src/report.js';
import { renderSide, CARD_CSS } from '../src/card.js';
import { layoutPerson } from '../src/layout.js';
import { CARD, LEGIBILITY, CONTRAST, PALETTE, DEVICES } from '../src/design.js';
import { esc } from '../src/html.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const EXAMPLE = path.join(ROOT, 'people.example.json');
const OUT = path.join(ROOT, 'docs', 'index.html');

// The same fixed date the CLI defaults to. A page whose ages changed at midnight would fail
// its own diff every day and teach everybody to ignore the check.
const TODAY = '2026-01-01';

const PAGE_CSS = `
:root{color-scheme:light dark;--bg:#f4f4f6;--fg:#141416;--muted:#55555c;--line:#d0d0d6;
  --panel:#ffffff;--alert:#6b0000}
@media (prefers-color-scheme:dark){
  :root{--bg:#141416;--fg:#f0f0f2;--muted:#a0a0a8;--line:#33333a;--panel:#1d1d21;--alert:#ff9a9a}
}
*{box-sizing:border-box}
body{margin:0;padding:0;background:var(--bg);color:var(--fg);
  font-family:"DejaVu Sans","Liberation Sans",system-ui,-apple-system,Arial,sans-serif;
  line-height:1.55}
main{max-width:60rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
h1{font-size:1.9rem;line-height:1.2;margin:0 0 .4rem}
h2{font-size:1.2rem;margin:2.5rem 0 .6rem;padding-top:1.4rem;border-top:1px solid var(--line)}
h3{font-size:1rem;margin:1.6rem 0 .4rem}
p,li{max-width:46rem}
.lede{font-size:1.08rem;color:var(--muted);margin:0 0 1.6rem}
.warn{border-left:4px solid var(--alert);background:color-mix(in srgb,var(--alert) 8%,transparent);
  padding:.85rem 1rem;margin:1.4rem 0;border-radius:0 6px 6px 0}
.warn strong{color:var(--alert)}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--line);
  vertical-align:top}
th{font-weight:700}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto;margin:1rem 0;-webkit-overflow-scrolling:touch}
.cards{display:flex;flex-wrap:wrap;gap:1rem;margin:1rem 0 0;padding:0;list-style:none}
figure{margin:0}
figcaption{font-size:.82rem;color:var(--muted);margin-top:.35rem}
.sheet{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:1rem;
  overflow-x:auto}
code{font-family:"DejaVu Sans Mono",ui-monospace,monospace;font-size:.9em}
pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;
  overflow-x:auto}
footer{margin-top:3rem;padding-top:1.2rem;border-top:1px solid var(--line);
  font-size:.85rem;color:var(--muted)}
`;

/** The card CSS, scoped so the demo cards do not restyle the page around them. */
function scopedCardCss() {
  return CARD_CSS
    .replace(/^\s*html,body\{[^}]*\}/m, '')
    .replace(/^\s*body\{[^}]*\}/m, '')
    .replace(/@media print\{[\s\S]*?\n\}/m, '')
    .split('\n')
    .map((line) => (line.trim().startsWith('.') || line.trim().startsWith('*')
      ? `.sheet ${line}` : line))
    .join('\n')
    + `\n.sheet{font-family:${CARD.family || '"DejaVu Sans", "Liberation Sans", Arial, sans-serif'};`
    + 'font-kerning:none;font-variant-ligatures:none}\n'
    + '.sheet .card{background:#fff;color:#111}\n';
}

function buildPage() {
  const raw = fs.readFileSync(EXAMPLE, 'utf8');
  const sourceSha256 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  const people = loadPeople(JSON.parse(raw), { today: TODAY });
  const { report } = buildAll(people, { sourceSha256 });

  if (report.findings.length > 0) {
    throw new Error(`refusing to publish a page built from output with ${report.findings.length} `
      + 'finding(s). The published page must show cards that pass the floors.');
  }

  const sections = [];

  for (const person of people) {
    const laid = layoutPerson(person);
    const pr = report.people.find((p) => p.id === person.id);
    const sides = laid.sides.map((side) => {
      const { html } = renderSide(laid, side);
      return `<figure><div class="sheet">${html}</div>`
        + `<figcaption>Card ${side.cardNumber} of ${side.cardCount}, ${side.face.toLowerCase()}`
        + `${side.filler ? ', blank reverse' : ''}. ${esc(side.continuation.toLowerCase())}.`
        + '</figcaption></figure>';
    }).join('\n');

    const lockRows = pr.lockScreens.map((l) => `<tr><td>${esc(l.label)}</td>`
      + `<td class="n">${l.cssWidth}&times;${l.cssHeight}</td>`
      + `<td class="n">${l.pixelWidth}&times;${l.pixelHeight}</td>`
      + `<td class="n">${l.placed}</td><td class="n">${l.omitted}</td>`
      + `<td>${l.note ? esc(l.note) : 'nothing deferred'}</td></tr>`).join('');

    sections.push(`<h3>${esc(person.name)}</h3>
<p>${pr.atomCount} fact${pr.atomCount === 1 ? '' : 's'} across
${pr.layout.cardCount} card${pr.layout.cardCount === 1 ? '' : 's'}
(${pr.layout.contentSides} printed side${pr.layout.contentSides === 1 ? '' : 's'})${
  pr.layout.splitAtoms.length
    ? `, with ${pr.layout.splitAtoms.length} entry too tall for one side and split across two`
    : ''}.
Smallest type ${pr.minPt} pt, lowest contrast ${pr.minContrast}:1.</p>
<div class="cards">${sides}</div>
<div class="scroll"><table>
<caption class="visually-hidden"></caption>
<thead><tr><th>Lock screen</th><th>CSS px</th><th>Image px</th><th>Shown</th><th>Deferred</th>
<th>What the image says about the rest</th></tr></thead>
<tbody>${lockRows}</tbody></table></div>`);
  }

  const summaryRows = report.people.map((p) => `<tr><td>${esc(p.name)}</td>`
    + `<td class="n">${p.atomCount}</td><td class="n">${p.layout.cardCount}</td>`
    + `<td class="n">${p.layout.contentSides}</td>`
    + `<td class="n">${p.layout.splitAtoms.length}</td>`
    + `<td class="n">${p.minPt}</td><td class="n">${p.minContrast}</td></tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>emergency-info-card</title>
<meta name="description" content="A wallet card and lock-screen image with the facts a first
 responder needs, generated locally from one file.">
<meta name="generator" content="scripts/build_docs.js">
<meta name="source-file" content="people.example.json">
<meta name="source-sha256" content="${esc(report.sourceSha256)}">
<meta name="built-for-date" content="${TODAY}">
<style>${PAGE_CSS}${scopedCardCss()}</style>
</head><body><main>

<h1>emergency-info-card</h1>
<p class="lede">A wallet card and a phone lock-screen image carrying the facts a first responder
needs, regenerated for every family member from one local file.</p>

<div class="warn">
<p><strong>Everybody on this page is invented.</strong> These are not real people, and the
allergies, diagnoses and medications shown are not real medical records. The repository
contains fictional example data only. The file holding real records is called
<code>people.json</code>, it is ignored by git before it exists, and the build never leaves
your machine.</p>
</div>

<div class="warn">
<p><strong>This is not medical advice</strong> and it is not a substitute for a medical alert
bracelet where one is indicated. A card in a wallet is found only if somebody opens the wallet.
If a clinician has told you to wear an engraved bracelet, wear the bracelet.</p>
</div>

<h2>The trade this tool asks you to make</h2>
<p>A wallet card is readable by anyone who finds the wallet. So is a lock-screen image, by
anyone who picks up the phone. You are trading disclosure to a stranger for disclosure to a
paramedic, and the tool does not pretend otherwise. That is your decision to make, per person
and per field, and the file format lets you leave anything out. A child with a life-threatening
allergy is usually a clear case. A diagnosis you would not tell a colleague is usually not.</p>

<h2>What is measured, and what the numbers are</h2>
<p>"Legible at wallet size" is a claim, so it is a measurement here rather than an intention.
Every card is rendered at <strong>${CARD.widthMm} by ${CARD.heightMm} mm</strong>, the ISO/IEC
7810 ID-1 size of a bank card. Every run of text is then measured inside a real headless Chrome
using <code>getBoundingClientRect</code> and the computed style, not judged from a screenshot,
and separately recomputed in Python from the font file's own metric tables.</p>
<div class="scroll"><table>
<thead><tr><th>Floor</th><th>Value</th><th>Why that number</th></tr></thead>
<tbody>
<tr><td>Type size</td><td class="n">${LEGIBILITY.minPt} pt</td>
<td>Above the 6 pt that US OTC drug labelling permits for a Drug Facts panel on a small
package, below the 12 pt RNIB Clear Print asks for and which does not fit on a bank card.</td></tr>
<tr><td>Rendered x-height</td><td class="n">${LEGIBILITY.minXHeightMm} mm</td>
<td>Point size describes the em box, not the letters. A condensed face is the obvious way to
pass a point-size check while shrinking the glyphs a reader resolves.</td></tr>
<tr><td>Contrast</td><td class="n">${CONTRAST.min}:1</td>
<td>WCAG AAA for body text is 7:1. This is read under stress, possibly at night, by somebody
who cannot come back later.</td></tr>
</tbody></table></div>

<h2>Overflow is visible, never silent</h2>
<p>Eleven medications do not fit on a bank card. Nothing is scaled below the floor and nothing
is clipped: the card set grows instead, every side that is not the last says where the reader
goes next, and an entry too tall for a whole side is split with an explicit
<code>(CONTINUES ON NEXT SIDE)</code> marker rather than truncated. A lock screen cannot
paginate, so it carries a prioritised subset and states what it left out and where the rest is,
with the count computed from what was actually placed.</p>
<div class="scroll"><table>
<thead><tr><th>Example person</th><th>Facts</th><th>Cards</th><th>Sides</th><th>Split</th>
<th>Min pt</th><th>Min contrast</th></tr></thead>
<tbody>${summaryRows}</tbody></table></div>

<h2>The cards</h2>
<p>These are rendered by the same code that writes the printable pages, at true ID-1 size. On a
screen they are the physical size of a bank card only if your browser and display agree about
what a millimetre is; printed at 100% scale, they are exact.</p>
${sections.join('\n')}

<h2>Running it</h2>
<pre><code>git clone &lt;this repository&gt;
cd emergency-info-card
cp people.example.json people.json   # people.json is gitignored before it exists
$EDITOR people.json
node bin/emcard.js build             # writes dist/, exits nonzero on any finding
node bin/emcard.js shoot             # lock-screen PNGs at real device resolution
bash scripts/verify.sh               # the whole check suite</code></pre>
<p>No dependencies, no build step, no network. <code>emcard build</code> is run under a preload
that replaces every outbound primitive in Node with something that throws, and the output is
required to be byte-identical, so the offline claim is tested rather than asserted.</p>

<footer>
<p>Generated by <code>scripts/build_docs.js</code> from
<code>people.example.json</code>, sha256 <code>${esc(report.sourceSha256.slice(0, 16))}</code>,
with ages computed for ${TODAY}. Rebuilt and diffed by <code>scripts/verify.sh</code>, so a
page built from any other file fails the build.</p>
<p>Devices modelled: ${DEVICES.map((d) => esc(d.label)).join(', ')}.
Ink ${esc(PALETTE.ink)} on ${esc(PALETTE.paper)}, alert ${esc(PALETTE.alert)}.</p>
<p>Not medical advice. Not a substitute for a medical alert bracelet where one is indicated.</p>
</footer>

</main></body></html>
`;
}

function main() {
  const check = process.argv.includes('--check');
  let page;
  try {
    page = buildPage();
  } catch (err) {
    process.stderr.write(`could not build the page: ${err.message}\n`);
    return 1;
  }

  if (!check) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, page);
    process.stdout.write(`wrote docs/index.html (${page.length} bytes)\n`);
    return 0;
  }

  if (!fs.existsSync(OUT)) {
    process.stderr.write('docs/index.html does not exist. Run: node scripts/build_docs.js\n');
    return 1;
  }
  const committed = fs.readFileSync(OUT, 'utf8');
  if (committed === page) {
    process.stdout.write('docs/index.html is exactly what people.example.json produces\n');
    return 0;
  }

  process.stderr.write('DOCS CHECK FAILED: the committed docs/index.html is not what '
    + 'people.example.json produces right now.\n'
    + '  Either the page was hand-edited, or the code changed without rebuilding it, or the '
    + 'page was built from a DIFFERENT people file.\n'
    + '  That last one is the reason this check exists: publishing a page built from a real '
    + "people.json would put somebody's medication list on the open web.\n");
  const want = crypto.createHash('sha256').update(page).digest('hex').slice(0, 16);
  const got = crypto.createHash('sha256').update(committed).digest('hex').slice(0, 16);
  process.stderr.write(`  committed ${got}, expected ${want}\n`);
  const m = /<meta name="source-sha256" content="([0-9a-f]*)"/.exec(committed);
  const expectedSource = /<meta name="source-sha256" content="([0-9a-f]*)"/.exec(page);
  if (m && expectedSource && m[1] !== expectedSource[1]) {
    process.stderr.write(`  the committed page was built from a source file with sha256 `
      + `${m[1].slice(0, 16)}, but people.example.json is ${expectedSource[1].slice(0, 16)}. `
      + 'The page was built from a different people file.\n');
  }
  process.stderr.write('  Fix with: node scripts/build_docs.js\n');
  return 1;
}

process.exitCode = main();
