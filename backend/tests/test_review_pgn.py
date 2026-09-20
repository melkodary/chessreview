import pytest

from review import MoveReview, _parse_pgn_or_raise


def test_parse_valid_pgn_returns_game():
    pgn = '[Event "?"]\n\n1. e4 e5 2. Nf3 Nc6 *'
    game, moves = _parse_pgn_or_raise(pgn)
    assert moves


def test_parse_empty_string_raises():
    with pytest.raises(ValueError):
        _parse_pgn_or_raise("")


def test_parse_garbage_raises():
    with pytest.raises(ValueError):
        _parse_pgn_or_raise("this is not pgn")


def test_parse_pgn_with_no_moves_raises():
    pgn = '[Event "?"]\n\n*'
    with pytest.raises(ValueError):
        _parse_pgn_or_raise(pgn)


def test_move_review_dataclass_fields():
    mr = MoveReview(
        ply=1, san="e4", fen_before="...",
        eval_before=0.0, eval_after_played=0.2,
        best_move_san="e4",
        win_before=50.0, win_after_played=52.0, win_drop=0.0,
        classification="best",
    )
    assert mr.ply == 1
    assert mr.classification == "best"
