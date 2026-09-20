#!/usr/bin/env python3
"""Run exactly the checks that cover what changed, and say what it skipped.

"Run every check that covers what you touched" is a judgment call made from
memory against four suites. Getting it wrong is invisible: a skipped e2e run
looks exactly like a passing one. This maps changed paths to suites
mechanically, so the agent keeps the judgment half -- reading the failures --
and stops owning the bookkeeping half.

  scripts/preflight.py                  # checks for the working tree's changes
  scripts/preflight.py --base main      # ...for everything since a ref
  scripts/preflight.py --all            # every suite, ignoring what changed
  scripts/preflight.py --list           # print the plan and exit (no runs)
  scripts/preflight.py --serial         # one at a time, cheapest first

Checks are separate processes over disjoint trees, so they run CONCURRENTLY
(4 lanes). `--serial` restores one-at-a-time, cheapest-first: use it when a
failure might be contention rather than a real break, since eight suites
sharing eight cores can starve a timing-sensitive e2e assertion.

Exit 1 if any selected check fails. Skips are reported loudly and are NOT
failures -- but they are never silent, because "could not check" reading as
"checked and fine" is the bug this repo keeps re-eating.
"""
import argparse
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Lanes, not cores: each suite already spawns its own workers (vitest,
DEFAULT_JOBS = 4

REPO_ROOT = Path(__file__).resolve().parent.parent


class Check:
    """A named suite, the command that runs it, and what it covers."""

    def __init__(self, name: str, cwd: str, cmd: list[str], why: str,
                 needs: list[str] | None = None):
        self.name = name
        self.cwd = cwd
        self.cmd = cmd
        self.why = why
        self.needs = needs or []

    def missing_prereq(self) -> str | None:
        for path in self.needs:
            if not (REPO_ROOT / path).exists():
                return path
        return None


# Ordered cheapest-first, so a lint typo fails before a 4-minute e2e run.
CHECKS = {
    "backend:seams": Check(
        "backend:seams", "backend", ["sh", "-c", r"! grep -rn 'monkeypatch\.setattr(review' tests --include='test_*.py' | grep ."],
        "pytest suites inject engine/book seams, never monkeypatch review", []),
    "lint:css": Check(
        "lint:css", "frontend", ["yarn", "lint:css"],
        "CSS token rules", ["frontend/node_modules"]),
    "lint": Check(
        "lint", "frontend", ["yarn", "lint"],
        "eslint", ["frontend/node_modules"]),
    "test": Check(
        "test", "frontend", ["yarn", "test"],
        "vitest unit tests", ["frontend/node_modules"]),
    "build": Check(
        "build", "frontend", ["yarn", "build"],
        "tsc typecheck + vite build", ["frontend/node_modules"]),
    "pytest": Check(
        "pytest", "backend", ["venv/bin/python", "-m", "pytest", "tests/", "-q"],
        "backend unit tests", ["backend/venv/bin/python"]),
    "e2e": Check(
        "e2e", "e2e", ["yarn", "e2e"],
        "user-visible behaviour", ["e2e/node_modules"]),
}

# Path prefix -> checks it implicates. First match wins per file, so order
# generic backend/ rule.
ROUTES: list[tuple[str, list[str]]] = [
    ("AGENTS.md", []),
    ("backend/AGENTS.md", []),
    ("frontend/AGENTS.md", []),
    ("docker/AGENTS.md", []),
    ("README.md", []),
    ("backend/tests/", ["backend:seams"]),
    ("backend/config.py", ["pytest"]),
    ("backend/review/", ["pytest"]),
    ("backend/", ["pytest"]),
    ("frontend/src/", ["lint:css", "lint", "test", "build", "e2e"]),
    ("frontend/", ["lint", "test", "build"]),
    ("e2e/", ["e2e"]),
    ("docker/", []),
    ("scripts/", []),
]

# Unrouted files with these suffixes change nothing runnable; any other
# unrouted path is loud (see plan()'s unrouted list). A routed .md still runs
# its checks -- the markdown an agent loads has a size budget.
INERT_SUFFIXES = (".md", ".txt", ".gitignore")


def changed_files(base: str | None) -> list[str]:
    """Working-tree changes, or everything since `base` if given."""
    if base:
        cmd = ["git", "diff", "--name-only", f"{base}...HEAD"]
    else:
        # Staged + unstaged + untracked, so a brand-new component counts.
        cmd = ["git", "status", "--porcelain"]
    out = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True).stdout
    if base:
        return [line.strip() for line in out.splitlines() if line.strip()]
    files = []
    for line in out.splitlines():
        if not line.strip():
            continue
        path = line[3:].strip()
        # Renames read as "old -> new"; the new path is what matters.
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        files.append(path)
    return files


def plan(files: list[str]) -> tuple[list[str], list[str]]:
    """Map changed files to check names. Returns (checks, unrouted files)."""
    selected: list[str] = []
    unrouted: list[str] = []
    for f in files:
        for prefix, checks in ROUTES:
            if f.startswith(prefix):
                for c in checks:
                    if c not in selected:
                        selected.append(c)
                break
        else:
            if not f.endswith(INERT_SUFFIXES):
                unrouted.append(f)
    # Preserve CHECKS' cheapest-first ordering rather than discovery order.
    return [name for name in CHECKS if name in selected], unrouted


