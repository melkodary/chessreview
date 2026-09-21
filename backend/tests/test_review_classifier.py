import io
from dataclasses import fields

import chess
import chess.pgn
import pytest

from config import GREAT_ROUTINE_SEE_FLOOR
from review import expected
from review.classify import explain
from review import (
    BAND_BLUNDER,
    BAND_GOOD,
    BAND_INACCURACY,
    BAND_MISTAKE,
    RATING_K_AT_1000,
    RATING_K_AT_2000,
    RATING_K_MAX,
    RATING_K_MIN,
    EvalPoints,
    MoveFacts,
    _has_hanging_friendly,
    _material_balance,
    _resolve_ratings,
    classify,
    expected_points_pct,
    k_for,
    win_chance,
)


def test_move_facts_excludes_lab_only_observations():
    names = {field.name for field in fields(MoveFacts)}
    assert "pv_confirms_sacrifice" not in names
    assert "no_mate" not in names
    assert "mate_before_mover" in names
    assert "mate_after_played_mover" in names
    assert "had_mate_mover" not in names
    assert "kept_mate_mover" not in names
    assert "is_sacrifice" not in names
    assert "move_created_offer" not in names
    assert {"brilliant_offer_delta", "brilliant_net_material"} <= names


# ---------------------------------------------------------------------------
# win_chance / expected_points_pct — the rating-aware seam (2026-07-13
# redesign): win_chance takes an explicit k (no default — every caller says
# whose curve it is), expected_points_pct adds the mover-POV flip.
# ---------------------------------------------------------------------------

K = RATING_K_AT_1000  # any k works for the shape tests; this is the default-elo curve


def test_win_chance_zero_cp_is_fifty():
    assert win_chance(0, K) == pytest.approx(50.0)


def test_win_chance_positive_cp_above_fifty():
    assert win_chance(100, K) > 50.0


def test_win_chance_negative_cp_below_fifty():
    assert win_chance(-100, K) < 50.0


def test_win_chance_symmetric_around_zero():
    assert win_chance(123, K) == pytest.approx(100.0 - win_chance(-123, K))


def test_win_chance_monotonic():
    seq = [win_chance(cp, K) for cp in range(-500, 501, 50)]
    assert seq == sorted(seq)


def test_win_chance_saturates_high():
    assert win_chance(10_000, K) > 99.9


def test_win_chance_saturates_low():
    assert win_chance(-10_000, K) < 0.1


def test_win_chance_higher_k_is_steeper():
    """The strong-player curve reads the same cp lead as MORE won than the
    weak-player one — a 100cp edge converts more reliably at higher skill."""
    assert win_chance(100, RATING_K_AT_2000) > win_chance(100, RATING_K_AT_1000)


def test_k_for_is_monotone_non_decreasing_in_elo():
    seq = [k_for(elo) for elo in range(100, 4001, 100)]
    assert seq == sorted(seq)


def test_k_for_hits_its_anchors():
    assert k_for(1000) == pytest.approx(RATING_K_AT_1000)
    assert k_for(2000) == pytest.approx(RATING_K_AT_2000)


def test_k_for_is_linear_between_the_anchors():
    assert k_for(1500) == pytest.approx((RATING_K_AT_1000 + RATING_K_AT_2000) / 2)


def test_k_for_clamps_at_both_ends():
    """The API accepts elo 100-4000; unclamped, the line leaves the range the
    lab measured well before either end."""
    assert k_for(100) == pytest.approx(RATING_K_MIN)
    assert k_for(4000) == pytest.approx(RATING_K_MAX)


def test_k_for_none_defaults_to_elo_1000():
    assert k_for(None) == k_for(1000) == pytest.approx(RATING_K_AT_1000)


def test_equal_anchors_are_the_rating_blind_off_switch(monkeypatch):
    """Documented supported config (config.py): RATING_K_AT_2000 ==
    RATING_K_AT_1000 is slope 0, i.e. one global k at every rating. Pinned by a
    test because a comment cannot notice when it stops being true."""
    monkeypatch.setattr(expected, "RATING_K_AT_2000", RATING_K_AT_1000)
    assert {expected.k_for(elo) for elo in (100, 800, 1000, 1500, 2500, 4000)} == {
        RATING_K_AT_1000
    }


