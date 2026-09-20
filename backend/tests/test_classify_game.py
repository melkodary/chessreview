"""The whole-game frontend-eval feeder (POST /reviews `plies`): parity with the
engine path, the plan-vs-payload matching, and the fallbacks. Extends
tests/test_classify_move.py's one-ply pattern to a game."""
import random
from types import SimpleNamespace

import chess
import chess.engine
import pytest
from fastapi.testclient import TestClient

import main
import review
from review_jobs import queue as queue_mod
from review_jobs import store as store_mod
from tests.test_review_move import _fake_ef

PGN = (
    '[White "Alice"]\n[Black "Bob"]\n[WhiteElo "1500"]\n[BlackElo "1400"]\n\n'
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O f6 6. d4 exd4 7. Nxd4 c5 *"
)
# Ends in checkmate: the last ply's after-position is terminal (no after_eval).
PGN_MATE = '[White "Alice"]\n[Black "Bob"]\n\n1. f3 e5 2. g4 Qh4# 0-1'


def _no_book(_game):
    return review._opening.BookInfo(plies=0, eco=None, name=None)


def _book(plies):
    return lambda _game: review._opening.BookInfo(plies=plies, eco="C60", name="Ruy Lopez")


def _resp(board, multipv):
    """A deterministic fake engine: rank k plays the k-th legal move (UCI order)
    at a cp derived from the position, so every ply has distinct numbers."""
    moves = sorted(board.legal_moves, key=lambda m: m.uci())
    base = (sum(map(ord, board.fen())) % 400) - 200
    return [
        {"multipv": k + 1, "pv": [m],
         "score": chess.engine.PovScore(chess.engine.Cp(base - 35 * k), chess.WHITE)}
        for k, m in enumerate(moves[:multipv])
    ]


def _plies(pgn, multipv=2, resp=_resp):
    """The payload the browser would send: EVERY ply, from that engine's numbers."""
    game, moves = review._parse_pgn_or_raise(pgn)
    board = game.board()
    out = []
    for move in moves:
        fen_before = board.fen()
        before = [
            {"uci": info["pv"][0].uci(), "cp": info["score"].white().score()}
            for info in resp(board, multipv)
        ]
        board.push(move)
        after = None
        if not board.is_game_over():
            after = {"cp": resp(board, multipv)[0]["score"].white().score()}
        out.append({"fen_before": fen_before, "fen_after": board.fen(),
                    "before_lines": before, "after_eval": after})
    return out


def _ns(plies):
    """Dict payload -> attribute objects, as the endpoint's pydantic model yields."""
    return [SimpleNamespace(
        fen_before=p["fen_before"], fen_after=p["fen_after"],
        before_lines=[SimpleNamespace(uci=l["uci"], cp=l.get("cp"), mate=l.get("mate"))
                      for l in p["before_lines"]],
        after_eval=None if p["after_eval"] is None
        else SimpleNamespace(cp=p["after_eval"].get("cp"), mate=p["after_eval"].get("mate")),
    ) for p in plies]


def _engine_path(pgn, book_walk=_no_book, **kw):
    ef, _ = _fake_ef(_resp)
    events = list(review.review_stream(pgn, engine_factory=ef, multipv=2, book_walk=book_walk, **kw))
    return [e["data"] for e in events if e["type"] == "move"], events[-1]["data"]


# ── Parity: the payload feeder == the engine feeder, fed the same numbers ─────

@pytest.mark.parametrize("pgn", [PGN, PGN_MATE])
def test_whole_game_parity(pgn):
    engine_moves, engine_summary = _engine_path(pgn)
    payload = review.classify_game(pgn, _ns(_plies(pgn)), book_walk=_no_book)
    assert payload is not None
    moves, summary = payload
    assert moves == engine_moves
    assert summary == engine_summary


def test_parity_with_book_and_request_ratings():
    engine_moves, engine_summary = _engine_path(PGN, _book(4), white_elo=2200, black_elo=900)
    moves, summary = review.classify_game(
        PGN, _ns(_plies(PGN)), book_walk=_book(4), white_elo=2200, black_elo=900,
    )
    assert [m["classification"] for m in moves[:4]] == ["book"] * 4
    assert moves == engine_moves
    assert summary == engine_summary


# ── Plan matching: by FEN, book plies planned by the backend ─────────────────

def test_payload_covering_only_planned_plies_is_accepted():
    engine_moves, _ = _engine_path(PGN, _book(4))
    moves, _ = review.classify_game(PGN, _ns(_plies(PGN)[4:]), book_walk=_book(4))
    assert moves == engine_moves


def test_shuffled_payload_still_matches_by_fen():
    plies = _plies(PGN)
    random.Random(7).shuffle(plies)
    engine_moves, _ = _engine_path(PGN)
    moves, _ = review.classify_game(PGN, _ns(plies), book_walk=_no_book)
    assert moves == engine_moves


def test_missing_planned_ply_rejects_whole_payload():
    plies = _plies(PGN)
    del plies[9]
    assert review.classify_game(PGN, _ns(plies), book_walk=_no_book) is None


