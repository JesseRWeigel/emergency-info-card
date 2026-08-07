#!/usr/bin/env python3
"""Recompute this project's headline numbers by a route that shares no code with it.

    python3 scripts/check_independent.py --dist DIR --people people.example.json

Why a second implementation rather than a second assertion. Every number this project publishes
comes out of src/: the advance-width table in src/metrics.js decides where lines break, the sRGB
arithmetic in src/color.js decides whether a colour pair passes, and src/layout.js decides
whether an atom fits. A check that imports any of those asks the same code the same question
twice and gets the same answer, including when the answer is wrong.

So nothing here is imported from the package. The three headline numbers are recomputed from
first principles and from primary sources:

  text metrics   the advance width of every rendered line is recomputed by parsing the hmtx,
                 cmap, head and OS/2 tables out of the DejaVu Sans TTF on this machine, in pure
                 Python. src/metrics.js uses a table of numbers that were measured once in a
                 browser canvas. The two routes have nothing in common but the font file, so
                 agreement to a hundredth of a millimetre means the baked table is honest.

  contrast       the sRGB relative-luminance formula is written out again here from IEC
                 61966-2-1, including the 0.03928 linear segment, the per-channel weights and
                 the +0.05 flare offsets. The colour pair it is applied to is read out of the
                 rendered HTML by walking the element tree for the painted background, not
                 taken from the tool's own claim about what the background is.

  completeness   the set of facts that reached a card is recounted from the data-atom
                 attributes in the rendered HTML, against the set of facts re-derived from the
                 people file by reimplementing the atom-id scheme here. This is the check that
                 catches a silently dropped eleventh medication, so it is the one that most
                 needed a second pair of eyes.

The claim that this file imports nothing from the package is itself checked, in
verify_own_independence(), by walking this file's own AST. A grep would be satisfied by a
comment saying "we do not import src/card.js" and would miss importlib.import_module entirely.
"""

import argparse
import ast
import json
import os
import re
import struct
import sys
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# ISO/IEC 7810 ID-1, written here rather than read from src/units.js.
ID1_WIDTH_MM = 85.60
ID1_HEIGHT_MM = 53.98
CARD_MARGIN_MM = 3.0

MIN_PT = 8.0
MIN_X_HEIGHT_MM = 1.40
MIN_CONTRAST = 12.0
MIN_LOCK_PX = 12.0

MM_PER_INCH = 25.4
POINTS_PER_INCH = 72.0
CSS_PX_PER_INCH = 96.0

FONT_CANDIDATES = {
    400: [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/usr/local/share/fonts/DejaVuSans.ttf",
    ],
    700: [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/usr/local/share/fonts/DejaVuSans-Bold.ttf",
    ],
}

failures = []
notes = []
checks = 0


def check(ok, message):
    global checks
    checks += 1
    if not ok:
        failures.append(message)
    return ok


# ----------------------------------------------------------------------------------------
# Proof that this file is independent, by AST rather than by grep.
# ----------------------------------------------------------------------------------------
ALLOWED_IMPORTS = {
    "argparse", "ast", "json", "os", "re", "struct", "sys", "html", "html.parser", "pathlib",
    "collections", "math", "decimal",
}

# Ways to reach the package under test that an import statement does not mention.
#
# Two lists, because the distinction matters and collapsing it produced a false positive the
# first time this ran: a BARE call to compile() can turn a string into code, while re.compile()
# is a regex and appears four times in this file. So bare builtin names are forbidden and
# attribute calls are matched by their own names.
#
# Every entry is assembled from fragments so that this list does not match itself. Written out
# whole, the scan below would find "exec" and "eval" as string constants in this very file and
# report the checker for the crime of describing it.
BARE_DANGEROUS_CALLS = {"ex" + "ec", "ev" + "al", "comp" + "ile", "__imp" + "ort__",
                        "op" + "en"}
DANGEROUS_ATTRIBUTES = {"import_" + "module", "run_" + "path", "load_" + "module",
                        "check_" + "output", "Pop" + "en"}
