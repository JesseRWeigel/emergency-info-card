# emergency-info-card

A wallet card and a phone lock-screen image carrying the facts a first responder needs,
regenerated for every family member from one local file.

Catalog task: `HLTH-035`. One of a public catalog of build ideas:
https://github.com/JesseRWeigel/722-things-to-build

## Read this part first

**This is not medical advice.** It is a layout tool. It does not know anything about medicine,
it does not check your drug names, and it will print whatever you type.

**It is not a substitute for a medical alert bracelet where one is indicated.** A card in a
wallet is found only if somebody opens the wallet, and a lock-screen image is seen only if
somebody picks up the phone and looks. If a clinician has told you to wear an engraved bracelet,
wear the bracelet. This is a supplement to that, not a replacement for it.

**A wallet card is readable by anyone who finds the wallet.** So is a lock-screen image, by
anyone who picks up the phone. Putting a diagnosis on a card means trading disclosure to a
stranger for disclosure to a paramedic. That is a real trade with a real cost, it is yours to
make and not the tool's, and the tool should not pretend otherwise. The file format lets you
leave any field out, per person. A child with a life-threatening allergy is usually a clear
case. A diagnosis you would not tell a colleague is usually not. Decide field by field.

**The blood type on the card is not a transfusion order.** A hospital types and cross-matches
the patient and will not transfuse on the strength of a card. It is on the card because the task
asked for it and because it is occasionally useful context, not because it is authoritative.

## Privacy

This holds real medical facts about real people, very often children. The design assumes that.

- **It runs locally and sends nothing.** That is tested rather than asserted.
  `scripts/netblock.cjs` replaces 47 outbound primitives in Node with something that throws, the
  build is run under it, and the output is required to be byte-identical to a normal build.
  `scripts/netblock-probe.cjs` is the positive control for the netblock itself, because a
  preload that patched nothing would let the identical-output test pass while proving nothing.
- **Your real file is gitignored before it exists.** `people.json` is ignored by `.gitignore` in
  a fresh clone, so the first time you copy the example across and fill it in, git already
  refuses to stage it. `people.example.json` is the committed one and contains invented people
  only. The privacy scan does not trust the file, it asks `git check-ignore`.
- **`dist/` is gitignored too.** Cards built from a real `people.json` are exactly as sensitive
  as the input.
- **Everybody in this repository is fictional.** Every example person's surname carries a marker
  such as Notareal or Fictitious-Example, and the privacy scan fails if one stops doing so. The
  published page is rebuilt from `people.example.json` and diffed, so a page built from any other
  file fails the build. That check exists because publishing a page built from somebody's real
  `people.json` is the worst accident this project could have.

## What it produces

For each person, from one JSON file:

- **A printable wallet card set** at ISO/IEC 7810 ID-1, 85.60 by 53.98 mm, the size of a bank
  card. Two faces per card, and as many cards as the facts need.
- **A lock-screen image** per device, at real device resolution, with the panel kept clear of
  the clock and the shortcut row.
- **A report** in `dist/report.json` recording every run of text, its size, its colour, the
  colour behind it, its measured contrast and the width the model predicted for it.

## Legibility is measured, not claimed

"Legible at wallet size" is the task's done condition, so it is a number that can fail.

| Floor | Value | Why that number |
| --- | --- | --- |
| Type size | 8 pt | US OTC drug labelling (21 CFR 201.66) permits a Drug Facts panel at 6 pt on a small package, which is the smallest a regulator will call readable for safety text. RNIB Clear Print asks for 12 pt, which does not fit on a bank card with the content on it. 8 pt sits a third of the way up that bracket. |
| Rendered x-height | 1.40 mm | Point size describes the em box, not the letters. Two faces at 8 pt can differ by 25% in the height a reader actually resolves, and a condensed face is the obvious way to pass a point-size check while shrinking the glyphs. |
| Contrast | 12:1 | WCAG AAA for body text is 7:1. This is read by a stranger, under stress, possibly at night, possibly through a cracked screen, by somebody who cannot come back later. |

Every one of those is measured **inside a real headless Chrome** with
`getBoundingClientRect` and `getComputedStyle`, not judged from a screenshot. That distinction
is load bearing: `chrome --headless --screenshot --window-size=` can render at a width different
from the one it captures, so a screenshot is evidence about the screenshot. The one thing read
from an image file is the PNG's pixel dimensions and the pixels themselves, which is exactly the
claim an image can support.

