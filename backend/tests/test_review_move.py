import chess
import chess.engine
import pytest
from fastapi.testclient import TestClient

import review
from review.classify import CLASSIFICATIONS
from main import app


def _fake_ef(response_factory, max_depth: int = 30):
    """An injectable engine_factory returning a fake single engine, plus the
    fake itself (to assert quit()). Mirrors test_review_stream's fake — no
    monkeypatching. `response_factory(board, multipv)` returns the multipv info
    list for that position."""
    class FakeAnalysis:
        def __init__(self, infos): self.infos = infos
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __iter__(self):
            for d in range(1, max_depth + 1):
                for info in self.infos:
                    yield {**info, "depth": d}
        def stop(self): pass

    class FakeEngine:
        def __init__(self): self.quit_called = False
        def analysis(self, board, limit, multipv, game=None):
            return FakeAnalysis(response_factory(board, multipv))
        def quit(self): self.quit_called = True

    fake = FakeEngine()
    return (lambda: fake), fake


def _cp(uci, cp):
    """A response_factory: every line is `uci` at White-POV centipawns `cp`."""
    def _resp(_board, multipv):
        return [
            {"multipv": j + 1, "pv": [chess.Move.from_uci(uci)],
             "score": chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE)}
            for j in range(multipv)
        ]
    return _resp


START = chess.STARTING_FEN


# ── review_move core ──────────────────────────────────────────────────────

def test_review_move_played_is_best_is_best():
    """Engine's top line == the move played, flat eval → 'best'."""
    fen = chess.Board(); fen.push_san("e4")
    before_fen = fen.fen()  # black to move

    def resp(board, multipv):
        # top line is the played move (e7e5) from the before position; the
        # after position's line is irrelevant (only its rank-1 score is read).
        uci = "e7e5" if board.turn == chess.BLACK else "e2e4"
        return _cp(uci, 0)(board, multipv)

    ef, fake = _fake_ef(resp)
    mv = review.review_move(before_fen, "e7e5", engine_factory=ef)
    assert mv.san == "e5"
    assert mv.classification == "best"
    assert fake.quit_called  # pool released


def test_review_move_traced_preserves_classifier_inputs_and_raw_cp():
    """A traced grade keeps exactly what classify() consumed, including the
    second line that the persisted MoveReview cannot reconstruct."""
    fen = chess.Board()
    fen.push_san("e4")
    before_fen = fen.fen()

    def resp(board, multipv):
        if board.fen() == before_fen:
            return [
                {
                    "multipv": 1,
                    "pv": [chess.Move.from_uci("e7e5")],
                    "score": chess.engine.PovScore(chess.engine.Cp(30), chess.WHITE),
                },
                {
                    "multipv": 2,
                    "pv": [chess.Move.from_uci("c7c5")],
                    "score": chess.engine.PovScore(chess.engine.Cp(10), chess.WHITE),
                },
            ]
        return _cp("g1f3", 20)(board, multipv)

    ef, _ = _fake_ef(resp)
    trace = review.review_move_traced(
        before_fen, "e7e5", prev_before_eval=0.4, engine_factory=ef,
    )

    assert trace.review.san == "e5"
    assert trace.points.after_second is not None
    assert trace.review.win_after_second == trace.points.after_second
    assert trace.facts.played_is_best
    assert trace.cp == {
        "before_opp": 40,
        "before": 30,
        "after_played": 20,
        "after_second": 10,
    }


def test_review_move_hang_is_blunder():
    """Played move is not best and the eval collapses → 'blunder'."""
    def resp(board, multipv):
        # before (White to move, start): best is d4 at +40; after e4 the stub
        # says White is -800 (a stubbed catastrophe), so the drop is huge.
        if board.turn == chess.WHITE and board.fen() == START:
            return _cp("d2d4", 40)(board, multipv)
        return _cp("g8f6", -800)(board, multipv)

    ef, _ = _fake_ef(resp)
    mv = review.review_move(START, "e2e4", engine_factory=ef)
    assert mv.classification == "blunder"


def test_review_move_before_opp_seed_flips_blunder_to_miss():
    """prev_before_eval feeds EvalPoints.before_opp: the same squandered-tactic
    move is 'miss' with the opponent-swing seed and merely bands without it."""
    b = chess.Board()
    for m in ["e4", "d5", "exd5", "Qxd5", "Nc3", "Nc6"]:
        b.push_san(m)
    fen_before = b.fen()  # White to move; Nxd5 wins the hung queen
    after = b.copy(); after.push_san("Nf3")
    fen_after = after.fen()

    responses = {fen_before: ("c3d5", 300), fen_after: ("g8f6", 0)}

    def resp(board, multipv):
        uci, cp = responses[board.fen()]
        return _cp(uci, cp)(board, multipv)

    ef, _ = _fake_ef(resp)
    seeded = review.review_move(fen_before, "g1f3", engine_factory=ef, prev_before_eval=0.0)
    assert seeded.classification == "miss"

    ef2, _ = _fake_ef(resp)
    unseeded = review.review_move(fen_before, "g1f3", engine_factory=ef2, prev_before_eval=None)
    assert unseeded.classification != "miss"


def test_review_move_terminal_after_position_is_handled():
    """A move that delivers checkmate leaves no after-position to search; the
    terminal fallback keeps it from raising."""
    b = chess.Board()
    for m in ["f3", "e5", "g4"]:
        b.push_san(m)
    fen_before = b.fen()  # black to move; Qh4# is mate

    ef, _ = _fake_ef(_cp("d8h4", 0))
    mv = review.review_move(fen_before, "d8h4", engine_factory=ef)
    assert mv.san == "Qh4#"
    assert mv.classification in CLASSIFICATIONS


def test_review_move_illegal_move_raises_value_error():
    ef, _ = _fake_ef(_cp("e2e4", 0))
    with pytest.raises(ValueError):
        review.review_move(START, "e2e5", engine_factory=ef)


def test_review_move_invalid_fen_raises_value_error():
    ef, _ = _fake_ef(_cp("e2e4", 0))
    with pytest.raises(ValueError):
        review.review_move("not a fen", "e2e4", engine_factory=ef)


# ── POST /reviews/move endpoint (validation paths — no engine spawn) ────────
# Legality/FEN/UCI are validated before engine_factory() is called, so these
# never touch Stockfish. A 200 success is covered by the unit tests above.

client = TestClient(app)


def test_endpoint_illegal_move_returns_422():
    r = client.post("/reviews/move", json={"fen_before": START, "uci": "e2e5"})
    assert r.status_code == 422


def test_endpoint_invalid_fen_returns_422():
    r = client.post("/reviews/move", json={"fen_before": "garbage", "uci": "e2e4"})
    assert r.status_code == 422


def test_endpoint_multipv_below_two_rejected():
    r = client.post("/reviews/move", json={"fen_before": START, "uci": "e2e4", "multipv": 1})
    assert r.status_code == 422
