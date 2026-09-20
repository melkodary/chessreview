from math import exp


def win_chance(cp: int, k: float) -> float:
    """White-POV win-% (0..100) for `cp` centipawns at steepness `k`. No
    default: every caller must say whose rating-aware curve it is (see
    review/expected.py:k_for) -- there is no longer a single rating-blind
    compromise constant."""
    return 50.0 + 50.0 * (2.0 / (1.0 + exp(-k * cp)) - 1.0)


def _cp_white(info: dict) -> int:
    score = info.get("score")
    if score is None:
        return 0
    w = score.white()
    if w.is_mate():
        m = w.mate() or 0
        return 10_000 if m > 0 else -10_000
    return w.score() or 0


def _cp_to_pawns(cp: int) -> float:
    if abs(cp) >= 10_000:
        return 99.99 if cp > 0 else -99.99
    return round(cp / 100.0, 2)


def mover_relative_mate(mate_white: int | None, mover_is_white: bool) -> int | None:
    """Signed white-POV mate distance -> positive mover-relative, or None when
    the mate is against the mover (`MoveFacts.mate_*_mover`). Both feeders of
    `_review_one_ply` and the stored-review rebuild need it, so it lives beside
    the other engine-score POV conversions rather than in one of them."""
    if mate_white is None or (mate_white > 0) != mover_is_white:
        return None
    return abs(mate_white)
