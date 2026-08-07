#!/usr/bin/env python3
"""Look for anything in this repository that should never have been committed.

    python3 scripts/privacy_scan.py

This project holds medical facts about real children in the file the user edits. The repository
must hold none of it. Three separate things are checked, because they fail in different ways:

  1. Secrets. The usual credential shapes, in tracked files.
  2. The real input file. people.json must be ignored by .gitignore and must not be tracked.
     The failure this prevents is somebody cloning this, filling in people.json with their
     child's medication list, and committing it without noticing.
  3. Real-looking people. Every person in the committed example must be marked fictional, so
     that a real record swapped into the example file is a scan failure rather than a quiet
     publication.

Two properties this scanner needs and that most scanners lack:

  A POSITIVE CONTROL. A scanner that reads no files is silent in exactly the same way as a clean
  tree. So a fake credential is planted where the scanner will read it, and the run fails if the
  scanner does not find it. The control also fails if almost nothing is tracked, because before
  the first commit `git ls-files` returns nothing and a scan of nothing passes instantly.

  PATTERNS ASSEMBLED FROM FRAGMENTS. Written out whole, the pattern list would match itself: the
  scanner would read this file, find the literal it is looking for, and report its own source as
  a leaked credential. That has happened twice in this fleet. The fix is never an exclusion for
  this file, because an exclusion disarms the check exactly where it is tested.
"""

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# ------------------------------------------------------------------------------------------
# The patterns. Every literal is concatenated at runtime so that this source file does not
# contain any of the strings it searches for.
# ------------------------------------------------------------------------------------------
A = "A"
SECRET_PATTERNS = [
    ("AWS access key id", re.compile(r"\b" + A + "KI" + A + r"[0-9A-Z]{16}\b")),
    ("GitHub personal access token", re.compile(r"\bgh" + r"[pousr]_[A-Za-z0-9]{36,}\b")),
    ("Slack token", re.compile(r"\bxox" + r"[abprs]-[0-9A-Za-z-]{10,}\b")),
    ("Google API key", re.compile(r"\b" + A + "Iza" + r"Sy[0-9A-Za-z_-]{33}\b")),
    ("OpenAI key", re.compile(r"\bsk-" + r"[A-Za-z0-9_-]{32,}\b")),
    ("Anthropic key", re.compile(r"\bsk-" + r"ant-[A-Za-z0-9_-]{24,}\b")),
    ("Stripe secret key", re.compile(r"\b" + r"sk_live_[0-9A-Za-z]{16,}\b")),
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*" + "PRIV" + "ATE KEY-----")),
    ("assigned password", re.compile(r"(?i)\b" + "pass" + "word\\s*[:=]\\s*[\"'][^\"'\\s]{6,}")),
    ("bearer token", re.compile(r"(?i)\b" + "auth" + r"orization\s*[:=]\s*[\"']?bearer\s+\S{16,}")),
]

# The planted credential for the positive control. Built the same way, so it is not itself a
# literal in this file, and shaped to match the AWS pattern above.
#
# The body is exactly sixteen characters because the pattern is {16} followed by a word
# boundary. The first version of this had eighteen, the pattern could not match, and the
# positive control correctly reported that the scanner had found nothing. That is the control
# doing its job on its first run, and it is the reason the length is spelled out here.
def planted_secret():
    body = "ZZ7EXAMPLE9CTRL0"
    assert len(body) == 16, "the planted key must be 16 characters to match the pattern"
    return A + "KI" + A + body


# Fictional-name markers. Every person in the committed example carries one of these in their
# surname, which is what makes "the example file contains only invented people" checkable rather
# than merely intended.
FICTION_MARKERS = ["fictitious", "nonexistent", "notareal", "madeup", "imaginary", "example",
                   "placeholder", "fabrication", "fictional", "invented", "specimen"]

BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ttf", ".woff", ".woff2", ".ico",
                   ".zip", ".gz"}

failures = []
notes = []


def git(*args, cwd=ROOT):
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True,
                          check=False)


def tracked_files():
    result = git("ls-files", "-z")
    if result.returncode != 0:
        return None, "git ls-files failed: %s" % result.stderr.strip()
    files = [f for f in result.stdout.split("\0") if f]
    return files, None


def scan_text(text, where, found):
    for label, pattern in SECRET_PATTERNS:
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            found.append((where, line, label, match.group(0)[:14] + "..."))


def scan_paths(paths, base):
    """Read every file and collect every hit. Returns the list of findings."""
    found = []
    read = 0
    for rel in paths:
        path = Path(base) / rel
        if not path.is_file():
            continue
        if path.suffix.lower() in BINARY_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        read += 1
        scan_text(text, rel, found)
    return found, read


