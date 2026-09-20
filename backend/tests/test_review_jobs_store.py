"""The store contract, asserted against the one implementation behind the seam.

Ran twice until 2026-07-28 — once per store class. There is now one `SqlStore`
on one SQLite configuration (`ephemeral_store()` differs from prod only in
where the file lives), so a second parametrization would re-run each test
against an identical setup rather than a different one.
"""
import threading
import time

import pytest
from sqlalchemy import update

from db import reviews
from review_jobs import store as store_mod


@pytest.fixture
def store_factory():
    """Return a factory that builds a fresh store with the given bounds."""
    return store_mod.ephemeral_store


@pytest.fixture
def store(store_factory):
    return store_factory()


def _create(store, pgn_hash="h1", **kw):
    params = dict(
        source="chess.com", pgn="1. e4 e5", depth=22, multipv=3,
        pgn_hash=pgn_hash, white="Alice", black="Bob", total_plies=2,
    )
    params.update(kw)
    return store.create(**params)


def test_create_returns_queued_job_with_id(store):
    job = _create(store)
    assert job.id
    assert job.status == "queued"
    assert job.white == "Alice"
    assert job.total_plies == 2
    assert job.moves == []
    assert job.summary is None
    assert job.created_at is not None
    assert job.finished_at is None


def test_create_persists_origin_coords(store):
    job = _create(store, user_id="alice", game_id="g42")
    fetched = store.get(job.id)
    assert fetched.user_id == "alice"
    assert fetched.game_id == "g42"


def test_get_returns_created_job(store):
    job = _create(store)
    assert store.get(job.id).id == job.id
    assert store.get("missing") is None


def test_list_newest_first(store):
    a = _create(store, pgn_hash="a")
    b = _create(store, pgn_hash="b")
    ids = [j.id for j in store.list()]
    assert ids == [b.id, a.id]


def test_dedup_lookup_finds_active_job_by_hash(store):
    job = _create(store, pgn_hash="dup")
    assert store.dedup_lookup("dup").id == job.id
    assert store.dedup_lookup("nope") is None


def test_dedup_lookup_ignores_canceled_and_error(store):
    job = _create(store, pgn_hash="dup")
    store.mark_canceled(job.id)
    assert store.dedup_lookup("dup") is None


# ── Dedupe ordering: a backend review satisfies a frontend request, never the
# reverse. NULL engine_source (a row older than the split) is a backend row.

def _create_sourced(store, engine_source, pgn_hash="dup"):
    if engine_source == "frontend":
        return store.create_done(
            source="chess.com", pgn="1. e4 e5", depth=22, multipv=3, pgn_hash=pgn_hash,
            white="Alice", black="Bob", total_plies=2, moves=[], summary={},
            engine="Stockfish 19", engine_source="frontend",
        )
    job = _create(store, pgn_hash=pgn_hash)
    if engine_source is None:
        with store.engine.begin() as conn:
            conn.execute(update(reviews).where(reviews.c.id == job.id).values(engine_source=None))
    return job


@pytest.mark.parametrize("stored, requested, satisfied", [
    ("backend", "backend", True),
    ("backend", "frontend", True),
    ("frontend", "frontend", True),
    ("frontend", "backend", False),
    (None, "backend", True),   # pre-split row reads as backend
    (None, "frontend", True),
])
def test_dedup_lookup_orders_by_engine_source(store, stored, requested, satisfied):
    job = _create_sourced(store, stored)
    found = store.dedup_lookup("dup", requested)
    assert (found.id if found else None) == (job.id if satisfied else None)


def test_dedup_lookup_prefers_a_backend_row_over_a_newer_frontend_row(store):
    backend = _create_sourced(store, "backend")
    _create_sourced(store, "frontend")
    assert store.dedup_lookup("dup", "frontend").id == backend.id
    assert store.dedup_lookup("dup", "backend").id == backend.id


