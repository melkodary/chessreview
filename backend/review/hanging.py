from dataclasses import dataclass

import chess

from config import HANGING_SEE_FLOOR

_MATERIAL = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
}

_PIECE_VALUE_INF = 999  # King

_PROMOTIONS = (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT)

# PV-walk horizon (half-moves) for the material helpers below: how far along
# an engine line `_pv_material_swing` / `_pv_confirms_sacrifice` look. It
# parameterizes material logic, so it lives beside the material helpers, not
# in the band config. (MISS_PV_SWING, the old squandered-tactic threshold,
# was retired with the pv-material-swing miss rule — 2026-07-13 rating-aware
# classifier spec.)
MISS_PV_PLIES = 6


@dataclass(frozen=True)
class BrilliantMaterial:
    offer_delta: int
    net_material: int


def _piece_value(piece: chess.Piece) -> int:
    if piece.piece_type == chess.KING:
        return _PIECE_VALUE_INF
    return _MATERIAL.get(piece.piece_type, 0)


def _material_balance(board: chess.Board, color: bool) -> int:
    return sum(
        _MATERIAL[p.piece_type]
        for p in board.piece_map().values()
        if p.color == color and p.piece_type != chess.KING
    )


def _pv_material_swing(
    board_before: chess.Board,
    pv: list[chess.Move],
    mover_color: bool,
    plies: int = MISS_PV_PLIES,
) -> int:
    """Mover-POV net material change along the first `plies` moves of `pv`.
    Positive = the line wins material for the mover.

    Walks a copy of `board_before`, stopping early if a PV move is not legal on
    the copy (stale/corrupt PV — a safety stop, not an expected path). An empty
    or short PV walks what exists; an empty PV yields 0."""
    board = board_before.copy()

    def _balance() -> int:
        return (
            _material_balance(board, mover_color)
            - _material_balance(board, not mover_color)
        )

    start = _balance()
    for move in pv[:plies]:
        if not board.is_legal(move):
            break
        board.push(move)
    return _balance() - start


def _pv_confirms_sacrifice(
    board_after: chess.Board,
    hanging_square: int | None,
    pv_after_move: list[chess.Move],
    plies: int = MISS_PV_PLIES,
) -> bool:
    """True iff the engine's own continuation actually captures the piece
    `_is_material_sacrifice` flagged as hanging (on `hanging_square` in
    `board_after`) within `plies` half-moves.

    Tracks the flagged piece's square as it relocates along its own side's
    moves, because neither cheaper test works: the static one-ply hang check
    misses a counter-attack that lets the piece evacuate, and a net-material
    -swing sign check misses a piece that genuinely was captured in a line that
    still resolves ahead overall. Only a capture on the piece's *current* square
    counts. Lab-and-tests only since the 2026-07-28 SEE rework dropped
    PV-confirm from the production classifier.
    """
    if hanging_square is None:
        return False
    board = board_after.copy()
    target = hanging_square
    for move in pv_after_move[:plies]:
        if not board.is_legal(move):
            break
        if move.to_square == target and board.piece_at(target) is not None:
            return True
        if move.from_square == target:
            target = move.to_square
        board.push(move)
    return False


def _enemy_to_move(board: chess.Board, square: int) -> tuple[chess.Board, bool] | None:
    """Copy with the enemy of the piece on `square` to move (so capture-legality
    resolves from the attacker's side) and en-passant cleared. None if empty."""
    piece = board.piece_at(square)
    if piece is None:
        return None
    enemy_color = not piece.color
    copy = board.copy()
    copy.turn = enemy_color
    copy.ep_square = None
    return copy, enemy_color


def _capture_moves(board: chess.Board, frm: int, to: int) -> list[chess.Move]:
    """Capture move(s) `frm`→`to`: four for a pawn promoting on the back rank,
    one otherwise — matching how `legal_moves` enumerates a promoting capture."""
    piece = board.piece_at(frm)
    if piece is not None and piece.piece_type == chess.PAWN and chess.square_rank(to) in (0, 7):
        return [chess.Move(frm, to, promotion=p) for p in _PROMOTIONS]
    return [chess.Move(frm, to)]


