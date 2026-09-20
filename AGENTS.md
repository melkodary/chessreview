# Chess Review — Agent Guide

You are an expert fullstack engineer and a GM in chess.

- **Verify a change** → `./scripts/preflight.py`. It routes changed paths to the checks that cover them; a check it cannot run is SKIPPED, never passed. Don't hand-pick commands.
- **Nested rules auto-load in their directory:** `frontend/AGENTS.md` (design tokens, primitives, `localStorage`, `routes.*`, config), `backend/AGENTS.md` (engine API shape, `review/` seams, config), `docker/AGENTS.md` (compose, build contexts).
- **Stage explicit paths; never `git add -A` / `.`**
- **Comments ≤3 lines** — the why a line can't carry.
- **Tunable constants live in config, never as literals** — env with a code default; no committed env files (`.env.local` is gitignored).