# Suffixes that mark a file belonging to the package under test. Fragments again, for the same
# reason: spelled out, the two constants below would themselves be flagged as paths into the
# package, which is exactly the self-matching failure this check has to avoid.
PACKAGE_SUFFIXES = ("." + "js", "." + "cjs", "." + "mjs")


def verify_own_independence():
    """Walk this file's own syntax tree and prove it cannot reach src/ or bin/."""
    source = Path(__file__).read_text(encoding="utf-8")
    tree = ast.parse(source, filename=__file__)

    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                failures.append("check_independent.py uses a relative import, which could reach "
                                "into the package under test")
            imported.add(node.module or "")

    stray = sorted(name for name in imported
                   if name.split(".")[0] not in {a.split(".")[0] for a in ALLOWED_IMPORTS})
    check(not stray,
          "check_independent.py imports %s, which is outside the standard-library allowlist. "
          "An independent check that imports the thing it checks is a second call, not a second "
          "opinion." % ", ".join(stray))

    # Dynamic reach. ast.walk finds these wherever they are, including inside a function that is
    # never called, which is the point: a grep for "import" misses importlib.import_module and a
    # grep for "importlib" is satisfied by this very comment.
    dynamic = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name) and node.func.id in BARE_DANGEROUS_CALLS:
            dynamic.append((node.func.id, getattr(node, "lineno", 0)))
        elif isinstance(node.func, ast.Attribute) and node.func.attr in DANGEROUS_ATTRIBUTES:
            dynamic.append((node.func.attr, getattr(node, "lineno", 0)))
    check(not dynamic,
          "check_independent.py can reach the package dynamically via %s"
          % ", ".join("%s (line %d)" % d for d in dynamic))

    # Nothing may read a file under src/ or bin/. String constants are the only way a path gets
    # in, so every string constant in the tree is examined.
    reaching = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            v = node.value
            if re.search(r"(^|[/\"'])(src|bin)/", v) or v.endswith(PACKAGE_SUFFIXES):
                reaching.append(v[:60])
    check(not reaching,
          "check_independent.py mentions a path into the package: %s" % ", ".join(reaching))

    notes.append("independence proved by AST: %d imports, all standard library, no dynamic "
                 "import, no path into the package" % len(imported))