The same numbers are then recomputed a second time, in Python, by a route that shares no code
with the tool: advance widths come from parsing the `hmtx`, `cmap`, `head` and `OS/2` tables of
`DejaVuSans.ttf` directly, and the sRGB contrast formula is written out again from IEC
61966-2-1. `scripts/check_independent.py` proves it imports nothing from the package by walking
its own AST rather than by grepping.

The last verification run measured 463 runs of text in the browser and 3137 checks in the
independent recomputation. Smallest rendered type 8 pt, smallest rendered x-height 1.588 mm,
lowest contrast 12.922:1, worst model under-prediction 0.003 mm.

## Overflow is visible, never silent

Eleven medications do not fit on a bank card. **Silently dropping the eleventh medication is the
worst bug this tool could have**, so nothing is scaled below the floor and nothing is clipped.

- The card set grows instead. Every side that is not the last says where the reader goes next:
  `CONTINUED ON BACK`, `CONTINUED ON CARD 2`, `END OF RECORD`.
- An entry too tall for a whole side is split across sides with an explicit
  `(CONTINUES ON NEXT SIDE)` marker and a repeated `(CONT.)` heading, never truncated.
- Sides are padded to an even count so a duplex print lines up, and the padding side carries an
  explicit end marker rather than being left blank and ambiguous.
- A lock screen cannot paginate, so it carries a prioritised subset and states what it left out:
  `+7 MORE ON WALLET CARD: 5 medications, 2 notes`. The count is computed from what was actually
  placed, and it is recounted from the rendered HTML by the independent check.
- Allergies lead the priority order, because a drug allergy changes what is given in the first
  two minutes.

The completeness invariant is stated once and checked from four directions: every fact in the
input appears, whole, exactly once, somewhere in the card set. The layout engine asserts it
before returning, the independent check recounts it from the `data-atom` attributes in the
rendered HTML against the atom ids re-derived from the people file, the unit suite states it
directly, and four sabotages attack it.

## Negative controls

A checker that only looks at the hard case cannot tell "handled the overflow" from "reports
overflow for everything". So both directions are required, and the verification fails if either
is missing from the example data:

- **Kip Notareal** is the negative control. Three facts, one card, nothing split, nothing
  deferred on any of the three phones, and **zero findings**.
- **Bartholomew Nonexistent-Fabrication** is the overflow case. 26 facts including eleven
  medications, three cards, and every fact either shown on the lock screen or counted in its
  omission note.
- **Marguerite Imaginary-Placeholder** carries a note too tall for a single side, which forces
  the split path.

## Running it

```bash
git clone <this repository>
cd emergency-info-card

cp people.example.json people.json   # people.json is gitignored before it exists
$EDITOR people.json

node bin/emcard.js build             # writes dist/, exits nonzero on any finding
node bin/emcard.js shoot             # lock-screen PNGs at real device resolution
```

`build` needs nothing but Node 18 or newer. `shoot` is a separate verb because it is the only
part that runs another program, and everything else stays usable on a machine with no browser.

Print `dist/<person>/cards.html` at 100% scale, with no page scaling, and cut along the border.
Set `dist/<person>/lock-<device>.png` as the phone's wallpaper.

Ages are computed from a fixed date so the build is reproducible. Pass `--today 2026-08-07` to
get a real age on a real card.

### The verify command

```bash
bash scripts/verify.sh
```

Its exit code is the result. There is no skip path: a missing Chrome, a missing DejaVu Sans or a
missing python3 is a failure of the run, because a skipped check and a passing check are
indistinguishable in a log a week later. It digests every tracked file at the start and again at
the end, and fails if the run modified the tree it was verifying.

## How it is checked

| Script | What it settles |
| --- | --- |
| `scripts/verify.sh` | Runs all of the below. Exit code is the answer. |
| `test/*.test.js` | 69 unit tests. Expectations worked out from the specification, not pasted from a run. |
| `scripts/measure.js` | Loads every generated page in real Chrome and measures from inside it. 3296 checks. |
| `scripts/check_independent.py` | Recomputes the headline numbers from the font file and the sRGB spec, importing nothing from the package and proving it with `ast`. |
| `scripts/netblock.cjs` and `-probe.cjs` | Takes the network away, then requires byte-identical output. The probe is the positive control for the block. |
| `scripts/privacy_scan.py` | Credentials, the gitignore rule, and the fictional-name requirement. Patterns assembled from fragments so the scanner does not match its own list. Has a positive control. |
| `scripts/sabotage.py` | Breaks 25 things on purpose and requires each to be caught, under the three-gate rule with a null control first. |
| `scripts/build_docs.js --check` | The published page is what `people.example.json` produces and nothing else. |
| `scripts/check_readme.py` | This file says what it must, with fenced code blocks stripped first so the check does not match its own pasted transcript. |
| `scripts/fingerprint.js` | One digest over the built tree, refusing to emit one for output containing an absolute path. |

