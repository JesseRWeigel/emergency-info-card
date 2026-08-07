#!/usr/bin/env bash
# The whole verification, and its exit code is the answer.
#
#   bash scripts/verify.sh
#
# Three rules this script is written around.
#
# NOTHING PRINTS SUCCESS FOR A STEP IT DID NOT RUN. There is no skip path. A missing Chrome, a
# missing font, a missing python3 is a FAILURE, because a skipped check and a passing check look
# identical in a log a week later, and the legibility claim this project makes rests entirely on
# the steps that need a browser.
#
# THE RUN MUST NOT MODIFY THE TREE IT VERIFIES. Every tracked file is digested at the start and
# again at the end, and a difference is a named failure. A verify that edits the repository can
# pass on a later run for reasons an earlier run created, which is indistinguishable from
# working. One script in this fleet alternated between exit 0 and exit 1 across identical
# invocations before this check existed.
#
# EVERY BROWSER CALL IS WRAPPED IN A TIMEOUT so a hang fails loudly instead of running forever.
# --disable-crashpad-for-testing and --disable-features=Crashpad are never passed anywhere in
# this project: on this workstation those two put Chrome into an infinite crash-restart loop.

set -u -o pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

RED=''; GREEN=''; DIM=''; OFF=''
if [ -t 1 ]; then RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; OFF=$'\033[0m'; fi

STEPS_RUN=0
STEPS_FAILED=0
FAILED_NAMES=()
START_TIME=$(date +%s)

WORK="$(mktemp -d -t emcard-verify-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

banner() {
  printf '\n%s=== %s ===%s\n' "$DIM" "$1" "$OFF"
}

# Run one step. Its exit code is the result, and there is no way to report success without it.
#
# The status is captured on the line after the command and nowhere else. Two shapes that look
# correct and are not, both of which this script shipped with before step_selftest caught them:
#
#   local code=$?            records the status of `local`, which is always 0
#   if cmd; then ... fi      leaves $? as the status of the `if` statement, and an `if` whose
#   code=$?                  condition failed with no else branch exits 0
step() {
  local name="$1"; shift
  local code
  STEPS_RUN=$((STEPS_RUN + 1))
  banner "$name"
  "$@"
  code=$?
  if [ "$code" -eq 0 ]; then
    printf '%sPASS%s %s\n' "$GREEN" "$OFF" "$name"
    return 0
  fi
  printf '%sFAIL%s %s (exit %d)\n' "$RED" "$OFF" "$name" "$code"
  STEPS_FAILED=$((STEPS_FAILED + 1))
  FAILED_NAMES+=("$name")
  return 1
}

# A prerequisite that is missing is a failure of this run, never a reason to skip a step.
require() {
  local what="$1" why="$2"; shift 2
  if "$@" >/dev/null 2>&1; then
    printf '  present: %s\n' "$what"
    return 0
  fi
  printf '  %sMISSING: %s%s\n    %s\n' "$RED" "$what" "$OFF" "$why"
  return 1
}

# ------------------------------------------------------------------------------------------
# Does the machinery above actually report a failure?
#
# This exists because the first run of this script printed "FAIL prerequisites (exit 0)" for a
# genuinely failing step, and a harness that mangles the exit code it reports is one edit away
# from swallowing it. Run in a subshell so the counters it moves do not leak into the real run.
step_selftest() {
  local ok=0
  if ( step "deliberately failing step" false >/dev/null 2>&1 ); then
    printf '  %sa step that returns 1 was reported as passing%s\n' "$RED" "$OFF"
    ok=1
  else
    printf '  a failing step returns nonzero from step()\n'
  fi
  if ( step "deliberately passing step" true >/dev/null 2>&1 ); then
    printf '  a passing step returns zero from step()\n'
  else
    printf '  %sa step that returns 0 was reported as failing%s\n' "$RED" "$OFF"
    ok=1
  fi
  # And the recorded exit code is the command's, not the shell builtin's. The digit class is
  # [0-9][0-9]* rather than [0-9]*, because [0-9]* also matches zero digits and the step name
  # itself contains the word this greps for.
  local seen
  seen=$( step "status fidelity" bash -c 'exit 7' 2>&1 | grep -o 'exit [0-9][0-9]*' | head -1 )
  if [ "$seen" = "exit 7" ]; then
    printf '  the reported exit code is the step command exit code\n'
  else
    printf '  %sa step exiting 7 was reported as %s%s\n' "$RED" "${seen:-nothing}" "$OFF"
    ok=1
  fi
  return $ok
}

