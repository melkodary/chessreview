"""Rebuild `classify()`'s inputs from a persisted `MoveReview`.

Lives in `review/` on purpose, beside `_classify_ply` which wrote those fields
-- a conversion far from its source of truth is how the lab drifted before.
The mirror on the lab side is `lab/adapter.py`; this
is the same seam for the review store.

New reviews persist the second-best expected-points value; legacy rows omit it
and remain partial. Move flags are recomputed from `fen_before` + `san` with
the same helpers the pipeline used.
"""
from __future__ import annotations

import chess

from .classify import EvalPoints, MoveFacts
from .expected import expected_points_pct, k_for
from .hanging import brilliant_material, direct_recapture, played_capture_see
from .winchance import mover_relative_mate


def points_and_facts(
    move: dict, prev_before_eval: float | None, *, white_elo: int, black_elo: int,
    prev_fen: str | None = None, prev_move: str | None = None,
) -> tuple[EvalPoints, MoveFacts]:
    """`(EvalPoints, MoveFacts)` for one stored ply. `move` is a serialized
    `MoveReview`; `prev_before_eval` is the previous ply's white-POV
    `eval_before`, or None on the first.

    `prev_fen` + `prev_move` (both or neither, SAN or UCI) are the opponent's
    last move, which `direct_recapture` reads. The store persists both halves
    on the previous row, so a tier-2 trace can supply them; a caller that
    cannot leaves the fact unknown rather than False.

    Raises `ValueError` if the stored FEN and SAN do not form a legal move --
    a corrupt row must not be silently traced as if it were sound.
    """
    board = chess.Board(move["fen_before"])
    mover_is_white = board.turn == chess.WHITE
    k_mover = k_for(white_elo if mover_is_white else black_elo)

    try:
        played = board.parse_san(move["san"])
    except (chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError) as exc:
        raise ValueError(
            f"ply {move.get('ply')}: stored san {move['san']!r} is not legal in "
            f"{move['fen_before']!r}"
        ) from exc

    points = EvalPoints(
        # The previous ply's before-eval, re-converted with the CURRENT mover's
        # k -- every feature lives in the current mover's curve. Stored in
        # pawns (white POV); the sigmoid takes centipawns.
        before_opp=(
            expected_points_pct(
                round(prev_before_eval * 100), mover_is_white, k_mover
            )
            if prev_before_eval is not None else None
        ),
        # win_before / win_after_played ARE the expected points classify() saw
        # (review/__init__.py notes they are mathematically identical to
        # points.before / points.after_played), so these need no reconversion
        # and carry no rounding of their own.
        before=move["win_before"],
        after_played=move["win_after_played"],
        after_second=move.get("win_after_second"),
    )

    board_after = board.copy(stack=False)
    board_after.push(played)
    material = brilliant_material(board, board_after, played, board.turn)

    facts = MoveFacts(
        # The pipeline compares moves; only the SAN survived persistence. Both
        # are rendered from the same board, so this agrees with it.
        played_is_best=move["san"] == move["best_move_san"],
        is_check=board.gives_check(played),
        is_capture=board.is_capture(played),
        is_promotion=played.promotion is not None,
        brilliant_offer_delta=material.offer_delta,
        brilliant_net_material=material.net_material,
        played_see=played_capture_see(board, played),
        direct_recapture=direct_recapture(board, played, _prev_ply(prev_fen, prev_move)),
        mate_before_mover=mover_relative_mate(move.get("mate_before"), mover_is_white),
        mate_after_played_mover=mover_relative_mate(
            move.get("mate_after_played"), mover_is_white
        ),
        is_only_legal_move=board.legal_moves.count() == 1,
    )
    return points, facts


def _prev_ply(
    prev_fen: str | None, prev_move: str | None,
) -> tuple[chess.Board, chess.Move] | None:
    """`(board, move)` of the opponent's last move, or None when a caller could
    not supply one. SAN first, UCI second: the store keeps SAN, the API sends
    UCI, and both spellings name the same move.

    An unparseable pair is None, not a raise -- the previous ply is an optional
    enrichment on every surface that has one, so a bad one degrades to the same
    INDETERMINATE as no previous ply at all.
    """
    if prev_fen is None or prev_move is None:
        return None
    try:
        board = chess.Board(prev_fen)
    except ValueError:
        return None
    for parse in (board.parse_san, board.parse_uci):
        try:
            return board, parse(prev_move)
        except (chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError):
            continue
    return None
