"""Unit coverage for the trace layer of `review/classify.py` — the `Check` /
`Group` / `Arm` semantics that the corpus-wide equivalence test in
`tests/calibration/test_explain.py` cannot pin down on its own.

The load-bearing distinction here is UNKNOWN vs failed. An arm that could not
be evaluated because an input was absent must never render as "did not fire":
reporting `brilliant: no` when the data was simply missing reads as an answer,
and a partial trace that looks complete is worse than no trace at all.
"""
import pytest

from review.classify import (
    EvalPoints,
    MoveFacts,
    classify,
    explain,
)


def points(**kw) -> EvalPoints:
    base = dict(before_opp=50.0, before=60.0, after_played=59.0, after_second=40.0)
    return EvalPoints(**{**base, **kw})


def facts(**kw) -> MoveFacts:
    base = dict(
        played_is_best=False, is_check=False, is_capture=False, is_promotion=False,
        brilliant_offer_delta=0, brilliant_net_material=0, played_see=0,
        direct_recapture=False, mate_before_mover=None,
        mate_after_played_mover=None, is_only_legal_move=False,
    )
    return MoveFacts(**{**base, **kw})


def arm(explanation, name):
    return next(a for a in explanation.arms if a.name == name)


# --- Check.margin ---------------------------------------------------------


@pytest.mark.parametrize("op_arm, expected", [
    # mate_before_mover 2 <= 2 -> no slack left; mate_after 7 >= 5 -> 2 to spare.
    ("mate_before_mover", 0),
    ("mate_after_played", 2),
])
def test_margin_is_signed_slack_from_flipping(op_arm, expected):
    e = explain(
        points(after_played=69.8),
        facts(mate_before_mover=2, mate_after_played_mover=7),
        miss_mate_before_max=2, miss_mate_after_min=5,
    )
    check = next(c for c in arm(e, "_short_mate_delay").checks if c.name == op_arm)
    assert check.passed
    assert check.margin == expected


def test_margin_is_none_when_the_input_is_unknown():
    e = explain(points(after_second=None), facts(played_is_best=True, is_check=True))
    check = next(
        c for c in arm(e, "_great_only_move").checks if c.name == "only_gap"
    )
    assert not check.known
    assert check.margin is None
    assert not check.passed, "an unknown check never passes"


def test_margin_is_none_for_boolean_and_presence_checks():
    e = explain(points(), facts())
    brilliant = arm(e, "brilliant")
    assert next(c for c in brilliant.checks if c.name == "is_promotion").margin is None
    squandered = arm(e, "_squandered_opportunity")
    assert next(c for c in squandered.checks if c.name == "before_opp").margin is None


# --- UNKNOWN / INDETERMINATE ----------------------------------------------


def test_absent_second_line_makes_the_only_move_arm_indeterminate():
    """The tier-2 case: a review-store game has no `after_second`, so this arm
    is unanswerable — not answered "no"."""
    e = explain(
        points(after_second=None, before=60.0, after_played=59.5),
        facts(played_is_best=True, is_check=True),
    )
    only_move = arm(e, "_great_only_move")
    assert not only_move.fired
    assert only_move.indeterminate
    assert only_move.blocked_by is None, "nothing known ruled it out"


def test_absent_second_line_makes_brilliant_indeterminate():
    e = explain(
        points(after_second=None, before=60.0, after_played=59.0),
        facts(
            played_is_best=True,
            brilliant_offer_delta=2,
            brilliant_net_material=1,
        ),
    )
    brilliant = arm(e, "brilliant")
    second = next(c for c in brilliant.checks if c.name == "after_second")
    assert not brilliant.fired
    assert brilliant.indeterminate
    assert brilliant.blocked_by is None
    assert not second.known and second.margin is None


def test_absent_previous_move_makes_both_great_arms_indeterminate():
    """A surface with no previous ply cannot answer `direct_recapture`. It must
    read `?`, never `no` — the same contract `after_second` has."""
    e = explain(
        # Every other check on both arms passes, so the gate is what is left.
        points(before_opp=40.0, before=60.0, after_played=59.5, after_second=None),
        facts(played_is_best=True, is_capture=True, direct_recapture=None),
    )
    for name in ("_great_banked_swing", "_great_only_move"):
        assert arm(e, name).indeterminate
    check = next(
        c for c in arm(e, "_great_only_move").checks if c.name == "non_obvious"
    )
    assert not check.known and not check.passed