step_preflight() {
  local ok=0
  require "node" "the tool is written in Node and nothing here runs without it" \
    node --version || ok=1
  require "python3" \
    "the independent check, the privacy scan and the sabotage harness are Python" \
    python3 --version || ok=1
  require "git" "the privacy scan asks git what is tracked and what is ignored" \
    git --version || ok=1

  local chrome=""
  for candidate in "${EMCARD_CHROME:-}" google-chrome google-chrome-stable chromium \
    chromium-browser; do
    [ -n "$candidate" ] || continue
    if command -v "$candidate" >/dev/null 2>&1; then chrome="$(command -v "$candidate")"; break; fi
  done
  if [ -n "$chrome" ]; then
    printf '  present: chrome (%s)\n' "$chrome"
    export EMCARD_CHROME="$chrome"
  else
    printf '  %sMISSING: Chrome or Chromium%s\n' "$RED" "$OFF"
    printf '    Every point size, x-height, contrast and safe-area number this project\n'
    printf '    publishes is measured in a real browser. Without one there is no measurement\n'
    printf '    at all, so this is a FAILURE and not a skip. Install one (Debian and Ubuntu:\n'
    printf '    sudo apt-get install chromium) or set EMCARD_CHROME.\n'
    ok=1
  fi

  # Not `fc-list | grep -q`. With pipefail set, grep -q exits on the first match and closes the
  # pipe, fc-list dies of SIGPIPE with status 141, and the pipeline reports failure for a font
  # that is installed. The first run of this script failed its own prerequisites that way.
  if fc-list > "$WORK/fonts.txt" 2>/dev/null \
    && grep -qi 'DejaVuSans\.ttf' "$WORK/fonts.txt"; then
    printf '  present: DejaVu Sans\n'
  else
    printf '  %sMISSING: DejaVu Sans%s\n' "$RED" "$OFF"
    printf '    The advance-width table in src/metrics.js describes this font, and the\n'
    printf '    independent check reads its metric tables directly. Without it neither the\n'
    printf '    browser measurement nor the independent recomputation means anything.\n'
    printf '    Install it: sudo apt-get install fonts-dejavu-core\n'
    ok=1
  fi

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$node_major" -lt 18 ]; then
    printf '  %sNode %s is too old, this needs 18 or newer%s\n' "$RED" "$node_major" "$OFF"
    ok=1
  fi
  return $ok
}

# ------------------------------------------------------------------------------------------
# Digest every tracked file, so the run can prove it changed nothing.
tree_digest() {
  git ls-files -z | sort -z | while IFS= read -r -d '' f; do
    if [ -f "$f" ]; then printf '%s  ' "$f"; sha256sum "$f" | cut -d' ' -f1; fi
  done
}

step_tree_untouched() {
  local after="$WORK/tree-after.txt"
  tree_digest > "$after"
  if diff -u "$WORK/tree-before.txt" "$after" > "$WORK/tree-diff.txt" 2>&1; then
    printf '  %d tracked files, all byte-identical to the start of the run\n' \
      "$(wc -l < "$after")"
    return 0
  fi
  printf '  %sTHE VERIFY RUN MODIFIED THE TREE IT VERIFIES.%s\n' "$RED" "$OFF"
  printf '  A verify that edits the repository can pass on a later run for reasons an\n'
  printf '  earlier run created, and that is indistinguishable from working.\n\n'
  head -40 "$WORK/tree-diff.txt"
  return 1
}

# ------------------------------------------------------------------------------------------
step_unit() {
  node --test 'test/*.test.js'
}

step_build() {
  rm -rf "$ROOT/dist"
  node bin/emcard.js build --out "$ROOT/dist"
}

step_netblock_control() {
  # The positive control first. A netblock that patches nothing would let the identical-output
  # test below pass while proving nothing at all.
  node --require ./scripts/netblock.cjs scripts/netblock-probe.cjs
}

