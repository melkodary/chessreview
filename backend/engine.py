import os
import queue as _queue
import threading
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

import chess
import chess.engine

from config import (
    ACTIVE_ENGINE_SPEC,
    EngineSpec,
    STOCKFISH_REVIEW_POOL_SIZE,
    STOCKFISH_INTERACTIVE_POOL_SIZE,
)

# Interactive analyze runs client-side (in-browser WASM Stockfish); only the
# batch review engine lives here — and it is a short-lived per-review pool, not
# a shared singleton. See the parallel-pool and client-WASM design specs.


def observed_engine_name(engine) -> str:
    """Engine-reported UCI `id name`, never a configured label."""
    name = (getattr(engine, "id", None) or {}).get("name")
    if not isinstance(name, str) or not name.strip():
        raise RuntimeError("review engine did not report a UCI id name")
    return name.strip()


def _spawn_engine(
    spec: EngineSpec,
    *,
    spawn=None,
) -> chess.engine.SimpleEngine:
    path = Path(spec.path).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(
            f"STOCKFISH_PATH={path} does not exist for REVIEW_ENGINE={spec.id!r}"
        )

    popen = spawn or chess.engine.SimpleEngine.popen_uci
    engine = popen(str(path))
    try:
        observed = observed_engine_name(engine)
        if not observed.startswith(spec.expects):
            raise RuntimeError(
                f"REVIEW_ENGINE={spec.id!r} expected UCI id name starting with "
                f"{spec.expects!r}, but {path} reported {observed!r}"
            )
        engine.configure(dict(spec.options))
        return engine
    except BaseException:
        try:
            engine.quit()
        except Exception:
            pass
        raise


def _spec_with_option_overrides(
    spec: EngineSpec,
    *,
    threads: int | None,
    hash_mb: int | None,
) -> EngineSpec:
    if threads is None and hash_mb is None:
        return spec
    options = dict(spec.options)
    if threads is not None:
        options["Threads"] = threads
    if hash_mb is not None:
        options["Hash"] = hash_mb
    return replace(spec, options=options)


# ── Per-review engine pool ──────────────────────────────────────────────────
# A review spawns a short-lived pool of single-thread engines that analyse
# distinct positions in parallel (one owning worker thread per engine — no
# shared SimpleEngine, so the per-engine UCI stream is never touched
# concurrently). See the parallel-pool spec.
def resolve_pool_size(requested: int = STOCKFISH_REVIEW_POOL_SIZE) -> int:
    """Resolve the pool size: an explicit positive value wins; 0 ⇒ auto
    (cpu_count - 1), never below 1."""
    if requested and requested > 0:
        return requested
    return max(1, (os.cpu_count() or 2) - 1)


def spawn_review_pool(
    size: int | None = None,
    *,
    spec: EngineSpec | None = None,
    threads: int | None = None,
    hash_mb: int | None = None,
) -> list[chess.engine.SimpleEngine]:
    """Spawn a fresh pool of `size` engines (None ⇒ config/auto), each
    validated against the selected engine spec.

    `threads` / `hash_mb` remain test/back-compat overrides; production options
    come from the registry entry.
    """
    n = resolve_pool_size(STOCKFISH_REVIEW_POOL_SIZE if size is None else size)
    selected = _spec_with_option_overrides(
        spec or ACTIVE_ENGINE_SPEC, threads=threads, hash_mb=hash_mb
    )
    return [_spawn_engine(selected) for _ in range(n)]


def quit_pool(engines) -> None:
    """Quit every engine in the pool, best-effort (a dead engine must not
    block the rest from shutting down)."""
    for e in engines:
        try:
            e.quit()
        except Exception:
            pass


# ── Interactive grading pool ────────────────────────────────────────────────
# Deviation grading (POST /reviews/move) borrows from a FIXED, long-lived pool
# dedicated to it — separate from the per-review pools above, so a burst of
# grading can never starve a whole-game review. Concurrency is bounded *by
# construction*: a fixed engine does one search at a time, so N callers queue on
# a free engine rather than forking N Stockfish processes. This is the "not a
# fragile semaphore" containment — the ceiling is the pool, not a guessed count.
class InteractiveEnginePool:
    def __init__(
        self,
        size: int,
        threads: int | None = None,
        hash_mb: int | None = None,
        spawn=None,
        spec: EngineSpec | None = None,
    ):
        self._size = max(1, size)
        self._spec = _spec_with_option_overrides(
            spec or ACTIVE_ENGINE_SPEC, threads=threads, hash_mb=hash_mb
        )
        # Injectable raw spawn so tests exercise identity/configuration plus the
        # borrow/return/replace mechanics without monkeypatching.
        self._spawn = lambda: _spawn_engine(self._spec, spawn=spawn)
        self._idle: _queue.Queue = _queue.Queue()
        self._lock = threading.Lock()
        self._started = False
        self._engines: list = []

    def _ensure_started(self) -> None:
        with self._lock:
            if self._started:
                return
            for _ in range(self._size):
                eng = self._spawn()
                self._engines.append(eng)
                self._idle.put(eng)
            self._started = True

    @contextmanager
    def borrow(self, timeout: float | None = None):
        """Check out an engine (blocking up to `timeout`; raises
        queue.Empty when every engine is busy) and return it on the way out. A
        borrow that ends in an engine error returns a fresh replacement, not the
        possibly-dead engine."""
        self._ensure_started()
        eng = self._idle.get(timeout=timeout)
        ok = True
        try:
            yield eng
        except BaseException:
            ok = False
            raise
        finally:
            if ok:
                self._idle.put(eng)
            else:
                try:
                    eng.quit()
                except Exception:
                    pass
                replacement = self._spawn()
                self._engines.append(replacement)
                self._idle.put(replacement)

    def shutdown(self) -> None:
        with self._lock:
            quit_pool(self._engines)
            self._engines = []
            self._started = False
            try:
                while True:
                    self._idle.get_nowait()
            except _queue.Empty:
                pass


# Lazy module singleton — engines spawn on first grade, not at import (tests and
# the review path never pay for it). Guarded so concurrent first-callers build
# one pool.
_interactive_pool: InteractiveEnginePool | None = None
_interactive_lock = threading.Lock()


def interactive_pool() -> InteractiveEnginePool:
    global _interactive_pool
    if _interactive_pool is None:
        with _interactive_lock:
            if _interactive_pool is None:
                _interactive_pool = InteractiveEnginePool(
                    STOCKFISH_INTERACTIVE_POOL_SIZE,
                    spec=ACTIVE_ENGINE_SPEC,
                )
    return _interactive_pool


def shutdown_interactive_pool() -> None:
    """Quit the interactive pool if it was ever started (lifespan shutdown)."""
    global _interactive_pool
    with _interactive_lock:
        if _interactive_pool is not None:
            _interactive_pool.shutdown()
            _interactive_pool = None
