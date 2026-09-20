from dataclasses import replace

from review.game_rating import (
    GameRatingInputs,
    estimate_game_rating,
    expected_accuracy,
    production_defaults,
)
from review.summary import _build_summary, _result_for_side
from opening import BookInfo


def _inputs(**overrides) -> GameRatingInputs:
    base = GameRatingInputs(
        own_elo=1000,
        opponent_elo=1000,
        accuracy=72.5,
        result="draw",
        move_count=20,
        counts={"best": 10},
    )
    return replace(base, **overrides)


def test_expected_accuracy_interpolates_between_elo_anchors_and_clamps():
    assert expected_accuracy(1000) == 72.25
    assert expected_accuracy(1500) == 75.875
    assert expected_accuracy(2000) == 79.5
    assert expected_accuracy(0) == 68.0
    assert expected_accuracy(4000) == 82.0


def test_formula_moves_elo_per_accuracy_point_from_own_rating():
    # round_step=1 so the assertion reads the slope, not the 50 Elo rounding.
    exact = replace(production_defaults, round_step=1)
    assert estimate_game_rating(_inputs(accuracy=74.25), params=exact) == 1083
    assert estimate_game_rating(_inputs(accuracy=70.25), params=exact) == 917


def test_formula_rounds_positive_midpoints_half_up_to_nearest_fifty():
    params = replace(production_defaults, elo_per_accuracy_point=1.0)
    assert estimate_game_rating(_inputs(accuracy=97.25), params=params) == 1050
    assert estimate_game_rating(_inputs(accuracy=97.24), params=params) == 1000


def test_formula_clamps_before_rounding_to_review_rating_range():
    assert estimate_game_rating(_inputs(own_elo=100, accuracy=0.0)) == 100
    assert estimate_game_rating(_inputs(own_elo=4000, accuracy=100.0)) == 4000


def test_formula_v1_ignores_future_candidate_inputs():
    reference = estimate_game_rating(_inputs())
    changed = estimate_game_rating(
        _inputs(
            opponent_elo=2400,
            result="win",
            move_count=5,
            counts={"blunder": 5},
        )
    )
    assert changed == reference


def test_summary_adds_both_game_ratings_and_algorithm_id():
    summary = _build_summary(
        [],
        BookInfo(plies=0, eco=None, name=None),
        {},
        white_elo=1200,
        black_elo=1500,
        pgn_result="1-0",
    )
    assert summary["white"]["game_rating"] == 2300
    assert summary["black"]["game_rating"] == 2500
    assert summary["game_rating_algorithm"] == "formula-v1"


def test_result_mapping_is_from_each_side_view_and_unknown_is_draw():
    assert _result_for_side("1-0", is_white=True) == "win"
    assert _result_for_side("1-0", is_white=False) == "loss"
    assert _result_for_side("0-1", is_white=True) == "loss"
    assert _result_for_side("0-1", is_white=False) == "win"
    assert _result_for_side("1/2-1/2", is_white=True) == "draw"
    assert _result_for_side("*", is_white=False) == "draw"
