import inspect
from dataclasses import dataclass
from typing import Callable, NamedTuple

from config import (
    BAND_BLUNDER, BAND_MISTAKE, BAND_INACCURACY, BAND_GOOD,
    BRILLIANT_ALT_CEILING, BRILLIANT_FLOOR, BRILLIANT_GOOD_TOL,
    BRILLIANT_NET_MATERIAL_FLOOR, BRILLIANT_OFFER_DELTA_MIN,
    GREAT_SWING, GREAT_HOLD, GREAT_RESULT_FLOOR, GREAT_ONLY_AFTER, GREAT_ONLY_GAP,
    GREAT_ROUTINE_SEE_FLOOR,
    MISS_SWING, MISS_DROP, MISS_CHANCE, MISS_ALIVE,
    MISS_MATE_BEFORE_MAX, MISS_MATE_AFTER_MIN,
)

CLASSIFICATIONS = (
    "book", "forced",
    "brilliant", "great", "best", "excellent", "good",
    "inaccuracy", "mistake", "blunder", "miss",
)


@dataclass(frozen=True)
class EvalPoints:
    """Mover-POV expected points, 0..100, each computed with the MOVER's own
    k (see review/expected.py:k_for) -- rating-aware, not a single shared
    curve. See the classifier design spec §3 for the full field contract."""

    before_opp: float | None
    """Expected points facing the mover BEFORE the opponent's previous move
    -- i.e. the previous ply's `before`, re-converted with the CURRENT
    mover's k (not the opponent's -- every feature lives in the current
    mover's curve). None on the first scored ply of the game (no previous
    ply to swing from)."""

    before: float
    """Position facing the mover, assuming best play (== the eval after the
    engine's own best move -- these have always been the same value in this
    pipeline)."""

    after_played: float
    """Position after the move the mover actually played."""

    after_second: float | None
    """Position after the engine's best ALTERNATIVE line (second-best
    multipv). None when the engine only analyzed one line."""


@dataclass(frozen=True)
class MoveFacts:
    played_is_best: bool
    is_check: bool
    is_capture: bool
    is_promotion: bool
    brilliant_offer_delta: int
    brilliant_net_material: int
    # review/hanging.py:played_capture_see — what THIS capture wins outright;
    # 0 for a quiet move.
    played_see: int
    # review/hanging.py:direct_recapture. None means the previous move was not
    # supplied, never "no" — the gate then reads INDETERMINATE.
    direct_recapture: bool | None
    mate_before_mover: int | None
    mate_after_played_mover: int | None
    is_only_legal_move: bool


# ---------------------------------------------------------------------------
# Check specs — the single source of every threshold and every rule ordering.
#
# The structure of a check is constant; only its left-hand value varies per
# ply. So structure is built once, at import, and the materialised `Check`
# objects below exist only when something asks for a trace. Two consumers read
# these specs: `fired()` (hot path, short-circuits, allocates nothing) and
# `materialise()` (trace path). Because both read the SAME specs, the trace and
# the label cannot disagree by construction -- see the design spec for why a
# separate explain module re-deriving margins was rejected.
# ---------------------------------------------------------------------------


class CheckSpec(NamedTuple):
    name: str
    read: Callable[["EvalPoints", "MoveFacts"], float | int | bool | None]
    op: str                        # "<=", ">=", "<", ">", "is", "is-set"
    rhs: float | int | bool | str  # literal, or a classify() knob name


class GroupSpec(NamedTuple):
    """An OR of specs. `brilliant`'s good_move is three alternatives; a flat
    AND list cannot express it without lying about which one held."""

    name: str
    mode: str                      # "any" (only OR needs a group today)
    specs: tuple[CheckSpec, ...]


class ArmSpec(NamedTuple):
    name: str
    specs: tuple[CheckSpec | GroupSpec, ...]   # shared preconditions first


# "is" is `bool(lhs) is rhs`, not `lhs is rhs`: it stands in for the `not x` /
# bare `x` truth tests it replaced, and must keep their exact semantics.
_COMPARATORS: dict[str, Callable[..., bool]] = {
    "<=": lambda a, b: a <= b,
    ">=": lambda a, b: a >= b,
    "<": lambda a, b: a < b,
    ">": lambda a, b: a > b,
    "is": lambda a, b: bool(a) is b,
}