def test_dedup_lookup_default_is_a_backend_request(store):
    _create_sourced(store, "frontend")
    assert store.dedup_lookup("dup") is None


def test_create_stamps_backend_source_by_default(store):
    job = _create(store)
    assert job.engine_source == "backend"
    assert store.get(job.id).engine_source == "backend"


def test_create_done_persists_a_finished_frontend_review(store):
    job = _create_sourced(store, "frontend")
    row = store.get(job.id)
    assert (row.status, row.engine_source, row.engine) == ("done", "frontend", "Stockfish 19")
    assert row.finished_at is not None
    assert not store.mark_running(job.id)  # never a worker's row


def test_mark_running_then_append_then_finish(store):
    job = _create(store)
    store.mark_running(job.id)
    assert store.get(job.id).status == "running"
    assert store.set_engine(job.id, "Stockfish 19")
    assert store.get(job.id).engine == "Stockfish 19"
    store.append_move(job.id, {"ply": 1, "san": "e4"})
    store.append_move(job.id, {"ply": 2, "san": "e5"})
    assert len(store.get(job.id).moves) == 2
    store.finish(job.id, {"accuracy": {"white": 95.0}})
    done = store.get(job.id)
    assert done.status == "done"
    assert done.summary == {"accuracy": {"white": 95.0}}
    assert done.finished_at is not None


def test_new_jobs_have_unknown_engine_until_worker_observes_it(store):
    job = _create(store)
    assert job.engine is None
    assert store.get(job.id).engine is None


def test_init_db_adds_engine_to_legacy_reviews_table(tmp_path):
    from sqlalchemy import inspect

    from db import init_db, make_engine

    engine = make_engine(f"sqlite:///{tmp_path}/legacy.db")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE reviews (seq INTEGER PRIMARY KEY AUTOINCREMENT)"
        )
    init_db(engine)
    assert {"engine", "engine_source"} <= {
        column["name"] for column in inspect(engine).get_columns("reviews")
    }


def test_fail_sets_error(store):
    job = _create(store)
    store.mark_running(job.id)
    store.fail(job.id, "engine died")
    failed = store.get(job.id)
    assert failed.status == "error"
    assert failed.error == "engine died"
    assert failed.finished_at is not None


def test_cancel_is_terminal_against_inflight_worker_writes(store):
    job = _create(store)
    assert store.mark_running(job.id)
    assert store.mark_canceled(job.id)

    assert not store.append_move(job.id, {"ply": 1})
    assert not store.finish(job.id, {"ok": True})
    assert not store.fail(job.id, "late engine error")
    assert store.get(job.id).status == "canceled"


def test_sql_append_move_treats_json_null_as_empty(tmp_path):
    from sqlalchemy import update

    from db import init_db, make_engine, reviews

    engine = make_engine(f"sqlite:///{tmp_path}/legacy_null.db")
    init_db(engine)
    store = store_mod.SqlStore(engine)
    job = _create(store)
    assert store.mark_running(job.id)
    with engine.begin() as conn:
        conn.execute(update(reviews).where(reviews.c.id == job.id).values(moves=None))

    assert store.append_move(job.id, {"ply": 1, "san": "e4"})
    assert store.get(job.id).moves == [{"ply": 1, "san": "e4"}]


def test_job_fields_and_table_columns_are_the_same_names():
    """`create` inserts `asdict(job)` and `_row_to_job` splats the row back, so
    the two name sets must agree exactly. Adding a column without its field (or
    vice versa) otherwise fails as an opaque TypeError from a store call rather
    than here, naming the mismatch."""
    import dataclasses

    from db import reviews

    fields = {f.name for f in dataclasses.fields(store_mod.ReviewJob)}
    columns = {c.name for c in reviews.columns} - {"seq"}
    assert fields == columns


def test_delete_removes_row(store):
    job = _create(store)
    store.delete(job.id)
    assert store.get(job.id) is None


