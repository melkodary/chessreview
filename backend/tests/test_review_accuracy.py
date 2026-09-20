"""Accuracy: the curve and the aggregator, both fitted to the reference corpus
(lab experiment 019). The corpus-wide MAE gate lives in
tests/calibration/test_accuracy.py — these are the unit-level invariants that
say WHAT the number is, independent of how well it scores."""
from statistics import fmean
from types import SimpleNamespace

import pytest

import config
from review import _per_move_accuracy, _side_summary


def _white_move(ply: int, drop: float, classification: str = "good"):
    """A white move (odd ply). Book plies pass classification="book"."""
    return SimpleNamespace(
        ply=ply,
        classification=classification,
        win_drop=drop,
        win_after_played=50.0,
    )


def _acc_drops(moves) -> dict[int, float]:
    """The out-of-band accuracy-scale drops production hands _side_summary.
    These fixtures set them equal to win_drop so the aggregator's arithmetic is
    what is under test here; production's two drops differ per ply, and that
    divergence is measured in tests/calibration/test_accuracy.py."""
    return {m.ply: m.win_drop for m in moves}


# ── the curve ───────────────────────────────────────────────────────────────

def test_per_move_accuracy_perfect_when_no_drop():
    assert _per_move_accuracy(0.0) == pytest.approx(100.0)


def test_per_move_accuracy_drops_with_win_drop():
    assert _per_move_accuracy(5.0) < _per_move_accuracy(0.0)
    assert _per_move_accuracy(20.0) < _per_move_accuracy(5.0)


def test_per_move_accuracy_goes_negative_on_a_big_drop():
    """The load-bearing difference from the old Lichess curve, which clamped at
    0. the reference per-move number for a blunder is around -60, and a curve
    that bottoms out at 0 cannot reproduce their game average (experiment 019)."""
    assert _per_move_accuracy(25.0) < 0.0


def test_per_move_accuracy_floors_at_the_curves_own_floor():
    """C=200 floors the curve at 100 - C = -100, however catastrophic the move."""
    floor = 100.0 - config.ACCURACY_CURVE_C
    assert _per_move_accuracy(10_000.0) == pytest.approx(floor)
    assert _per_move_accuracy(10_000.0) >= floor


def test_per_move_accuracy_never_exceeds_one_hundred():
    assert _per_move_accuracy(0.0) <= 100.0


# ── the aggregator ──────────────────────────────────────────────────────────

def test_side_accuracy_is_the_plain_mean_of_its_moves():
    """Measured, not chosen: the reference game-level accuracy is the plain arithmetic
    mean of that side's per-move numbers (MAE 0.02 over the corpus's 154 sides).
    No volatility weighting, no harmonic mean, no blend of the two."""
    moves = [_white_move(1, 0.0), _white_move(3, 8.0),
             _white_move(5, 2.0), _white_move(7, 15.0)]
    expected = fmean(_per_move_accuracy(m.win_drop) for m in moves)
    got = _side_summary(moves, is_white=True, acc_drops=_acc_drops(moves))
    assert got["accuracy"] == pytest.approx(round(expected, 1))


def test_accuracy_reads_acc_drops_not_win_drop():
    """The 031 seam, pinned: the two drops diverge per ply in production, so a
    _side_summary that quietly fell back to m.win_drop would still look right on
    every other test in this file."""
    moves = [_white_move(1, 0.0), _white_move(3, 0.0)]
    got = _side_summary(moves, True, {1: 0.0, 3: 20.0})
    assert got["accuracy"] == round(
        (_per_move_accuracy(0.0) + _per_move_accuracy(20.0)) / 2, 1
    )
    assert got["accuracy"] < 100.0


def test_book_plies_count_toward_accuracy_at_one_hundred():
    """The reference counts them (at 100); excluding them costs 4.85
    game-level MAE against their published number. A book ply has win_drop 0.0,
    so it scores 100 — the point of this test is that it is not FILTERED OUT."""
    played = [_white_move(5, 20.0), _white_move(7, 20.0)]
    with_book = [_white_move(1, 0.0, "book"), _white_move(3, 0.0, "book")] + played

    assert (_side_summary(with_book, True, _acc_drops(with_book))["accuracy"]
            > _side_summary(played, True, _acc_drops(played))["accuracy"])
    expected = fmean(_per_move_accuracy(m.win_drop) for m in with_book)
    assert _side_summary(with_book, True, _acc_drops(with_book))["accuracy"] == pytest.approx(
        round(expected, 1)
    )


def test_all_perfect_side_is_100():
    moves = [_white_move(p, 0.0) for p in (1, 3, 5, 7)]
    got = _side_summary(moves, is_white=True, acc_drops=_acc_drops(moves))
    assert got["accuracy"] == 100.0


def test_single_move_equals_its_accuracy():
    moves = [_white_move(1, 6.0)]
    assert _side_summary(moves, True, _acc_drops(moves))["accuracy"] == round(
        _per_move_accuracy(6.0), 1
    )


def test_side_accuracy_is_clamped_to_zero_not_negative():
    """Per-move accuracy is signed; a side's is not. Every move a catastrophe
    would average below zero, which is not a number to show a human."""
    moves = [_white_move(p, 90.0) for p in (1, 3, 5)]
    assert _side_summary(moves, True, _acc_drops(moves))["accuracy"] == 0.0


def test_a_side_with_no_moves_at_all_is_100():
    assert _side_summary([], is_white=True, acc_drops={})["accuracy"] == 100.0


def test_biggest_blunder_ply_is_the_worst_drop():
    moves = [
        _white_move(1, 0.0),
        _white_move(3, 12.0, "mistake"),
        _white_move(5, 30.0, "blunder"),
    ]
    assert _side_summary(moves, True, _acc_drops(moves))["biggest_blunder_ply"] == 5