def test_expected_points_white_mover_matches_win_chance():
    assert expected_points_pct(150, True, K) == pytest.approx(win_chance(150, K))


def test_expected_points_black_mover_flips_pov():
    """White is +150 → black's expected points mirror below 50."""
    assert expected_points_pct(150, False, K) == pytest.approx(100.0 - win_chance(150, K))


def test_expected_points_zero_is_fifty_both_povs():
    assert expected_points_pct(0, True, K) == pytest.approx(50.0)
    assert expected_points_pct(0, False, K) == pytest.approx(50.0)


def test_band_ordering():
    assert BAND_GOOD < BAND_INACCURACY < BAND_MISTAKE < BAND_BLUNDER


# ---------------------------------------------------------------------------
# Rating resolution — request field → PGN Elo tag → 1000 (spec §1)
# ---------------------------------------------------------------------------

def _game_with_headers(**headers) -> chess.pgn.Game:
    tags = "".join(f'[{k} "{v}"]\n' for k, v in headers.items())
    game = chess.pgn.read_game(io.StringIO(f"{tags}\n1. e4 *"))
    assert game is not None
    return game


def test_resolve_ratings_from_pgn_tags():
    game = _game_with_headers(WhiteElo="1450", BlackElo="1875")
    assert _resolve_ratings(game, None, None) == (1450, 1875)


def test_resolve_ratings_request_fields_win_over_tags():
    game = _game_with_headers(WhiteElo="1450", BlackElo="1875")
    assert _resolve_ratings(game, 800, 2200) == (800, 2200)


def test_resolve_ratings_missing_tags_default_1000():
    game = _game_with_headers()
    assert _resolve_ratings(game, None, None) == (1000, 1000)


def test_resolve_ratings_non_numeric_tag_ignored():
    """Some sites stamp '?' for unrated sides — must fall through to 1000,
    not crash."""
    game = _game_with_headers(WhiteElo="?", BlackElo="1875")
    assert _resolve_ratings(game, None, None) == (1000, 1875)


def test_resolve_ratings_partial_request_fields():
    game = _game_with_headers(WhiteElo="1450", BlackElo="1875")
    assert _resolve_ratings(game, None, 999) == (1450, 999)


# ---------------------------------------------------------------------------
# hanging.py helpers (unchanged by the redesign — brilliant still feeds on them)
# ---------------------------------------------------------------------------

def test_material_balance_starting_position_white():
    board = chess.Board()
    # 8P + 2N + 2B + 2R + 1Q = 8 + 6 + 6 + 10 + 9 = 39
    assert _material_balance(board, chess.WHITE) == 39


def test_material_balance_starting_position_black():
    board = chess.Board()
    assert _material_balance(board, chess.BLACK) == 39


# ---------------------------------------------------------------------------
# classify() — EvalPoints + MoveFacts fixtures
# ---------------------------------------------------------------------------

def _points(**overrides) -> EvalPoints:
    base = dict(
        before_opp=50.0,
        before=50.0,
        after_played=50.0,
        after_second=50.0,
    )
    base.update(overrides)
    return EvalPoints(**base)


def _facts(**overrides) -> MoveFacts:
    base = dict(
        played_is_best=False,
        is_check=False,
        is_capture=False,
        is_promotion=False,
        brilliant_offer_delta=0,
        brilliant_net_material=0,
        played_see=0,
        direct_recapture=False,
        mate_before_mover=None,
        mate_after_played_mover=None,
        is_only_legal_move=False,
    )
    base.update(overrides)
    return MoveFacts(**base)


# ---------------------------------------------------------------------------
# Band ladder — drop = before - after_played, constants unchanged 2/5/10/20.
# BAND_EXCELLENT (0.5) was dead since strict-best (P2) and is deleted.
# ---------------------------------------------------------------------------