def _resolve(rhs: float | int | bool | str, knobs: dict) -> float | int | bool:
    return knobs[rhs] if isinstance(rhs, str) else rhs


def _passes(op: str, lhs, rhs) -> bool:
    """Does one check hold, given an already-resolved `rhs`? The single
    evaluator behind BOTH spec consumers -- `fired()` and `Check.passed` --
    which each had their own copy of this until 2026-07-28. Sharing the specs
    never made them share the verdict; only this does.

    "is-set" asks whether the input EXISTS, so None is an answer, not a gap.
    Every other op treats a None left-hand side as UNKNOWN, which never passes
    -- that is what the old `x is not None and x <= n` chains did.
    """
    if op == "is-set":
        return (lhs is not None) is rhs
    if lhs is None:
        return False
    return _COMPARATORS[op](lhs, rhs)


def fired(
    spec: "CheckSpec | GroupSpec | ArmSpec",
    points: EvalPoints, facts: MoveFacts, knobs: dict,
) -> bool:
    """Hot path. Generator + all() -> short-circuits exactly like the `and`
    chains this replaced, and allocates nothing."""
    if type(spec) is ArmSpec:
        return all(fired(s, points, facts, knobs) for s in spec.specs)
    if type(spec) is GroupSpec:
        return any(fired(s, points, facts, knobs) for s in spec.specs)
    return _passes(
        spec.op, spec.read(points, facts), _resolve(spec.rhs, knobs)
    )


# --- Materialised types — only the trace path constructs these -------------


@dataclass(frozen=True)
class Check:
    name: str
    lhs: float | int | bool | None
    op: str
    rhs: float | int | bool

    @property
    def known(self) -> bool:
        return self.op == "is-set" or self.lhs is not None

    @property
    def passed(self) -> bool:
        return _passes(self.op, self.lhs, self.rhs)

    @property
    def margin(self) -> float | int | None:
        """Signed slack: how far the left-hand value is from flipping this
        check. Positive means passing with room. None where the notion does
        not apply -- an unknown input, or a boolean/presence check."""
        if not self.known or self.op in ("is", "is-set"):
            return None
        if isinstance(self.lhs, bool) or isinstance(self.rhs, bool):
            return None
        return self.lhs - self.rhs if self.op in (">=", ">") else self.rhs - self.lhs


@dataclass(frozen=True)
class Group:
    name: str
    mode: str
    checks: tuple[Check, ...]

    @property
    def passed(self) -> bool:
        return any(c.passed for c in self.checks)

    @property
    def known(self) -> bool:
        # One passing alternative settles an OR even if a sibling is unknown.
        return self.passed or all(c.known for c in self.checks)


@dataclass(frozen=True)
class Arm:
    name: str
    checks: tuple[Check | Group, ...]

    @property
    def fired(self) -> bool:
        return all(c.passed for c in self.checks)

    @property
    def indeterminate(self) -> bool:
        """Something this arm needed was absent, and nothing known ruled it
        out. Distinct from "did not fire" -- reporting an absent input as a
        `no` is the failure the trace exists to prevent."""
        return (
            not self.fired
            and not any(c.known and not c.passed for c in self.checks)
            and any(not c.known for c in self.checks)
        )

    @property
    def blocked_by(self) -> str | None:
        """First check that is known to have failed, in shipped order."""
        return next((c.name for c in self.checks if c.known and not c.passed), None)


@dataclass(frozen=True)
class Explanation:
    label: str
    arms: tuple[Arm, ...]          # shipped precedence order