The sabotage harness is worth a sentence. A passing check suite tells you the code passes its
checks, which is not the same claim as the checks would fail if the code were wrong. Each
sabotage counts only if it **applies**, **moves the measured output**, and only then is
**caught**. An unmodified copy is measured first and required to fingerprint identically, because
if it does not then the measurement is tracking the working directory and every result below it
is void. Guards that no example input exercises invert the second gate: the output must stay
identical, proving the code really is dormant, and a detector must fail anyway.

That harness earned its place on the first run. It deleted the completeness invariant and the
per-side overflow assertion, no output changed, and no test noticed. Both were comments rather
than guards. They are now exported functions that the unit suite hands a layout that lost a
fact, repeated one, invented one, or overflowed a side.

## The people file

```json
{
  "people": [
    {
      "id": "kip",
      "name": "Kip Notareal",
      "dateOfBirth": "2019-06-03",
      "bloodType": "O+",
      "pronouns": "they/them",
      "language": "Portuguese",
      "allergies": [
        { "what": "Penicillin", "reaction": "anaphylaxis", "severity": "life-threatening" }
      ],
      "conditions": [{ "what": "Type 1 diabetes", "detail": "insulin pump, left abdomen" }],
      "medications": [{ "what": "Insulin aspart", "dose": "pump, 0.6 u/hr basal" }],
      "contacts": [{ "name": "A Guardian", "relationship": "parent", "phone": "555-0100" }],
      "notes": ["Non-verbal when distressed. Responds to written questions."]
    }
  ]
}
```

`id`, `name` and at least one `contacts` entry are required. A card with no way to reach anybody
is the one field a responder will look for and not find. Everything else is optional, and leaving
a field out is a supported choice rather than an incomplete record. `severity` must be one of
`life-threatening`, `severe`, `moderate` or `mild`. `bloodType` must be one of the eight or
absent, because an absent blood type is safer than a guessed one.

## Assumptions made where the task was silent

- **8 pt and 12:1** are the legibility floors, bracketed and justified above. The task said
  "legible at wallet size" without a number.
- **The lock-screen safe area fractions** are conservative estimates from stock iOS and Android
  layouts, not measurements from any API. They are configuration in `src/design.js`. Check them
  against your own phone before trusting the bottom of the panel.
- **Three devices** are modelled, at two aspect ratios, including a 667 px screen where the
  omission path is forced.
- **Ages use a fixed date** rather than the wall clock, so the build is reproducible and the
  output does not change at midnight.
- **DejaVu Sans** is the metric reference. If the font stack resolves to something else, the
  browser check fails and names the font it got, which is the intended behaviour.

## Status

Verified on 2026-08-07. `bash scripts/verify.sh` **exit code 0**, all 14 steps passed.

