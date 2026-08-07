#!/usr/bin/env python3
"""Check the README says what it has to say, and no longer says what the scaffold said.

    python3 scripts/check_readme.py

FENCED CODE BLOCKS ARE STRIPPED BEFORE ANYTHING IS SEARCHED FOR, and that is the whole reason
this is a script rather than a grep.

The README's Status section holds the pasted transcript of the verification run. That transcript
contains the words this check looks for: the string TODO appears inside the sentence "no TODO
left in it", the node test runner prints a lowercase "todo 0" line, and the privacy scanner
prints its own findings. A scaffold-marker search over the raw file therefore matches its own
output and fails a perfectly good README, or worse, is "fixed" by adding an exclusion for the
Status section, which disarms the check exactly where it is tested.

Stripping fences first is the fix that keeps the check armed everywhere it matters: prose is
searched, pasted transcripts are not, and a real TODO in the prose still fails.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"

# Assembled from fragments so that this list is not itself a scaffold marker when some other
# tool reads this file.
SCAFFOLD_MARKERS = [
    "TO" + "DO",
    "FIX" + "ME",
    "XX" + "X",
    "replace with a real description",
    "NOT YET VERIFIED",
    "A maintainer or agent must replace",
    "lorem ipsum",
]

# Things this particular README must state, because they are promises to a person holding a
# card rather than stylistic preferences.
REQUIRED_STATEMENTS = [
    ("not medical advice",
     re.compile(r"not\s+medical\s+advice", re.I),
     "the README must say in so many words that this is not medical advice"),
    ("medical alert bracelet",
     re.compile(r"medical\s+alert\s+bracelet", re.I),
     "the README must say this is not a substitute for a medical alert bracelet where one is "
     "indicated. A card in a wallet is found only if somebody opens the wallet."),
    ("the disclosure trade",
     re.compile(r"anyone\s+who\s+finds\s+the\s+wallet", re.I),
     "the README must say that a wallet card is readable by anyone who finds the wallet, so "
     "the user is trading disclosure to a stranger for disclosure to a paramedic. That is "
     "theirs to decide and the tool must not pretend otherwise."),
    ("people.json is ignored",
     re.compile(r"people\.json", re.I),
     "the README must name people.json and say it is gitignored"),
    ("the verify command",
     re.compile(r"scripts/verify\.sh"),
     "the README must give the exact command whose exit code means the thing works"),
    ("ID-1",
     re.compile(r"85\.6", re.I),
     "the README must state the card size it renders at"),
]

REQUIRED_SECTIONS = ["## Status", "## Unfinished"]

FENCE = re.compile(r"^\s*(```|~~~)")


def strip_fenced_blocks(text):
    """Remove fenced code blocks, keeping line numbers so findings can be located.

    Lines inside a fence become empty rather than disappearing, so a reported line number still
    matches the line in the file the reader will open.
    """
    out = []
    in_fence = False
    fence_marker = None
    for line in text.splitlines():
        match = FENCE.match(line)
        if match and not in_fence:
            in_fence = True
            fence_marker = match.group(1)
            out.append("")
            continue
        if in_fence:
            out.append("")
            if match and match.group(1) == fence_marker:
                in_fence = False
                fence_marker = None
            continue
        out.append(line)
    if in_fence:
        out.append("__UNCLOSED_FENCE__")
    return "\n".join(out)


def main():
    if not README.exists():
        sys.stderr.write("there is no README.md\n")
        return 1

    raw = README.read_text(encoding="utf-8")
    prose = strip_fenced_blocks(raw)
    failures = []
    notes = []

    if "__UNCLOSED_FENCE__" in prose:
        failures.append("a fenced code block is never closed, so everything after it was "
                        "treated as code and not checked at all")

    fenced_lines = sum(1 for a, b in zip(raw.splitlines(), prose.splitlines())
                       if a.strip() and not b.strip())
    notes.append("%d lines of prose checked, %d lines of fenced transcript skipped"
                 % (sum(1 for line in prose.splitlines() if line.strip()), fenced_lines))

    for marker in SCAFFOLD_MARKERS:
        for number, line in enumerate(prose.splitlines(), 1):
            if marker.lower() in line.lower():
                failures.append("README.md line %d still carries the scaffold marker %r: %s"
                                % (number, marker, line.strip()[:70]))

    for section in REQUIRED_SECTIONS:
        if section not in raw:
            failures.append("README.md has no %s section" % section)

    for label, pattern, why in REQUIRED_STATEMENTS:
        if not pattern.search(prose):
            failures.append("%s: %s" % (label, why))

    # The Status section must hold a pasted transcript, not a description of one. A transcript
    # is fenced, so this looks at the raw text between the heading and the next one.
    status = re.search(r"^## Status\b(.*?)(?=^## |\Z)", raw, re.S | re.M)
    if status is None:
        failures.append("README.md has no Status section to hold the verification output")
    else:
        body = status.group(1)
        if "```" not in body:
            failures.append("the Status section contains no fenced block, so it describes the "
                            "verification rather than pasting it")
        if not re.search(r"exit code 0|EXIT 0|exit 0", body, re.I):
            failures.append("the Status section does not record the exit code of the run")
        if len(body.strip()) < 300:
            failures.append("the Status section is %d characters, which is too short to be a "
                            "pasted transcript" % len(body.strip()))
        else:
            notes.append("the Status section holds a %d character transcript"
                         % len(body.strip()))

    # No em dashes anywhere, prose or transcript. Jesse considers them an AI tell.
    for number, line in enumerate(raw.splitlines(), 1):
        if "—" in line:
            failures.append("README.md line %d contains an em dash: %s"
                            % (number, line.strip()[:70]))

    for note in notes:
        sys.stdout.write("  %s\n" % note)
    if failures:
        sys.stdout.write("\nREADME CHECK FAILED: %d finding(s)\n" % len(failures))
        for f in failures:
            sys.stdout.write("  %s\n" % f)
        return 1
    sys.stdout.write("README CHECK PASSED\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