def materialise(
    spec: "CheckSpec | GroupSpec | ArmSpec",
    points: EvalPoints, facts: MoveFacts, knobs: dict,
):
    """Trace path. Evaluates EVERY spec in the arm, including ones `fired()`
    would have short-circuited past -- they are pure comparisons, so computing
    them costs nothing but the trace, and "how close was the next check?" is
    unanswerable without them."""
    if type(spec) is ArmSpec:
        return Arm(spec.name, tuple(
            materialise(s, points, facts, knobs) for s in spec.specs
        ))
    if type(spec) is GroupSpec:
        return Group(spec.name, spec.mode, tuple(
            materialise(s, points, facts, knobs) for s in spec.specs
        ))
    return Check(
        spec.name, spec.read(points, facts), spec.op,
        spec.rhs if spec.op == "is-set" else _resolve(spec.rhs, knobs),
    )


def _non_obvious(facts: MoveFacts) -> bool | None:
    """A great is never a routine recapture. Reads capture GEOMETRY,
    not move syntax: the opponent just took here, or the capture wins material
    outright. A check is no longer exempt (experiments 061/068 arm C).

    Tri-state, because `direct_recapture` is -- None only when the previous
    move was not supplied AND the SEE half has not already settled it. That
    ordering is why the see check comes first in `_GREAT_GATE`."""
    return None if facts.direct_recapture is None else not facts.direct_recapture


def _costs_nothing(points: EvalPoints) -> bool:
    """The played move gives up nothing against the engine's own best -- it
    either IS the best line's value or beats it (search noise: `after_played`
    comes from a separate search of the after-position).

    Exists because `played_is_best` is decided by the engine's multipv ORDERING,
    and the engine has to break ties somehow -- 2 of the corpus's 7 brilliants
    are our rank-2, both dead-tied with our rank-1. Calling one "best" and the
    other not is an artifact of list order, so brilliant treats a tie as best.

    Deliberately an EQUALITY, not a tolerance. A tolerance would be a number on
    the expected-points scale, hence curve-coupled to RATING_K_* -- the exact
    defect BRILLIANT_ALT_WIN had. Equal expected points and equal centipawns are
    the same statement under EVERY k, so there is nothing to refit. Lab
    experiment 018 measured both at an identical score.

    Not used by `band_for`: a tie is still "excellent" there, never "best"."""
    return points.after_played >= points.before


def _swing(points: EvalPoints) -> float | None:
    """Expected points the opponent's previous move handed the mover. None on
    the first scored ply -- guarded by an explicit `before_opp is-set` check in
    every arm that reads it, so ply 1 reads as a clean FAIL, not as UNKNOWN."""
    if points.before_opp is None:
        return None
    return points.before - points.before_opp


_FORCED = ArmSpec("forced", (
    CheckSpec("is_only_legal_move", lambda p, f: f.is_only_legal_move, "is", True),
))

_BRILLIANT = ArmSpec("brilliant", (
    CheckSpec("is_promotion",  lambda p, f: f.is_promotion,               "is", False),
    GroupSpec("good_move", "any", (
        CheckSpec("played_is_best", lambda p, f: f.played_is_best,        "is", True),
        CheckSpec("costs_nothing",  lambda p, f: _costs_nothing(p),       "is", True),
        CheckSpec("good_tol", lambda p, f: p.before - p.after_played, "<=", "brilliant_good_tol"),
    )),
    CheckSpec("after_played",  lambda p, f: p.after_played, ">=", "brilliant_floor"),
    CheckSpec("after_second",  lambda p, f: p.after_second, "<",  "brilliant_alt_ceiling"),
    CheckSpec("brilliant_offer_delta", lambda p, f: f.brilliant_offer_delta,
              ">=", "brilliant_offer_delta_min"),
    CheckSpec("brilliant_net_material", lambda p, f: f.brilliant_net_material,
              ">=", "brilliant_net_material_floor"),
))

# The 005 hybrid's shared gate. Hoisted into BOTH arms rather than evaluated
# once outside them: `fired()`'s all() short-circuits on the first spec, so a
# gate placed first stays a gate, and each arm's trace stays readable alone.
#
# `non_obvious` is TWO checks because a CheckSpec's `read` sees no knobs, so the
# SEE half has to be the comparison itself to keep its floor a knob. Order is
# load-bearing: an outright-winning capture is routine whatever preceded it, so
# testing it first keeps `non_obvious`'s unknown branch to the plies where the
# previous move actually decides the answer.
_GREAT_GATE = (
    CheckSpec("played_is_best", lambda p, f: f.played_is_best,      "is", True),
    CheckSpec("see_unprofitable", lambda p, f: f.played_see,        "<", "great_routine_see_floor"),
    CheckSpec("non_obvious",    lambda p, f: _non_obvious(f),       "is", True),
)