```
emergency-info-card, full verification
2026-08-07T08:47:33Z

=== tree digest, before ===
  34 tracked files digested

=== prerequisites ===
  present: node
  present: python3
  present: git
  present: chrome (/usr/bin/google-chrome)
  present: DejaVu Sans
PASS prerequisites

=== unit tests ===
ℹ tests 69
ℹ suites 0
ℹ pass 69
ℹ fail 0
PASS unit tests

=== build the example ===
source: people.example.json sha256 dc09c800e336001e
people: 5, cards: 9, text runs: 215 on cards and 248 on lock screens
smallest type: 8 pt (floor 8 pt), lowest contrast: 12.922:1 (floor 12:1)
  wren: 8 facts on 1 card(s), 2 side(s); lock screen iphone-15-pro 8 shown, galaxy-s23 8 shown, iphone-se-3 5 shown 3 deferred
  bartholomew: 26 facts on 3 card(s), 6 side(s); lock screen iphone-15-pro 9 shown 17 deferred, galaxy-s23 7 shown 19 deferred, iphone-se-3 5 shown 21 deferred
  kip: 3 facts on 1 card(s), 2 side(s); lock screen iphone-15-pro 3 shown, galaxy-s23 3 shown, iphone-se-3 3 shown
  juniper: 10 facts on 2 card(s), 4 side(s); lock screen iphone-15-pro 8 shown 2 deferred, galaxy-s23 8 shown 2 deferred, iphone-se-3 6 shown 4 deferred
  marguerite: 5 facts on 2 card(s), 4 side(s), 1 long entry split across sides; lock screen iphone-15-pro 4 shown 1 deferred, galaxy-s23 4 shown 1 deferred, iphone-se-3 4 shown 1 deferred
wrote 21 file(s) under dist
OK: every run of text clears the point, x-height, contrast and fit floors.
PASS build the example

=== netblock positive control ===
NETBLOCK POSITIVE CONTROL PASSED: all 14 outbound primitives throw ENETBLOCK
PASS netblock positive control

=== build with the network taken away ===
  building with every outbound primitive replaced by something that throws
  byte-identical output with and without the network. The offline claim is tested,
  not asserted.
PASS build with the network taken away

=== lock-screen PNGs at device size ===
browser furniture: 0 x 87 CSS px of window that is not viewport
wrote 15 lock-screen PNG(s) at real device resolution
PASS lock-screen PNGs at device size

=== browser measurement ===
chrome: /usr/bin/google-chrome
  viewport independence: identical geometry at 500 px and 1400 px window widths
  measured 463 runs of text in a real browser
  smallest rendered type: 8 pt (floor 8)
  smallest rendered x-height: 1.588 mm (floor 1.4)
  lowest measured contrast: 12.922:1 (floor 12)
  worst model under-prediction: 0.003 mm (must be at most 0.05)
  DejaVu Sans available to the browser: true
BROWSER MEASUREMENT PASSED: 3296 checks
PASS browser measurement

=== independent recomputation ===
  independence proved by AST: 9 imports, all standard library, no dynamic import, no path into the package
  font metrics read from DejaVuSans.ttf (unitsPerEm 2048, 6253 glyphs)
  negative control: kip fit with zero findings, zero splits and zero deferrals
  overflow control: wren, bartholomew, juniper, marguerite overflowed and accounted for every fact
INDEPENDENT CHECK PASSED: 3137 checks, recomputed from the font file and the sRGB formula
PASS independent recomputation

=== privacy scan ===
  positive control: a planted credential was detected, so the scanner does read and does match
  read 24 of 34 tracked files
  .gitignore ignores people.json
  git check-ignore confirms people.json is ignored
  all 5 example people carry a fictional-name marker
PRIVACY SCAN PASSED
PASS privacy scan

=== published page matches the example ===
docs/index.html is exactly what people.example.json produces
PASS published page matches the example

=== README ===
README CHECK PASSED
PASS README

=== sabotage harness ===
sabotage harness: 25 sabotages over 34 tracked files
null control: an unmodified copy fingerprints identically
25 of 25 sabotages applied, moved the output as declared, and were caught
SABOTAGE HARNESS PASSED
PASS sabotage harness

=== fingerprint ===
  5 people, 9 cards, 215 card runs, 248 lock-screen runs, 0 findings
  smallest type 8 pt, lowest contrast 12.922:1
PASS fingerprint

=== the run did not modify the tree ===
  34 tracked files, all byte-identical to the start of the run
PASS the run did not modify the tree

================================================
VERIFY PASSED: 14 of 14 steps
```

## Unfinished

Honest list of what this does not do.

- **The lock-screen safe area is configuration, not measurement.** No API reports where the
  clock is. The fractions in `src/design.js` are conservative readings of the stock iOS and
  Android layouts. Three devices are modelled and a fourth phone may differ. Put the wallpaper
  on your own phone and look at the bottom of the panel before trusting it.
- **The sabotage harness does not use the browser measurement as a detector.** It runs 25
  sabotages and the browser step takes about three minutes per run. A defect that only the
  browser can see would be reported as uncaught. `verify.sh` runs the browser measurement
  separately against the real tree, so the gap is in the sabotage coverage rather than in the
  verification.
- **The advance-width table is DejaVu Sans only.** Another font fails the browser check by
  design rather than being measured. Adding a second face means re-running the measurement.
- **No i18n beyond Latin-1 and a few punctuation marks.** A name in a non-Latin script is
  charged the widest advance in the table, which over-predicts, so it will not clip, but it
  will waste space and may push onto another card. Nothing is dropped.
- **No print calibration.** The card is exactly ID-1 in the HTML. Whether your printer honours
  that at 100% scale is between you and your printer. Measure the printed card against a bank
  card before cutting.
- **`emcard shoot` needs Chrome specifically.** The viewport overhead it corrects for is
  measured at run time rather than assumed, so another browser would likely work, but only
  Chrome and Chromium have been tried.
- **No encryption at rest.** `people.json` is a plain file on your disk. If your disk is not
  encrypted, neither is it.

## Licence

MIT. See `LICENSE`.
