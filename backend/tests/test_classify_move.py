from dataclasses import asdict
from types import SimpleNamespace

import chess
import chess.engine
import pytest
from fastapi.testclient import TestClient

import review
from review.classify import CLASSIFICATIONS
from main import app, _has_complete_eval_payload
from models import BeforeLine, MoveReviewRequest
from tests.test_review_move import _fake_ef, _cp, START


client = TestClient(app)


def _line(uci, cp=None, mate=None):
    return SimpleNamespace(uci=uci, cp=cp, mate=mate)


def _both(fen_before, uci, responses, *, multipv=2, **kw):
    """Grade `uci` twice off `fen_before`: once through the engine feeder
    (review_move fed a fake engine) and once through the classify feeder
    (review.classify_move fed that same engine's numbers). `responses` maps a
    position FEN -> (best_uci, white_POV_cp). Returns (engine_mv, classify_mv)."""
    def resp(board, mpv):
        u, cp = responses[board.fen()]
        return _cp(u, cp)(board, mpv)

    ef, _ = _fake_ef(resp)
    engine_mv = review.review_move(fen_before, uci, multipv=multipv, engine_factory=ef, **kw)

    bu, bcp = responses[fen_before]
    before = [_line(bu, cp=bcp) for _ in range(multipv)]
    b = chess.Board(fen_before)
    b.push(chess.Move.from_uci(uci))
    after = None if b.is_game_over() else SimpleNamespace(cp=responses[b.fen()][1], mate=None)
    classify_mv = review.classify_move(fen_before, uci, before, after, **kw)
    return engine_mv, classify_mv


# ── Parity: classify feeder == engine feeder, fed the same numbers ──────────

def test_parity_best():
    b = chess.Board(); b.push_san("e4")
    fen = b.fen()  # black to move
    engine_mv, classify_mv = _both(
        fen, "e7e5",
        {fen: ("e7e5", 0), _after(fen, "e7e5"): ("e2e4", 0)},
    )
    assert asdict(engine_mv) == asdict(classify_mv)
    assert classify_mv.classification == "best"


def test_parity_blunder():
    engine_mv, classify_mv = _both(
        START, "e2e4",
        {START: ("d2d4", 40), _after(START, "e2e4"): ("g8f6", -800)},
    )
    assert asdict(engine_mv) == asdict(classify_mv)
    assert classify_mv.classification == "blunder"


def test_parity_miss_via_before_opp_seed():
    b = chess.Board()
    for m in ["e4", "d5", "exd5", "Qxd5", "Nc3", "Nc6"]:
        b.push_san(m)
    fen = b.fen()  # White to move; Nxd5 wins the hung queen, Nf3 squanders it
    engine_mv, classify_mv = _both(
        fen, "g1f3",
        {fen: ("c3d5", 300), _after(fen, "g1f3"): ("g8f6", 0)},
        prev_before_eval=0.0,
    )
    assert asdict(engine_mv) == asdict(classify_mv)
    assert classify_mv.classification == "miss"


