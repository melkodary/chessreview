import os
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_here = Path(__file__).parent

# The defaults below are the single source of truth for every knob. There is
# no committed .env / .env.example: `python -m config --dump-env` prints the
# catalogue on demand, and `.env.local` (gitignored) holds secrets, machine
# paths, and local tweaks. Precedence: real env > .env.local > these defaults.
#
# Under pytest the env file is skipped entirely (backend/conftest.py sets
# CHESSREVIEW_NO_DOTENV) so a local .env.local tweak can never re-tune the
# classifier the suite asserts against.
_env_files = () if os.getenv("CHESSREVIEW_NO_DOTENV") else (_here / ".env.local",)


@dataclass(frozen=True)
class EngineSpec:
    """One configured UCI review engine.

    `id` selects the entry; `expects` validates the binary's observed UCI
    identity before any position is analysed.
    """

    id: str
    path: str
    options: dict[str, int | str | bool]
    expects: str


class Settings(BaseSettings):
    """Typed app config. Field names map case-insensitively to env vars."""

    model_config = SettingsConfigDict(
        env_file=_env_files,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Environment / store selection ───────────────────────────────────────
    # APP_ENV selects the review store's backing database (one SqlStore either
    # way): dev = in-memory SQLite, ephemeral and zero setup; prod = the SQLite
    # file at DATABASE_URL, durable across restart. DATABASE_URL is only read
    # when APP_ENV="prod"; an explicit override wins.
    app_env: Literal["dev", "prod"] = Field(
        "dev", description="dev = in-memory SQLite (ephemeral) | prod = SQLite file (durable)",
        json_schema_extra={"section": "Environment / store selection"},
    )
    database_url: str = Field(
        "sqlite:///./data/reviews.db", description="SQLite only; read when APP_ENV=prod",
    )

    # ── Server ──────────────────────────────────────────────────────────────
    log_level: str = Field(
        "INFO", description="DEBUG | INFO | WARNING | ERROR",
        json_schema_extra={"section": "Server"},
    )
    enable_explain: bool = Field(
        True,
        description="serve move-classifier traces; disable to hide the endpoint and engine path",
    )
    # NoDecode: skip pydantic-settings' JSON parsing so _split_origins handles
    # the comma-separated env string itself.
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        ["http://localhost:5173", "http://localhost"],
        description="comma-separated CORS allowlist",
    )
    host: str = Field("0.0.0.0", description="bind address")
    port: int = Field(8000, description="bind port")

    # ── Stockfish ───────────────────────────────────────────────────────────
    stockfish_path: str = Field(
        "/usr/bin/stockfish", description="engine binary; Mac (Homebrew): /opt/homebrew/bin/stockfish",
        json_schema_extra={"section": "Stockfish"},
    )
    review_engine: str = Field(
        "sf19", description="named review-engine registry entry (valid: sf19)",
    )

    # ── Stockfish — review pool (parallel position analysis) ────────────────
    # Per-review pool of single-thread engines analysing distinct positions in
    # parallel. Default 4 ≈ physical *performance* cores: one engine per fast
    # core, no oversubscription (measured optimum on Apple M2 — beyond 4 the
    # engines land on slow E-cores and add only overhead; >1 thread/engine
    # oversubscribes and is slower). Set 0 for auto (cpu_count - 1) on a
    # homogeneous many-core host. Transient RAM ≈ pool_size × pool_hash MB.
    stockfish_review_pool_size: int = Field(
        4, description="engines per review ≈ perf cores; 0 = auto (cpu_count-1)",
        json_schema_extra={"section": "Stockfish — review pool (parallel position analysis)"},
    )
    stockfish_review_pool_threads: int = Field(
        1, description="CPU threads per pooled engine (1 = no oversubscription)",
    )
    stockfish_review_pool_hash: int = Field(
        128, description="MB hash per pooled engine (RAM ≈ pool_size × this)",
    )
    stockfish_interactive_pool_size: int = Field(
        1, description="long-lived engines for deviation grading (POST /reviews/move); "
                       "walled off from the review pool so grading can't starve reviews. "
                       "Fixed = concurrency ceiling by construction, not a semaphore.",
        json_schema_extra={"section": "Stockfish — interactive grading pool (deviation moves)"},
    )
    stockfish_interactive_grade_timeout: float = Field(
        30.0, description="seconds a /reviews/move call waits for a free interactive "
                          "engine before returning 503 (all engines busy)",
    )

    # ── Review tuning — rating-aware expected-points model ──────────────────
    # depth / multipv are NOT here: the frontend owns them (sent per request,
    # validated by CreateReviewRequest). No competing backend default.
    #
    # k(elo): the win-chance sigmoid's steepness, a clamped straight line in the
    # mover's elo (continuous k; lab experiments 029/030 for the fit).
    # review/expected.py:k_for is the code.
    #
    # Stored as two ANCHOR VALUES, not base+slope: the true slope is 2.5e-6,
    # where a 10x typo in an env file still parses and still looks plausible.
    # The anchor elos live in the names, so a later re-anchoring cannot silently
    # change what every historical value meant.
    #
    # A single global k (rating-blind) is a supported configuration, not a code
    # change: set RATING_K_AT_2000 == RATING_K_AT_1000 (slope 0).
    #
    # The clamps are plateaus, not fits (experiment 030). MIN binds below elo 800
    # and is load-bearing; MAX binds at no in-corpus elo — it guards
    # extrapolation over the 100-4000 range the API accepts.
    rating_k_at_1000: float = Field(
        0.003, description="win-chance sigmoid steepness for an elo-1000 mover (029 anchor)",
        json_schema_extra={"section": "Review tuning — rating-aware expected-points model"},
    )
    rating_k_at_2000: float = Field(
        0.0055, description="steepness for an elo-2000 mover; the slope is derived from the two "
                            "anchors. Set equal to RATING_K_AT_1000 for a rating-blind global k",
    )
    rating_k_min: float = Field(
        0.0025, description="floor on k; binds below elo 800",
    )
    rating_k_max: float = Field(
        0.0065, description="ceiling on k; binds at no in-corpus elo — an extrapolation guard",
    )

    # Removed 2026-07-26 with the two-bucket step. Declared, not deleted:
    # model_config sets extra="ignore", so a stale RATING_K_LOW=0.0035 left in a
    # deploy's .env.local would be silently dropped and that deploy would revert
    # to the code default with no error. Declaring them turns that into a
    # startup failure naming the replacement. Checking os.environ instead would
    # miss the case entirely — .env.local is read by pydantic-settings' own
    # dotenv source and never reaches os.environ. Delete after a release or two.
    # "removed" keeps them out of `--dump-env`, which must read as an env file.
    rating_k_low: float | None = Field(
        None, description="REMOVED 2026-07-26 — see RATING_K_AT_1000",
        json_schema_extra={"removed": True},
    )
    rating_k_high: float | None = Field(
        None, description="REMOVED 2026-07-26 — see RATING_K_AT_2000",
        json_schema_extra={"removed": True},
    )
    rating_k_split: int | None = Field(
        None, description="REMOVED 2026-07-26 — k(elo) is continuous; there is no split",
        json_schema_extra={"removed": True},
    )

    # ── Review job queue (in-memory, ephemeral) ─────────────────────────────
    review_keep: int = Field(
        100, description="max review jobs kept in memory",
        json_schema_extra={"section": "Review job queue (in-memory, ephemeral)"},
    )
    review_ttl_hours: int = Field(
        24, description="terminal jobs older than this are deleted on the next insert",
    )
    review_default_source: str = Field(
        "unknown", description="origin label stamped on jobs submitted without one",
    )
    queue_acquire_timeout: float = Field(
        0.5, description="queued-worker cancel-check interval (s)",
    )
    review_meta_max_length: int = Field(
        100, description="max chars for source/user_id/game_id",
    )
    review_payload_max_plies: int = Field(
        600, description="frontend-eval review payload: more plies than this queues a backend review instead",
    )
    review_payload_max_bytes: int = Field(
        1_048_576, description="frontend-eval review payload: a larger request body queues a backend review instead",
    )

    # ── Opening book ────────────────────────────────────────────────────────
    opening_book_path: Path = Field(
        _here / "openings" / "elite.bin",
        description="read-only Polyglot opening book; missing/invalid falls back to ECO TSVs",
        json_schema_extra={"section": "Opening book"},
    )
    opening_eco_index_path: Path = Field(
        _here / "openings" / "eco.json.gz",
        description="precomputed ECO position index; missing/stale rebuilds from the TSVs (~1.5s)",
    )

    # ── Classifier benchmark ────────────────────────────────────────────────
    # Generated offline by lab/build_stats.py (the corpus is excluded from the
    # image, so this is never computed at runtime); missing → 503.
    classifier_stats_path: Path = Field(
        _here / "lab" / "benchmark" / "classifier_stats.json",
        description="precomputed classifier-vs-reference-labels benchmark served at /stats/classifier",
        json_schema_extra={"section": "Classifier benchmark"},
    )

    # ── Hanging (static exchange evaluation) ────────────────────────────────
    # 1 is what the old sign test accepted: a one-pawn square is a marginal
    # exchange, not an offer — every SEE=1 brilliant was a FP (experiment 048).
    hanging_see_floor: int = Field(
        2, description="a piece hangs when the swap evaluation on its square reaches this; "
                       "1 restores the pre-2026-07-28 sign test",
        json_schema_extra={"section": "Hanging (static exchange evaluation)"},
    )

    # ── Classification bands (win-% drop thresholds) ────────────────────────
    # No constant changes for the 2026-07-13 rating-aware redesign: this
    # ladder already equals the reference thresholds ×100 — k(elo) is
    # the whole band change (lab experiment 009). BAND_EXCELLENT is gone: it
    # was dead in the ladder (the P2 redesign made "best" strict).
    band_blunder: float = Field(
        20.0, description="expected-points drop at/above which a move is a blunder",
        json_schema_extra={"section": "Classification bands (expected-points drop thresholds)"},
    )
    band_mistake: float = Field(10.0, description="drop at/above which a move is a mistake")
    band_inaccuracy: float = Field(5.0, description="drop at/above which a move is an inaccuracy")
    band_good: float = Field(2.0, description="drop below which a non-best move is still excellent")
    # Alternative-line ceiling from experiment 077. Curve-, engine-, depth-,
    # and multipv-coupled: the value is mover-relative expected points for the
    # rank-2 line, so any of those inputs changing requires remeasurement.
    brilliant_alt_ceiling: float = Field(
        85.0, description="brilliant only if the rank-2 alternative stays below this mover-relative "
                          "expected-points value; remeasure after rating-curve, engine, depth, or multipv changes",
    )
    # Brilliant "good move" tolerance: a brilliant need not be the engine's top
    # move, but may not cost more than this against the best line. Complements
    # played_is_best and the _costs_nothing tie.
    brilliant_good_tol: float = Field(
        2.0, description="brilliant may cost at most this many expected points vs the best line; "
                         "held-out fit — see lab/exp_brilliant_cc/heldout_fit.py",
    )
    # Brilliant floor: "not losing after", not "winning after" — a brilliancy may
    # leave the mover equal or slightly worse. 50.0 is the sigmoid's k-invariant
    # fixed point (the one win-% that is the same centipawn value under every k),
    # so unlike the ceiling above, this floor never rots.
    brilliant_floor: float = Field(
        50.0, description="expected points after the sac must clear this (\"not losing after\"); "
                          "50 = the sigmoid's k-invariant fixed point, so it never rots",
    )
    brilliant_offer_delta_min: int = Field(
        2, description="minimum increase in one offered piece's exchange exposure",
    )
    brilliant_net_material_floor: int = Field(
        1, description="minimum material genuinely offered after the played capture and incremental recoup",
    )

    # ── Great — the 005 hybrid ─────────────────────────────────────────────────
    # Values are the lab's 0-1 fractions ×100, frozen from experiments 005/008;
    # arm 2's `great_only_gap` replaced a `great_only_second` cutoff in 056/058.
    # The arms themselves are in review/classify.py:_GREAT_ARMS.
    great_swing: float = Field(
        20.0, description="arm 1: expected-points swing the opponent's previous move handed the mover",
        json_schema_extra={"section": "Great — 005 hybrid (banked turnaround OR only good move)"},
    )
    great_hold: float = Field(
        2.0, description="both arms: how much of the pre-move value the mover may give back",
    )
    great_result_floor: float = Field(
        45.0, description="arm 1: expected points after the move must clear this",
    )
    great_only_after: float = Field(
        40.0, description="arm 2: expected points after the played move must clear this",
    )
    great_only_gap: float = Field(
        10.0, description="arm 2: ...and beats the second-best alternative by at least this margin",
    )
    # Both arms' `non_obvious` gate, reshaped from move syntax to capture
    # geometry (experiments 061/068 arm C). Its own
    # knob rather than a read of HANGING_SEE_FLOOR: 068 pinned the two to the
    # same value, but they govern different rules. Above any achievable SEE the
    # rule reduces to `direct_recapture` alone — the off switch.
    great_routine_see_floor: int = Field(
        2, description="both arms: a capture winning at least this much material outright is "
                       "routine, so it can never be great",
    )

    # ── Miss — squandered opportunity (experiment 008) ─────────────────────────
    # Mirrors great in the same expected-points space: where great BANKS an
    # opponent-handed swing, miss DROPS one.
    miss_swing: float = Field(
        10.0, description="expected-points swing the opponent's previous move handed the mover",
        json_schema_extra={"section": "Miss — squandered opportunity"},
    )
    miss_drop: float = Field(10.0, description="...of which the mover dropped at least this much")
    miss_chance: float = Field(
        50.0, description="...from an equal-or-better position (expected points before)",
    )
    miss_alive: float = Field(
        20.0, description="...and isn't dead-lost after (below this it stays a blunder)",
    )
    miss_mate_before_max: int = Field(
        2, description="miss if a non-best move delays the mover's mate from at most this many moves",
        json_schema_extra={"section": "Miss — forced-mate delay"},
    )
    miss_mate_after_min: int = Field(
        5, description="...to at least this many moves while the mover still has forced mate",
    )

    # ── Accuracy — fitted to the reference corpus (lab experiments 019, 031, 104) ────
    # The curve and the aggregator are both measurements, not choices; the model
    # is in review/summary.py.
    # B=1 and C=200 collapse the form to a plain 200*exp(-A*d) - 100 — the general
    # shape is exposed only so a refit stays a config change, not a code change.
    #
    # Two constraints a reader cannot recover from the values:
    #
    # NOT curve-coupled to RATING_K_* since 2026-07-26 (experiment 031): the
    # `drop` this curve reads is its OWN, computed at ACCURACY_K, not the
    # classifier's rating-aware one. tests/calibration/test_accuracy.py holds it.
    #
    # A and ACCURACY_K are FITTED TOGETHER and are meaningless apart. Moving one
    # without refitting the other is not a supported configuration.
    # Also coupled to OUR engine: 104 refit the pair on Stockfish 19 evals (was
    # 0.0025/0.06 on 18), whose scores run larger — a lower k compresses them back.
    accuracy_k: float = Field(
        0.0018, description="win-chance sigmoid steepness the ACCURACY model reads — rating-BLIND, "
                            "unlike RATING_K_*. Coupled to both engines: the reference corpus's and the "
                            "shipped Stockfish (fitted on Stockfish 19), so it needs a refit when either "
                            "changes. Fitted jointly with ACCURACY_CURVE_A",
        json_schema_extra={"section": "Accuracy — fitted to the reference corpus (lab experiments 019, 031, 104)"},
    )
    accuracy_curve_a: float = Field(
        0.064, description="accuracy curve decay: acc = C*exp(-A*drop^B) - (C-100); "
                          "fitted jointly with ACCURACY_K — re-run lab experiment 104 if you touch either",
    )
    accuracy_curve_b: float = Field(
        1.0, description="accuracy curve drop exponent (1.0 = a plain exponential)",
    )
    accuracy_curve_c: float = Field(
        200.0, description="accuracy curve scale; the curve floors at 100 - C (so C=200 floors at -100)",
    )

    # ── Game Rating — formula-v1 heuristic ──────────────────────────────────
    game_rating_expected_at_1000: float = Field(
        72.25,
        description="formula-v1 expected accuracy for an Elo-1000 player",
        json_schema_extra={"section": "Game Rating — formula-v1 heuristic"},
    )
    game_rating_expected_at_2000: float = Field(
        79.5,
        description="formula-v1 expected accuracy for an Elo-2000 player; slope derives from both anchors",
    )
    game_rating_expected_min: float = Field(
        68.0, description="formula-v1 expected-accuracy floor",
    )
    game_rating_expected_max: float = Field(
        82.0, description="formula-v1 expected-accuracy ceiling",
    )
    game_rating_elo_per_accuracy_point: float = Field(
        41.5, description="formula-v1 Elo change per accuracy point above or below expected",
    )
    game_rating_min: int = Field(
        100, description="formula-v1 minimum estimated Game Rating",
    )
    game_rating_max: int = Field(
        4000, description="formula-v1 maximum estimated Game Rating",
    )
    game_rating_round_step: int = Field(
        50, description="formula-v1 half-up rounding step in Elo",
    )

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        # Reproduce the old comma-split + empty-strip; leave a real list alone.
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("rating_k_low", "rating_k_high", "rating_k_split")
    @classmethod
    def _rating_k_removed(cls, value, info):
        # Only fires when the var is actually supplied (validate_default is off),
        # so the None defaults cost nothing at startup.
        if value is not None:
            raise ValueError(
                f"{info.field_name.upper()} was removed on 2026-07-26 when k(elo) "
                f"became continuous. Replace it: RATING_K_LOW -> RATING_K_AT_1000, "
                f"RATING_K_HIGH -> RATING_K_AT_2000 (the elo-2000 anchor of a line, "
                f"not a bucket value), RATING_K_SPLIT -> nothing (there is no split); "
                f"RATING_K_MIN / RATING_K_MAX clamp the ends."
            )
        return value

    @field_validator("review_engine")
    @classmethod
    def _known_review_engine(cls, value: str) -> str:
        valid = ("sf19",)
        if value not in valid:
            raise ValueError(
                f"unknown REVIEW_ENGINE={value!r}; valid ids: {', '.join(valid)}"
            )
        return value