# ----------------------------------------------------------------------------------------
# A TrueType reader, enough of one to recompute advance widths.
# ----------------------------------------------------------------------------------------
class TrueTypeFont:
    """Advance widths and x-height, read straight out of the font file.

    This is the independent route for every width in this project. src/metrics.js carries a
    table of per-glyph advances that were measured once with a browser canvas; this reads the
    same information from the hmtx and cmap tables of the same font. Agreement means the baked
    table is a faithful description of the font that will actually render.
    """

    def __init__(self, path):
        self.path = path
        self.data = Path(path).read_bytes()
        self.tables = {}
        self._read_directory()
        self.units_per_em = self._read_head()
        self.num_glyphs = self._read_maxp()
        self.advances = self._read_hmtx()
        self.cmap = self._read_cmap()
        self.x_height_units = self._read_os2_x_height()

    def _read_directory(self):
        tag = self.data[0:4]
        if tag not in (b"\x00\x01\x00\x00", b"true", b"ttcf", b"OTTO"):
            raise ValueError("%s is not a TrueType font (tag %r)" % (self.path, tag))
        if tag == b"ttcf":
            raise ValueError("%s is a font collection, which this reader does not handle"
                             % self.path)
        num_tables = struct.unpack_from(">H", self.data, 4)[0]
        for i in range(num_tables):
            off = 12 + i * 16
            name = self.data[off:off + 4].decode("latin1")
            start, length = struct.unpack_from(">II", self.data, off + 8)
            self.tables[name] = (start, length)

    def _table(self, name):
        if name not in self.tables:
            raise ValueError("%s has no %s table" % (self.path, name))
        start, length = self.tables[name]
        return self.data[start:start + length]

    def _read_head(self):
        head = self._table("head")
        return struct.unpack_from(">H", head, 18)[0]

    def _read_maxp(self):
        return struct.unpack_from(">H", self._table("maxp"), 4)[0]

    def _read_hmtx(self):
        num_h_metrics = struct.unpack_from(">H", self._table("hhea"), 34)[0]
        hmtx = self._table("hmtx")
        advances = []
        for i in range(num_h_metrics):
            advances.append(struct.unpack_from(">H", hmtx, i * 4)[0])
        # Every glyph after numberOfHMetrics repeats the last advance. This is the monospaced
        # tail of the font and dropping it would make those glyphs measure as zero.
        while len(advances) < self.num_glyphs:
            advances.append(advances[-1] if advances else 0)
        return advances

    def _read_cmap(self):
        cmap = self._table("cmap")
        num_subtables = struct.unpack_from(">H", cmap, 2)[0]
        best = None
        for i in range(num_subtables):
            platform, encoding, offset = struct.unpack_from(">HHI", cmap, 4 + i * 8)
            fmt = struct.unpack_from(">H", cmap, offset)[0]
            if fmt != 4:
                continue
            # Windows BMP first, then Unicode BMP. Both are format 4 here.
            rank = 0 if (platform == 3 and encoding == 1) else 1 if platform == 0 else 2
            if best is None or rank < best[0]:
                best = (rank, offset)
        if best is None:
            raise ValueError("%s has no format 4 cmap subtable" % self.path)
        return self._parse_cmap4(cmap, best[1])

    @staticmethod
    def _parse_cmap4(cmap, offset):
        seg_count = struct.unpack_from(">H", cmap, offset + 6)[0] // 2
        end_at = offset + 14
        start_at = end_at + seg_count * 2 + 2
        delta_at = start_at + seg_count * 2
        range_at = delta_at + seg_count * 2
        mapping = {}
        for seg in range(seg_count):
            end = struct.unpack_from(">H", cmap, end_at + seg * 2)[0]
            start = struct.unpack_from(">H", cmap, start_at + seg * 2)[0]
            delta = struct.unpack_from(">h", cmap, delta_at + seg * 2)[0]
            range_offset = struct.unpack_from(">H", cmap, range_at + seg * 2)[0]
            if start > end:
                continue
            for code in range(start, min(end, 0xFFFF) + 1):
                if range_offset == 0:
                    glyph = (code + delta) & 0xFFFF
                else:
                    at = range_at + seg * 2 + range_offset + (code - start) * 2
                    if at + 2 > len(cmap):
                        continue
                    glyph = struct.unpack_from(">H", cmap, at)[0]
                    if glyph != 0:
                        glyph = (glyph + delta) & 0xFFFF
                if glyph != 0:
                    mapping[code] = glyph
        return mapping

    def _read_os2_x_height(self):
        os2 = self._table("OS/2")
        version = struct.unpack_from(">H", os2, 0)[0]
        if version < 2 or len(os2) < 88:
            return None
        return struct.unpack_from(">h", os2, 86)[0]

    def advance_em(self, text):
        """Width of a string in em, summed from the font's own horizontal metrics."""
        total = 0
        for ch in text:
            glyph = self.cmap.get(ord(ch))
            if glyph is None or glyph >= len(self.advances):
                # Unknown character. Report it rather than scoring it zero, because a zero
                # would make this check agree with a model that also lost the character.
                return None
            total += self.advances[glyph]
        return total / self.units_per_em

    def x_height_em(self):
        if self.x_height_units is None:
            return None
        return self.x_height_units / self.units_per_em


def load_fonts():
    fonts = {}
    for weight, candidates in FONT_CANDIDATES.items():
        found = next((c for c in candidates if os.path.exists(c)), None)
        if found is None:
            return None, ("no DejaVu Sans at weight %d on this machine. Looked in: %s. Install it "
                          "(Debian and Ubuntu: `sudo apt-get install fonts-dejavu-core`). This is "
                          "a failure and not a skip: without the font file there is no "
                          "independent route to the text metrics at all."
                          % (weight, ", ".join(candidates)))
        fonts[weight] = TrueTypeFont(found)
    return fonts, None