_GREAT_BANKED_SWING = ArmSpec("_great_banked_swing", _GREAT_GATE + (
    CheckSpec("before_opp",   lambda p, f: p.before_opp,                "is-set", True),
    CheckSpec("swing",        lambda p, f: _swing(p),                   ">=", "great_swing"),
    CheckSpec("hold",         lambda p, f: p.before - p.after_played,   "<=", "great_hold"),
    CheckSpec("after_played", lambda p, f: p.after_played,              ">=", "great_result_floor"),
))

# No `after_second is-set` check, deliberately: a missing second line is a
# genuinely UNKNOWN input (the engine analysed one line), so this arm must read
# INDETERMINATE rather than `no`. Contrast `before_opp` above, whose absence is
# a fact about the game, not a gap in the data. `only_gap` keeps that by reading
# None rather than raising, which `_passes` turns into the same UNKNOWN.
_GREAT_ONLY_MOVE = ArmSpec("_great_only_move", _GREAT_GATE + (
    CheckSpec("hold",         lambda p, f: p.before - p.after_played, "<=", "great_hold"),
    CheckSpec("after_played", lambda p, f: p.after_played,            ">=", "great_only_after"),
    CheckSpec("only_gap",     lambda p, f: None if p.after_second is None
                              else p.after_played - p.after_second,   ">=", "great_only_gap"),
))

_GREAT_ARMS = (_GREAT_BANKED_SWING, _GREAT_ONLY_MOVE)

# Had a forced mate, the played move gave it up. Independent of the win-% drop
# (the sigmoid saturates on both sides of a mate, so the drop is tiny even when
# the whole win evaporates). The < 99 guard filters search-horizon noise: the
# after-position search is one ply shallower on the same line, so a "lost" mate
# that leaves ~100% win is the mate slipping past the horizon, not a squander.
_MISSED_MATE = ArmSpec("_missed_mate", (
    CheckSpec("played_is_best",          lambda p, f: f.played_is_best,           "is", False),
    CheckSpec("mate_before_mover",       lambda p, f: f.mate_before_mover,        "is-set", True),
    CheckSpec("mate_after_played_mover", lambda p, f: f.mate_after_played_mover,  "is-set", False),
    CheckSpec("after_played",            lambda p, f: p.after_played,             "<", 99.0),
))

_SHORT_MATE_DELAY = ArmSpec("_short_mate_delay", (
    CheckSpec("played_is_best",          lambda p, f: f.played_is_best,          "is", False),
    CheckSpec("has_mate_before",         lambda p, f: f.mate_before_mover,       "is-set", True),
    CheckSpec("mate_before_min",         lambda p, f: f.mate_before_mover,       ">=", 1),
    CheckSpec("mate_before_mover",       lambda p, f: f.mate_before_mover,       "<=", "miss_mate_before_max"),
    CheckSpec("has_mate_after",          lambda p, f: f.mate_after_played_mover, "is-set", True),
    CheckSpec("mate_after_played",       lambda p, f: f.mate_after_played_mover, ">=", "miss_mate_after_min"),
))

# Mirrors great in the same expected-points space: where great BANKS an
# opponent-handed swing, miss DROPS one. No played_is_best guard needed --
# miss_drop's floor cannot fire on a best move (before - after_played ~= 0 by
# construction). Ply 1 -> no opportunity to have squandered.
_SQUANDERED_OPPORTUNITY = ArmSpec("_squandered_opportunity", (
    CheckSpec("before_opp",   lambda p, f: p.before_opp,              "is-set", True),
    CheckSpec("swing",        lambda p, f: _swing(p),                 ">=", "miss_swing"),
    CheckSpec("drop",         lambda p, f: p.before - p.after_played, ">=", "miss_drop"),
    CheckSpec("before",       lambda p, f: p.before,                  ">=", "miss_chance"),
    CheckSpec("after_played", lambda p, f: p.after_played,            ">=", "miss_alive"),
))

