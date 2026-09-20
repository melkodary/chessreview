from dataclasses import dataclass
from math import floor
from typing import Literal, Mapping

from config import (
    GAME_RATING_ELO_PER_ACCURACY_POINT,
    GAME_RATING_EXPECTED_AT_1000,
    GAME_RATING_EXPECTED_AT_2000,
    GAME_RATING_EXPECTED_MAX,
    GAME_RATING_EXPECTED_MIN,
    GAME_RATING_MAX,
    GAME_RATING_MIN,
    GAME_RATING_ROUND_STEP,
)

GAME_RATING_ALGORITHM = "formula-v1"


@dataclass(frozen=True)
class GameRatingInputs:
    own_elo: int
    opponent_elo: int
    accuracy: float
    result: Literal["win", "draw", "loss"]
    move_count: int
    counts: Mapping[str, int]


@dataclass(frozen=True)
class GameRatingParams:
    expected_at_1000: float
    expected_at_2000: float
    expected_min: float
    expected_max: float
    elo_per_accuracy_point: float
    rating_min: int
    rating_max: int
    round_step: int


production_defaults = GameRatingParams(
    expected_at_1000=GAME_RATING_EXPECTED_AT_1000,
    expected_at_2000=GAME_RATING_EXPECTED_AT_2000,
    expected_min=GAME_RATING_EXPECTED_MIN,
    expected_max=GAME_RATING_EXPECTED_MAX,
    elo_per_accuracy_point=GAME_RATING_ELO_PER_ACCURACY_POINT,
    rating_min=GAME_RATING_MIN,
    rating_max=GAME_RATING_MAX,
    round_step=GAME_RATING_ROUND_STEP,
)


def expected_accuracy(
    elo: int, *, params: GameRatingParams = production_defaults,
) -> float:
    slope = (
        (params.expected_at_2000 - params.expected_at_1000)
        / (2000 - 1000)
    )
    raw = params.expected_at_1000 + (elo - 1000) * slope
    return max(params.expected_min, min(params.expected_max, raw))


def _round_half_up(value: float, step: int) -> int:
    return int(floor(value / step + 0.5) * step)


def estimate_game_rating(
    inputs: GameRatingInputs, *, params: GameRatingParams = production_defaults,
) -> int:
    raw = inputs.own_elo + params.elo_per_accuracy_point * (
        inputs.accuracy - expected_accuracy(inputs.own_elo, params=params)
    )
    clamped = max(params.rating_min, min(params.rating_max, raw))
    return _round_half_up(clamped, params.round_step)
