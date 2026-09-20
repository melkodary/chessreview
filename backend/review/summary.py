"""Accuracy — fitted to the reference corpus, not invented (lab experiment 019).

Both halves of the number below are MEASUREMENTS against the reference
corpus's own per-move and game-level accuracy (both archived in its raw
frames), not design choices:

  the curve       a signed exponential in the expected-points drop -- since
                  2026-07-26 (experiment 031) the drop is taken on the accuracy
                  model's OWN rating-blind scale (ACCURACY_K), not the
                  classifier's k(elo), and the two differ for the same ply.
                  It runs through zero to a floor at 100 - C. Their per-move
                  number is signed -- a blunder scores about -60, not 0 -- and no
                  curve clamped at zero can reproduce their game average.
  the aggregator  the PLAIN MEAN of a side's per-move numbers, book plies
                  included at 100. Measured MAE 0.02 over the corpus's 154 sides.
                  Not volatility-weighted, not blended with a harmonic mean.
"""
from math import exp, fsum

from config import ACCURACY_CURVE_A, ACCURACY_CURVE_B, ACCURACY_CURVE_C

from .classify import CLASSIFICATIONS
from .game_rating import (
    GAME_RATING_ALGORITHM,
    GameRatingInputs,
    estimate_game_rating,
)


def _per_move_accuracy(drop: float) -> float:
    """Reference-style per-move accuracy for a move that gave up `drop` expected
    points ON THE ACCURACY SCALE (rating-blind, k = ACCURACY_K) -- not the
    classifier's rating-aware win_drop, which is a different number for the same
    ply since 2026-07-26. Signed, floors at 100 - C (=-100 shipped); the caller
    aggregates, and only the aggregate is clamped to 0..100."""
    raw = (
        ACCURACY_CURVE_C * exp(-ACCURACY_CURVE_A * max(0.0, drop) ** ACCURACY_CURVE_B)
        - (ACCURACY_CURVE_C - 100.0)
    )
    return max(100.0 - ACCURACY_CURVE_C, min(100.0, raw))


def _mover_win(white_win: float, mover_is_white: bool) -> float:
    return white_win if mover_is_white else 100.0 - white_win


def _side_summary(moves: list, is_white: bool, acc_drops: dict[int, float]) -> dict:
    side = [m for m in moves if (m.ply % 2 == 1) == is_white]

    counts = {c: 0 for c in CLASSIFICATIONS}
    for m in side:
        counts[m.classification] += 1

    if not side:
        return {
            "accuracy": 100.0,
            "counts": {k: v for k, v in counts.items() if v > 0},
            "biggest_blunder_ply": None,
        }

    # Book plies carry a 0.0 drop, so they score 100 and lift the mean -- which
    # is exactly what the reference does, and excluding them is worth 4.85 game-level
    # MAE against their number (experiment 019, section 1).
    per_move = [_per_move_accuracy(acc_drops[m.ply]) for m in side]
    acc = fsum(per_move) / len(per_move)

    # `biggest` stays on win_drop, the RATING-AWARE drop: "worst blunder" is a
    # classifier-adjacent notion, and it must agree with the badge shown on the
    # ply. Only the accuracy number moved to the rating-blind scale (031).
    blunder_moves = [m for m in side
                     if m.classification in ("blunder", "mistake")]
    biggest = max(blunder_moves, key=lambda m: m.win_drop).ply if blunder_moves else None

    return {
        # Per-move accuracy is signed; a side's is not. A player whose every move
        # is a blunder scores 0, not -60.
        "accuracy": round(max(0.0, min(100.0, acc)), 1),
        "counts": {k: v for k, v in counts.items() if v > 0},
        "biggest_blunder_ply": biggest,
    }


def _result_for_side(pgn_result: str, is_white: bool) -> str:
    if pgn_result == "1-0":
        return "win" if is_white else "loss"
    if pgn_result == "0-1":
        return "loss" if is_white else "win"
    return "draw"


def _build_summary(
    moves: list,
    book,
    acc_drops: dict[int, float],
    *,
    white_elo: int,
    black_elo: int,
    pgn_result: str,
) -> dict:
    severity = {
        "blunder": 4, "miss": 3, "mistake": 2, "brilliant": 2,
        "great": 1, "inaccuracy": 1,
    }
    candidates = [(severity[m.classification], m.ply)
                  for m in moves if m.classification in severity]
    candidates.sort(key=lambda t: (-t[0], t[1]))

    opening_field = (
        {"eco": book.eco, "name": book.name, "until_ply": book.plies}
        if book.plies > 0 else None
    )

    white = _side_summary(moves, True, acc_drops)
    black = _side_summary(moves, False, acc_drops)
    for side, own_elo, opponent_elo, is_white in (
        (white, white_elo, black_elo, True),
        (black, black_elo, white_elo, False),
    ):
        side_moves = [m for m in moves if (m.ply % 2 == 1) == is_white]
        side["game_rating"] = estimate_game_rating(GameRatingInputs(
            own_elo=own_elo,
            opponent_elo=opponent_elo,
            accuracy=side["accuracy"],
            result=_result_for_side(pgn_result, is_white),
            move_count=len(side_moves),
            counts=side["counts"],
        ))

    return {
        "white": white,
        "black": black,
        "game_rating_algorithm": GAME_RATING_ALGORITHM,
        "key_moments": [ply for _, ply in candidates[:10]],
        "opening": opening_field,
    }
