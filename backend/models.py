from pydantic import BaseModel, Field, model_validator

from config import REVIEW_META_MAX_LENGTH


class _CpOrMate(BaseModel):
    """A single engine score: exactly one of cp / mate, both white-POV (the
    frontend AnalysisLine convention, matching review._info_to_line)."""

    cp: int | None = None
    mate: int | None = None

    @model_validator(mode="after")
    def _exactly_one_score(self):
        if (self.cp is None) == (self.mate is None):
            raise ValueError("exactly one of cp / mate must be set")
        return self


class BeforeLine(_CpOrMate):
    """One rank-ordered analysis line of the before-position, supplied by the
    frontend eval-bar search (review.classify_move feeder). Rank order is the
    list order."""

    uci: str = Field(..., min_length=4, max_length=5)


class MoveEval(_CpOrMate):
    """Rank-1 eval of the after-position, supplied by the frontend."""


class ReviewPly(BaseModel):
    """One ply of a frontend-evaluated game (POST /reviews `plies`): the
    before-position's rank-ordered lines and the after-position's rank-1 eval.
    `after_eval` is None only for a terminal after-position."""

    fen_before: str = Field(..., min_length=1, max_length=120)
    fen_after: str = Field(..., min_length=1, max_length=120)
    before_lines: list[BeforeLine] = Field(..., max_length=8)
    after_eval: MoveEval | None = None


class CreateReviewRequest(BaseModel):
    pgn: str = Field(..., min_length=1, max_length=200_000)
    depth: int = Field(default=22, ge=14, le=24)
    multipv: int = Field(default=2, ge=2, le=4)
    force: bool = False
    # Origin game coordinates (optional) — let the inbox link back to the viewer.
    source: str | None = Field(default=None, max_length=REVIEW_META_MAX_LENGTH)
    user_id: str | None = Field(default=None, max_length=REVIEW_META_MAX_LENGTH)
    game_id: str | None = Field(default=None, max_length=REVIEW_META_MAX_LENGTH)
    # Player ratings for the rating-aware classifier (k(elo), see review/expected.py).
    # Optional: falls back to the PGN's WhiteElo/BlackElo tags, then 1000 — see
    # review._resolve_ratings. Bounds are sanity limits, not FIDE/Elo semantics.
    white_elo: int | None = Field(default=None, ge=100, le=4000)
    black_elo: int | None = Field(default=None, ge=100, le=4000)
    # Optional frontend-eval payload (the browser's whole-game sweep). Complete for
    # every planned ply → classified with no engine, stored done as engine_source
    # 'frontend'; absent/incomplete/over cap → a backend job. `engine` is informational.
    plies: list[ReviewPly] | None = None
    engine: str | None = Field(default=None, max_length=REVIEW_META_MAX_LENGTH)

    @model_validator(mode="after")
    def _lowercase_user_id(self):
        # Usernames are case-insensitive on every source we know; normalize at the one
        # write choke point so persisted rows always match a lowercased lookup.
        if self.user_id is not None:
            self.user_id = self.user_id.lower()
        return self