_MISS_ARMS = (_MISSED_MATE, _SHORT_MATE_DELAY, _SQUANDERED_OPPORTUNITY)

# Shipped precedence order — the order classify() tries them.
_ALL_ARMS = (_FORCED, _BRILLIANT) + _GREAT_ARMS + _MISS_ARMS


def is_brilliant(
    points: EvalPoints, facts: MoveFacts, *,
    brilliant_floor: float, brilliant_alt_ceiling: float,
    brilliant_offer_delta_min: int, brilliant_net_material_floor: int,
    brilliant_good_tol: float,
) -> bool:
    """Experiment 077's precision-first alternative-line/material rule."""
    return fired(_BRILLIANT, points, facts, locals())


def is_great(
    points: EvalPoints, facts: MoveFacts, *,
    great_swing: float, great_hold: float, great_result_floor: float,
    great_only_after: float, great_only_gap: float, great_routine_see_floor: int,
) -> bool:
    """The 005 hybrid. Arm 1 banks an
    opponent-handed swing; arm 2 fires when the move beats every alternative by
    a margin, independent of what preceded it. Both arms are in `_GREAT_ARMS`.

    Arm 2 measures the alternative RELATIVELY, not against an absolute cutoff:
    reference greats have another good move 64% of the time, so "no other
    move is good" is not the rule its wording claims."""
    knobs = locals()
    return any(fired(arm, points, facts, knobs) for arm in _GREAT_ARMS)


def is_miss(
    points: EvalPoints, facts: MoveFacts, *,
    miss_swing: float, miss_drop: float, miss_chance: float, miss_alive: float,
    miss_mate_before_max: int = MISS_MATE_BEFORE_MAX,
    miss_mate_after_min: int = MISS_MATE_AFTER_MIN,
) -> bool:
    """Three independent arms (`_MISS_ARMS`), any of which is a miss."""
    knobs = locals()
    return any(fired(arm, points, facts, knobs) for arm in _MISS_ARMS)


def band_for(points: EvalPoints, facts: MoveFacts) -> str:
    """The non-special tail of the ladder: best, then the expected-points-drop
    bands. Public so a lab experiment testing a NEW special rule can compose
    the shipped ones (is_brilliant / is_great / is_miss / band_for) instead of
    hand-porting all five -- the port is what used to drift from prod."""
    # Strict best: only the engine move earns "best". A tiny-drop alternative
    # is excellent (calibration game 171122613282: the old
    # `or win_drop < BAND_EXCELLENT` clamp swallowed 11 moves).
    if facts.played_is_best:
        return "best"

    drop = max(0.0, points.before - points.after_played)
    if drop < BAND_GOOD:
        return "excellent"
    if drop < BAND_INACCURACY:
        return "good"
    if drop < BAND_MISTAKE:
        return "inaccuracy"
    if drop < BAND_BLUNDER:
        return "mistake"
    return "blunder"