def _banded(drop: float) -> str:
    # before_opp == before: zero opponent-handed swing, so the squandered-
    # opportunity miss can't fire — these tests isolate the ladder itself.
    return classify(
        _points(before_opp=80.0, before=80.0, after_played=80.0 - drop),
        _facts(),
    )


def test_classify_played_is_best_short_circuits_to_best():
    out = classify(
        _points(before=54.0, after_played=50.0),
        _facts(played_is_best=True, is_capture=True),
    )
    assert out == "best"


def test_classify_small_drop_without_engine_move_is_excellent():
    """Strict best: 'best' means the engine move was played. A tiny drop on a
    different move is excellent, not best (calibration — the old
    clamp swallowed 11 moves in the reference game)."""
    assert _banded(0.49) == "excellent"


def test_classify_below_good_threshold_is_excellent():
    assert _banded(1.99) == "excellent"


def test_classify_at_good_threshold_is_good():
    assert _banded(2.0) == "good"


def test_classify_below_inaccuracy_threshold_is_good():
    assert _banded(4.99) == "good"


def test_classify_at_inaccuracy_threshold_is_inaccuracy():
    assert _banded(5.0) == "inaccuracy"


def test_classify_below_mistake_threshold_is_inaccuracy():
    assert _banded(9.99) == "inaccuracy"


def test_classify_at_mistake_threshold_is_mistake():
    assert _banded(10.0) == "mistake"


def test_classify_below_blunder_threshold_is_mistake():
    assert _banded(19.99) == "mistake"


def test_classify_at_blunder_threshold_is_blunder():
    assert _banded(20.0) == "blunder"


def test_classify_negative_drop_floors_to_excellent():
    """A non-best move that (per the engine) improved the position — drop
    floors at 0, never negative → excellent."""
    out = classify(_points(before=50.0, after_played=55.0), _facts())
    assert out == "excellent"


# ---------------------------------------------------------------------------
# Brilliant — experiment 077's precision-first alternative-line and
# net-material rule. Good-move, result-floor, promotion, and precedence gates
# stay intact; material is two numeric production facts.
# ---------------------------------------------------------------------------

def _brilliant_facts(**overrides):
    base = dict(
        played_is_best=True,
        brilliant_offer_delta=2,
        brilliant_net_material=1,
    )
    base.update(overrides)
    return _facts(**base)


def test_brilliant_fires_on_a_good_net_material_offer():
    out = classify(
        _points(before=70.0, after_played=72.0, after_second=84.9),
        _brilliant_facts(),
    )
    assert out == "brilliant"


def test_brilliant_offer_delta_boundary_is_inclusive():
    points = _points(before=70.0, after_played=72.0, after_second=84.9)
    assert classify(points, _brilliant_facts(brilliant_offer_delta=2),
                    brilliant_offer_delta_min=2) == "brilliant"
    out = classify(
        points,
        _brilliant_facts(brilliant_offer_delta=1),
        brilliant_offer_delta_min=2,
    )
    assert out == "great"


def test_brilliant_net_material_boundary_is_inclusive():
    points = _points(before=70.0, after_played=72.0, after_second=84.9)
    assert classify(points, _brilliant_facts(brilliant_net_material=1),
                    brilliant_net_material_floor=1) == "brilliant"
    assert classify(points, _brilliant_facts(brilliant_net_material=0),
                    brilliant_net_material_floor=1) == "great"


def test_brilliant_excludes_promotions():
    out = classify(
        _points(before=70.0, after_played=72.0),
        _brilliant_facts(is_promotion=True),
    )
    assert out != "brilliant"


def test_brilliant_net_material_offer_does_not_require_forced_mate():
    out = classify(
        _points(before=70.0, after_played=72.0),
        _brilliant_facts(is_capture=True, mate_before_mover=None),
    )
    assert out == "brilliant"


def test_brilliant_fires_on_a_move_that_merely_ties_the_engine_best_rxg6_regression():
    """Calibration game 171395689460, ply 51 Rxg6+: the reference label is brilliant,
    our engine ranked it #2 — but scored it IDENTICALLY to its #1
    (cp_before == cp_best == cp_played == 0, a dead tie it broke by list
    order). `played_is_best` is multipv ORDERING, not merit, so a move that
    gives up nothing against the best line is eligible for brilliant. Lab
    experiment 018; still an anchor after the rework (before 50% < ceiling,
    after 50% >= floor)."""
    out = classify(
        _points(before=50.0, after_played=50.0),
        _brilliant_facts(played_is_best=False, is_check=True),
    )
    assert out == "brilliant"