def test_engine_and_frontend_feeders_share_brilliant_material_facts():
    fen = "r3k3/8/8/8/8/8/1N6/4K3 w - - 0 1"
    uci = "b2a4"
    after_fen = _after(fen, uci)

    def resp(board, multipv):
        if board.fen() == fen:
            return [
                {"multipv": 1, "pv": [chess.Move.from_uci(uci)],
                 "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE)},
                {"multipv": 2, "pv": [chess.Move.from_uci("e1e2")],
                 "score": chess.engine.PovScore(chess.engine.Cp(-10), chess.WHITE)},
            ]
        assert board.fen() == after_fen
        return _cp("a8a4", 0)(board, multipv)

    ef, _ = _fake_ef(resp)
    engine = review.review_move_traced(fen, uci, engine_factory=ef)
    frontend = review.classify_move_traced(
        fen,
        uci,
        [_line(uci, cp=0), _line("e1e2", cp=-10)],
        SimpleNamespace(cp=0, mate=None),
    )

    assert (engine.facts.brilliant_offer_delta,
            engine.facts.brilliant_net_material) == (3, 3)
    assert engine.facts == frontend.facts


def _after(fen, uci):
    b = chess.Board(fen)
    b.push(chess.Move.from_uci(uci))
    return b.fen()


# ── classify feeder: terminal + validation ──────────────────────────────────

def test_classify_terminal_move_ignores_after_eval():
    b = chess.Board()
    for m in ["f3", "e5", "g4"]:
        b.push_san(m)
    fen = b.fen()  # black to move; Qh4# is mate — no after-position to search
    before = [_line("d8h4", mate=-1), _line("d8e7", cp=-50)]
    mv = review.classify_move(fen, "d8h4", before, None)
    assert mv.san == "Qh4#"
    assert mv.classification in CLASSIFICATIONS


def test_classify_empty_before_lines_raises():
    with pytest.raises(ValueError):
        review.classify_move(START, "e2e4", [], SimpleNamespace(cp=0, mate=None))


def test_classify_missing_after_eval_nonterminal_raises():
    with pytest.raises(ValueError):
        review.classify_move(START, "e2e4", [_line("e2e4", cp=0), _line("d2d4", cp=0)], None)


def test_before_line_carries_move_and_score_without_pv_tail():
    assert "pv" not in BeforeLine.model_fields


def test_classify_bad_line_move_raises():
    bad = [_line("zzzz", cp=0), _line("d2d4", cp=0)]
    with pytest.raises(ValueError):
        review.classify_move(START, "e2e4", bad, SimpleNamespace(cp=0, mate=None))


def test_classify_illegal_move_raises():
    with pytest.raises(ValueError):
        review.classify_move(START, "e2e5", [_line("e2e4", cp=0), _line("d2d4", cp=0)],
                             SimpleNamespace(cp=0, mate=None))


def test_batch_and_deviation_planners_share_typed_shape():
    game, moves = review._parse_pgn_or_raise("1. e4 e5 *")
    batch, _ = review._plan_review(game, moves, SimpleNamespace(plies=0))
    single = review._plan_one_move(START, "e2e4")

    assert isinstance(single, review.PlannedMove)
    assert isinstance(batch[0], review.PlannedMove)
    assert single.move == batch[0].move
    assert single.fen_before == batch[0].fen_before
    assert single.fen_after == batch[0].fen_after
    assert single.is_capture == batch[0].is_capture


# ── Dispatch: _has_complete_eval_payload ────────────────────────────────────

def _req(uci="e2e4", fen=START, **kw):
    return MoveReviewRequest(fen_before=fen, uci=uci, **kw)


def test_dispatch_no_payload_uses_engine():
    assert not _has_complete_eval_payload(_req())


def test_dispatch_one_line_not_complete():
    req = _req(before_lines=[{"uci": "e2e4", "cp": 0}], after_eval={"cp": 0})
    assert not _has_complete_eval_payload(req)


def test_dispatch_two_lines_plus_after_eval_complete():
    req = _req(
        before_lines=[{"uci": "e2e4", "cp": 0}, {"uci": "d2d4", "cp": 5}],
        after_eval={"cp": 0},
    )
    assert _has_complete_eval_payload(req)


def test_dispatch_missing_after_eval_not_complete_when_nonterminal():
    req = _req(before_lines=[{"uci": "e2e4", "cp": 0}, {"uci": "d2d4", "cp": 5}])
    assert not _has_complete_eval_payload(req)


def test_dispatch_terminal_after_position_complete_without_after_eval():
    b = chess.Board()
    for m in ["f3", "e5", "g4"]:
        b.push_san(m)
    fen = b.fen()
    req = _req(
        uci="d8h4", fen=fen,
        before_lines=[{"uci": "d8h4", "mate": -1},
                      {"uci": "d8e7", "cp": -50}],
    )
    assert _has_complete_eval_payload(req)  # Qh4# terminal → no after_eval needed


# ── Endpoint: complete payload grades with NO engine (Stockfish-free) ───────

def test_endpoint_complete_payload_grades_without_engine():
    b = chess.Board(); b.push_san("e4")
    fen = b.fen()
    payload = {
        "fen_before": fen, "uci": "e7e5",
        "before_lines": [
            {"uci": "e7e5", "cp": 0},
            {"uci": "c7c5", "cp": -10},
        ],
        "after_eval": {"cp": 0},
    }
    r = client.post("/reviews/move", json=payload)
    assert r.status_code == 200
    assert r.json()["classification"] in CLASSIFICATIONS


def test_endpoint_before_line_needs_exactly_one_score():
    payload = {
        "fen_before": START, "uci": "e2e4",
        "before_lines": [
            {"uci": "e2e4", "cp": 0, "mate": 1},
            {"uci": "d2d4", "cp": 5},
        ],
        "after_eval": {"cp": 0},
    }
    r = client.post("/reviews/move", json=payload)
    assert r.status_code == 422


# ── prev_before: the seed as a score, so a ply needs no earlier verdict ─────

def _seeded(seed: dict) -> dict:
    b = chess.Board(); b.push_san("e4")
    payload = {
        "fen_before": b.fen(), "uci": "g8h6",
        "before_lines": [{"uci": "e7e5", "cp": 0}, {"uci": "c7c5", "cp": -10}],
        "after_eval": {"cp": 160},
        **seed,
    }
    r = client.post("/reviews/move", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_prev_before_score_grades_like_the_pawns_seed():
    assert _seeded({"prev_before": {"cp": -140}}) == _seeded({"prev_before_eval": -1.4})
    # Mate folds to +-10000 cp, the whole-game review's convention (not 99.99's 9999).
    assert _seeded({"prev_before": {"mate": -3}}) == _seeded({"prev_before_eval": -100.0})


def test_prev_before_cp_round_trips_through_the_pawns_seed():
    from main import _seed_eval
    for cp in range(-9999, 10000):
        req = MoveReviewRequest(fen_before=START, uci="e2e4", prev_before={"cp": cp})
        assert int(round(_seed_eval(req) * 100)) == cp


def test_endpoint_rejects_both_seed_forms():
    payload = {
        "fen_before": START, "uci": "e2e4", "prev_before_eval": 0.1, "prev_before": {"cp": 10},
        "before_lines": [{"uci": "e2e4", "cp": 0}, {"uci": "d2d4", "cp": 5}],
        "after_eval": {"cp": 0},
    }
    assert client.post("/reviews/move", json=payload).status_code == 422
