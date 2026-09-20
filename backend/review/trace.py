"""Pure JSON view of a classifier explanation."""
from __future__ import annotations

from config import (
    RATING_K_AT_1000,
    RATING_K_AT_2000,
    RATING_K_MAX,
    RATING_K_MIN,
)

from .classify import Arm, Check, Explanation, Group, band_for
from .expected import k_for
from .winchance import win_chance

FAMILIES = (
    ("forced", ("forced",)),
    ("brilliant", ("brilliant",)),
    ("great", ("_great_banked_swing", "_great_only_move")),
    ("miss", ("_missed_mate", "_short_mate_delay", "_squandered_opportunity")),
)

_K_FEATURES = ("before_opp", "before", "after_played", "after_second")


def _check_state(check: Check | Group) -> str:
    if not check.known:
        return "unknown"
    return "ok" if check.passed else "fail"


def _arm_state(arm: Arm) -> str:
    if arm.fired:
        return "yes"
    return "indeterminate" if arm.indeterminate else "no"


def _family_state(arms: list[Arm]) -> str:
    if any(arm.fired for arm in arms):
        return "yes"
    if any(arm.indeterminate for arm in arms):
        return "indeterminate"
    return "no"


def _check_json(check: Check | Group) -> dict:
    if isinstance(check, Group):
        return {
            "kind": "group",
            "name": check.name,
            "mode": check.mode,
            "state": _check_state(check),
            "checks": [_check_json(child) for child in check.checks],
        }
    return {
        "kind": "check",
        "name": check.name,
        "lhs": check.lhs,
        "op": check.op,
        "rhs": check.rhs,
        "state": _check_state(check),
        "margin": check.margin,
    }


def k_rows(header: dict) -> list[dict]:
    """Rating-curve panel rows from white-POV raw centipawns."""
    active_k = k_for(header.get("elo"))
    mover_is_white = header["mover_is_white"]
    rows = []
    for feature in _K_FEATURES:
        cp = header["cp"].get(feature)
        if cp is None:
            rows.append({
                "feature": feature,
                "cp": None,
                "at_1000": None,
                "at_k": None,
                "at_2000": None,
            })
            continue
        cp_mover = cp if mover_is_white else -cp
        rows.append({
            "feature": feature,
            "cp": cp,
            "at_1000": round(win_chance(cp_mover, RATING_K_AT_1000), 1),
            "at_k": round(win_chance(cp_mover, active_k), 1),
            "at_2000": round(win_chance(cp_mover, RATING_K_AT_2000), 1),
        })
    return rows


def to_json(
    explanation: Explanation,
    header: dict,
    *,
    points,
    facts,
) -> dict:
    by_name = {arm.name: arm for arm in explanation.arms}
    families = []
    for family_name, arm_names in FAMILIES:
        arms = [by_name[name] for name in arm_names]
        families.append({
            "name": family_name,
            "state": _family_state(arms),
            "arms": [
                {
                    "name": arm.name,
                    "state": _arm_state(arm),
                    "blocked_by": arm.blocked_by,
                    "checks": [_check_json(check) for check in arm.checks],
                }
                for arm in arms
            ],
        })

    active_k = k_for(header.get("elo"))
    drop = max(0.0, points.before - points.after_played)
    response_header = {
        key: header.get(key)
        for key in ("san", "color", "elo", "k", "source", "stored_label", "cp")
    }
    response_header["k"] = header.get("k", active_k)

    return {
        "label": explanation.label,
        "header": response_header,
        "families": families,
        "k_panel": {
            "at_1000": RATING_K_AT_1000,
            "at_2000": RATING_K_AT_2000,
            "clamp": [RATING_K_MIN, RATING_K_MAX],
            "active": active_k,
            "clamped": active_k in (RATING_K_MIN, RATING_K_MAX),
            "rows": k_rows(header),
        },
        "band_for": {
            "label": band_for(points, facts),
            "drop": round(drop, 1),
        },
        # Inputs the caller could not supply, so a check reads `?` rather than
        # `no`. Both are optional by construction — see review/stored.py.
        "partial": (
            (["after_second"] if points.after_second is None else [])
            + (["direct_recapture"] if facts.direct_recapture is None else [])
        ),
    }