def test_brilliant_good_move_tolerance():
    """A fresh sacrifice that is NOT the engine top move and NOT a dead tie, but
    costs at most BRILLIANT_GOOD_TOL=2 expected points, still qualifies as a
    'good move' (the rework's third good-move arm — a genuine sac the engine
    ranks a hair below its own line)."""
    out = classify(
        _points(before=70.0, after_played=68.5),  # 1.5 <= 2.0
        _brilliant_facts(played_is_best=False, is_check=True),
    )
    assert out == "brilliant"


def test_brilliant_good_move_tolerance_boundary():
    """Costing more than BRILLIANT_GOOD_TOL against the best line, without being
    the best move, is not a good-enough move → not brilliant."""
    out = classify(
        _points(before=70.0, after_played=67.5),  # 2.5 > 2.0, and not best
        _brilliant_facts(played_is_best=False, is_check=True),
    )
    assert out != "brilliant"


def test_brilliant_floor_is_50():
    """Floor is BRILLIANT_FLOOR=50.0 ('not losing after'). Exactly at the floor
    qualifies (>=)."""
    out = classify(
        _points(before=70.0, after_played=50.0),
        _brilliant_facts(),
    )
    assert out == "brilliant"


def test_brilliant_blocked_below_floor():
    """Below the floor the mover is losing after the sac → not brilliant."""
    out = classify(
        _points(before=70.0, after_played=49.9),
        _brilliant_facts(),
    )
    assert out != "brilliant"


def test_brilliant_alt_ceiling_is_exclusive():
    out = classify(
        _points(before=95.0, after_played=95.0, after_second=85.0),
        _brilliant_facts(),
        brilliant_alt_ceiling=85.0,
    )
    assert out != "brilliant"


def test_brilliant_just_below_alt_ceiling_fires():
    out = classify(
        _points(before=95.0, after_played=95.0, after_second=84.9),
        _brilliant_facts(),
        brilliant_alt_ceiling=85.0,
    )
    assert out == "brilliant"


def test_brilliant_missing_second_line_cannot_fire():
    out = classify(
        _points(before=70.0, after_played=72.0, after_second=None),
        _brilliant_facts(),
    )
    assert out == "great"


def test_non_sacrifice_tie_does_not_leak_into_best():
    """A move that ties the engine best but is NOT a sacrifice is still not
    "best" — strict best stays the engine's own move (calibration,
    see band_for). Guards the fallthrough from the brilliant good-move arm."""
    out = classify(
        _points(before=50.0, after_played=50.0),
        _facts(played_is_best=False),  # no sacrifice → falls through to bands
    )
    assert out == "excellent"


def test_brilliant_d5_regression():
    """d5 push (d4d5) should NOT be brilliant: Bc4 defends d5 → not hanging."""
    # FEN before d4d5: white Bc4, d-pawn on d4; black Nc6, Be6, e-pawn on e5.
    fen_before = "r2qkbnr/ppp2ppp/2npb3/4p3/2BPP3/5N2/PPP2PPP/RNBQK2R w KQkq - 1 5"
    board_before = chess.Board(fen_before)
    board_after = board_before.copy()
    move = chess.Move.from_uci("d4d5")
    board_after.push(move)

    # _has_hanging_friendly should be False: d5 pawn is defended by Bc4
    result = _has_hanging_friendly(board_before, board_after, mover_color=chess.WHITE)
    assert result is False, "d5 pawn should not be considered hanging (Bc4 defends it)"

    # End-to-end classify: played_is_best=True, no hanging → not brilliant
    out = classify(
        _points(before=50.0, after_played=55.0, after_second=48.0),
        _facts(played_is_best=True),
    )
    assert out == "best", f"d5 should be 'best', got '{out}'"