# ── Static exchange evaluation ────────────────────────────────────────────────
# The hanging test is a swap evaluation on the square, walked by pushing real
# captures onto a board copy. Walking it on a board rather than over a
# hand-maintained attacker set is the whole design: `board.is_legal` answers
# pins, check-evasion and king safety on the ACTUAL position at every step, and
# occupancy updates reveal x-rays with no battery code of its own. The four
# fitted rules this replaced each needed that attacker set beside them, and
# three production bugs in a row lived in it. Cost 7 brilliant false positives
# on arrival, 9 refunded by HANGING_SEE_FLOOR.

_MAX_SWAP_DEPTH = 32  # unreachable in a real exchange — a guard, not a horizon


def _cheapest_capture(board: chess.Board, square: int) -> chess.Move | None:
    """Cheapest legal side-to-move capture on `square`, or None.

    `board.attackers()` stopping at the first blocker is right here rather than
    something to compensate for: the rear piece of a battery is not an attacker
    *yet*, and becomes one on its own turn because the capture ahead of it
    vacated the ray. An adjacent king needs no special case either — it sorts
    last by value, and `is_legal` refuses it a defended square."""
    best: chess.Move | None = None
    best_value: int | None = None
    for frm in board.attackers(board.turn, square):
        piece = board.piece_at(frm)
        if piece is None:
            continue
        value = _piece_value(piece)
        if best_value is not None and value >= best_value:
            continue
        for move in _capture_moves(board, frm, square):
            if board.is_legal(move):
                best, best_value = move, value
                break
    return best


def _see(board: chess.Board, square: int, depth: int = 0) -> int:
    """Material the side to move wins by starting the exchange on `square`.

    Either side may stand pat once continuing costs more than stopping — the
    `max(0, …)` at every node, which is what makes this an evaluation of the
    exchange rather than of a forced capture sequence."""
    if depth >= _MAX_SWAP_DEPTH:
        return 0
    move = _cheapest_capture(board, square)
    if move is None:
        return 0
    victim = board.piece_at(square)
    gain = _piece_value(victim) if victim is not None else 0
    if move.promotion:
        gain += _MATERIAL[move.promotion] - _MATERIAL[chess.PAWN]
    board.push(move)
    try:
        return max(0, gain - _see(board, square, depth + 1))
    finally:
        board.pop()


def played_capture_see(board_before: chess.Board, move: chess.Move) -> int:
    """What THIS capture wins, not what the cheapest capture on the square wins.

    `_see` always starts the exchange with the cheapest attacker, so it answers
    a different question than "the mover played Rxe6 — did that pay?". 0 for a
    quiet move. Great's `non_obvious` gate reads it (experiment 061/068 arm C).
    """
    if not board_before.is_capture(move):
        return 0
    gain = _captured_value(board_before, move)
    if move.promotion:
        gain += _MATERIAL[move.promotion] - _MATERIAL[chess.PAWN]
    after = board_before.copy(stack=False)
    after.push(move)
    return max(0, gain - _see(after, move.to_square))


def direct_recapture(
    board_before: chess.Board,
    move: chess.Move,
    prev: tuple[chess.Board, chess.Move] | None,
) -> bool | None:
    """Did the opponent's immediately preceding move capture on the square this
    move takes back? `prev` is `(board before that move, that move)`.

    Tri-state: None means the previous move was NOT SUPPLIED, never "no" — a
    surface without it must read INDETERMINATE rather than claim the move was
    hard. A non-capture can never be a recapture, so it answers False without
    the previous move at all, which is what keeps the unknown branch narrow.
    """
    if not board_before.is_capture(move):
        return False
    if prev is None:
        return None
    prev_board, prev_move = prev
    return prev_board.is_capture(prev_move) and prev_move.to_square == move.to_square