class MoveReviewRequest(BaseModel):
    """One deviation move to grade (POST /reviews/move). Grades a single move
    off `fen_before` through the same classifier a whole-game review uses. No
    PGN: the position and move stand alone.

    Two feeders, dispatched by field-presence (main.grade_move): a complete
    frontend-eval payload (`before_lines` >= 2 lines, or 1 for a forced move, AND
    `after_eval`, or the after-position is terminal) grades with no backend engine
    (review.classify_move); otherwise the backend searches (review.review_move). The
    app always sends one; the search path stays for other clients (2026-10-04)."""

    fen_before: str = Field(..., min_length=1, max_length=120)
    uci: str = Field(..., min_length=4, max_length=5)
    # depth/multipv mirror CreateReviewRequest; multipv >= 2 so the classifier
    # always sees a second-best line (after_second — great arm 2, brilliant).
    depth: int = Field(default=18, ge=14, le=24)
    multipv: int = Field(default=2, ge=2, le=4)
    white_elo: int | None = Field(default=None, ge=100, le=4000)
    black_elo: int | None = Field(default=None, ge=100, le=4000)
    # The previous ply's before-eval (white-POV pawns, i.e. MoveReview.eval_before)
    # feeding EvalPoints.before_opp — the opponent-swing input for great/miss.
    # None on the first graded move off the game line's opening (no prior ply).
    prev_before_eval: float | None = Field(default=None)
    # The same seed as the previous position's rank-1 engine score (white-POV),
    # so a ply can be graded without waiting for the previous ply's verdict.
    prev_before: MoveEval | None = Field(default=None)
    # Optional frontend-eval payload. When complete, grading skips the backend
    # engine — see the class docstring + review.classify_move.
    before_lines: list[BeforeLine] | None = Field(default=None, max_length=8)
    after_eval: MoveEval | None = Field(default=None)

    @model_validator(mode="after")
    def _one_seed(self):
        if self.prev_before is not None and self.prev_before_eval is not None:
            raise ValueError("send prev_before or prev_before_eval, not both")
        return self


class StoredMove(BaseModel):
    """Validated wire mirror of review.MoveReview."""

    ply: int = Field(..., ge=0)
    san: str = Field(..., min_length=1, max_length=20)
    fen_before: str = Field(..., min_length=1, max_length=120)
    eval_before: float
    eval_after_played: float
    best_move_san: str = Field(..., min_length=1, max_length=20)
    win_before: float
    win_after_played: float
    win_drop: float
    classification: str = Field(..., min_length=1, max_length=20)
    mate_before: int | None = None
    mate_after_played: int | None = None
    win_after_second: float | None = None


class WinChancePoint(BaseModel):
    """One provisional-curve sample: white-POV cp or mate distance, matching
    the `_CpOrMate` convention above (review._info_to_line)."""

    ply: int = Field(..., ge=1)
    cp_white: int | None = None
    mate: int | None = None

    @model_validator(mode="after")
    def _exactly_one_score(self):
        if (self.cp_white is None) == (self.mate is None):
            raise ValueError("exactly one of cp_white / mate must be set")
        return self


class WinChanceRequest(BaseModel):
    """POST /win-chance — the browser-sweep conversion seam (frontend cp,
    backend win-%)."""

    white_elo: int | None = Field(default=None, ge=100, le=4000)
    black_elo: int | None = Field(default=None, ge=100, le=4000)
    points: list[WinChancePoint] = Field(..., max_length=600)


class ExplainRequest(BaseModel):
    """One stored review row, or one position plus legal UCI move."""

    move: StoredMove | None = None
    fen_before: str | None = Field(default=None, min_length=1, max_length=120)
    uci: str | None = Field(default=None, min_length=4, max_length=5)
    depth: int = Field(default=18, ge=14, le=24)
    multipv: int = Field(default=2, ge=2, le=4)
    white_elo: int | None = Field(default=None, ge=100, le=4000)
    black_elo: int | None = Field(default=None, ge=100, le=4000)
    prev_before_eval: float | None = None
    # The opponent's last move, feeding great's `direct_recapture`. Optional on
    # every form: a client that cannot supply it gets an INDETERMINATE gate, not
    # an error (mirrors lab/tools/explain_move.py's --prev-fen/--prev-move).
    prev_fen: str | None = Field(default=None, min_length=1, max_length=120)
    prev_uci: str | None = Field(default=None, min_length=4, max_length=5)
    before_lines: list[BeforeLine] | None = Field(default=None, max_length=8)
    after_eval: MoveEval | None = None

    @model_validator(mode="after")
    def _exactly_one_form(self):
        has_position_field = self.fen_before is not None or self.uci is not None
        has_position = self.fen_before is not None and self.uci is not None
        if self.move is not None:
            if has_position_field:
                raise ValueError("give move or fen_before + uci, not both")
        elif not has_position:
            raise ValueError("give exactly one of move or fen_before + uci")
        if (self.prev_fen is None) != (self.prev_uci is None):
            raise ValueError("give prev_fen + prev_uci together, or neither")
        return self
