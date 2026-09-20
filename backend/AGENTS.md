# Backend rules

Binds anything under `backend/` — FastAPI app, engine wrapper, the `review/` package,
config, tests. Repo-wide rules stay in the root `AGENTS.md`.

- **Engine analysis takes a `chess.Board` object, not a FEN string.** Parse FEN in the endpoint, pass the board (`analyze_stream` / `_analyse_position`). The non-streaming `analyze()` wrapper was removed.
- **`backend/review/` is a package**: orchestration in `__init__`, leaf logic in `winchance` / `hanging` / `classify` / `summary`; `import review` surface preserved via re-exports. The engine + opening seams are **injected** (`review_stream`/`_run_review` take `engine_factory` / `book_walk`) — pytest suites pass fakes, never `monkeypatch.setattr(review, …)`. *preflight-enforced (`backend:seams`).*
- **Don't bypass engine locks.** `_analyse_lock` / `_review_analyse_lock` serialize Stockfish calls; cache locks guard the LRUs. No async in engine code. **Sanctioned exception:** the per-review parallel pool (`review._ParallelAnalyser`) does not take a global lock — each pooled engine has exactly one owning worker thread, so no `SimpleEngine` is touched concurrently and the lock's invariant holds per-engine. Wrapping that path would re-serialize it and erase the win. The rule still binds anywhere an engine is shared between threads.
- **`Infinity` not valid JSON.** Mate scores go in `Line.mate: int | None`. `Line.evaluation` stays finite (±99.99 sentinel).
- **Backend config** (the mechanics of the root `CLAUDE.md` "tunable constants belong in config" rule): a `Settings` field in `backend/config.py` with a one-line `Field(description=...)`; the description renders into `python -m config --dump-env`, so it must read as env-file documentation. **Tests load no env file** (`backend/conftest.py` sets `CHESSREVIEW_NO_DOTENV`), so they always run on the code defaults — never add a test env file.
