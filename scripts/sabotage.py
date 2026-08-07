#!/usr/bin/env python3
"""Break this project on purpose, and require something to notice.

    python3 scripts/sabotage.py            run every sabotage
    python3 scripts/sabotage.py --list     name them without running
    python3 scripts/sabotage.py --only ID  run one

A passing check suite tells you the code passes its checks. It does not tell you the checks
would fail if the code were wrong, and those are different claims. This script settles the
second one by breaking one thing at a time in a throwaway copy of the tree and requiring a
detector to catch it.

THE THREE GATES. A sabotage counts only if all three hold:

    1. APPLIES         the edit actually changed the file. A patch whose search text has drifted
                       silently does nothing, and a sabotage that does nothing is caught by
                       nothing, which reads in the log exactly like a well defended codebase.
    2. MOVES THE OUTPUT the measured output changes. If it does not, the sabotage touched dead
                       code and the detector that "caught" it was reacting to something else.
                       Some sabotages declare the opposite on purpose, see below.
    3. CAUGHT          and only then, a detector fails.

Gate 2 is inverted for dormant guard code. Removing a guard that no example input triggers
changes no output at all, so requiring a change would make it impossible to test guards. Those
sabotages set expect_output_change to False: the output must stay IDENTICAL, proving the code
really is dormant, and a detector must fail anyway. A guard that nothing exercises and nothing
notices is a comment.

THE NULL CONTROL RUNS FIRST. An unmodified copy of the tree is measured and required to
fingerprint identically to the original. If it does not, the measurement is tracking the working
directory rather than the code, gate 2 passes for free for every sabotage, and every result
below it is void. AGENTS.md records the day this happened elsewhere in this fleet and the eleven
sabotages it invalidated.

WHAT IS NOT RUN HERE. The browser measurement in scripts/measure.js is not used as a detector,
because it takes about a minute and a half per run and this script does twenty of them. That is
a real gap and it is stated rather than hidden: a defect that only the browser measurement can
see would be reported below as uncaught. The sabotages are chosen so that the fast detectors
can catch them, and scripts/verify.sh runs the browser measurement separately on the real tree.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

TIMEOUT = 300


class Sabotage:
    def __init__(self, ident, target, find, replace, defence, detectors,
                 expect_output_change=True, count=1):
        self.ident = ident
        self.target = target
        self.find = find
        self.replace = replace
        self.defence = defence
        self.detectors = detectors
        self.expect_output_change = expect_output_change
        self.count = count


# ------------------------------------------------------------------------------------------
# The sabotages. Each one removes a specific defence and names the detector that should notice.
# ------------------------------------------------------------------------------------------
SABOTAGES = [
    Sabotage(
        "srgb-linear-segment",
        "src/color.js",
        "return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);",
        "return Math.pow((c + 0.055) / 1.055, 2.4);",
        "the linear segment of the sRGB transfer function near black",
        ["unit", "independent"],
    ),
    Sabotage(
        "srgb-flare-offset",
        "src/color.js",
        "return (light + 0.05) / (dark + 0.05);",
        "return light / dark;",
        "the +0.05 ambient flare offsets in the contrast ratio",
        ["unit", "independent"],
    ),
    Sabotage(
        "srgb-channel-weights",
        "src/color.js",
        "return 0.2126 * channelToLinear(rgb.r)\n       + 0.7152 * channelToLinear(rgb.g)\n"
        "       + 0.0722 * channelToLinear(rgb.b);",
        "return (channelToLinear(rgb.r) + channelToLinear(rgb.g) + channelToLinear(rgb.b)) / 3;",
        "the per-channel luminance weights, replaced by an average",
        ["unit", "independent"],
    ),
    Sabotage(
        "contrast-floor-lowered",
        "src/design.js",
        "export const CONTRAST = { min: 12.0 };",
        "export const CONTRAST = { min: 3.0 };",
        "the 12:1 contrast floor, relaxed to 3:1",
        ["unit"],
    ),
    Sabotage(
        "point-floor-lowered",
        "src/design.js",
        "  minPt: 8.0,",
        "  minPt: 4.0,",
        "the 8 pt legibility floor, relaxed to 4 pt",
        ["unit"],
    ),
    Sabotage(
        "x-height-floor-lowered",
        "src/design.js",
        "  minXHeightMm: 1.40,",
        "  minXHeightMm: 0.10,",
        "the rendered x-height floor",
        ["unit"],
    ),
    Sabotage(
        "card-size-rounded",
        "src/units.js",
        "export const CARD_WIDTH_MM = 85.60;",
        "export const CARD_WIDTH_MM = 85;",
        "the exact ISO/IEC 7810 ID-1 width, rounded to a whole millimetre",
        ["unit", "independent"],
    ),
    Sabotage(
        "atom-dropped-when-it-does-not-fit",
        "src/layout.js",
        "      // Last resort. One atom is taller than an entire empty side, so it is split "
        "across sides",
        "      continue;\n      // Last resort. One atom is taller than an entire empty side, "
        "so it is split across sides",
        "the split path, so an entry taller than a side is silently dropped",
        ["build", "unit", "independent"],
    ),
    Sabotage(
        "pagination-disabled",
        "src/layout.js",
        "      if (placed.heightMm <= remaining()) {",
        "      if (true) {",
        "pagination, so every fact is crammed onto the first side and overflows it",
        ["build", "unit"],
    ),
    Sabotage(
        "completeness-invariant-removed",
        "src/layout.js",
        "  if (missing.length > 0 || duplicated.length > 0 || unexpected.length > 0) {",
        "  if (false) {",
        "the completeness invariant that refuses to return a layout that lost a fact",
        ["unit"],
        expect_output_change=False,
    ),
    Sabotage(
        "overflow-check-removed",
        "src/layout.js",
        "    if (s.usedMm > s.capacityMm + 1e-6) {",
        "    if (false) {",
        "the per-side overflow assertion, so a clipped card returns successfully",
        ["unit"],
        expect_output_change=False,
    ),
    Sabotage(
        "split-atom-counted-twice",
        "src/layout.js",
        "        if (entry.part === null || entry.part.first) ids.push(entry.atom.id);",
        "        ids.push(entry.atom.id);",
        "the rule that a split fact is one fact, so completeness miscounts it as two",
        ["build", "unit"],
    ),
    Sabotage(
        "advance-width-understated",
        "src/metrics.js",
        '"m": 0.97412,',
        '"m": 0.47412,',
        "the advance width of the letter m, so the model under-predicts and clips",
        ["independent"],
    ),
    Sabotage(
        "unknown-glyph-measured-as-zero",
        "src/metrics.js",
        "export const FALLBACK_ADVANCE_EM = 1.10303;",
        "export const FALLBACK_ADVANCE_EM = 0;",
        "the widest-glyph fallback, so an unmapped character costs no width at all",
        ["unit"],
        expect_output_change=False,
    ),
    Sabotage(
        "lock-screen-omission-note-removed",
        "src/lockscreen.js",
        "    const note = omitted.length > 0 ? omissionNote(omitted) : null;",
        "    const note = null;",
        "the lock-screen overflow note, so facts are dropped without saying so",
        ["independent"],
    ),
    Sabotage(
        "lock-screen-omission-miscounted",
        "src/lockscreen.js",
        "  return `+${omitted.length} MORE ON WALLET CARD: ${parts.join(', ')}`;",
        "  return `+${omitted.length - 1} MORE ON WALLET CARD: ${parts.join(', ')}`;",
        "the count in the overflow note, understated by one",
        ["independent"],
    ),
    Sabotage(
        "clock-reserve-removed",
        "src/design.js",
        "    ios: { top: 0.34, bottom: 0.12 },",
        "    ios: { top: 0.0, bottom: 0.0 },",
        "the lock-screen clock and shortcut reserve, so text sits under the clock",
        ["independent"],
    ),
    Sabotage(
        "html-escaping-neutered",
        "src/html.js",
        "  return String(value)\n    .replace(/&/g, '&amp;')",
        "  return String(value)\n    .replace(/&/g, '&')",
        "HTML escaping of the ampersand, which is dormant on the example data",
        ["unit"],
        expect_output_change=False,
    ),
    Sabotage(
        "unparseable-colour-treated-as-black",
        "src/color.js",
        "  return null;\n}\n\n/** The sRGB transfer function, inverted. */",
        "  return { r: 0, g: 0, b: 0, a: 1 };\n}\n\n/** The sRGB transfer function, inverted. */",
        "the refusal to guess at an unreadable colour, which would score 21:1 on white",
        ["unit"],
        expect_output_change=False,
    ),
    Sabotage(
        "blood-type-validation-removed",
        "src/schema.js",
        "  if (bloodType && !ALLOWED_BLOOD_TYPES.includes(bloodType)) {",
        "  if (false) {",
        "blood type validation, so a typo reaches a card a clinician might read",
        ["unit"],
        expect_output_change=False,
    ),
    Sabotage(
        "contacts-no-longer-required",
        "src/schema.js",
        "  if (!raw.contacts || arr(raw.contacts, `${where}.contacts`).length === 0) {",
        "  if (false) {",
        "the rule that a card must carry some way to reach somebody",
        ["unit"],
        expect_output_change=False,
    ),
    Sabotage(
        "people-json-no-longer-ignored",
        ".gitignore",
        "people.json\npeople.*.json",
        "# people.json\npeople.*.json",
        "the .gitignore rule that keeps a real medication list out of the repository",
        ["privacy"],
        expect_output_change=False,
    ),
    Sabotage(
        "example-person-no-longer-fictional",
        "people.example.json",
        '"name": "Kip Notareal"',
        '"name": "Kip Sanderson"',
        "the fictional-name marker on an example person",
        ["privacy", "docs"],
    ),
    Sabotage(
        "netblock-disarmed",
        "scripts/netblock.cjs",
        "      value: forbid(what)",
        "      value: object[name]",
        "the network block itself, leaving every outbound primitive reachable",
        ["netblock"],
        expect_output_change=False,
    ),
    Sabotage(
        "docs-page-hand-edited",
        "docs/index.html",
        "<h1>emergency-info-card</h1>",
        "<h1>emergency-info-card (edited by hand)</h1>",
        "the guarantee that the published page is what the example produces",
        ["docs"],
        expect_output_change=False,
    ),
]


# ------------------------------------------------------------------------------------------
# Running things
# ------------------------------------------------------------------------------------------
def run(cmd, cwd, env=None):
    full_env = dict(os.environ)
    if env:
        full_env.update(env)
    try:
        proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True,
                              timeout=TIMEOUT, env=full_env, check=False)
        return proc.returncode, proc.stdout + proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "timed out after %d seconds" % TIMEOUT


def tracked_files():
    proc = subprocess.run(["git", "ls-files", "-z"], cwd=str(ROOT), capture_output=True,
                          text=True, check=True)
    return [f for f in proc.stdout.split("\0") if f]


def copy_tree(destination, files):
    for rel in files:
        source = ROOT / rel
        if not source.is_file():
            continue
        target = Path(destination) / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def measure(tree):
    """The measured output of a tree: what the build did, and what it produced.

    Both halves matter. A sabotage that makes the build refuse to run changes the exit code and
    not the files; a sabotage that quietly drops a medication changes the files and not the
    exit code. Digesting only one of the two would let half of these through gate 2.
    """
    out = Path(tree) / "dist"
    if out.exists():
        shutil.rmtree(out)
    # cwd is the copied tree and the output path is relative, so nothing in the recorded output
    # can mention where the copy happens to live.
    code, text = run(["node", "bin/emcard.js", "build", "--out", "dist"], tree)
    build_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()

    fp_code, fp_text = run(["node", "scripts/fingerprint.js", "--dist", "dist"], tree)
    if fp_code == 0:
        try:
            fingerprint = json.loads(fp_text)["fingerprint"]
        except (ValueError, KeyError):
            fingerprint = "unreadable"
    else:
        fingerprint = "none:%d" % fp_code

    combined = hashlib.sha256(
        ("%d\n%s\n%s" % (code, build_digest, fingerprint)).encode("utf-8")).hexdigest()
    return {"buildExit": code, "fingerprint": fingerprint, "combined": combined,
            "output": text}


DETECTOR_COMMANDS = {
    "build": (["node", "bin/emcard.js", "check"], "the tool's own verdict on its output"),
    "unit": (["node", "--test", "test/color.test.js", "test/layout.test.js",
              "test/schema.test.js", "test/lockscreen.test.js", "test/build.test.js"],
             "the unit suite"),
    "independent": (["python3", "scripts/check_independent.py", "--dist", "dist"],
                    "the independent recomputation"),
    "privacy": (["python3", "scripts/privacy_scan.py"], "the privacy scan"),
    "docs": (["node", "scripts/build_docs.js", "--check"], "the docs page diff"),
    "netblock": (["node", "--require", "./scripts/netblock.cjs", "scripts/netblock-probe.cjs"],
                 "the netblock positive control"),
}


def run_detectors(tree, names):
    """Run each named detector. Returns [(name, exit code, description)]."""
    results = []
    for name in names:
        cmd, description = DETECTOR_COMMANDS[name]
        code, _ = run(cmd, tree)
        results.append((name, code, description))
    return results


def prepare(tree, sabotage):
    """Apply one sabotage to a copied tree. Returns None on success, or why it did not apply."""
    target = Path(tree) / sabotage.target
    if not target.exists():
        return "%s is not in the tree" % sabotage.target
    before = target.read_text(encoding="utf-8")
    occurrences = before.count(sabotage.find)
    if occurrences == 0:
        return ("the search text is not in %s any more, so this sabotage changed nothing. The "
                "code has drifted and the patch needs updating." % sabotage.target)
    if occurrences != sabotage.count:
        return ("the search text appears %d times in %s, expected %d"
                % (occurrences, sabotage.target, sabotage.count))
    after = before.replace(sabotage.find, sabotage.replace, sabotage.count)
    if after == before:
        return "the replacement is identical to the original"
    target.write_text(after, encoding="utf-8")
    return None


# ------------------------------------------------------------------------------------------
def null_control(files, baseline):
    """An unmodified copy must measure identically, or nothing below it means anything."""
    with tempfile.TemporaryDirectory(prefix="emcard-null-") as tmp:
        copy_tree(tmp, files)
        got = measure(tmp)
        if got["combined"] != baseline["combined"]:
            sys.stdout.write(
                "NULL CONTROL FAILED.\n"
                "  An unmodified copy of the tree measured differently from the original:\n"
                "    original %s (build exit %d)\n"
                "    copy     %s (build exit %d)\n"
                "  The measurement therefore tracks the working directory rather than the code. "
                "Gate 2 would pass for free for every sabotage below, so the whole run is void "
                "and no result from it may be quoted.\n"
                % (baseline["combined"][:16], baseline["buildExit"],
                   got["combined"][:16], got["buildExit"]))
            return False
    sys.stdout.write("null control: an unmodified copy fingerprints identically (%s)\n"
                     % baseline["combined"][:16])
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--only", default=None)
    args = parser.parse_args()

    chosen = SABOTAGES
    if args.only:
        chosen = [s for s in SABOTAGES if s.ident == args.only]
        if not chosen:
            sys.stderr.write("no sabotage called %r\n" % args.only)
            return 2

    if args.list:
        for s in chosen:
            sys.stdout.write("  %-38s %s -> %s\n" % (s.ident, s.target, s.defence))
        return 0

    files = tracked_files()
    if len(files) < 10:
        sys.stderr.write("only %d tracked files. Commit before running the sabotage harness: it "
                         "copies tracked files, and an almost empty copy would build nothing and "
                         "catch nothing.\n" % len(files))
        return 1

    sys.stdout.write("sabotage harness: %d sabotages over %d tracked files\n"
                     % (len(chosen), len(files)))

    with tempfile.TemporaryDirectory(prefix="emcard-baseline-") as tmp:
        copy_tree(tmp, files)
        baseline = measure(tmp)
    if baseline["buildExit"] != 0:
        sys.stderr.write("the unmodified tree does not build (exit %d). Fix that before asking "
                         "whether breaking it is noticed.\n%s\n"
                         % (baseline["buildExit"], baseline["output"][-2000:]))
        return 1

    if not null_control(files, baseline):
        return 1

    passed = []
    failed = []
    for sabotage in chosen:
        with tempfile.TemporaryDirectory(prefix="emcard-sab-") as tmp:
            copy_tree(tmp, files)

            # Gate 1: does the edit apply at all?
            problem = prepare(tmp, sabotage)
            if problem is not None:
                failed.append((sabotage, "GATE 1, did not apply", problem, []))
                sys.stdout.write("  %-38s GATE 1 did not apply\n" % sabotage.ident)
                continue

            # Gate 2: does the measured output move, or stay put when it should?
            got = measure(tmp)
            moved = got["combined"] != baseline["combined"]
            if sabotage.expect_output_change and not moved:
                failed.append((sabotage, "GATE 2, output unchanged",
                               "the edit applied and the build produced byte-identical output "
                               "with the same exit code, so this sabotage touched code that "
                               "nothing runs. Any detector that failed was reacting to "
                               "something else.", []))
                sys.stdout.write("  %-38s GATE 2 output unchanged\n" % sabotage.ident)
                continue
            if not sabotage.expect_output_change and moved:
                failed.append((sabotage, "GATE 2, output moved unexpectedly",
                               "this sabotage is declared dormant, meaning it should change no "
                               "output at all, and it changed some. Either the declaration is "
                               "wrong or the edit is broader than intended.", []))
                sys.stdout.write("  %-38s GATE 2 unexpectedly moved the output\n"
                                 % sabotage.ident)
                continue

            # Gate 3: and only now, does anything notice?
            results = run_detectors(tmp, sabotage.detectors)
            caught = [r for r in results if r[1] != 0]
            if caught:
                passed.append((sabotage, moved, caught))
                sys.stdout.write("  %-38s caught by %s%s\n"
                                 % (sabotage.ident,
                                    ", ".join(c[0] for c in caught),
                                    "" if moved else "  (dormant, output unchanged)"))
            else:
                failed.append((sabotage, "GATE 3, nobody noticed",
                               "the edit applied, the measured output %s, and every detector "
                               "still passed."
                               % ("changed" if moved else "stayed identical as declared"),
                               results))
                sys.stdout.write("  %-38s NOT CAUGHT\n" % sabotage.ident)

    sys.stdout.write("\n")
    for sabotage, moved, caught in passed:
        sys.stdout.write("  ok    %s\n        removed %s\n        caught by %s\n"
                         % (sabotage.ident, sabotage.defence,
                            ", ".join("%s (%s)" % (c[2], c[0]) for c in caught)))
    for sabotage, gate, why, results in failed:
        sys.stdout.write("  FAIL  %s [%s]\n        removed %s\n        %s\n"
                         % (sabotage.ident, gate, sabotage.defence, why))
        for name, code, description in results:
            sys.stdout.write("          %s exited %d\n" % (description, code))

    sys.stdout.write("\n%d of %d sabotages applied, moved the output as declared, and were "
                     "caught\n" % (len(passed), len(chosen)))
    if failed:
        sys.stdout.write("SABOTAGE HARNESS FAILED: %d sabotage(s) did not clear all three "
                         "gates\n" % len(failed))
        return 1
    sys.stdout.write("SABOTAGE HARNESS PASSED\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
