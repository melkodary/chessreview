from review.classify import (
    Arm,
    Check,
    EvalPoints,
    Explanation,
    Group,
    MoveFacts,
)
import chess
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import app
from tests.test_review_move import _cp, _fake_ef


client = TestClient(app)


def _points(**overrides) -> EvalPoints:
    values = {
        "before_opp": 45.0,
        "before": 60.0,
        "after_played": 58.0,
        "after_second": None,
    }
    return EvalPoints(**(values | overrides))


def _facts(**overrides) -> MoveFacts:
    values = {
        "played_is_best": False,
        "is_check": False,
        "is_capture": True,
        "is_promotion": False,
        "brilliant_offer_delta": 0,
        "brilliant_net_material": 0,
        "played_see": 0,
        "direct_recapture": False,
        "mate_before_mover": None,
        "mate_after_played_mover": None,
        "is_only_legal_move": False,
    }
    return MoveFacts(**(values | overrides))


def test_trace_json_preserves_states_groups_blocker_and_partial_input():
    from review.trace import to_json

    explanation = Explanation(
        label="best",
        arms=(
            Arm("forced", (Check("is_only_legal_move", False, "is", True),)),
            Arm(
                "brilliant",
                (
                    Check("is_promotion", True, "is", False),
                    Group(
                        "good_move",
                        "any",
                        (
                            Check("played_is_best", True, "is", True),
                            Check("good_tol", 2.0, "<=", 2.0),
                        ),
                    ),
                ),
            ),
            Arm("_great_banked_swing", (Check("played_is_best", False, "is", True),)),
            Arm("_great_only_move", (Check("after_second", None, "<", 35.0),)),
            Arm("_missed_mate", (Check("played_is_best", True, "is", False),)),
            Arm("_short_mate_delay", (Check("played_is_best", True, "is", False),)),
            Arm("_squandered_opportunity", (Check("drop", 2.0, ">=", 15.0),)),
        ),
    )
    header = {
        "san": "Rxe2",
        "color": "black",
        "mover_is_white": False,
        "elo": 1450,
        "k": 0.004125,
        "source": "review row",
        "stored_label": "best",
        "cp": {
            "before_opp": 34,
            "before": -120,
            "after_played": -95,
            "after_second": None,
        },
    }

    payload = to_json(explanation, header, points=_points(), facts=_facts())

    assert payload["label"] == "best"
    brilliant = next(f for f in payload["families"] if f["name"] == "brilliant")
    assert brilliant["state"] == "no"
    assert brilliant["arms"][0]["blocked_by"] == "is_promotion"
    assert brilliant["arms"][0]["checks"][0] == {
        "kind": "check",
        "name": "is_promotion",
        "lhs": True,
        "op": "is",
        "rhs": False,
        "state": "fail",
        "margin": None,
    }
    group = brilliant["arms"][0]["checks"][1]
    assert group["kind"] == "group"
    assert group["mode"] == "any"
    assert group["state"] == "ok"
    great = next(f for f in payload["families"] if f["name"] == "great")
    assert great["state"] == "indeterminate"
    assert payload["partial"] == ["after_second"]
    assert payload["band_for"] == {"label": "good", "drop": 2.0}


def test_k_rows_flip_white_cp_for_black_mover():
    from review.expected import k_for
    from review.trace import k_rows
    from review.winchance import win_chance

    header = {
        "mover_is_white": False,
        "elo": 1450,
        "cp": {
            "before_opp": None,
            "before": 120,
            "after_played": 95,
            "after_second": 80,
        },
    }

    rows = k_rows(header)
    before = next(row for row in rows if row["feature"] == "before")

    assert before["cp"] == 120
    assert before["at_k"] == round(win_chance(-120, k_for(1450)), 1)
    assert next(row for row in rows if row["feature"] == "before_opp")["at_k"] is None


def _stored_move() -> dict:
    return {
        "ply": 1,
        "san": "e4",
        "fen_before": chess.STARTING_FEN,
        "eval_before": 0.2,
        "eval_after_played": 0.1,
        "best_move_san": "e4",
        "win_before": 51.5,
        "win_after_played": 50.7,
        "win_drop": 0.8,
        "classification": "best",
        "mate_before": None,
        "mate_after_played": None,
    }


