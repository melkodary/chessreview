"""Phase 1: the worker queue — submit, dedup, one-engine lock, cancel."""
import threading
import time

import pytest

from review_jobs import store as store_mod
from review_jobs import queue as queue_mod

PGN = '[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 *'


def _wait(predicate, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


@pytest.fixture
def q():
    return queue_mod.ReviewQueue(store_mod.ephemeral_store())


def _seed(store, pgn_hash, *, status, moves=None):
    """Insert a job and drive it to `status` for boot-sweep tests.

    Walks the real status transitions rather than assigning the field: the
    store hands back a row-built `ReviewJob`, so mutating it changes nothing
    (it aliased live state only under the dict store this replaced).
    """
    job = store.create(
        source="chess.com", pgn=PGN, depth=22, multipv=3, pgn_hash=pgn_hash,
        white="Alice", black="Bob", total_plies=3,
    )
    if status == "queued":
        return job
    store.mark_running(job.id)
    for move in moves or ():
        store.append_move(job.id, move)
    if status == "done":
        store.finish(job.id, {})
    elif status != "running":
        raise ValueError(f"_seed cannot reach {status!r}")
    return job


def _fast_runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
    """Two moves then a summary, cancel-responsive."""
    for i in (1, 2):
        if cancel_event.is_set():
            return
        yield {"type": "move", "data": {"ply": i, "san": "e4"}}
    yield {"type": "summary", "data": {"accuracy": {"white": 90.0}}}


def test_submit_creates_queued_job_and_returns_id(q, monkeypatch):
    # Gate the runner so we can observe the queued/running handoff deterministically.
    gate = threading.Event()

    def runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        gate.wait(2.0)
        yield {"type": "summary", "data": {}}

    monkeypatch.setattr(queue_mod, "review_stream", runner)
    job = q.submit(PGN, depth=22, multipv=3)
    assert job.id
    assert job.status in ("queued", "running")
    assert job.white == "Alice"
    assert job.black == "Bob"
    assert job.total_plies == 3
    gate.set()


def test_worker_runs_to_done_persisting_moves_and_summary(q, monkeypatch):
    monkeypatch.setattr(queue_mod, "review_stream", _fast_runner)
    job = q.submit(PGN, depth=22, multipv=3)
    assert _wait(lambda: q.store.get(job.id).status == "done")
    done = q.store.get(job.id)
    assert [m["ply"] for m in done.moves] == [1, 2]
    assert done.summary == {"accuracy": {"white": 90.0}}
    assert done.finished_at is not None


def test_worker_persists_observed_engine_before_result(q, monkeypatch):
    def runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        yield {"type": "engine", "data": {"engine": "Stockfish 19"}}
        yield {"type": "summary", "data": {}}

    monkeypatch.setattr(queue_mod, "review_stream", runner)
    job = q.submit(PGN, depth=22, multipv=3)
    assert _wait(lambda: q.store.get(job.id).status == "done")
    assert q.store.get(job.id).engine == "Stockfish 19"


def test_dedup_returns_existing_job_no_second_thread(q, monkeypatch):
    monkeypatch.setattr(queue_mod, "review_stream", _fast_runner)
    a = q.submit(PGN, depth=22, multipv=3)
    assert _wait(lambda: q.store.get(a.id).status == "done")
    b = q.submit(PGN, depth=22, multipv=3)
    assert b.id == a.id
    assert len(q.store.list()) == 1


def test_force_bypasses_dedup(q, monkeypatch):
    monkeypatch.setattr(queue_mod, "review_stream", _fast_runner)
    a = q.submit(PGN, depth=22, multipv=3)
    assert _wait(lambda: q.store.get(a.id).status == "done")
    b = q.submit(PGN, depth=22, multipv=3, force=True)
    assert b.id != a.id
    assert len(q.store.list()) == 2


def test_invalid_pgn_raises(q):
    with pytest.raises(ValueError):
        q.submit("not a pgn", depth=22, multipv=3)


def test_cancel_running_marks_canceled(q, monkeypatch):
    def slow(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        for i in range(1, 100):
            if cancel_event.is_set():
                return
            yield {"type": "move", "data": {"ply": i}}
            time.sleep(0.01)
        yield {"type": "summary", "data": {}}

    monkeypatch.setattr(queue_mod, "review_stream", slow)
    job = q.submit(PGN, depth=22, multipv=3)
    assert _wait(lambda: q.store.get(job.id).status == "running")
    q.cancel(job.id)
    assert _wait(lambda: q.store.get(job.id).status == "canceled")


def test_cancel_suppresses_late_worker_results(q, monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def inflight(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        started.set()
        release.wait(2.0)
        yield {"type": "move", "data": {"ply": 1}}
        yield {"type": "summary", "data": {}}

    monkeypatch.setattr(queue_mod, "review_stream", inflight)

    job = q.submit(PGN, depth=22, multipv=3)
    assert started.wait(1)
    q.cancel(job.id)
    release.set()
    assert _wait(lambda: job.id not in q._events)

    assert q.store.get(job.id).status == "canceled"
    assert q.store.get(job.id).moves == []


def test_cancel_terminal_deletes_row(q, monkeypatch):
    monkeypatch.setattr(queue_mod, "review_stream", _fast_runner)
    job = q.submit(PGN, depth=22, multipv=3)
    assert _wait(lambda: q.store.get(job.id).status == "done")
    q.cancel(job.id)
    assert q.store.get(job.id) is None


def test_boot_sweep_requeues_running_and_spawns_queued(monkeypatch):
    """running rows requeued (moves cleared) + spawned, queued rows spawned,
    terminal rows left alone. `_spawn` stubbed to just record ids."""
    store = store_mod.ephemeral_store()
    q = queue_mod.ReviewQueue(store)

    running = _seed(store, "run", status="running", moves=[{"ply": 1}])
    queued = _seed(store, "que", status="queued")
    done = _seed(store, "don", status="done")

    spawned = []
    monkeypatch.setattr(q, "_spawn", lambda job: spawned.append(job.id))

    q.boot_sweep()

    assert set(spawned) == {running.id, queued.id}  # done not respawned
    refetched = store.get(running.id)
    assert refetched.status == "queued"
    assert refetched.moves == []  # restart-from-0
    assert store.get(done.id).status == "done"  # untouched


def test_engine_lock_serializes_two_submits(q, monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def blocking(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        started.set()
        release.wait(2.0)
        yield {"type": "summary", "data": {}}

    monkeypatch.setattr(queue_mod, "review_stream", blocking)
    a = q.submit(PGN, depth=22, multipv=3)
    assert _wait(lambda: q.store.get(a.id).status == "running")
    b = q.submit(PGN, depth=22, multipv=3, force=True)
    # b cannot run while a holds the single engine lock
    time.sleep(0.1)
    assert q.store.get(b.id).status == "queued"
    release.set()
    assert _wait(lambda: q.store.get(a.id).status == "done")
    assert _wait(lambda: q.store.get(b.id).status == "done")