def dump_env() -> str:
    """Render the full knob catalogue as env-file text — the replacement for
    the deleted .env.example. `python -m config --dump-env > .env.local` gives
    an operator a starting file that cannot be stale, because it is generated
    from the fields themselves."""
    lines = [
        "# Generated by `python -m config --dump-env`. Every value here is the",
        "# code default — delete the lines you don't override. Precedence:",
        "# real env > .env.local > these defaults. Secrets belong here, not in git.",
    ]
    for name, field in Settings.model_fields.items():
        extra = field.json_schema_extra or {}
        if extra.get("removed"):
            continue  # a startup guard for a deleted knob, not a setting
        if section := extra.get("section"):
            lines.append(f"\n# ── {section} " + "─" * max(0, 60 - len(section)))
        default = field.default
        if isinstance(default, list):
            default = ",".join(default)
        elif isinstance(default, bool):
            default = str(default).lower()
        comment = f"  # {field.description}" if field.description else ""
        lines.append(f"{name.upper()}={default}{comment}")
    return "\n".join(lines)


settings = Settings()

ENGINE_REGISTRY: dict[str, EngineSpec] = {
    "sf19": EngineSpec(
        id="sf19",
        path=settings.stockfish_path,
        options={
            "Threads": settings.stockfish_review_pool_threads,
            "Hash": settings.stockfish_review_pool_hash,
        },
        expects="Stockfish 19",
    ),
}

# Not a field — the registry entry the REVIEW_ENGINE id selects.
ACTIVE_ENGINE_SPEC = ENGINE_REGISTRY[settings.review_engine]

_REMOVED_FIELDS = {
    name for name, f in Settings.model_fields.items()
    if (f.json_schema_extra or {}).get("removed")
}


def __getattr__(name: str):
    """Back-compat: `from config import RATING_K_MIN` reads `settings.rating_k_min`.

    Sixty hand-written `X = settings.x` aliases lived here until 2026-07-28.
    Declaring a Field and forgetting its alias was a *silent* omission at this
    end — it surfaced as an ImportError from whichever module first wanted the
    knob. PEP 562 makes the mapping total instead.

    Fields marked "removed" are deliberately excluded: they exist to reject a
    deleted env var at startup, so importing one must still fail.
    """
    field = name.lower()
    if name.isupper() and field in Settings.model_fields and field not in _REMOVED_FIELDS:
        return getattr(settings, field)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    return sorted(
        set(globals())
        | {n.upper() for n in Settings.model_fields if n not in _REMOVED_FIELDS}
    )


if __name__ == "__main__":
    import sys

    if "--dump-env" in sys.argv:
        print(dump_env())
    else:
        sys.exit("usage: python -m config --dump-env")