def test_a_known_failure_outranks_an_unknown_check():
    """An arm with a real failing check is a definite `no`, even if a later
    check could not be evaluated."""
    e = explain(
        points(after_second=None),
        facts(played_is_best=False),  # fails the shared gate
    )
    only_move = arm(e, "_great_only_move")
    assert not only_move.fired
    assert not only_move.indeterminate
    assert only_move.blocked_by == "played_is_best"


def test_first_ply_is_a_clean_failure_not_indeterminate():
    """`before_opp` absent on ply 1 is a fact about the game, not a gap in the
    data — so the swing arms report `no`, with the presence check as the
    blocker."""
    e = explain(points(before_opp=None), facts(played_is_best=True, is_check=True))
    for name in ("_great_banked_swing", "_squandered_opportunity"):
        assert not arm(e, name).indeterminate
        assert arm(e, name).blocked_by == "before_opp"


# --- Arms: fires / does not fire ------------------------------------------


def test_forced_arm_fires_and_wins_the_label():
    e = explain(points(), facts(is_only_legal_move=True))
    assert e.label == "forced"
    assert arm(e, "forced").fired


def test_brilliant_good_move_group_is_an_or_of_three():
    """Only the tolerance alternative holds here; the group still passes, and
    the trace says which one carried it."""
    e = explain(
        points(before=71.0, after_played=69.8),
        facts(brilliant_offer_delta=2, brilliant_net_material=1),
        brilliant_good_tol=2.0,
        brilliant_floor=50.0,
        brilliant_alt_ceiling=85.0,
        brilliant_offer_delta_min=2,
        brilliant_net_material_floor=1,
    )
    group = next(c for c in arm(e, "brilliant").checks if c.name == "good_move")
    assert group.passed
    assert [c.name for c in group.checks if c.passed] == ["good_tol"]
    assert e.label == "brilliant"


def test_blocked_by_names_the_first_failing_check_in_shipped_order():
    e = explain(points(), facts(is_promotion=True))
    assert arm(e, "brilliant").blocked_by == "is_promotion"


def test_brilliant_trace_names_values_margins_and_order_match_the_rule():
    e = explain(
        points(before=60.0, after_played=59.0, after_second=84.0),
        facts(
            played_is_best=True,
            brilliant_offer_delta=2,
            brilliant_net_material=1,
        ),
        brilliant_alt_ceiling=85.0,
        brilliant_offer_delta_min=2,
        brilliant_net_material_floor=1,
    )
    brilliant = arm(e, "brilliant")
    assert [check.name for check in brilliant.checks] == [
        "is_promotion",
        "good_move",
        "after_played",
        "after_second",
        "brilliant_offer_delta",
        "brilliant_net_material",
    ]
    checks = {check.name: check for check in brilliant.checks if check.name != "good_move"}
    assert (checks["after_second"].lhs, checks["after_second"].margin) == (84.0, 1.0)
    assert (checks["brilliant_offer_delta"].lhs,
            checks["brilliant_offer_delta"].margin) == (2, 0)
    assert (checks["brilliant_net_material"].lhs,
            checks["brilliant_net_material"].margin) == (1, 0)


def test_every_arm_is_traced_even_after_the_label_is_settled():
    """`classify()` short-circuits at `forced`; the trace still evaluates the
    later arms, which is what makes "how close was the next one?" answerable."""
    e = explain(points(), facts(is_only_legal_move=True))
    assert e.label == "forced"
    assert len(e.arms) == 7
    miss = arm(e, "_squandered_opportunity")
    assert any(c.known for c in miss.checks), "later arms are still computed"


def test_explain_label_tracks_classify_under_non_shipped_knobs():
    p = points(before=71.0, after_played=69.8, after_second=84.0)
    f = facts(brilliant_offer_delta=2, brilliant_net_material=1)
    knobs = dict(brilliant_good_tol=2.0, brilliant_alt_ceiling=85.0)
    assert explain(p, f, **knobs).label == classify(p, f, **knobs)
    tight = dict(brilliant_good_tol=0.5, brilliant_alt_ceiling=85.0)
    assert explain(p, f, **tight).label == classify(p, f, **tight)
    assert explain(p, f, **tight).label != "brilliant", "the knob must bite"