def test_missing_book_ply_is_not_required():
    plies = _plies(PGN)
    del plies[1]  # inside the book — the plan has no use for it
    assert review.classify_game(PGN, _ns(plies), book_walk=_book(4)) is not None


def test_malformed_line_at_one_ply_rejects_whole_payload():
    plies = _plies(PGN)
    plies[5]["before_lines"][0]["uci"] = "zzzz"
    assert review.classify_game(PGN, _ns(plies), book_walk=_no_book) is None


def test_single_line_rejected_unless_the_ply_is_forced():
    plies = _plies(PGN)
    plies[3]["before_lines"] = plies[3]["before_lines"][:1]
    assert review.classify_game(PGN, _ns(plies), book_walk=_no_book) is None


def test_forced_ply_accepts_its_single_line():
    # 2. Qh5+ leaves Black exactly one legal move (g6): one line is complete there.
    pgn = '[White "A"]\n[Black "B"]\n\n1. e4 f5 2. Qh5+ g6 3. Qxg6+ hxg6 *'
    plies = _plies(pgn)
    assert len(plies[3]["before_lines"]) == 1
    assert review.classify_game(pgn, _ns(plies), book_walk=_no_book) is not None


@pytest.mark.parametrize("index, field", [(6, "fen_before"), (13, "fen_after")])
def test_fen_mismatch_rejects_whole_payload(index, field):
    plies = _plies(PGN)
    plies[index][field] = plies[index][field].replace(" 0 ", " 9 ", 1)
    assert plies[index][field] not in {p["fen_before"] for p in _plies(PGN)}
    assert review.classify_game(PGN, _ns(plies), book_walk=_no_book) is None


def test_bad_pgn_raises_not_none():
    with pytest.raises(ValueError):
        review.classify_game("garbage", [], book_walk=_no_book)


# ── Endpoint dispatch + provenance ───────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    queued = []

    def runner(pgn, cancel_event, *, depth, multipv, white_elo=None, black_elo=None):
        queued.append(pgn)
        yield {"type": "summary", "data": {"white": {}, "black": {}}}

    monkeypatch.setattr(queue_mod, "review_stream", runner)
    monkeypatch.setattr(main, "review_queue", queue_mod.ReviewQueue(store_mod.ephemeral_store()))
    c = TestClient(main.app)
    c.queued = queued
    return c


def _post(client, **extra):
    return client.post("/reviews", json={"pgn": PGN, "depth": 18, "multipv": 2, **extra})


def test_complete_payload_is_stored_done_as_frontend_without_a_worker(client):
    r = _post(client, plies=_plies(PGN), engine="Stockfish 19 (browser)")
    assert r.status_code == 201
    assert r.json()["status"] == "done"
    assert r.json()["engine"] == "Stockfish 19 (browser)"
    job = main.review_queue.store.get(r.json()["id"])
    assert job.engine_source == "frontend"
    assert len(job.moves) == 14 and job.summary is not None
    assert client.queued == []
    assert client.get(f"/reviews/{job.id}").json()["moves"] == job.moves


def test_no_payload_queues_a_backend_job(client):
    r = _post(client)
    job = main.review_queue.store.get(r.json()["id"])
    assert job.engine_source == "backend"


@pytest.mark.parametrize("break_payload", [
    lambda plies: plies[:-1],                                   # planned ply missing
    lambda plies: [*plies[:-1], {**plies[-1], "fen_after": plies[0]["fen_before"]}],  # FEN mismatch
    lambda plies: [{**p, "before_lines": p["before_lines"][:1]} for p in plies],     # one line
    lambda plies: plies + [plies[0]] * main.REVIEW_PAYLOAD_MAX_PLIES,               # over ply cap
])
def test_incomplete_payload_falls_back_to_a_backend_job(client, break_payload):
    r = _post(client, plies=break_payload(_plies(PGN)))
    assert r.status_code == 201
    job = main.review_queue.store.get(r.json()["id"])
    assert job.engine_source == "backend"
    assert client.queued == [PGN]


def test_body_over_byte_cap_falls_back_to_a_backend_job(client, monkeypatch):
    monkeypatch.setattr(main, "REVIEW_PAYLOAD_MAX_BYTES", 64)
    r = _post(client, plies=_plies(PGN))
    assert main.review_queue.store.get(r.json()["id"]).engine_source == "backend"


def test_wire_cannot_assert_engine_source(client):
    r = _post(client, engine_source="frontend")
    assert main.review_queue.store.get(r.json()["id"]).engine_source == "backend"


def test_backend_job_for_same_hash_satisfies_the_payload_request(client):
    backend_id = _post(client).json()["id"]
    r = _post(client, plies=_plies(PGN))
    assert r.json()["id"] == backend_id
    assert len(main.review_queue.store.list()) == 1


def test_frontend_review_never_satisfies_a_backend_request(client):
    frontend_id = _post(client, plies=_plies(PGN)).json()["id"]
    r = _post(client)
    assert r.json()["id"] != frontend_id
    assert main.review_queue.store.get(r.json()["id"]).engine_source == "backend"


def test_frontend_review_satisfies_a_second_payload_request(client):
    first = _post(client, plies=_plies(PGN)).json()["id"]
    assert _post(client, plies=_plies(PGN)).json()["id"] == first