# ---------------------------------------------------------------------------
# Great — the 005 hybrid (2026-07-13 rating-aware redesign): two arms, both
# require played_is_best AND non-obvious — since 2026-08-08 that is capture
# geometry (not a direct recapture, and not an outright material win), not the
# old `is_check or not is_capture`.
# Arm 1 (banked turnaround): swing >= GREAT_SWING(20), hold <= GREAT_HOLD(2),
#   result >= GREAT_RESULT_FLOOR(45). Skipped when before_opp is None.
# Arm 2 (beats every alternative): hold <= GREAT_HOLD, after >=
#   GREAT_ONLY_AFTER(40), after - second >= GREAT_ONLY_GAP(10).
# ---------------------------------------------------------------------------

# Arm 1 fixture: opponent handed a 25-point swing (30 → 55), mover banked it
# (55 → 55, hold 0), result 55 >= 45. Second-best kept high (50) so arm 2
# stays quiet (gap 5 < GREAT_ONLY_GAP).
_ARM1 = dict(before_opp=30.0, before=55.0, after_played=55.0, after_second=50.0)


def test_great_arm1_banked_turnaround_fires():
    out = classify(_points(**_ARM1), _facts(played_is_best=True))
    assert out == "great"


def test_great_arm1_blocked_below_swing():
    """Swing 19.99 < GREAT_SWING(20) → no turnaround to bank."""
    out = classify(
        _points(**{**_ARM1, "before_opp": 35.01}),
        _facts(played_is_best=True),
    )
    assert out == "best"


def test_great_arm1_blocked_when_not_held():
    """Mover gave back more than GREAT_HOLD(2) of the swing → not banked
    (second stays at 50 so arm 2 can't rescue it; a 2.01 drop is also below
    every band threshold that isn't excellent, proving the great path is what
    changed)."""
    out = classify(
        _points(**{**_ARM1, "after_played": 52.99}),
        _facts(played_is_best=True),
    )
    assert out == "best"


def test_great_arm1_blocked_below_result_floor():
    """Banked swing but still below GREAT_RESULT_FLOOR(45) afterwards: a
    turnaround from dead-lost to merely-bad is not a great."""
    out = classify(
        _points(before_opp=10.0, before=40.0, after_played=40.0, after_second=50.0),
        _facts(played_is_best=True),
    )
    assert out == "best"


def test_great_arm1_skipped_on_ply_one():
    """before_opp is None (first scored ply) → arm 1 has no swing to read;
    arm 2 quiet (second-best not collapsing) → best."""
    out = classify(
        _points(**{**_ARM1, "before_opp": None}),
        _facts(played_is_best=True),
    )
    assert out == "best"


def test_great_arm1_requires_played_is_best():
    out = classify(_points(**_ARM1), _facts(played_is_best=False))
    assert out != "great"


def test_great_arm1_allows_a_hard_quiet_capture():
    """The 061/068 arm-C change: a capture that neither takes back nor wins
    material outright is no longer routine, so it can be great."""
    out = classify(_points(**_ARM1), _facts(played_is_best=True, is_capture=True))
    assert out == "great"


@pytest.mark.parametrize("routine, why", [
    (dict(direct_recapture=True), "the opponent just took here"),
    (dict(played_see=GREAT_ROUTINE_SEE_FLOOR), "the capture wins material outright"),
])
def test_great_arm1_blocked_on_a_routine_capture(routine, why):
    out = classify(
        _points(**_ARM1),
        _facts(played_is_best=True, is_capture=True, **routine),
    )
    assert out == "best", why


def test_great_arm1_see_floor_is_a_floor():
    """One under the floor is a marginal exchange, not an outright win."""
    out = classify(
        _points(**_ARM1),
        _facts(played_is_best=True, is_capture=True,
               played_see=GREAT_ROUTINE_SEE_FLOOR - 1),
    )
    assert out == "great"


def test_great_arm1_check_no_longer_rescues_a_recapture():
    """is_check was the whole of the old gate's escape hatch and is now read by
    neither half — a checking recapture is routine (068's 44 demoted greats)."""
    out = classify(
        _points(**_ARM1),
        _facts(played_is_best=True, is_capture=True, is_check=True,
               direct_recapture=True),
    )
    assert out == "best"


