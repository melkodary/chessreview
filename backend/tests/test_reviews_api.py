"""Tests for the persistent /reviews REST surface."""
import threading
import time

import pytest

import main
from review_jobs import queue as queue_mod
from review_jobs import store as store_mod

PGN = '[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 *'


def _fast_runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
    for i in (1, 2):
        if cancel_event.is_set():
            return
        yield {"type": "move", "data": {"ply": i, "san": "e4"}}
    yield {
        "type": "summary",
        "data": {
            "white": {"accuracy": 90.0, "counts": {"best": 1, "great": 1}},
            "black": {"accuracy": 81.0, "counts": {"blunder": 1}},
        },
    }


@pytest.fixture(autouse=True)
def fresh_queue(monkeypatch):
    monkeypatch.setattr(queue_mod, "review_stream", _fast_runner)
    monkeypatch.setattr(
        main, "review_queue", queue_mod.ReviewQueue(store_mod.ephemeral_store())
    )


def _wait_for(predicate, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def _wait_done(client, job_id, timeout=2.0):
    return _wait_for(
        lambda: client.get(f"/reviews/{job_id}").json()["status"] == "done",
        timeout,
    )


def test_post_reviews_creates_queued_job(client):
    r = client.post("/reviews", json={"pgn": PGN})
    assert r.status_code == 201
    body = r.json()
    assert body["id"]
    assert body["status"] in ("queued", "running", "done")


def test_post_invalid_pgn_returns_422(client):
    r = client.post("/reviews", json={"pgn": "garbage"})
    assert r.status_code == 422


def test_get_review_returns_full_row_with_moves_and_summary(client):
    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_done(client, job_id)
    body = client.get(f"/reviews/{job_id}").json()
    assert body["status"] == "done"
    assert [m["ply"] for m in body["moves"]] == [1, 2]
    assert body["summary"] == {
        "white": {"accuracy": 90.0, "counts": {"best": 1, "great": 1}},
        "black": {"accuracy": 81.0, "counts": {"blunder": 1}},
    }


def test_get_review_returns_persisted_running_progress(client, monkeypatch):
    release = threading.Event()

    def runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        yield {"type": "move", "data": {"ply": 1, "san": "e4"}}
        release.wait(2.0)
        if not cancel_event.is_set():
            yield {"type": "summary", "data": {"accuracy": {"white": 90.0}}}

    monkeypatch.setattr(queue_mod, "review_stream", runner)
    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    try:
        assert _wait_for(
            lambda: len(main.review_queue.store.get(job_id).moves) == 1
        )
        body = client.get(f"/reviews/{job_id}").json()
        assert body["status"] == "running"
        assert body["moves"] == [{"ply": 1, "san": "e4"}]
        assert body["summary"] is None
        assert body["error"] is None
    finally:
        release.set()


def test_get_review_returns_persisted_error(client, monkeypatch):
    def runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        raise RuntimeError("engine died")
        yield

    monkeypatch.setattr(queue_mod, "review_stream", runner)
    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_for(
        lambda: main.review_queue.store.get(job_id).status == "error"
    )

    body = client.get(f"/reviews/{job_id}").json()
    assert body["status"] == "error"
    assert body["error"] == "engine died"
    assert body["summary"] is None


def test_get_review_returns_persisted_cancellation(client, monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        started.set()
        release.wait(2.0)
        if not cancel_event.is_set():
            yield {"type": "summary", "data": {}}

    monkeypatch.setattr(queue_mod, "review_stream", runner)
    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    try:
        assert started.wait(1.0)
        assert client.delete(f"/reviews/{job_id}").status_code == 204
        body = client.get(f"/reviews/{job_id}").json()
        assert body["status"] == "canceled"
        assert body["summary"] is None
        assert body["error"] is None
    finally:
        release.set()


def test_get_missing_review_returns_404(client):
    assert client.get("/reviews/nope").status_code == 404


def test_inbox_lists_jobs_without_moves_array(client):
    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_done(client, job_id)
    inbox = client.get("/reviews").json()
    assert len(inbox) == 1
    row = inbox[0]
    assert row["id"] == job_id
    assert row["white"] == "Alice"
    assert row["reviewed"] == 2  # len(moves), computed
    assert row["total_plies"] == 3
    assert "moves" not in row


def test_inbox_carries_game_coords_for_deep_link(client):
    job_id = client.post(
        "/reviews",
        json={"pgn": PGN, "source": "lichess", "user_id": "alice", "game_id": "42"},
    ).json()["id"]
    assert _wait_done(client, job_id)
    row = client.get("/reviews").json()[0]
    assert row["user_id"] == "alice"
    assert row["game_id"] == "42"


@pytest.mark.parametrize(
    ("user_id", "expected", "counts"),
    [
        ("ALICE", 90.0, {"best": 1, "great": 1}),
        ("bOb", 81.0, {"blunder": 1}),
        ("carol", None, None),
        (None, None, None),
    ],
)
def test_rest_accuracy_and_counts_are_player_relative(client, user_id, expected, counts):
    payload = {"pgn": PGN}
    if user_id is not None:
        payload["user_id"] = user_id
    job_id = client.post("/reviews", json=payload).json()["id"]
    assert _wait_done(client, job_id)

    for row in (client.get("/reviews").json()[0], client.get(f"/reviews/{job_id}").json()):
        assert row["accuracy"] == expected
        assert row["counts"] == counts


def test_rest_counts_null_for_legacy_summary_without_counts(client, monkeypatch):
    def runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        yield {"type": "summary", "data": {"white": {"accuracy": 90.0}}}

    monkeypatch.setattr(queue_mod, "review_stream", runner)
    job_id = client.post("/reviews", json={"pgn": PGN, "user_id": "alice"}).json()["id"]
    assert _wait_done(client, job_id)
    row = client.get("/reviews").json()[0]
    assert row["accuracy"] == 90.0
    assert row["counts"] is None


def test_user_id_persisted_and_filtered_case_insensitively(client):
    job_id = client.post(
        "/reviews",
        json={"pgn": PGN, "source": "lichess", "user_id": "Alice", "game_id": "42"},
    ).json()["id"]
    assert _wait_done(client, job_id)
    row = client.get("/reviews").json()[0]
    assert row["user_id"] == "alice"  # persisted lowercase regardless of input case
    assert {r["id"] for r in client.get("/reviews", params={"user_id": "ALICE"}).json()} == {job_id}


def test_inbox_carries_engine_config(client):
    job_id = client.post("/reviews", json={"pgn": PGN, "depth": 18, "multipv": 4}).json()["id"]
    assert _wait_done(client, job_id)
    row = client.get("/reviews").json()[0]
    assert row["depth"] == 18
    assert row["multipv"] == 4


def test_rest_rows_carry_observed_engine(client, monkeypatch):
    def runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        yield {"type": "engine", "data": {"engine": "Stockfish 19"}}
        yield {"type": "summary", "data": {"accuracy": {"white": 90.0}}}

    monkeypatch.setattr(queue_mod, "review_stream", runner)
    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_done(client, job_id)
    assert client.get(f"/reviews/{job_id}").json()["engine"] == "Stockfish 19"
    assert client.get("/reviews").json()[0]["engine"] == "Stockfish 19"


def test_rest_rows_carry_engine_source(client):
    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_done(client, job_id)
    assert client.get(f"/reviews/{job_id}").json()["engine_source"] == "backend"
    assert client.get("/reviews").json()[0]["engine_source"] == "backend"


def test_rest_rows_read_null_engine_source_as_backend(client):
    from sqlalchemy import update
    from db import reviews

    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_done(client, job_id)
    with main.review_queue.store.engine.begin() as conn:
        conn.execute(update(reviews).where(reviews.c.id == job_id).values(engine_source=None))
    assert client.get("/reviews").json()[0]["engine_source"] == "backend"
    assert client.get(f"/reviews/{job_id}").json()["engine_source"] == "backend"


def test_dedup_returns_same_job(client):
    a = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_done(client, a)
    b = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert b == a
    assert len(client.get("/reviews").json()) == 1


def test_force_creates_new_job(client):
    a = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_done(client, a)
    b = client.post("/reviews", json={"pgn": PGN, "force": True}).json()["id"]
    assert b != a
    assert len(client.get("/reviews").json()) == 2


def test_delete_done_job_removes_it(client):
    job_id = client.post("/reviews", json={"pgn": PGN}).json()["id"]
    assert _wait_done(client, job_id)
    assert client.delete(f"/reviews/{job_id}").status_code == 204
    assert client.get(f"/reviews/{job_id}").status_code == 404


def test_delete_missing_returns_404(client):
    assert client.delete("/reviews/nope").status_code == 404


def test_create_review_returns_429_when_store_full(client, monkeypatch):
    full_store = store_mod.ephemeral_store(maxsize=1, ttl_hours=24)
    job = full_store.create(
        source="lichess", pgn=PGN, depth=22, multipv=3,
        pgn_hash="occupied", white="A", black="B", total_plies=2,
    )
    full_store.finish(job.id, {"white": {"accuracy": 90.0}})  # terminal, fresh
    monkeypatch.setattr(main.review_queue, "store", full_store)
    r = client.post("/reviews", json={"pgn": PGN})
    assert r.status_code == 429


def test_create_review_rejects_overlong_meta_fields(client):
    import config
    too_long = "x" * (config.REVIEW_META_MAX_LENGTH + 1)
    r = client.post("/reviews", json={"pgn": PGN, "user_id": too_long})
    assert r.status_code == 422


def test_list_reviews_filters_by_source_and_user_id(client):
    a = client.post(
        "/reviews", json={"pgn": PGN, "source": "pgn", "user_id": "alice"},
    ).json()["id"]
    assert _wait_done(client, a)
    b = client.post(
        "/reviews", json={"pgn": PGN, "source": "lichess", "user_id": "bob", "force": True},
    ).json()["id"]
    assert _wait_done(client, b)

    assert {r["id"] for r in client.get("/reviews").json()} == {a, b}
    assert {r["id"] for r in client.get("/reviews", params={"source": "pgn"}).json()} == {a}
    assert {r["id"] for r in client.get("/reviews", params={"user_id": "bob"}).json()} == {b}
    assert client.get("/reviews", params={"source": "lichess", "user_id": "alice"}).json() == []


def test_list_reviews_filters_by_game_id(client):
    a = client.post(
        "/reviews", json={"pgn": PGN, "source": "lichess", "user_id": "alice", "game_id": "g1"},
    ).json()["id"]
    assert _wait_done(client, a)
    b = client.post(
        "/reviews", json={"pgn": PGN, "source": "lichess", "user_id": "alice", "game_id": "g2", "force": True},
    ).json()["id"]
    assert _wait_done(client, b)

    assert {r["id"] for r in client.get("/reviews", params={"game_id": "g1"}).json()} == {a}
    assert {r["id"] for r in client.get("/reviews", params={"game_id": "g2"}).json()} == {b}
    assert client.get("/reviews", params={"game_id": "nope"}).json() == []
    assert {r["id"] for r in client.get(
        "/reviews", params={"source": "lichess", "user_id": "alice", "game_id": "g1"},
    ).json()} == {a}