step_offline() {
  local out="$WORK/dist-netblocked"
  local code
  rm -rf "$out"
  printf '  building with every outbound primitive replaced by something that throws\n'
  EMCARD_NETBLOCK_REPORT=1 node --require ./scripts/netblock.cjs \
    bin/emcard.js build --out "$out" > "$WORK/offline.log" 2>&1
  code=$?
  if [ $code -ne 0 ]; then
    printf '  %sthe build failed under the netblock (exit %d), which means it tried to reach '\
'the network%s\n' "$RED" "$code" "$OFF"
    tail -30 "$WORK/offline.log"
    return 1
  fi
  if diff -r "$ROOT/dist" "$out" > "$WORK/offline.diff" 2>&1; then
    printf '  byte-identical output with and without the network. The offline claim is tested,\n'
    printf '  not asserted.\n'
    return 0
  fi
  printf '  %sthe output differs with the network taken away%s\n' "$RED" "$OFF"
  head -30 "$WORK/offline.diff"
  return 1
}

step_shoot() {
  # Wrapped in timeout: a wedged Chrome must fail loudly rather than run forever.
  timeout 600 node bin/emcard.js shoot --out "$ROOT/dist"
}

step_measure() {
  timeout 900 node scripts/measure.js --dist "$ROOT/dist"
}

step_independent() {
  python3 scripts/check_independent.py --dist "$ROOT/dist"
}

step_privacy() {
  python3 scripts/privacy_scan.py
}

step_docs() {
  node scripts/build_docs.js --check
}

step_readme() {
  python3 scripts/check_readme.py
}

step_sabotage() {
  python3 scripts/sabotage.py
}

step_fingerprint() {
  node scripts/fingerprint.js --dist "$ROOT/dist" > "$WORK/fingerprint.json" || return 1
  python3 - "$WORK/fingerprint.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
h = d["headline"]
print("  fingerprint %s over %d files" % (d["fingerprint"][:32], d["fileCount"]))
print("  %d people, %d cards, %d card runs, %d lock-screen runs, %d findings"
      % (h["people"], h["cards"], h["cardRuns"], h["lockRuns"], h["findings"]))
print("  smallest type %s pt, lowest contrast %s:1" % (h["minPt"], h["minContrast"]))
sys.exit(1 if h["findings"] else 0)
PY
}

# ------------------------------------------------------------------------------------------
printf '%semergency-info-card, full verification%s\n' "$DIM" "$OFF"
printf '%s%s%s\n' "$DIM" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$OFF"

banner "tree digest, before"
tree_digest > "$WORK/tree-before.txt"
printf '  %d tracked files digested\n' "$(wc -l < "$WORK/tree-before.txt")"
if [ "$(wc -l < "$WORK/tree-before.txt")" -lt 10 ]; then
  printf '  %sonly a handful of tracked files. Commit before verifying: several checks read\n' "$RED"
  printf '  what git tracks, and they all pass trivially over an empty index.%s\n' "$OFF"
  exit 1
fi

step "this script reports failures"        step_selftest || true
step "prerequisites"                       step_preflight || true
step "unit tests"                          step_unit || true
step "build the example"                   step_build || true
step "netblock positive control"           step_netblock_control || true
step "build with the network taken away"   step_offline || true
step "lock-screen PNGs at device size"     step_shoot || true
step "browser measurement"                 step_measure || true
step "independent recomputation"           step_independent || true
step "privacy scan"                        step_privacy || true
step "published page matches the example"  step_docs || true
step "README"                              step_readme || true
step "sabotage harness"                    step_sabotage || true
step "fingerprint"                         step_fingerprint || true
step "the run did not modify the tree"     step_tree_untouched || true

ELAPSED=$(( $(date +%s) - START_TIME ))
printf '\n%s================================================%s\n' "$DIM" "$OFF"
if [ "$STEPS_FAILED" -eq 0 ]; then
  printf '%sVERIFY PASSED%s: %d of %d steps, %d seconds\n' \
    "$GREEN" "$OFF" "$STEPS_RUN" "$STEPS_RUN" "$ELAPSED"
  exit 0
fi
printf '%sVERIFY FAILED%s: %d of %d steps failed, %d seconds\n' \
  "$RED" "$OFF" "$STEPS_FAILED" "$STEPS_RUN" "$ELAPSED"
for name in "${FAILED_NAMES[@]}"; do printf '  failed: %s\n' "$name"; done
exit 1
