import io
import queue as _queue
import threading
from dataclasses import asdict, dataclass

import chess
import chess.engine as _chess_engine
import chess.pgn

# Defaults for the injectable seams in review_stream / _run_review
# (engine_factory / book_walk). Tests pass fakes as arguments — no monkeypatching.
import opening as _opening
import queue as _stdqueue
from engine import (
    interactive_pool,
    observed_engine_name,
    quit_pool,
    spawn_review_pool,
)
from config import STOCKFISH_INTERACTIVE_GRADE_TIMEOUT

# Config knobs re-exported for `from review import …`. depth/multipv are NOT
# config: the frontend owns them and sends them per request (validated by
# CreateReviewRequest). The constants below are a test/direct-call fallback for
# review_stream's signature only — the production path (the queue) always passes
# the request's explicit depth/multipv, so this default is never used in prod.
from config import (  # noqa: F401
    RATING_K_AT_1000, RATING_K_AT_2000, RATING_K_MIN, RATING_K_MAX,
    BAND_BLUNDER, BAND_MISTAKE, BAND_INACCURACY, BAND_GOOD,
)

_FALLBACK_DEPTH = 16
_FALLBACK_MULTIPV = 2
_DEFAULT_ELO = 1000  # unresolved rating (no request field, no PGN Elo tag) — see _resolve_ratings
# Leaf-module surface re-exported for callers/tests that do `from review import …`.
from .winchance import win_chance, _cp_white, _cp_to_pawns, mover_relative_mate  # noqa: F401
from .expected import k_for, k_for_accuracy, expected_points_pct  # noqa: F401
from .hanging import (  # noqa: F401
    _is_piece_hanging, _has_hanging_friendly, brilliant_material, sacrifice_facts,
    _is_material_sacrifice, _move_created_offer, _material_balance,
    _pv_material_swing, _hanging_friendly_square, _pv_confirms_sacrifice,
    played_capture_see, direct_recapture,
)
from .classify import classify, EvalPoints, MoveFacts  # noqa: F401
from .summary import (  # noqa: F401
    _per_move_accuracy, _mover_win, _side_summary, _build_summary,
)


@dataclass
class MoveReview:
    ply: int
    san: str
    fen_before: str
    eval_before: float
    eval_after_played: float
    best_move_san: str
    win_before: float
    win_after_played: float
    win_drop: float
    classification: str
    mate_before: int | None = None
    mate_after_played: int | None = None
    win_after_second: float | None = None


@dataclass(frozen=True)
class MoveTrace:
    review: MoveReview
    points: EvalPoints
    facts: MoveFacts
    cp: dict[str, int | None]


@dataclass(frozen=True)
class PlannedMove:
    ply: int
    move: chess.Move
    san: str
    fen_before: str
    fen_after: str
    is_terminal: bool
    board_before: chess.Board
    board_after: chess.Board
    mover_is_white: bool
    mover_color: chess.Color
    is_promotion: bool
    is_check: bool
    is_capture: bool
    is_only_legal_move: bool
    # review/hanging.py:direct_recapture — None means the caller could not
    # supply the previous move, so the trace reads `?` rather than "no".
    direct_recapture: bool | None