def _is_piece_hanging(
    board_before: chess.Board, board_after: chess.Board, square: int
) -> bool:
    """True when the enemy wins `HANGING_SEE_FLOOR` or more by taking on
    `square` in `board_after`.

    A floor, not a sign test: a one-pawn square is a marginal exchange rather
    than an offered piece.

    `board_before` is unread — a swap evaluation is a function of one position —
    but the three-argument shape is a seam `build_dataset.py` and several
    committed lab experiments call, so it stays."""
    view = _enemy_to_move(board_after, square)
    if view is None:
        return False
    copy, _ = view
    return _see(copy, square) >= HANGING_SEE_FLOOR


def _hanging_friendly(
    board_before: chess.Board, board_after: chess.Board, mover_color: bool
) -> tuple[int | None, int]:
    """`(square, cost)` of the friendly non-pawn non-king piece whose loss costs
    most to the exchange, or `(None, 0)` if none hang.

    THE scan — a full SEE per candidate piece, and the only place this walk
    lives. The three helpers below are views on it: callers wanting one half
    take one, and `sacrifice_facts` takes both from a single pass rather than
    re-deriving the value from the square.

    Ranked on the SWAP VALUE, not on nominal material: a defended rook taken by
    a knight costs the exchange, not a rook, so nominal ranking read `Rxf2`-shaped
    moves as 5-point offers (experiment 055).
    """
    best_square: int | None = None
    best_cost = 0
    for square, piece in board_after.piece_map().items():
        if piece.color != mover_color:
            continue
        if piece.piece_type in (chess.PAWN, chess.KING):
            continue
        if _is_piece_hanging(board_before, board_after, square):
            view = _enemy_to_move(board_after, square)
            cost = _see(view[0], square) if view is not None else 0
            if cost > best_cost:
                best_cost = cost
                best_square = square
    return best_square, best_cost


def _has_hanging_friendly(
    board_before: chess.Board, board_after: chess.Board, mover_color: bool
) -> bool:
    """Returns True if any friendly non-pawn non-king piece is hanging after the move."""
    return _hanging_friendly(board_before, board_after, mover_color)[1] > 0


def _hanging_friendly_square(
    board_before: chess.Board, board_after: chess.Board, mover_color: bool
) -> int | None:
    """Square of the highest-value hanging friendly piece, or None. The square
    is what `_pv_confirms_sacrifice` needs to track the flagged piece through
    the PV."""
    return _hanging_friendly(board_before, board_after, mover_color)[0]


def _hanging_friendly_value(
    board_before: chess.Board, board_after: chess.Board, mover_color: bool
) -> int:
    """What the costliest hanging friendly non-pawn non-king piece costs to the
    exchange, 0 if none hang. Named `_value` because it is the amount
    `_is_material_sacrifice` weighs against `_captured_value`."""
    return _hanging_friendly(board_before, board_after, mover_color)[1]


def _captured_value(board_before: chess.Board, move: chess.Move) -> int:
    """Value of the piece the move captures, 0 for a quiet move."""
    if board_before.is_en_passant(move):
        return _MATERIAL[chess.PAWN]
    captured = board_before.piece_at(move.to_square)
    return _piece_value(captured) if captured is not None else 0


def _exposure(board: chess.Board, square: int) -> int:
    """Material the piece owner's enemy wins by starting an exchange here."""
    view = _enemy_to_move(board, square)
    return 0 if view is None else _see(view[0], square)


def _best_loose_material(
    board: chess.Board,
    side: chess.Color,
    *,
    exclude: int,
) -> int:
    """Best enemy non-pawn, non-king material `side` can win now."""
    best = 0
    for square, piece in board.piece_map().items():
        if square == exclude or piece.color == side:
            continue
        if piece.piece_type in (chess.PAWN, chess.KING):
            continue
        best = max(best, _exposure(board, square))
    return best


def _incremental_recoup_after_acceptance(
    board_after: chess.Board,
    mover_color: chess.Color,
    offered_square: int,
) -> int:
    """Extra material available elsewhere instead of the local recapture."""
    view = _enemy_to_move(board_after, offered_square)
    if view is None:
        return 0
    accepted = view[0]
    capture = _cheapest_capture(accepted, offered_square)
    if capture is None:
        return 0
    accepted.push(capture)
    local = _see(accepted, offered_square)
    elsewhere = _best_loose_material(
        accepted, mover_color, exclude=offered_square
    )
    return max(0, elsewhere - local)


