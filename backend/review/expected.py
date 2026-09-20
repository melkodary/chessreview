"""The seam between engine centipawns and the 0..100 win-% scale. One file,
two scales, and the split is measured rather than structural:

  k_for(elo)        RATING-AWARE. Everything the classifier reads -- every
                    classify() rule, every band, `win_drop` on the wire.
                    Continuous since 2026-07-26 (lab experiment 029).
                    See specs/2026-07-13-rating-aware-classifier-design.md §1-2.
  k_for_accuracy()  RATING-BLIND. The per-move accuracy model only. Accuracy
                    inherited k_for() mechanically in the 2026-07-13 rewrite;
                    experiment 031 asked whether it should and measured no:
                    a global scale beats the rating-aware one by 1.92 held-out
                    game MAE, 5/5 folds, replicated on a second cohort.

The two drops diverge for the same ply, deliberately. A rating-aware drop is
what "how bad was this move FOR THIS PLAYER" means; the reference
accuracy is not that number.
"""
from config import (
    ACCURACY_K,
    RATING_K_AT_1000,
    RATING_K_AT_2000,
    RATING_K_MAX,
    RATING_K_MIN,
)

from .winchance import win_chance


def k_for(elo: int | None) -> float:
    """Sigmoid steepness for a mover's rating: a straight line through the two
    configured anchors, clamped to [RATING_K_MIN, RATING_K_MAX]. Continuous
    since 2026-07-26 (lab experiment 029); it was a two-bucket step before.

    `elo=None` (unresolved rating) defaults to 1000 -- the same code path
    review._resolve_ratings falls back to when neither the request nor the
    PGN's Elo tag supplies a value, so it lands on RATING_K_AT_1000, which is
    the value the old low bucket returned. Unrated reviews are unchanged."""
    e = 1000 if elo is None else elo
    slope = (RATING_K_AT_2000 - RATING_K_AT_1000) / 1000
    return min(RATING_K_MAX, max(RATING_K_MIN,
                                 RATING_K_AT_1000 + slope * (e - 1000)))


def k_for_accuracy() -> float:
    """The accuracy model's own steepness -- rating-BLIND, unlike k_for().

    Takes no argument on purpose: not depending on elo is the entire finding
    (031), and a signature accepting an ignored `elo` would invite someone to
    start honouring it."""
    return ACCURACY_K


def expected_points_pct(cp_white: int, mover_is_white: bool, k: float) -> float:
    """Mover-POV expected points, 0..100, using the mover's own k: flips
    `cp_white` to the mover's side of the board, then applies the same
    sigmoid `win_chance` does (win_chance(cp, k) is white-POV; the two are
    provably equivalent for `cp_mover = cp_white if mover_is_white else
    -cp_white`, since win_chance is odd-symmetric around 50)."""
    cp_mover = cp_white if mover_is_white else -cp_white
    return win_chance(cp_mover, k)