# ------------------------------------------------------------------------------------------
# The three checks
# ------------------------------------------------------------------------------------------
def check_positive_control(paths):
    """Plant a credential where the scanner reads, and require it to be found.

    The plant goes into a copy of the tree rather than into the working tree, so a crash midway
    through cannot leave a credential-shaped string in the repository.
    """
    if len(paths) < 8:
        failures.append(
            "only %d tracked files. A scan of an almost empty tree passes instantly and proves "
            "nothing, and before the first commit `git ls-files` returns nothing at all."
            % len(paths))
        return

    with tempfile.TemporaryDirectory(prefix="emcard-privacy-control-") as tmp:
        target_rel = "README.md" if "README.md" in paths else paths[0]
        target = Path(tmp) / target_rel
        target.parent.mkdir(parents=True, exist_ok=True)
        original = (ROOT / target_rel).read_text(encoding="utf-8")
        target.write_text(original + "\n\naws_access_key_id = %s\n" % planted_secret(),
                          encoding="utf-8")
        found, read = scan_paths([target_rel], tmp)
        if read != 1:
            failures.append("the positive control read %d files rather than 1, so the scanner "
                            "was not exercised" % read)
            return
        if not found:
            failures.append(
                "POSITIVE CONTROL FAILED: a planted AWS-shaped credential in %s was not found. "
                "The scanner reads files and reports nothing, which is indistinguishable from a "
                "clean tree." % target_rel)
            return
    notes.append("positive control: a planted credential was detected, so the scanner does read "
                 "and does match")


def check_no_secrets(paths):
    found, read = scan_paths(paths, ROOT)
    if read == 0:
        failures.append("the scanner opened no files at all")
        return
    notes.append("read %d of %d tracked files" % (read, len(paths)))
    for where, line, label, sample in found:
        failures.append("%s line %d looks like a %s: %s" % (where, line, label, sample))


def check_real_input_is_ignored(paths):
    """people.json must be ignored and must not be tracked."""
    gitignore = ROOT / ".gitignore"
    if not gitignore.exists():
        failures.append("there is no .gitignore, so the real input file is not ignored by "
                        "default")
        return
    rules = [line.strip() for line in gitignore.read_text(encoding="utf-8").splitlines()]
    has_rule = any(r in ("people.json", "/people.json") for r in rules)
    if not has_rule:
        failures.append(
            "\".gitignore\" does not ignore people.json. The failure this prevents is somebody "
            "cloning this, putting their child's medication list in people.json, and committing "
            "it. The rule must be present before the file exists, not added afterwards.")
    else:
        notes.append(".gitignore ignores people.json")

    negated = [r for r in rules if r.lstrip("!").strip() in ("people.json", "/people.json")
               and r.startswith("!")]
    if negated:
        failures.append("\".gitignore\" un-ignores people.json with %r" % negated[0])

    if "people.json" in paths:
        failures.append("people.json IS TRACKED. This is the file that holds real medical "
                        "records. Remove it from the index immediately: "
                        "git rm --cached people.json")

    # And prove the rule actually works, rather than that a line exists in a file. git
    # check-ignore is the same code git itself uses to decide.
    result = git("check-ignore", "-q", "people.json")
    if result.returncode != 0:
        failures.append("git check-ignore says people.json would NOT be ignored, whatever "
                        "\".gitignore\" appears to say")
    else:
        notes.append("git check-ignore confirms people.json is ignored")

    example = ROOT / "people.example.json"
    if not example.exists():
        failures.append("people.example.json is missing, so there is nothing to copy from and a "
                        "user will create people.json by hand")


def check_example_people_are_fictional(paths):
    """Every person in the committed example must be visibly invented."""
    import json
    example = ROOT / "people.example.json"
    if not example.exists():
        return
    if "people.example.json" not in paths:
        failures.append("people.example.json is not tracked")
    try:
        data = json.loads(example.read_text(encoding="utf-8"))
    except ValueError as err:
        failures.append("people.example.json is not valid JSON: %s" % err)
        return
    people = data.get("people") or []
    if not people:
        failures.append("people.example.json has no people in it")
        return
    for person in people:
        name = str(person.get("name", ""))
        lowered = name.lower()
        if not any(marker in lowered for marker in FICTION_MARKERS):
            failures.append(
                "%r in people.example.json is not marked as fictional. Every example person's "
                "name must contain one of %s, so that a real record pasted into this file is a "
                "scan failure rather than a quiet publication."
                % (name, ", ".join(FICTION_MARKERS[:4])))
    notes.append("all %d example people carry a fictional-name marker" % len(people))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    paths, error = tracked_files()
    if error:
        sys.stderr.write("PRIVACY SCAN FAILED: %s\n" % error)
        return 1

    check_positive_control(paths)
    check_no_secrets(paths)
    check_real_input_is_ignored(paths)
    check_example_people_are_fictional(paths)

    for note in notes:
        sys.stdout.write("  %s\n" % note)
    if failures:
        sys.stdout.write("\nPRIVACY SCAN FAILED: %d finding(s)\n" % len(failures))
        for f in failures:
            sys.stdout.write("  %s\n" % f)
        return 1
    sys.stdout.write("PRIVACY SCAN PASSED\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