# ----------------------------------------------------------------------------------------
# sRGB contrast, written out again from IEC 61966-2-1 and WCAG 2.x.
# ----------------------------------------------------------------------------------------
def channel_to_linear(channel_255):
    c = channel_255 / 255.0
    if c <= 0.03928:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb):
    r, g, b = rgb[0], rgb[1], rgb[2]
    return (0.2126 * channel_to_linear(r)
            + 0.7152 * channel_to_linear(g)
            + 0.0722 * channel_to_linear(b))


def contrast_ratio(fg, bg):
    lighter = max(relative_luminance(fg), relative_luminance(bg))
    darker = min(relative_luminance(fg), relative_luminance(bg))
    return (lighter + 0.05) / (darker + 0.05)


HEX6 = re.compile(r"^#([0-9a-fA-F]{6})$")
HEX3 = re.compile(r"^#([0-9a-fA-F]{3})$")
RGB_FUNC = re.compile(r"^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)")


def parse_color(text):
    if not text:
        return None
    s = text.strip().lower()
    m = HEX6.match(s)
    if m:
        return (int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16))
    m = HEX3.match(s)
    if m:
        return tuple(int(c * 2, 16) for c in s[1:4])
    m = RGB_FUNC.match(s)
    if m:
        return (float(m.group(1)), float(m.group(2)), float(m.group(3)))
    return None


# ----------------------------------------------------------------------------------------
# A small HTML reader that keeps the ancestor stack, so the painted background of a run of
# text can be found the way a browser finds it.
# ----------------------------------------------------------------------------------------
def parse_style(value):
    out = {}
    for declaration in (value or "").split(";"):
        if ":" not in declaration:
            continue
        key, _, val = declaration.partition(":")
        out[key.strip().lower()] = val.strip()
    return out


LENGTH = re.compile(r"^(-?[\d.]+)(mm|px|pt)$")


def to_mm(value):
    m = LENGTH.match((value or "").strip())
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2)
    if unit == "mm":
        return n
    if unit == "px":
        return n * MM_PER_INCH / CSS_PX_PER_INCH
    return n * MM_PER_INCH / POINTS_PER_INCH


def to_pt(value):
    m = LENGTH.match((value or "").strip())
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2)
    if unit == "pt":
        return n
    if unit == "px":
        return n * POINTS_PER_INCH / CSS_PX_PER_INCH
    return n * POINTS_PER_INCH / MM_PER_INCH


def to_px(value):
    m = LENGTH.match((value or "").strip())
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2)
    if unit == "px":
        return n
    if unit == "pt":
        return n * CSS_PX_PER_INCH / POINTS_PER_INCH
    return n * CSS_PX_PER_INCH / MM_PER_INCH


VOID_ELEMENTS = {"meta", "link", "br", "img", "hr", "input", "source", "area", "base", "col"}