def test_great_arm1_is_indeterminate_without_the_previous_move():
    """`direct_recapture=None` means NOT SUPPLIED. It must not read as "no" --
    the arm goes unknown, so the ladder falls through instead of claiming
    great."""
    e = explain(
        _points(**_ARM1),
        _facts(played_is_best=True, is_capture=True, direct_recapture=None),
    )
    banked = next(a for a in e.arms if a.name == "_great_banked_swing")
    assert banked.indeterminate and not banked.fired
    assert e.label == "best"


def test_great_gate_settles_a_winning_capture_without_the_previous_move():
    """SEE first is not cosmetic: an outright-winning capture is routine
    whatever preceded it, so this reads a clean `no`, not unknown."""
    e = explain(
        _points(**_ARM1),
        _facts(played_is_best=True, is_capture=True, direct_recapture=None,
               played_see=GREAT_ROUTINE_SEE_FLOOR),
    )
    banked = next(a for a in e.arms if a.name == "_great_banked_swing")
    assert not banked.indeterminate
    assert banked.blocked_by == "see_unprofitable"


# Arm 2 fixture: no opponent gift (flat 45 → 45), move holds (45 → 45), every
# alternative collapses (second 20 < 40). before_opp equal to before keeps
# arm 1 quiet (swing 0).
_ARM2 = dict(before_opp=45.0, before=45.0, after_played=45.0, after_second=20.0)


def test_great_arm2_only_good_move_fires():
    out = classify(_points(**_ARM2), _facts(played_is_best=True))
    assert out == "great"


def test_great_arm2_blocked_when_second_line_missing():
    """after_second None (single analyzed line) → no alternative to measure
    the margin against."""
    out = classify(
        _points(**{**_ARM2, "after_second": None}),
        _facts(played_is_best=True),
    )
    assert out == "best"


def test_great_arm2_blocked_when_not_held():
    out = classify(
        _points(**{**_ARM2, "before": 48.0}),  # drop 3 > GREAT_HOLD(2)
        _facts(played_is_best=True),
    )
    assert out != "great"


def test_great_arm2_blocked_below_after_floor():
    """Held, alternatives collapse, but the mover sits below
    GREAT_ONLY_AFTER(40) — too lost for the badge."""
    out = classify(
        _points(before_opp=39.0, before=39.0, after_played=39.0, after_second=20.0),
        _facts(played_is_best=True),
    )
    assert out == "best"


def test_great_arm2_gap_boundary_is_inclusive():
    """`>=` on the margin: 45 − 35 == GREAT_ONLY_GAP(10) fires, a hair under
    does not. The alternative's own level is irrelevant — 35 is comfortably
    "good" by the old cutoff and the badge still lands."""
    exact = classify(
        _points(**{**_ARM2, "after_second": 35.0}),
        _facts(played_is_best=True),
    )
    assert exact == "great"

    narrow = classify(
        _points(**{**_ARM2, "after_second": 35.1}),
        _facts(played_is_best=True),
    )
    assert narrow == "best"


def test_great_arm2_blocked_on_a_routine_capture():
    """The gate is on both arms, so arm 2 reads the same geometry."""
    routine = classify(
        _points(**_ARM2),
        _facts(played_is_best=True, is_capture=True, direct_recapture=True),
    )
    hard = classify(_points(**_ARM2), _facts(played_is_best=True, is_capture=True))
    assert (routine, hard) == ("best", "great")


def test_great_arm2_fires_on_ply_one():
    """Arm 2 doesn't need history — before_opp None only silences arm 1."""
    out = classify(
        _points(**{**_ARM2, "before_opp": None}),
        _facts(played_is_best=True),
    )
    assert out == "great"


def test_brilliant_wins_over_great():
    """Rule order: a sac that satisfies both brilliant and great is brilliant."""
    out = classify(
        _points(before_opp=30.0, before=55.0, after_played=55.0, after_second=20.0),
        _brilliant_facts(played_is_best=True),
    )
    assert out == "brilliant"