def _parse_pgn_or_raise(pgn: str) -> tuple[chess.pgn.Game, list[chess.Move]]:
    """Parse the PGN and return (game, mainline moves). Walks the mainline once;
    callers reuse the returned list instead of re-walking."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ValueError("Invalid or empty PGN")
    moves = list(game.mainline_moves())
    if not moves:
        raise ValueError("Invalid or empty PGN")
    return game, moves


def _resolve_elo(explicit: int | None, game: chess.pgn.Game, tag: str) -> int:
    """One color's rating: an explicit request-field override, else the PGN's
    Elo tag (ignoring non-numeric values like chess.com's "?"), else the
    default 1000 (review/expected.py:k_for's low bucket)."""
    if explicit is not None:
        return explicit
    raw = game.headers.get(tag)
    if raw is not None:
        try:
            return int(raw)
        except ValueError:
            pass
    return _DEFAULT_ELO


def _resolve_ratings(
    game: chess.pgn.Game, white_elo: int | None, black_elo: int | None,
) -> tuple[int, int]:
    """(white_elo, black_elo) per §1 of the rating-aware classifier spec:
    explicit request field -> PGN WhiteElo/BlackElo tag -> 1000."""
    return (
        _resolve_elo(white_elo, game, "WhiteElo"),
        _resolve_elo(black_elo, game, "BlackElo"),
    )


def _terminal_infos(board: chess.Board) -> list[dict]:
    if board.is_checkmate():
        mate_white = -1 if board.turn == chess.WHITE else 1
        score = _chess_engine.PovScore(_chess_engine.Mate(mate_white), chess.WHITE)
    else:
        score = _chess_engine.PovScore(_chess_engine.Cp(0), chess.WHITE)
    return [{"score": score, "pv": [], "depth": _FALLBACK_DEPTH, "multipv": 1}]


def _analyse_position(engine, board: chess.Board, depth: int, multipv: int) -> list[dict]:
    # No global analyse-lock here: each engine in the review pool is owned by a
    # single worker thread (see _ParallelAnalyser), so this engine's UCI stream
    # is never touched concurrently. Locking would re-serialize the pool and
    # erase the parallel win.
    # A fresh game token clears per-engine search state so queue timing cannot
    # change an otherwise identical review's evaluations.
    with engine.analysis(
        board, _chess_engine.Limit(depth=depth), multipv=multipv, game=object(),
    ) as analysis:
        latest: dict[int, dict] = {}
        for info in analysis:
            d = info.get("depth")
            mp = info.get("multipv")
            if d is None or mp is None:
                continue
            latest[mp] = info
            if d >= depth and len(latest) >= multipv:
                break
    if not latest:
        # Engine ended without producing any usable info (e.g. immediate
        # terminal). Fall back to a synthetic score so callers can index [0].
        return _terminal_infos(board)
    return [latest[i] for i in sorted(latest)]


def _review_one_ply(
    before_infos, after_infos, e: PlannedMove, k_mover, prev_before_white_cp,
):
    """Classify a single ply from its two position analyses. Pure — no engine,
    no I/O, no shared state. Shared by the whole-game review loop and the
    per-move deviation endpoint (POST /reviews/move), so a branch move grades
    through the exact same rules as a real review.

    - `before_infos` / `after_infos`: the multipv `_analyse_position` output
      (or `_terminal_infos`) for the move's before / after positions.
    - `e`: the typed per-ply plan shared by batch and deviation review.
    - `k_mover`: the mover's rating-aware sigmoid steepness (`k_for(elo)`).
    - `prev_before_white_cp`: the previous scored ply's before-eval (white-POV
      cp) feeding `EvalPoints.before_opp`, or None on the first scored ply.

    Returns `(MoveReview, before_white_cp, acc_drop, points, facts,
    second_white_cp)` — the cp threads into the next ply's
    `prev_before_white_cp`; `acc_drop` is the accuracy model's own rating-blind
    drop, which travels out-of-band because it is not a wire field (see
    review/expected.py). The traced deviation endpoints retain the classifier
    inputs and second-line cp; the batch review discards them.
    """
    mover_is_white = e.mover_is_white
    board_before = e.board_before
    board_after = e.board_after

    before_white_cp = _cp_white(before_infos[0])
    mate_before = before_infos[0]["score"].white().mate()
    best_pv = before_infos[0].get("pv") or []
    best_move = best_pv[0] if best_pv else e.move
    best_move_san = (
        board_before.san(best_move) if best_move in board_before.legal_moves
        else e.san
    )
    played_is_best = bool(best_pv) and e.move == best_pv[0]

    after_played_cp = _cp_white(after_infos[0])
    mate_after_played = after_infos[0]["score"].white().mate()
    second_white_cp = _cp_white(before_infos[1]) if len(before_infos) > 1 else None

    points = EvalPoints(
        before_opp=(
            expected_points_pct(prev_before_white_cp, mover_is_white, k_mover)
            if prev_before_white_cp is not None else None
        ),
        before=expected_points_pct(before_white_cp, mover_is_white, k_mover),
        after_played=expected_points_pct(after_played_cp, mover_is_white, k_mover),
        after_second=(
            expected_points_pct(second_white_cp, mover_is_white, k_mover)
            if second_white_cp is not None else None
        ),
    )
    # Kept for MoveReview's own output fields (unaffected event shape) —
    # mathematically identical to points.before/after_played (see
    # review/expected.py:expected_points_pct's docstring).
    win_before = points.before
    win_after_played = points.after_played
    win_drop = max(0.0, win_before - win_after_played)

    # The accuracy model's drop, on its OWN rating-blind scale (031). Computed
    # here because this is where the raw centipawns still exist; it does not go
    # on the wire and nothing in classify() may read it.
    k_acc = k_for_accuracy()
    acc_drop = max(0.0, expected_points_pct(before_white_cp, mover_is_white, k_acc)
                        - expected_points_pct(after_played_cp, mover_is_white, k_acc))

    material = brilliant_material(board_before, board_after, e.move, e.mover_color)

    facts = MoveFacts(
        played_is_best=played_is_best,
        is_check=e.is_check,
        is_capture=e.is_capture,
        is_promotion=e.is_promotion,
        brilliant_offer_delta=material.offer_delta,
        brilliant_net_material=material.net_material,
        played_see=played_capture_see(board_before, e.move),
        direct_recapture=e.direct_recapture,
        # MoveReview keeps the original signed white-POV fields below.
        mate_before_mover=mover_relative_mate(mate_before, mover_is_white),
        mate_after_played_mover=mover_relative_mate(mate_after_played, mover_is_white),
        is_only_legal_move=e.is_only_legal_move,
    )

    classification = classify(points, facts)

    mv = MoveReview(
        ply=e.ply, san=e.san, fen_before=e.fen_before,
        eval_before=_cp_to_pawns(before_white_cp),
        eval_after_played=_cp_to_pawns(after_played_cp),
        best_move_san=best_move_san,
        win_before=win_before, win_after_played=win_after_played,
        win_drop=win_drop, classification=classification,
        mate_before=mate_before, mate_after_played=mate_after_played,
        win_after_second=points.after_second,
    )
    return mv, before_white_cp, acc_drop, points, facts, second_white_cp


class _ParallelAnalyser:
    """Runs a pool of engines over a FIFO list of distinct FENs in background
    threads. ``get(fen)`` blocks until that FEN's analysis lands, raising on an
    engine error and returning ``None`` on cancel. One owning thread per engine
    — no SimpleEngine is ever touched concurrently."""

    def __init__(self, engines, depth: int, multipv: int, cancel_event):
        self._engines = engines
        self._depth = depth
        self._multipv = multipv
        self._cancel = cancel_event
        self._work: _queue.Queue = _queue.Queue()
        self._results: dict[str, list[dict]] = {}
        self._error: BaseException | None = None
        self._active = 0
        self._cond = threading.Condition()
        self._threads: list[threading.Thread] = []

    def _cancelled(self) -> bool:
        return self._cancel is not None and self._cancel.is_set()

    def start(self, fens) -> None:
        for f in fens:
            self._work.put(f)
        self._active = len(self._engines)
        for eng in self._engines:
            t = threading.Thread(target=self._worker, args=(eng,), daemon=True)
            t.start()
            self._threads.append(t)

    def _worker(self, eng) -> None:
        try:
            while not self._cancelled():
                try:
                    fen = self._work.get_nowait()
                except _queue.Empty:
                    return
                try:
                    infos = _analyse_position(
                        eng, chess.Board(fen), self._depth, self._multipv
                    )
                except BaseException as exc:  # engine crash, terminated, etc.
                    with self._cond:
                        if self._error is None:
                            self._error = exc
                        self._cond.notify_all()
                    return
                with self._cond:
                    self._results[fen] = infos
                    self._cond.notify_all()
        finally:
            with self._cond:
                self._active -= 1
                self._cond.notify_all()

    def get(self, fen: str) -> list[dict] | None:
        with self._cond:
            while True:
                if fen in self._results:
                    return self._results[fen]
                if self._error is not None:
                    raise self._error
                if self._cancelled():
                    return None
                if self._active == 0:
                    raise RuntimeError(f"position never analysed: {fen}")
                self._cond.wait(timeout=0.2)


def _grade_move_with(
    eng, e, depth, multipv, k_mover, prev_before_white_cp,
) -> MoveTrace:
    """Analyse the move's two positions on `eng` and classify. Fresh boards per
    call so the engine's analysis never races the boards _review_one_ply reads."""
    before_infos = _analyse_position(eng, chess.Board(e.fen_before), depth, multipv)
    if e.is_terminal:
        after_infos = _terminal_infos(e.board_after)
    else:
        after_infos = _analyse_position(eng, chess.Board(e.fen_after), depth, multipv)
    mv, before_white_cp, _, points, facts, second_white_cp = _review_one_ply(
        before_infos, after_infos, e, k_mover, prev_before_white_cp
    )
    return MoveTrace(
        review=mv,
        points=points,
        facts=facts,
        cp={
            "before_opp": prev_before_white_cp,
            "before": before_white_cp,
            "after_played": _cp_white(after_infos[0]),
            "after_second": second_white_cp,
        },
    )


def _planned_move(
    board_before: chess.Board, move: chess.Move, ply: int,
    prev: tuple[chess.Board, chess.Move] | None = None,
) -> PlannedMove:
    """Build the one typed plan shape shared by batch and deviation review.

    `copy(stack=False)` gives the same detached board a FEN round-trip did, at
    a fraction of the cost — the caller keeps pushing onto `board_before`, so
    the plan must not alias it, but serializing and re-parsing to achieve that
    was most of the plan's runtime (2.1x over a game).

    `prev` is `(board before the opponent's last move, that move)`; omitting it
    leaves `direct_recapture` unknown rather than False."""
    board_after = board_before.copy(stack=False)
    board_after.push(move)
    return PlannedMove(
        ply=ply,
        move=move,
        san=board_before.san(move),
        fen_before=board_before.fen(),
        fen_after=board_after.fen(),
        is_terminal=board_after.is_game_over(),
        board_before=board_before.copy(stack=False),
        board_after=board_after,
        mover_is_white=board_before.turn == chess.WHITE,
        mover_color=board_before.turn,
        is_promotion=move.promotion is not None,
        is_check=board_before.gives_check(move),
        is_capture=board_before.is_capture(move),
        is_only_legal_move=board_before.legal_moves.count() == 1,
        direct_recapture=direct_recapture(board_before, move, prev),
    )


def _plan_one_move(
    fen_before: str, uci: str, *,
    prev_fen: str | None = None, prev_uci: str | None = None,
) -> PlannedMove:
    """Validate a deviation move and build the shared typed plan.

    The optional previous position + move feed `direct_recapture`; supplying
    neither leaves it unknown. A pair that does not actually lead to
    `fen_before` is a ValueError, not a silently wrong fact."""
    board_before = chess.Board(fen_before)
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        raise ValueError(f"Invalid UCI move: {uci!r}")
    if move not in board_before.legal_moves:
        raise ValueError(f"Illegal move {uci!r} in position {fen_before!r}")
    return _planned_move(board_before, move, 0, _plan_prev(board_before, prev_fen, prev_uci))


def _plan_prev(
    board_before: chess.Board, prev_fen: str | None, prev_uci: str | None,
) -> tuple[chess.Board, chess.Move] | None:
    """`(board, move)` of the opponent's last move, or None when the caller did
    not supply one. Both halves or neither."""
    if prev_fen is None or prev_uci is None:
        return None
    prev_board = chess.Board(prev_fen)
    try:
        prev_move = chess.Move.from_uci(prev_uci)
    except ValueError:
        raise ValueError(f"Invalid UCI move: {prev_uci!r}")
    if prev_move not in prev_board.legal_moves:
        raise ValueError(f"Illegal move {prev_uci!r} in position {prev_fen!r}")
    after = prev_board.copy(stack=False)
    after.push(prev_move)
    # Position only — the halfmove/fullmove counters carry no geometry, and
    # python-chess keeps a raw ep square where a FEN writes `-`.
    if after.fen().split()[:4] != board_before.fen().split()[:4]:
        raise ValueError(f"{prev_uci!r} in {prev_fen!r} does not lead to the position given")
    return prev_board, prev_move


def move_is_terminal(fen_before: str, uci: str) -> bool:
    """Does `uci` end the game when played from `fen_before`? Lets the
    /reviews/move dispatcher route a terminal deviation — which the frontend
    cannot search for an after-eval — onto the classify feeder. Raises
    ValueError on a bad FEN/UCI/illegal move (same as `_plan_one_move`)."""
    return _plan_one_move(fen_before, uci).is_terminal


def _k_mover(e: PlannedMove, white_elo: int | None, black_elo: int | None) -> float:
    """The mover's rating-aware sigmoid steepness for this ply's plan `e`."""
    mover_elo = white_elo if e.mover_is_white else black_elo
    return k_for(mover_elo if mover_elo is not None else _DEFAULT_ELO)


def review_move_traced(
    fen_before: str, uci: str, *,
    depth: int = _FALLBACK_DEPTH, multipv: int = _FALLBACK_MULTIPV,
    white_elo: int | None = None, black_elo: int | None = None,
    prev_before_eval: float | None = None,
    prev_fen: str | None = None, prev_uci: str | None = None,
    engine_factory=None,
) -> MoveTrace:
    """Grade a single move played from `fen_before`, through the same
    analyse→classify path a whole-game review uses (`_review_one_ply`), so a
    deviation move earns the same verdict a real review would give it.

    No PGN and no prev/after chain: the position and move stand alone. The one
    cross-ply input, `prev_before_eval` (the previous ply's before-eval, white-
    POV pawns == MoveReview.eval_before), seeds EvalPoints.before_opp; None ⇒
    before_opp None, exactly as the first scored ply of a review.

    `prev_fen` + `prev_uci` (both or neither) supply the opponent's last move
    for `direct_recapture`; without them great's gate reads INDETERMINATE on a
    capture the SEE floor has not already settled.

    Engine: by default borrows from the shared interactive pool (bounded,
    long-lived, walled off from the review pools). `engine_factory` overrides
    that with a spawn-and-quit pool — tests inject a fake this way (no
    monkeypatching, mirroring review_stream). Raises TimeoutError when every
    interactive engine is busy past the configured wait.
    """
    e = _plan_one_move(fen_before, uci, prev_fen=prev_fen, prev_uci=prev_uci)
    k_mover = _k_mover(e, white_elo, black_elo)
    prev_before_white_cp = (
        int(round(prev_before_eval * 100)) if prev_before_eval is not None else None
    )

    if engine_factory is not None:
        # Test / explicit-pool path: spawn, use, quit.
        engines = engine_factory()
        if not isinstance(engines, (list, tuple)):
            engines = [engines]
        try:
            return _grade_move_with(engines[0], e, depth, multipv, k_mover, prev_before_white_cp)
        finally:
            quit_pool(engines)

    # Production path: borrow one engine from the bounded interactive pool.
    try:
        with interactive_pool().borrow(timeout=STOCKFISH_INTERACTIVE_GRADE_TIMEOUT) as eng:
            return _grade_move_with(eng, e, depth, multipv, k_mover, prev_before_white_cp)
    except _stdqueue.Empty:
        raise TimeoutError("interactive graders busy — try again")


def review_move(
    fen_before: str, uci: str, *,
    depth: int = _FALLBACK_DEPTH, multipv: int = _FALLBACK_MULTIPV,
    white_elo: int | None = None, black_elo: int | None = None,
    prev_before_eval: float | None = None,
    prev_fen: str | None = None, prev_uci: str | None = None,
    engine_factory=None,
) -> MoveReview:
    return review_move_traced(
        fen_before,
        uci,
        depth=depth,
        multipv=multipv,
        white_elo=white_elo,
        black_elo=black_elo,
        prev_before_eval=prev_before_eval,
        prev_fen=prev_fen,
        prev_uci=prev_uci,
        engine_factory=engine_factory,
    ).review


def _score_from_cp_mate(cp: int | None, mate: int | None) -> _chess_engine.PovScore:
    """A white-POV PovScore from a frontend line's cp/mate (exactly one set,
    both white-POV — matching AnalysisLine / _info_to_line's convention)."""
    if mate is not None:
        return _chess_engine.PovScore(_chess_engine.Mate(mate), chess.WHITE)
    return _chess_engine.PovScore(_chess_engine.Cp(cp), chess.WHITE)


def _line_to_info(line, rank: int) -> dict:
    """Reconstruct one `_analyse_position`-shaped info dict from a frontend
    before-line (`.uci`, `.cp`/`.mate` white-POV). `rank` is the 1-based
    multipv order. Raises ValueError on an unparseable line move."""
    return {
        "score": _score_from_cp_mate(line.cp, line.mate),
        "pv": [chess.Move.from_uci(line.uci)],
        "multipv": rank,
    }


def _eval_to_info(ev) -> dict:
    """Reconstruct the rank-1 info dict for an after-position from a frontend
    eval (`.cp`/`.mate` white-POV). No PV needed — the after-position feeds only
    `after_played` (rank-1 score)."""
    return {"score": _score_from_cp_mate(ev.cp, ev.mate), "pv": [], "multipv": 1}


def classify_move_traced(
    fen_before: str, uci: str, before_lines, after_eval, *,
    white_elo: int | None = None, black_elo: int | None = None,
    prev_before_eval: float | None = None,
    prev_fen: str | None = None, prev_uci: str | None = None,
) -> MoveTrace:
    """Grade a single move from FRONTEND-supplied engine numbers — no backend
    Stockfish, no pool, no lock, no 503. The second feeder of `_review_one_ply`
    (`review_move` is the engine feeder); the classifier and every derived fact
    are identical, so a browser-eval grade matches a real review's verdict.

    - `before_lines`: rank-ordered lines of the before-position, each with
      `.uci` and `.cp`/`.mate` (white-POV, exactly one). Rank-1 supplies the
      best move; rank-2's score feeds `after_second`.
    - `after_eval`: rank-1 `.cp`/`.mate` (white-POV) of the after-position.
      Ignored when the after-position is terminal (the frontend never searches
      one) — `_terminal_infos` is synthesized instead, mirroring `review_move`.
    - `prev_fen` + `prev_uci`: the opponent's last move, as in `review_move`.

    Raises ValueError on a bad FEN/UCI/illegal move, an empty `before_lines`, an
    unparseable line move, or a missing `after_eval` on a non-terminal position.
    """
    e = _plan_one_move(fen_before, uci, prev_fen=prev_fen, prev_uci=prev_uci)
    if not before_lines:
        raise ValueError("before_lines is required to classify a move")

    before_infos = [_line_to_info(l, i + 1) for i, l in enumerate(before_lines)]
    if e.is_terminal:
        after_infos = _terminal_infos(e.board_after)
    else:
        if after_eval is None:
            raise ValueError("after_eval is required for a non-terminal move")
        after_infos = [_eval_to_info(after_eval)]

    k_mover = _k_mover(e, white_elo, black_elo)
    prev_before_white_cp = (
        int(round(prev_before_eval * 100)) if prev_before_eval is not None else None
    )
    mv, before_white_cp, _, points, facts, second_white_cp = _review_one_ply(
        before_infos, after_infos, e, k_mover, prev_before_white_cp
    )
    return MoveTrace(
        review=mv,
        points=points,
        facts=facts,
        cp={
            "before_opp": prev_before_white_cp,
            "before": before_white_cp,
            "after_played": _cp_white(after_infos[0]),
            "after_second": second_white_cp,
        },
    )


def classify_move(
    fen_before: str, uci: str, before_lines, after_eval, *,
    white_elo: int | None = None, black_elo: int | None = None,
    prev_before_eval: float | None = None,
    prev_fen: str | None = None, prev_uci: str | None = None,
) -> MoveReview:
    return classify_move_traced(
        fen_before,
        uci,
        before_lines,
        after_eval,
        white_elo=white_elo,
        black_elo=black_elo,
        prev_before_eval=prev_before_eval,
        prev_fen=prev_fen,
        prev_uci=prev_uci,
    ).review


class _PayloadAnalyser:
    """`_ParallelAnalyser`'s shape over evals supplied up front, keyed by FEN."""

    def __init__(self, infos_by_fen: dict[str, list[dict]]):
        self._infos = infos_by_fen

    def start(self, fens) -> None:
        pass

    def get(self, fen: str) -> list[dict]:
        return self._infos[fen]


def _payload_infos(plies) -> dict[str, list[dict]]:
    """FEN -> `_analyse_position`-shaped infos from a whole-game eval payload.
    A position that is both one ply's after and the next ply's before keeps
    the before-lines (the fuller analysis; rank 1 is the same eval)."""
    infos: dict[str, list[dict]] = {}
    for ply in plies:
        if ply.after_eval is not None:
            infos[ply.fen_after] = [_eval_to_info(ply.after_eval)]
    for ply in plies:
        if ply.before_lines:
            infos[ply.fen_before] = [_line_to_info(l, i + 1) for i, l in enumerate(ply.before_lines)]
    return infos


def classify_game(
    pgn: str, plies, *,
    white_elo: int | None = None, black_elo: int | None = None,
    book_walk=_opening.book_walk,
) -> tuple[list[dict], dict] | None:
    """Review a whole game from FRONTEND-supplied evals — the whole-game twin of
    `classify_move`: no engine, the same `_run_review` loop (book plies, per-ply
    `_review_one_ply`, summary) over a `_PayloadAnalyser`.

    The backend plans the game itself and matches each planned ply to the
    payload by `fen_before` / `fen_after` — never by index. Every planned
    position must be present (>= 2 before-lines unless the ply is forced), and
    surplus entries (the book) are ignored. Any planned ply missing or malformed
    → None, whole; the caller then queues a backend review. Returns
    `(moves, summary)` as wire dicts. Raises ValueError only on a bad PGN.
    """
    game, all_moves = _parse_pgn_or_raise(pgn)
    book = book_walk(game)
    try:
        infos = _payload_infos(plies)
    except ValueError:
        return None
    plan, _ = _plan_review(game, all_moves, book)
    for e in plan:
        if len(infos.get(e.fen_before, ())) < (1 if e.is_only_legal_move else 2):
            return None
        if not e.is_terminal and e.fen_after not in infos:
            return None

    events = list(_run_review(
        [], game, all_moves, None, white_elo=white_elo, black_elo=black_elo,
        book_walk=lambda _game: book, analyser_factory=lambda *_: _PayloadAnalyser(infos),
    ))
    moves = [evt["data"] for evt in events if evt["type"] == "move"]
    return moves, events[-1]["data"]


def review_stream(pgn: str, cancel_event=None, *, depth: int = _FALLBACK_DEPTH, multipv: int = _FALLBACK_MULTIPV,
                  white_elo: int | None = None, black_elo: int | None = None,
                  engine_factory=spawn_review_pool, book_walk=_opening.book_walk):
    # Dedup/persistence now lives in the review-job store (the DB is the only
    # review cache); this generator just runs the engine pool and streams
    # events. engine_factory / book_walk are injectable so tests supply fakes as
    # arguments instead of monkeypatching module globals. The factory returns a
    # per-review pool of engines (a bare engine is accepted as a pool of one).
    # white_elo/black_elo: optional per-review rating overrides (§1 of the
    # rating-aware classifier spec) — resolved against the PGN's Elo tags
    # (then 1000) in _run_review via _resolve_ratings.
    game, all_moves = _parse_pgn_or_raise(pgn)
    engines = engine_factory()
    if not isinstance(engines, (list, tuple)):
        engines = [engines]

    try:
        # Production-spawned engines are identity-validated already. Emit their
        # observed UCI name before any eval-bearing move so queue/store can
        # stamp the review. Test/replay fakes predating the identity seam may
        # omit `.id`; they remain usable and simply emit no metadata event.
        names = {
            observed_engine_name(engine)
            for engine in engines
            if getattr(engine, "id", None)
        }
        if len(names) > 1:
            raise RuntimeError(
                f"review pool contains mixed engine identities: {sorted(names)}"
            )
        if names:
            yield {"type": "engine", "data": {"engine": names.pop()}}
        yield from _run_review(
            engines, game, all_moves, cancel_event, depth, multipv,
            white_elo=white_elo, black_elo=black_elo, book_walk=book_walk,
        )
    finally:
        # Per-review pool: always release the engines (finish, cancel, crash).
        quit_pool(engines)


def _plan_review(game: chess.pgn.Game, all_moves: list[chess.Move], book) \
        -> tuple[list[PlannedMove], list[str]]:
    """Walk the scored portion of the game into a per-ply plan plus the ordered
    list of distinct FENs the engine must score. The board after each played
    move is the 'before' position of the next ply, so each position is listed
    once (the seed plus each non-terminal result) — the old prev/after chain
    reuse, unchained."""
    board = game.board()
    # The last book move is the first scored ply's previous move, so the chain
    # `direct_recapture` reads starts inside the opening, not at the first
    # scored ply. One board copy per game, not per ply.
    prev: tuple[chess.Board, chess.Move] | None = None
    for move in all_moves[: book.plies]:
        prev = (board.copy(stack=False), move)  # advance to the seed position
        board.push(move)

    plan: list[PlannedMove] = []
    fens: list[str] = []
    seen: set[str] = set()

    def _need(fen: str) -> None:
        if fen not in seen:
            seen.add(fen)
            fens.append(fen)

    _need(board.fen())  # seed: the position before the first scored ply

    for ply, move in enumerate(all_moves[book.plies:], start=book.plies + 1):
        planned = _planned_move(board, move, ply, prev)
        board.push(move)
        if not planned.is_terminal:
            _need(board.fen())
        plan.append(planned)
        # The plan's own detached copy — no extra copy to carry the chain.
        prev = (planned.board_before, planned.move)
    return plan, fens


def _run_review(engines, game: chess.pgn.Game, all_moves: list[chess.Move], cancel_event, depth: int = _FALLBACK_DEPTH, multipv: int = _FALLBACK_MULTIPV, *, white_elo: int | None = None, black_elo: int | None = None, book_walk=_opening.book_walk, analyser_factory=None):
    moves: list[MoveReview] = []
    # Per-ply accuracy-scale drops, out-of-band because they are not wire fields.
    # _side_summary subscripts this, so every ply appended to `moves` must write
    # its entry in the same breath — a missing ply is a KeyError, not a silent 100.
    acc_drops: dict[int, float] = {}
    board = game.board()

    book = book_walk(game)

    # Rating resolution (§1): request field -> PGN Elo tag -> 1000, once per
    # review. k is per-mover, computed once and reused every ply.
    resolved_white_elo, resolved_black_elo = _resolve_ratings(game, white_elo, black_elo)
    k_white = k_for(resolved_white_elo)
    k_black = k_for(resolved_black_elo)

    # Emit book plies without engine calls
    for ply in range(1, book.plies + 1):
        if cancel_event is not None and cancel_event.is_set():
            return None
        move = all_moves[ply - 1]
        san = board.san(move)
        fen_before = board.fen()
        board.push(move)
        mv = MoveReview(
            ply=ply, san=san, fen_before=fen_before,
            eval_before=0.0, eval_after_played=0.0,
            best_move_san=san,
            win_before=50.0, win_after_played=50.0,
            win_drop=0.0, classification="book",
        )
        moves.append(mv)
        acc_drops[ply] = 0.0  # book plies give up nothing on either scale
        yield {"type": "move", "data": asdict(mv)}

    if book.plies >= len(all_moves):
        # Whole game was opening theory — no engine work.
        yield {
            "type": "summary",
            "data": _build_summary(
                moves,
                book,
                acc_drops,
                white_elo=resolved_white_elo,
                black_elo=resolved_black_elo,
                pgn_result=game.headers.get("Result", "*"),
            ),
        }
        return

    plan, fens = _plan_review(game, all_moves, book)

    # Fan the distinct positions out across the pool; classify/emit sequentially
    # in ply order as each ply's two positions land (progressive streaming).
    # `analyser_factory` swaps the engine pool for pre-supplied evals (the
    # frontend feeder, classify_game); the per-ply loop below is shared as-is.
    analyser = (analyser_factory or _ParallelAnalyser)(engines, depth, multipv, cancel_event)
    analyser.start(fens)

    # The previous scored ply's `before`, white-POV cp — re-converted with
    # the CURRENT mover's k each ply to build EvalPoints.before_opp (§4: "not
    # the opponent's — the lab computed every feature in the current mover's
    # curve"). None before the first scored ply (nothing to swing from).
    prev_before_white_cp: int | None = None

    for e in plan:
        if cancel_event is not None and cancel_event.is_set():
            return None

        prev_infos = analyser.get(e.fen_before)
        if prev_infos is None:
            return None  # cancelled
        if e.is_terminal:
            after_infos = _terminal_infos(e.board_after)
        else:
            after_infos = analyser.get(e.fen_after)
            if after_infos is None:
                return None  # cancelled

        k_mover = k_white if e.mover_is_white else k_black
        mv, before_white_cp, acc_drop, _, _, _ = _review_one_ply(
            prev_infos, after_infos, e, k_mover, prev_before_white_cp
        )
        moves.append(mv)
        acc_drops[mv.ply] = acc_drop
        yield {"type": "move", "data": asdict(mv)}

        prev_before_white_cp = before_white_cp

    yield {
        "type": "summary",
        "data": _build_summary(
            moves,
            book,
            acc_drops,
            white_elo=resolved_white_elo,
            black_elo=resolved_black_elo,
            pgn_result=game.headers.get("Result", "*"),
        ),
    }