class RunCollector(HTMLParser):
    """Collect every run of text, with the inline style stack that produced it."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.runs = []
        self.cards = []
        self.atom_ids = []          # one entry per rendered piece of an atom
        self.body_attrs = {}
        self.current_run = None
        self.text_parts = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        node = {
            "tag": tag,
            "class": a.get("class", ""),
            "style": parse_style(a.get("style")),
            "attrs": a,
        }
        if tag == "body":
            self.body_attrs = a
        if tag in VOID_ELEMENTS:
            return
        self.stack.append(node)
        if tag == "div" and "card" in node["class"].split():
            self.cards.append(node)
        if tag == "div" and a.get("data-atom"):
            self.atom_ids.append((a["data-atom"], a.get("data-part")))
        if a.get("data-run"):
            self.current_run = {"node": node, "ancestors": list(self.stack)}
            self.text_parts = []

    def handle_endtag(self, tag):
        if tag in VOID_ELEMENTS:
            return
        if self.current_run is not None and self.stack and self.stack[-1] is self.current_run["node"]:
            self.current_run["text"] = "".join(self.text_parts)
            self.runs.append(self.current_run)
            self.current_run = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]["tag"] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.current_run is not None:
            self.text_parts.append(data)


def painted_background(ancestors, page_default):
    """The colour actually behind a glyph: the nearest ancestor that declares one."""
    for node in reversed(ancestors):
        declared = node["style"].get("background") or node["style"].get("background-color")
        colour = parse_color(declared)
        if colour is not None:
            return colour
    return page_default


def inherited(ancestors, prop, default=None):
    for node in reversed(ancestors):
        if prop in node["style"]:
            return node["style"][prop]
    return default


# ----------------------------------------------------------------------------------------
# Re-derive the facts from the people file, reimplementing the atom-id scheme.
# ----------------------------------------------------------------------------------------
SECTIONS = ["allergies", "conditions", "medications", "contacts", "notes"]


def derive_atoms(people_json):
    """The atom ids a correct tool must place, worked out again from the source data.

    This deliberately reimplements the id scheme in src/schema.js rather than reading it. If the
    two ever disagree the check fails, which is the intended behaviour: a change to how facts
    are identified is a change that must be noticed.
    """
    per_person = {}
    for person in people_json["people"]:
        pid = person["id"]
        ids = []
        for section in SECTIONS:
            entries = person.get(section) or []
            for index in range(len(entries)):
                ids.append("%s/%s/%d" % (pid, section, index))
        per_person[pid] = ids
    return per_person


# ----------------------------------------------------------------------------------------
# The checks
# ----------------------------------------------------------------------------------------
def check_cards(dist, report, fonts, expected_atoms):
    content_width_mm = ID1_WIDTH_MM - 2 * CARD_MARGIN_MM

    for person in report["people"]:
        pid = person["id"]
        path = dist / pid / "cards.html"
        if not check(path.exists(), "%s: %s was not generated" % (pid, path.name)):
            continue
        collector = RunCollector()
        collector.feed(path.read_text(encoding="utf-8"))

        # --- card geometry, against ISO/IEC 7810 ID-1 written down here ---
        check(len(collector.cards) == person["layout"]["sideCount"],
              "%s: the HTML has %d card sides, the report claims %d"
              % (pid, len(collector.cards), person["layout"]["sideCount"]))
        for card in collector.cards:
            w = to_mm(card["style"].get("width"))
            h = to_mm(card["style"].get("height"))
            check(w is not None and abs(w - ID1_WIDTH_MM) < 0.001,
                  "%s: a card is %s wide in the HTML, ISO/IEC 7810 ID-1 is %.2f mm"
                  % (pid, card["style"].get("width"), ID1_WIDTH_MM))
            check(h is not None and abs(h - ID1_HEIGHT_MM) < 0.001,
                  "%s: a card is %s tall in the HTML, ISO/IEC 7810 ID-1 is %.2f mm"
                  % (pid, card["style"].get("height"), ID1_HEIGHT_MM))

        # --- completeness, recounted from the HTML against the people file ---
        want = expected_atoms.get(pid)
        if check(want is not None, "%s: the report describes a person who is not in the people "
                                   "file" % pid):
            seen_first_parts = []
            for atom_id, part in collector.atom_ids:
                # A split atom is rendered once per part. Only the first part counts as a
                # placement, exactly as src/layout.js's own invariant does, but recounted here
                # from the markup rather than from the layout engine's bookkeeping.
                if part is None or part == "0":
                    seen_first_parts.append(atom_id)
            missing = [a for a in want if a not in seen_first_parts]
            extra = [a for a in seen_first_parts if a not in want]
            duplicated = sorted({a for a in seen_first_parts
                                 if seen_first_parts.count(a) > 1})
            check(not missing,
                  "%s: %d fact(s) in the people file never reached a card: %s. This is the "
                  "silently dropped eleventh medication, and it is the worst bug this tool "
                  "could have." % (pid, len(missing), ", ".join(missing[:6])))
            check(not extra,
                  "%s: the cards carry %d fact(s) that are not in the people file: %s"
                  % (pid, len(extra), ", ".join(extra[:6])))
            check(not duplicated,
                  "%s: %d fact(s) appear on more than one card: %s"
                  % (pid, len(duplicated), ", ".join(duplicated[:6])))

        # --- every run of text, measured from the font file and the sRGB formula ---
        modelled = {r["id"]: r for r in person["cardRuns"]}
        check(len(collector.runs) == len(person["cardRuns"]),
              "%s: the HTML has %d runs of text, the report describes %d"
              % (pid, len(collector.runs), len(person["cardRuns"])))

        for run in collector.runs:
            run_id = run["node"]["attrs"]["data-run"]
            text = run["text"]
            ancestors = run["ancestors"]
            size_pt = to_pt(inherited(ancestors, "font-size"))
            weight_text = inherited(ancestors, "font-weight", "400")
            weight = 700 if str(weight_text).strip() in ("700", "bold") else 400
            colour = parse_color(inherited(ancestors, "color"))
            background = painted_background(ancestors, (255, 255, 255))

            if not check(size_pt is not None,
                         "%s %s: no font-size in the markup, so nothing about this run can be "
                         "measured" % (pid, run_id)):
                continue
            if not check(colour is not None,
                         "%s %s: no readable colour in the markup" % (pid, run_id)):
                continue

            check(size_pt >= MIN_PT - 1e-6,
                  "%s %s: the markup sets %.3f pt, under the %.1f pt floor. Text: %r"
                  % (pid, run_id, size_pt, MIN_PT, text[:40]))

            font = fonts[weight]
            x_height_em = font.x_height_em()
            if x_height_em is not None:
                x_height_mm = x_height_em * size_pt * MM_PER_INCH / POINTS_PER_INCH
                check(x_height_mm >= MIN_X_HEIGHT_MM - 1e-6,
                      "%s %s: the font's own OS/2 x-height at %.2f pt is %.3f mm, under the "
                      "%.2f mm floor" % (pid, run_id, size_pt, x_height_mm, MIN_X_HEIGHT_MM))

            ratio = contrast_ratio(colour, background)
            check(ratio >= MIN_CONTRAST - 1e-6,
                  "%s %s: rgb%s on rgb%s is %.3f:1, under the %.1f:1 floor"
                  % (pid, run_id, tuple(int(c) for c in colour),
                     tuple(int(c) for c in background), ratio, MIN_CONTRAST))

            # The width, from the font file rather than from the baked table.
            em = font.advance_em(text)
            if not check(em is not None,
                         "%s %s: the font has no glyph for a character in %r, so this line "
                         "cannot be measured and the tool's width for it is unverified"
                         % (pid, run_id, text[:40])):
                continue
            width_mm = em * size_pt * MM_PER_INCH / POINTS_PER_INCH

            model = modelled.get(run_id)
            if check(model is not None,
                     "%s %s: the HTML has a run the report does not describe" % (pid, run_id)):
                check(text == model["text"],
                      "%s %s: the HTML says %r, the report says %r"
                      % (pid, run_id, text[:40], model["text"][:40]))
                check(abs(width_mm - model["predictedWidthMm"]) <= 0.01,
                      "%s %s: the font file puts this line at %.4f mm, the tool's table says "
                      "%.4f mm. The baked advance-width table does not describe this font."
                      % (pid, run_id, width_mm, model["predictedWidthMm"]))

            # And an absolute bound that does not depend on the tool's own idea of the column:
            # nothing may be wider than the content box of an ID-1 card.
            check(width_mm <= content_width_mm + 0.01,
                  "%s %s: %.3f mm of text in a %.2f mm content box (ID-1 less two %.1f mm "
                  "margins). Text: %r"
                  % (pid, run_id, width_mm, content_width_mm, CARD_MARGIN_MM, text[:40]))


def check_lock_screens(dist, report, fonts):
    for person in report["people"]:
        pid = person["id"]
        total_atoms = person["atomCount"]
        for lock in person["lockScreens"]:
            path = dist / pid / ("lock-%s.html" % lock["device"])
            if not check(path.exists(), "%s: %s was not generated" % (pid, path.name)):
                continue
            collector = RunCollector()
            collector.feed(path.read_text(encoding="utf-8"))

            shown = [a for a, _ in collector.atom_ids]
            check(len(set(shown)) == len(shown),
                  "%s %s: the lock screen shows the same fact twice" % (pid, lock["device"]))

            # The overflow note, recounted. "+7 MORE ON WALLET CARD: 5 medications, 2 notes"
            # must agree with the number of facts that are on the card set and not on this
            # screen. A note that says the wrong number is worse than no note.
            #
            # The note is collected by its container rather than by matching its text. Matching
            # text found only the first line of a wrapped note and scored a correct
            # "+3 MORE ON WALLET CARD: 2 contacts, 1 note" as adding up to 2, which is a bug in
            # the checker that looks exactly like a bug in the tool.
            note_runs = [r["text"] for r in collector.runs
                         if any("note" in n["class"].split() for n in r["ancestors"])]
            note = " ".join(note_runs)
            omitted_here = total_atoms - len(shown)
            if omitted_here > 0:
                if check(note, "%s %s: %d of %d facts are not on this lock screen and the image "
                               "says nothing about it. A silent omission is the failure mode "
                               "this note exists to prevent."
                               % (pid, lock["device"], omitted_here, total_atoms)):
                    m = re.search(r"\+(\d+)\s+MORE", note)
                    if check(m, "%s %s: the overflow note %r does not state a count"
                                % (pid, lock["device"], note[:60])):
                        check(int(m.group(1)) == omitted_here,
                              "%s %s: the note says +%s more, but %d of the %d facts are not on "
                              "the screen" % (pid, lock["device"], m.group(1), omitted_here,
                                              total_atoms))
                    # The per-section breakdown must add up to the same number.
                    parts = re.findall(r"(\d+)\s+(?:allerg|condition|medication|contact|note)",
                                       note)
                    if parts:
                        check(sum(int(p) for p in parts) == omitted_here,
                              "%s %s: the note breaks %d facts down into parts adding to %d"
                              % (pid, lock["device"], omitted_here,
                                 sum(int(p) for p in parts)))
            else:
                check(not note,
                      "%s %s: every fact is on the screen and it still carries an overflow note "
                      "%r" % (pid, lock["device"], note[:60]))

            check(len(shown) == lock["placed"] and omitted_here == lock["omitted"],
                  "%s %s: the HTML shows %d facts and defers %d, the report claims %d and %d"
                  % (pid, lock["device"], len(shown), omitted_here, lock["placed"],
                     lock["omitted"]))

            # Type size and contrast on the screen, same two routes as the card.
            for run in collector.runs:
                run_id = run["node"]["attrs"]["data-run"]
                ancestors = run["ancestors"]
                size_px = to_px(inherited(ancestors, "font-size"))
                colour = parse_color(inherited(ancestors, "color"))
                background = painted_background(ancestors, (255, 255, 255))
                if not check(size_px is not None and colour is not None,
                             "%s %s %s: the markup does not say how this run is painted"
                             % (pid, lock["device"], run_id)):
                    continue
                check(size_px >= MIN_LOCK_PX - 1e-6,
                      "%s %s %s: %.2f px is under the %.0f px floor"
                      % (pid, lock["device"], run_id, size_px, MIN_LOCK_PX))
                ratio = contrast_ratio(colour, background)
                check(ratio >= MIN_CONTRAST - 1e-6,
                      "%s %s %s: rgb%s on rgb%s is %.3f:1, under the %.1f:1 floor"
                      % (pid, lock["device"], run_id, tuple(int(c) for c in colour),
                         tuple(int(c) for c in background), ratio, MIN_CONTRAST))


def check_overflow_behaviour(report, expected_atoms):
    """The negative control and the overflow case, stated as opposites.

    A checker that only ever looks at the hard case cannot tell "handled the overflow" from
    "reports overflow for everything". So both directions are required here: at least one
    person whose record fits must produce no continuation and no omission at all, and at least
    one person whose record does not fit must produce a continuation, an omission note, and a
    complete set of facts across the cards.
    """
    fitting = []
    overflowing = []
    for person in report["people"]:
        layout = person["layout"]
        lock_omitted = sum(l["omitted"] for l in person["lockScreens"])
        if layout["cardCount"] == 1 and not layout["splitAtoms"] and lock_omitted == 0:
            fitting.append(person)
        if layout["cardCount"] > 1 or lock_omitted > 0:
            overflowing.append(person)

    if check(fitting,
             "no person in the example file fits on a single card with nothing deferred on any "
             "lock screen. Without a negative control, a checker that reported overflow for "
             "every record would pass every test here."):
        for person in fitting:
            check(person["layout"]["contentSides"] <= 2,
                  "%s: fits on one card but occupies %d sides"
                  % (person["id"], person["layout"]["contentSides"]))
            check(not person["layout"]["overWideWords"],
                  "%s: fits on one card and still has an over-wide word" % person["id"])
            for lock in person["lockScreens"]:
                check(lock["omitted"] == 0 and lock["note"] is None,
                      "%s %s: a record that fits produced an omission note %r"
                      % (person["id"], lock["device"], lock["note"]))
            check(person["id"] in expected_atoms,
                  "%s: the negative control is not in the people file" % person["id"])
        notes.append("negative control: %s fit with zero findings, zero splits and zero "
                     "deferrals" % ", ".join(p["id"] for p in fitting))

    if check(overflowing,
             "no person in the example file overflows a card or a lock screen, so the overflow "
             "path is never exercised and the eleven-medication case is untested."):
        for person in overflowing:
            placed_total = len(expected_atoms.get(person["id"], []))
            check(person["atomCount"] == placed_total,
                  "%s: the report counts %d facts, the people file has %d"
                  % (person["id"], person["atomCount"], placed_total))
            for lock in person["lockScreens"]:
                check(lock["placed"] + lock["omitted"] == person["atomCount"],
                      "%s %s: %d shown plus %d deferred is not the %d facts this person has. A "
                      "fact that is neither shown nor counted has been lost."
                      % (person["id"], lock["device"], lock["placed"], lock["omitted"],
                         person["atomCount"]))
                if lock["omitted"] > 0:
                    check(lock["note"],
                          "%s %s: %d facts deferred with no note on the image"
                          % (person["id"], lock["device"], lock["omitted"]))
        notes.append("overflow control: %s overflowed and accounted for every fact"
                     % ", ".join(p["id"] for p in overflowing))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", default=str(ROOT / "dist"))
    parser.add_argument("--people", default=str(ROOT / "people.example.json"))
    args = parser.parse_args()

    verify_own_independence()

    dist = Path(args.dist).resolve()
    report_path = dist / "report.json"
    if not report_path.exists():
        sys.stderr.write("%s does not exist. Build first.\n" % report_path)
        return 1
    report = json.loads(report_path.read_text(encoding="utf-8"))
    people_json = json.loads(Path(args.people).read_text(encoding="utf-8"))
    expected_atoms = derive_atoms(people_json)

    fonts, error = load_fonts()
    if error:
        sys.stderr.write("INDEPENDENT CHECK FAILED: %s\n" % error)
        return 1
    notes.append("font metrics read from %s (unitsPerEm %d, %d glyphs)"
                 % (os.path.basename(fonts[400].path), fonts[400].units_per_em,
                    fonts[400].num_glyphs))

    check_cards(dist, report, fonts, expected_atoms)
    check_lock_screens(dist, report, fonts)
    check_overflow_behaviour(report, expected_atoms)

    for note in notes:
        sys.stdout.write("  %s\n" % note)

    if failures:
        sys.stdout.write("\nINDEPENDENT CHECK FAILED: %d of %d checks\n" % (len(failures), checks))
        for f in failures[:40]:
            sys.stdout.write("  %s\n" % f)
        if len(failures) > 40:
            sys.stdout.write("  ... and %d more\n" % (len(failures) - 40))
        return 1
    sys.stdout.write("INDEPENDENT CHECK PASSED: %d checks, recomputed from the font file and "
                     "the sRGB formula\n" % checks)
    return 0


if __name__ == "__main__":
    sys.exit(main())