def run_check(check: Check) -> tuple[str, float, str]:
    """Run one check. Returns (outcome, seconds, detail)."""
    missing = check.missing_prereq()
    if missing:
        return "SKIP", 0.0, f"{missing} not present"
    if not shutil.which(check.cmd[0]) and not (REPO_ROOT / check.cwd / check.cmd[0]).exists():
        return "SKIP", 0.0, f"{check.cmd[0]} not found"

    start = time.time()
    proc = subprocess.run(check.cmd, cwd=REPO_ROOT / check.cwd,
                          capture_output=True, text=True)
    elapsed = time.time() - start
    if proc.returncode == 0:
        return "PASS", elapsed, ""
    # Tails only: the agent asked which suite broke, and can re-run the one
    # command to see all of it. Dumping four full suites is how a real failure
    # gets lost in the scroll.
    tail = (proc.stdout + proc.stderr).strip().splitlines()
    return "FAIL", elapsed, "\n".join(tail[-25:])


def run_all(names: list[str], jobs: int):
    """Yield `(name, result)` in PLAN order, whatever order they finish in.

    Reporting order is the plan's cheapest-first order even when the runs are
    concurrent, so two preflight outputs of the same change are diffable. The
    price is that a lane finishing early stays quiet until its predecessors
    land -- worth it for a report that reads the same every time."""
    if jobs <= 1:
        for name in names:
            yield name, run_check(CHECKS[name])
        return
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        # Threads, not processes: each one only waits on a subprocess.
        futures = [(name, pool.submit(run_check, CHECKS[name])) for name in names]
        for name, future in futures:
            yield name, future.result()


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Run the checks that cover what changed.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--base", metavar="REF",
                    help="check everything changed since REF instead of the working tree")
    ap.add_argument("--all", action="store_true", help="run every check")
    ap.add_argument("--list", action="store_true", help="print the plan and exit")
    ap.add_argument("--only", metavar="NAMES",
                    help="comma-separated subset (" + ",".join(CHECKS) + ")")
    ap.add_argument("--jobs", type=int, default=DEFAULT_JOBS, metavar="N",
                    help=f"concurrent lanes (default {DEFAULT_JOBS}; 1 = serial)")
    ap.add_argument("--serial", dest="jobs", action="store_const", const=1,
                    help="one check at a time, cheapest first")
    args = ap.parse_args()

    unrouted: list[str] = []
    if args.all:
        names, source = list(CHECKS), "--all"
    elif args.only:
        names = [n.strip() for n in args.only.split(",")]
        bad = [n for n in names if n not in CHECKS]
        if bad:
            print(f"error: unknown check(s): {', '.join(bad)}", file=sys.stderr)
            return 2
        names, source = [n for n in CHECKS if n in names], "--only"
    else:
        files = changed_files(args.base)
        if not files:
            print("no changes detected — nothing to check", file=sys.stderr)
            return 0
        names, unrouted = plan(files)
        source = f"{len(files)} changed file(s)"

    if unrouted:
        # An unmapped path means ROUTES has a hole. Better to say so than to
        # report a clean run that covered less than the reader assumes.
        print(f"! {len(unrouted)} changed path(s) match no route — coverage unknown:",
              file=sys.stderr)
        for f in unrouted[:10]:
            print(f"    {f}", file=sys.stderr)

    if not names:
        print(f"{source}: no suite covers these changes", file=sys.stderr)
        return 1 if unrouted else 0

    print(f"{source} → {len(names)} check(s): {', '.join(names)}", file=sys.stderr)
    if args.list:
        for n in names:
            print(f"    {n:12} {CHECKS[n].why}  ({CHECKS[n].cwd}: {' '.join(CHECKS[n].cmd)})")
        return 0

    failed, skipped = [], []
    started = time.time()
    for name, (outcome, elapsed, detail) in run_all(names, args.jobs):
        check = CHECKS[name]
        stamp = f"{elapsed:5.1f}s" if elapsed else "     "
        print(f"  {outcome:4} {stamp}  {name:12} {check.why}", file=sys.stderr)
        if outcome == "FAIL":
            failed.append(name)
            print(detail, file=sys.stderr)
        elif outcome == "SKIP":
            skipped.append((name, detail))
    if args.jobs > 1 and len(names) > 1:
        print(f"  ---- {time.time() - started:5.1f}s  wall clock "
              f"({args.jobs} lanes)", file=sys.stderr)

    if skipped:
        print("\nSKIPPED — these surfaces are UNVERIFIED, not clean:", file=sys.stderr)
        for name, why in skipped:
            print(f"    {name}: {why}", file=sys.stderr)

    if failed:
        print(f"\n{len(failed)} check(s) FAILED: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"\nall {len(names) - len(skipped)} check(s) passed"
          + (f", {len(skipped)} skipped" if skipped else ""), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