def brilliant_material(
    board_before: chess.Board,
    board_after: chess.Board,
    move: chess.Move,
    mover_color: chess.Color,
) -> BrilliantMaterial:
    """Experiment 077's per-piece offer delta and one-reply material ledger."""
    best_delta = 0
    best_exposure = 0
    best_square: int | None = None

    for square, piece in board_after.piece_map().items():
        if piece.color != mover_color:
            continue
        if piece.piece_type in (chess.PAWN, chess.KING):
            continue
        exposure_after = _exposure(board_after, square)
        if exposure_after <= 0:
            continue
        before_square = move.from_square if square == move.to_square else square
        delta = exposure_after - _exposure(board_before, before_square)
        if delta > best_delta or (
            delta == best_delta and exposure_after > best_exposure
        ):
            best_delta = delta
            best_exposure = exposure_after
            best_square = square

    if best_square is None:
        return BrilliantMaterial(offer_delta=0, net_material=0)

    captured = _captured_value(board_before, move)
    incremental_recoup = _incremental_recoup_after_acceptance(
        board_after, mover_color, best_square
    )
    return BrilliantMaterial(
        offer_delta=best_delta,
        net_material=best_exposure - captured - incremental_recoup,
    )


def _is_material_sacrifice(
    board_before: chess.Board,
    board_after: chess.Board,
    move: chess.Move,
    mover_color: bool,
) -> bool:
    """True when the move offers net material: a friendly piece is left hanging
    and its value exceeds whatever the move itself captured. A recapture or an
    even/winning trade is not a sacrifice."""
    hanging = _hanging_friendly_value(board_before, board_after, mover_color)
    return hanging > _captured_value(board_before, move)


def sacrifice_facts(
    board_before: chess.Board,
    board_after: chess.Board,
    move: chess.Move,
    mover_color: bool,
) -> tuple[bool, bool]:
    """`(is_sacrifice, move_created_offer)` in ONE board scan.

    `_is_material_sacrifice` and `_move_created_offer` each run `_hanging_friendly`,
    a full SEE over every friendly non-pawn non-king piece (~117us). Calling
    them in sequence — which is what every production caller wants — pays for
    that scan twice with identical arguments. Both remain as the lab's and the
    tests' single-fact seams; this is the pipeline's entry point.

    `move_created_offer` is False when the move is not a sacrifice, matching
    the callers' old cheap-when-relevant gate rather than
    `_move_created_offer`'s own no-piece-hangs True.
    """
    square, hanging = _hanging_friendly(board_before, board_after, mover_color)
    if hanging <= _captured_value(board_before, move):
        return False, False
    return True, _move_created_offer_at(board_before, board_after, move, mover_color, square)


def _move_created_offer(
    board_before: chess.Board,
    board_after: chess.Board,
    move: chess.Move,
    mover_color: bool,
) -> bool:
    """True when the move CREATED the offer: the piece left hanging is the one
    the move just played, or it is a piece the move newly exposed. A piece that
    was already en prise going in is not an offer this move made.

    The off-destination branch buys deflections and abandoned defenders at a
    measured cost in precision, shipped as a product call.

    Only meaningful when the move is a material sacrifice; callers gate on
    `_is_material_sacrifice` first. Returns True when no piece hangs.
    """
    return _move_created_offer_at(
        board_before, board_after, move, mover_color,
        _hanging_friendly(board_before, board_after, mover_color)[0],
    )


def _move_created_offer_at(
    board_before: chess.Board,
    board_after: chess.Board,
    move: chess.Move,
    mover_color: bool,
    square: int | None,
) -> bool:
    """`_move_created_offer` given an already-computed hanging square, so
    `sacrifice_facts` can reuse the one scan both facts need.

    `board_after` is unread; the shape stays because committed lab experiments
    tap this function at the module attribute (049, 050, 067).
    """
    return (
        square is None
        or square == move.to_square
        or not _is_piece_hanging(board_before, board_before, square)
    )