def test_appends_survive_concurrent_readers(store):
    """`append_move` read-modify-writes the whole blob, and its safety rests on
    each thread holding its OWN connection — the production shape, where a
    worker writes plies while request threads serve GET /reviews/{id}.

    Regression guard for the 2026-07-28 `:memory:` attempt: `StaticPool` shares
    one connection, so writer and readers shared transaction state and 25 of
    300 appends vanished while every call still returned True. Nothing else in
    this suite exercises the two together, so the loss was silent.
    """
    job = _create(store)
    assert store.mark_running(job.id)
    appends, readers, failures = 120, 3, []

    def write():
        for ply in range(appends):
            if not store.append_move(job.id, {"ply": ply}):
                failures.append(f"append_move returned False at ply {ply}")

    def read():
        for _ in range(appends):
            fetched = store.get(job.id)
            if fetched is None:
                failures.append("get() returned None for an existing row")

    threads = [threading.Thread(target=write)]
    threads += [threading.Thread(target=read) for _ in range(readers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert failures == []
    assert [m["ply"] for m in store.get(job.id).moves] == list(range(appends))


# ── boot-recovery helpers ─────────────────────────────────────────────────────
def test_running_and_queued_jobs_filter_by_status(store):
    a = _create(store, pgn_hash="a")  # stays queued
    b = _create(store, pgn_hash="b")
    store.mark_running(b.id)
    assert [j.id for j in store.queued_jobs()] == [a.id]
    assert [j.id for j in store.running_jobs()] == [b.id]


def test_requeue_clears_moves_and_resets_to_queued(store):
    job = _create(store)
    store.mark_running(job.id)
    store.set_engine(job.id, "Stockfish 19")
    store.append_move(job.id, {"ply": 1, "san": "e4"})
    store.requeue(job.id)
    refetched = store.get(job.id)
    assert refetched.status == "queued"
    assert refetched.moves == []
    assert refetched.engine is None
    assert refetched.finished_at is None


# ── TTL sweep + StoreFull parity ──────────────────────────────────────────────
def test_full_store_all_terminal_fresh_raises_store_full(store_factory):
    store = store_factory(maxsize=1, ttl_hours=24)
    a = _create(store, pgn_hash="a")
    store.mark_running(a.id)
    store.finish(a.id, {"ok": True})  # terminal, but well within ttl_hours
    with pytest.raises(store_mod.StoreFull):
        _create(store, pgn_hash="b")
    assert [j.id for j in store.list()] == [a.id]  # protected, not evicted


def test_full_store_terminal_past_ttl_sweeps_and_inserts(store_factory):
    # ttl_hours=0 → any already-finished row is immediately reclaimable, portable
    # across both stores without mutating finished_at behind the store's back.
    store = store_factory(maxsize=1, ttl_hours=0)
    a = _create(store, pgn_hash="a")
    store.mark_running(a.id)
    store.finish(a.id, {"ok": True})
    time.sleep(0.01)  # ensure finished_at < now
    b = _create(store, pgn_hash="b")
    assert {j.id for j in store.list()} == {b.id}


def test_not_full_store_still_sweeps_expired_on_insert(store_factory):
    store = store_factory(maxsize=10, ttl_hours=0)
    a = _create(store, pgn_hash="a")
    store.mark_running(a.id)
    store.finish(a.id, {"ok": True})
    time.sleep(0.01)
    b = _create(store, pgn_hash="b")
    assert {j.id for j in store.list()} == {b.id}  # retention, not just eviction


def test_full_store_active_jobs_never_swept_raises_store_full(store_factory):
    store = store_factory(maxsize=1, ttl_hours=0)
    a = _create(store, pgn_hash="a")  # queued = active
    with pytest.raises(store_mod.StoreFull):
        _create(store, pgn_hash="b")  # nothing active is evictable
    assert [j.id for j in store.list()] == [a.id]