def classify(
    points: EvalPoints,
    facts: MoveFacts,
    *,
    # Threaded explicitly rather than read as module globals so a dev sweep
    # script can re-run classify() at other knob values without monkeypatching.
    brilliant_floor: float = BRILLIANT_FLOOR,
    brilliant_alt_ceiling: float = BRILLIANT_ALT_CEILING,
    brilliant_offer_delta_min: int = BRILLIANT_OFFER_DELTA_MIN,
    brilliant_net_material_floor: int = BRILLIANT_NET_MATERIAL_FLOOR,
    brilliant_good_tol: float = BRILLIANT_GOOD_TOL,
    great_swing: float = GREAT_SWING,
    great_hold: float = GREAT_HOLD,
    great_result_floor: float = GREAT_RESULT_FLOOR,
    great_only_after: float = GREAT_ONLY_AFTER,
    great_only_gap: float = GREAT_ONLY_GAP,
    great_routine_see_floor: int = GREAT_ROUTINE_SEE_FLOOR,
    miss_swing: float = MISS_SWING,
    miss_drop: float = MISS_DROP,
    miss_chance: float = MISS_CHANCE,
    miss_alive: float = MISS_ALIVE,
    miss_mate_before_max: int = MISS_MATE_BEFORE_MAX,
    miss_mate_after_min: int = MISS_MATE_AFTER_MIN,
) -> str:
    """Six ordered pure rules over (points, facts); each knob is documented
    where it is declared in config.py."""
    if facts.is_only_legal_move:
        return "forced"

    if is_brilliant(
        points, facts, brilliant_floor=brilliant_floor,
        brilliant_alt_ceiling=brilliant_alt_ceiling,
        brilliant_offer_delta_min=brilliant_offer_delta_min,
        brilliant_net_material_floor=brilliant_net_material_floor,
        brilliant_good_tol=brilliant_good_tol,
    ):
        return "brilliant"

    if is_great(
        points, facts,
        great_swing=great_swing, great_hold=great_hold, great_result_floor=great_result_floor,
        great_only_after=great_only_after, great_only_gap=great_only_gap,
        great_routine_see_floor=great_routine_see_floor,
    ):
        return "great"

    if is_miss(
        points, facts,
        miss_swing=miss_swing, miss_drop=miss_drop, miss_chance=miss_chance, miss_alive=miss_alive,
        miss_mate_before_max=miss_mate_before_max,
        miss_mate_after_min=miss_mate_after_min,
    ):
        return "miss"

    return band_for(points, facts)


def knob_defaults() -> dict:
    """classify()'s knob names and their shipped values, read off its own
    signature so a caller cannot drift from the shipped config. The trace CLI
    and the corpus equivalence test both need this list; neither may keep its
    own."""
    return {
        name: param.default
        for name, param in inspect.signature(classify).parameters.items()
        if param.default is not inspect.Parameter.empty
    }


def explain(
    points: EvalPoints,
    facts: MoveFacts,
    *,
    # Mirrors classify()'s knobs exactly, so a trace can be taken at a
    # non-shipped config.
    brilliant_floor: float = BRILLIANT_FLOOR,
    brilliant_alt_ceiling: float = BRILLIANT_ALT_CEILING,
    brilliant_offer_delta_min: int = BRILLIANT_OFFER_DELTA_MIN,
    brilliant_net_material_floor: int = BRILLIANT_NET_MATERIAL_FLOOR,
    brilliant_good_tol: float = BRILLIANT_GOOD_TOL,
    great_swing: float = GREAT_SWING,
    great_hold: float = GREAT_HOLD,
    great_result_floor: float = GREAT_RESULT_FLOOR,
    great_only_after: float = GREAT_ONLY_AFTER,
    great_only_gap: float = GREAT_ONLY_GAP,
    great_routine_see_floor: int = GREAT_ROUTINE_SEE_FLOOR,
    miss_swing: float = MISS_SWING,
    miss_drop: float = MISS_DROP,
    miss_chance: float = MISS_CHANCE,
    miss_alive: float = MISS_ALIVE,
    miss_mate_before_max: int = MISS_MATE_BEFORE_MAX,
    miss_mate_after_min: int = MISS_MATE_AFTER_MIN,
) -> Explanation:
    """A per-check trace of the same ordered rules `classify()` runs, over
    EVERY arm -- including the ones classify() short-circuits past once the
    label is settled. Reads the same specs as `fired()`, so the trace and the
    label cannot disagree; `tests/calibration/test_explain.py` asserts that
    over the whole corpus."""
    knobs = locals()
    arms = tuple(materialise(spec, points, facts, knobs) for spec in _ALL_ARMS)
    by_name = {arm.name: arm for arm in arms}

    if by_name["forced"].fired:
        label = "forced"
    elif by_name["brilliant"].fired:
        label = "brilliant"
    elif any(by_name[s.name].fired for s in _GREAT_ARMS):
        label = "great"
    elif any(by_name[s.name].fired for s in _MISS_ARMS):
        label = "miss"
    else:
        label = band_for(points, facts)

    return Explanation(label, arms)
