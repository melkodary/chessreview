import queue
import threading

import pytest

from engine import InteractiveEnginePool
from config import EngineSpec


class FakeEngine:
    def __init__(self, n):
        self.n = n
        self.id = {"name": "Stockfish 19"}
        self.config = None
        self.quit_called = False
    def configure(self, options): self.config = options
    def quit(self): self.quit_called = True


def _spec(tmp_path):
    path = tmp_path / "stockfish"
    path.touch(exist_ok=True)
    return EngineSpec(
        id="test", path=str(path),
        options={"Threads": 1, "Hash": 1},
        expects="Stockfish 19",
    )


def _counting_spawn():
    c = {"n": 0}
    def spawn(_path):
        c["n"] += 1
        return FakeEngine(c["n"])
    return spawn, c


def test_borrow_returns_engine_to_the_pool(tmp_path):
    spawn, c = _counting_spawn()
    pool = InteractiveEnginePool(size=1, spawn=spawn, spec=_spec(tmp_path))
    with pool.borrow() as e1:
        first = e1
    with pool.borrow() as e2:
        # Same single engine reused — not respawned per call.
        assert e2 is first
    assert c["n"] == 1  # spawned exactly once (at pool start)


def test_pool_bounds_concurrency_to_its_size(tmp_path):
    spawn, _ = _counting_spawn()
    pool = InteractiveEnginePool(size=1, spawn=spawn, spec=_spec(tmp_path))
    # Hold the only engine, then a second borrow must block until released.
    held = threading.Event()
    release = threading.Event()

    def worker():
        with pool.borrow():
            held.set()
            release.wait(timeout=2)

    t = threading.Thread(target=worker)
    t.start()
    assert held.wait(timeout=2)
    # Engine is checked out → a borrow with no wait time raises Empty.
    with pytest.raises(queue.Empty):
        with pool.borrow(timeout=0.05):
            pass
    release.set()
    t.join(timeout=2)
    # Once released, the engine is available again.
    with pool.borrow(timeout=1):
        pass


def test_borrow_that_errors_replaces_the_engine(tmp_path):
    spawn, c = _counting_spawn()
    pool = InteractiveEnginePool(size=1, spawn=spawn, spec=_spec(tmp_path))
    with pytest.raises(RuntimeError):
        with pool.borrow() as e:
            first = e
            raise RuntimeError("engine crashed mid-search")
    assert first.quit_called  # the possibly-dead engine was quit
    with pool.borrow() as e2:
        assert e2 is not first  # a fresh replacement is in the pool
        replacement = e2
    assert c["n"] == 2  # one at start + one replacement
    pool.shutdown()
    assert replacement.quit_called


def test_shutdown_quits_all_engines(tmp_path):
    spawn, _ = _counting_spawn()
    pool = InteractiveEnginePool(size=2, spawn=spawn, spec=_spec(tmp_path))
    with pool.borrow():
        pass  # force start (spawns both)
    engines = list(pool._engines)
    assert len(engines) == 2
    pool.shutdown()
    assert all(e.quit_called for e in engines)