# ---------------------------------------------------------------------------
# Miss rules — forced-mate loss and short forced-mate delay
# ---------------------------------------------------------------------------

def test_miss_had_and_lost_mate_is_miss_even_at_zero_drop():
    out = classify(
        _points(before=90.0, after_played=90.0),
        _facts(mate_before_mover=3, mate_after_played_mover=None),
    )
    assert out == "miss"


def test_miss_kept_mate_outside_short_delay_gate_is_not_miss():
    """A longer kept mate outside the pre-registered M1/M2 gate is not a miss."""
    out = classify(
        _points(before=99.99, after_played=99.99),
        _facts(mate_before_mover=3, mate_after_played_mover=6),
    )
    assert out != "miss"


def test_miss_lost_mate_but_best_move_is_not_miss():
    """A best move never misses, even when the mate evaporated (depth noise)."""
    out = classify(
        _points(before=99.99, after_played=95.0),
        _facts(played_is_best=True, mate_before_mover=2, mate_after_played_mover=None),
    )
    assert out != "miss"


def test_miss_opponent_had_mate_rule_inert():
    """Mate belonged to the opponent (had_mate_mover False) → rule 1 inert."""
    out = classify(
        _points(before=5.0, after_played=2.0),
        _facts(mate_before_mover=None, mate_after_played_mover=None),
    )
    assert out != "miss"


def test_miss_rule1_horizon_noise_not_miss():
    """Mate 'lost' but position still ~100% winning → search-horizon artifact
    (after-position search is one ply shallower on the same line), not a real
    squander."""
    out = classify(
        _points(before=99.99, after_played=99.2),
        _facts(mate_before_mover=1, mate_after_played_mover=None),
    )
    assert out != "miss"


def test_miss_rule1_real_lost_mate_below_guard_is_miss():
    """Mate lost and the position actually gave something up → miss."""
    out = classify(
        _points(before=99.99, after_played=96.0),
        _facts(mate_before_mover=1, mate_after_played_mover=None),
    )
    assert out == "miss"


@pytest.mark.parametrize(
    ("before", "after", "played_is_best", "expected"),
    [
        (1, 5, False, "miss"),
        (2, 5, False, "miss"),
        (2, 4, False, "excellent"),
        (3, 8, False, "excellent"),
        (1, 8, True, "best"),
    ],
)
def test_miss_short_mate_delay_uses_exact_mover_distances(
    before, after, played_is_best, expected,
):
    out = classify(
        _points(),
        _facts(
            played_is_best=played_is_best,
            mate_before_mover=before,
            mate_after_played_mover=after,
        ),
    )
    assert out == expected


def test_short_mate_delay_yields_to_forced_and_brilliant():
    forced = classify(
        _points(),
        _facts(
            is_only_legal_move=True,
            mate_before_mover=1,
            mate_after_played_mover=5,
        ),
    )
    brilliant = classify(
        _points(before=70.0, after_played=70.0),
        _facts(
            brilliant_offer_delta=2,
            brilliant_net_material=1,
            mate_before_mover=1,
            mate_after_played_mover=5,
        ),
    )
    assert forced == "forced"
    assert brilliant == "brilliant"


def test_short_mate_delay_uses_injected_config_bounds():
    points = _points()
    facts = _facts(mate_before_mover=2, mate_after_played_mover=5)

    assert classify(points, facts) == "miss"
    assert classify(points, facts, miss_mate_before_max=1) == "excellent"
    assert classify(points, facts, miss_mate_after_min=6) == "excellent"


# ---------------------------------------------------------------------------
# Miss rule 2 — squandered opportunity (2026-07-13, lab experiment 008):
# swing >= MISS_SWING(10), drop >= MISS_DROP(10), before >= MISS_CHANCE(50),
# after_played >= MISS_ALIVE(20). Replaces the pv-material-swing rule.
# ---------------------------------------------------------------------------

# Opponent handed a 20-point swing (45 → 65 ≥ chance 50); mover dropped 15 of
# it (65 → 50 ≥ alive 20).
_SQUANDER = dict(before_opp=45.0, before=65.0, after_played=50.0, after_second=60.0)