def test_stored_request_returns_partial_trace_without_engine():
    response = client.post(
        "/reviews/explain",
        json={"move": _stored_move(), "white_elo": 1500, "black_elo": 1400},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["header"]["source"] == "review row"
    assert payload["header"]["stored_label"] == "best"
    assert payload["partial"] == ["after_second"]
    only_move = next(
        arm
        for family in payload["families"]
        for arm in family["arms"]
        if arm["name"] == "_great_only_move"
    )
    assert only_move["state"] == "indeterminate"


def test_new_stored_request_restores_the_second_line_for_brilliant():
    response = client.post(
        "/reviews/explain",
        json={"move": _stored_move() | {"win_after_second": 42.0}},
    )

    assert response.status_code == 200
    payload = response.json()
    brilliant = next(f for f in payload["families"] if f["name"] == "brilliant")
    check = next(
        c for c in brilliant["arms"][0]["checks"]
        if c["name"] == "after_second"
    )
    assert check["lhs"] == 42.0
    assert check["state"] != "unknown"
    assert "after_second" not in payload["partial"]


def test_frontend_eval_request_returns_complete_trace():
    response = client.post(
        "/reviews/explain",
        json={
            "fen_before": chess.STARTING_FEN,
            "uci": "e2e4",
            "before_lines": [
                {"uci": "e2e4", "cp": 20},
                {"uci": "d2d4", "cp": 5},
            ],
            "after_eval": {"cp": 15},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["header"]["source"] == "frontend eval"
    assert payload["header"]["cp"]["after_second"] == 5
    assert payload["partial"] == []


def test_engine_request_uses_injected_factory():
    from main import _explain_move
    from models import ExplainRequest

    ef, fake = _fake_ef(_cp("e2e4", 20))
    payload = _explain_move(
        ExplainRequest(fen_before=chess.STARTING_FEN, uci="e2e4"),
        engine_factory=ef,
    )

    assert payload["header"]["source"] == "engine"
    assert payload["partial"] == []
    assert fake.quit_called


def test_explain_request_requires_exactly_one_request_form():
    neither = client.post("/reviews/explain", json={})
    both = client.post(
        "/reviews/explain",
        json={
            "move": _stored_move(),
            "fen_before": chess.STARTING_FEN,
            "uci": "e2e4",
        },
    )

    assert neither.status_code == 422
    assert both.status_code == 422


def test_previous_move_is_optional_and_reported_as_partial():
    """No previous ply supplied → `direct_recapture` is unknown, both great
    arms read indeterminate, and the response says which input was missing
    rather than pretending the check answered `no`."""
    move = _stored_move() | {
        "ply": 6, "san": "Nxd4", "best_move_san": "Nxd4",
        "fen_before": "r1bqkbnr/pppp1ppp/2n5/8/3pP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 4",
    }
    response = client.post("/reviews/explain", json={"move": move})

    assert response.status_code == 200
    payload = response.json()
    assert payload["partial"] == ["after_second", "direct_recapture"]
    great = next(f for f in payload["families"] if f["name"] == "great")
    assert great["state"] == "indeterminate"


def test_previous_move_makes_the_gate_determinate():
    """The same ply WITH the previous position: Nxd4 takes back on d4, so the
    gate answers `no` and nothing is partial but the unpersisted second line."""
    move = _stored_move() | {
        "ply": 6, "san": "Nxd4", "best_move_san": "Nxd4",
        "fen_before": "r1bqkbnr/pppp1ppp/2n5/8/3pP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 4",
    }
    response = client.post(
        "/reviews/explain",
        json={
            "move": move,
            "prev_fen": "r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3",
            "prev_uci": "e5d4",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["partial"] == ["after_second"]
    banked = next(
        arm
        for family in payload["families"]
        for arm in family["arms"]
        if arm["name"] == "_great_banked_swing"
    )
    gate = next(c for c in banked["checks"] if c["name"] == "non_obvious")
    assert (gate["lhs"], gate["state"]) == (False, "fail")


def test_previous_move_halves_must_come_together():
    only_fen = client.post(
        "/reviews/explain",
        json={"move": _stored_move(), "prev_fen": chess.STARTING_FEN},
    )
    only_uci = client.post(
        "/reviews/explain", json={"move": _stored_move(), "prev_uci": "e2e4"},
    )

    assert only_fen.status_code == 422
    assert only_uci.status_code == 422


def test_illegal_stored_san_returns_422():
    move = _stored_move() | {"san": "e5"}
    response = client.post("/reviews/explain", json={"move": move})
    assert response.status_code == 422


def test_disabled_feature_is_hidden(monkeypatch):
    import main
    from main import _explain_move
    from models import ExplainRequest

    monkeypatch.setattr(main, "ENABLE_EXPLAIN", False)
    with pytest.raises(HTTPException) as exc:
        _explain_move(ExplainRequest(move=_stored_move()))
    assert exc.value.status_code == 404