def test_miss_squandered_opportunity_fires():
    out = classify(_points(**_SQUANDER), _facts())
    assert out == "miss"


def test_miss_blocked_below_swing():
    """Swing 9.99 < MISS_SWING(10): nothing was handed → band label (the
    15-point drop is a mistake)."""
    out = classify(
        _points(**{**_SQUANDER, "before_opp": 55.01}),
        _facts(),
    )
    assert out == "mistake"


def test_miss_blocked_below_drop():
    """Drop 9.99 < MISS_DROP(10) → the chance was (mostly) kept → band label."""
    out = classify(
        _points(**{**_SQUANDER, "after_played": 55.01}),
        _facts(),
    )
    assert out == "inaccuracy"


def test_miss_blocked_below_chance_floor():
    """before 49.99 < MISS_CHANCE(50): the opportunity never reached
    equal-or-better → their miss doesn't fire (exp 008: dropping the
    chance-floor cost 13 points of precision)."""
    out = classify(
        _points(before_opp=25.0, before=49.99, after_played=29.0, after_second=45.0),
        _facts(),
    )
    assert out == "blunder"


def test_miss_blocked_below_alive_floor():
    """after_played 19.99 < MISS_ALIVE(20): a squander that leaves the mover
    dead-lost stays 'blunder' in the reference too."""
    out = classify(
        _points(before_opp=40.0, before=65.0, after_played=19.99, after_second=60.0),
        _facts(),
    )
    assert out == "blunder"


def test_miss_skipped_on_ply_one():
    """before_opp None → no opponent move to have handed a chance."""
    out = classify(
        _points(**{**_SQUANDER, "before_opp": None}),
        _facts(),
    )
    assert out == "mistake"


def test_miss_best_move_cannot_squander():
    """A best move's drop is ~0 by construction (before == eval after best
    play), structurally below MISS_DROP — no played_is_best guard needed.
    Sanity-check the closest a best move can come: zero drop. (Swing kept at
    15 — above MISS_SWING but below GREAT_SWING, so neither special fires.)"""
    out = classify(
        _points(before_opp=50.0, before=65.0, after_played=65.0, after_second=60.0),
        _facts(played_is_best=True),
    )
    assert out == "best"


def test_miss_wins_over_band_blunder():
    """A drop that would band as blunder relabels to miss at a squandered
    moment (the exp-008 relabel: their miss over our blunder ×57 was the
    largest residual block)."""
    out = classify(
        _points(before_opp=40.0, before=75.0, after_played=45.0, after_second=70.0),
        _facts(),
    )
    assert out == "miss"


def test_great_wins_over_miss():
    """Rule order: great is evaluated before miss (a banked turnaround can't
    simultaneously be a squander — hold and drop are mutually exclusive at
    the default knobs — but order is part of the contract)."""
    out = classify(_points(**_ARM1), _facts(played_is_best=True))
    assert out == "great"


# ---------------------------------------------------------------------------
# Forced — the only-legal-move label. Board-derived, not a curve.
# ---------------------------------------------------------------------------

def test_forced_fires_on_only_legal_move():
    out = classify(_points(), _facts(is_only_legal_move=True))
    assert out == "forced"


def test_forced_wins_over_great_kc4_regression():
    """170910514096 ply 87 Kc4: the mover had no choice, so the arm1
    banked-turnaround shape (which would otherwise fire "great") must lose to
    forced — a forced move demonstrates nothing."""
    out = classify(
        _points(**_ARM1),
        _facts(played_is_best=True, is_only_legal_move=True),
    )
    assert out == "forced"


def test_forced_wins_over_brilliant():
    """A one-legal-move position offers no skill — forced must intercept even
    a shape that would otherwise satisfy brilliant's sacrifice gates."""
    out = classify(
        _points(before_opp=30.0, before=55.0, after_played=55.0, after_second=20.0),
        _facts(
            played_is_best=True, brilliant_offer_delta=2, brilliant_net_material=1,
            is_only_legal_move=True,
        ),
    )
    assert out == "forced"
