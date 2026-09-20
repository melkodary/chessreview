"""Unit tests for the hanging helpers.

`_is_piece_hanging` is a static exchange evaluation (`review/hanging.py:_see`):
the enemy wins material by taking on the square. It replaced a four-rule ladder
on 2026-07-28 (lab experiment 045), so the exchange geometry that used to be
asserted against `_attackers` / `_defenders` is asserted through the predicate
itself here — those two helpers no longer exist.
"""
import chess
import pytest

from review import (
    _has_hanging_friendly, _is_material_sacrifice,
    _is_piece_hanging, _pv_material_swing,
)
from review.hanging import (
    HANGING_SEE_FLOOR, BrilliantMaterial, _hanging_friendly_square,
    _incremental_recoup_after_acceptance, _move_created_offer,
    _pv_confirms_sacrifice, _see, brilliant_material, sacrifice_facts,
)


def hangs(fen: str, square: int) -> bool:
    """`_is_piece_hanging` on a single position (before == after)."""
    board = chess.Board(fen)
    return _is_piece_hanging(board, board, square)


# ---------------------------------------------------------------------------
# _see — the swap evaluation itself, in material units
# ---------------------------------------------------------------------------

def see_from(fen: str, square: int) -> int:
    board = chess.Board(fen)
    board.turn = not board.piece_at(square).color
    board.ep_square = None
    return _see(board, square)


def test_see_undefended_piece_is_worth_its_value():
    """Ra4xd4 wins a whole knight — nothing recaptures."""
    assert see_from("4k3/8/8/8/r2N4/8/8/4K3 w - - 0 1", chess.D4) == 3


def test_see_defended_piece_of_equal_value_is_worth_nothing():
    """Rxd4 cxd4 loses 5 for 3, so the exchange is declined at the root."""
    assert see_from("4k3/8/8/8/r2N4/2P5/8/4K3 w - - 0 1", chess.D4) == 0


def test_see_counts_the_deeper_chain_not_just_the_first_recapture():
    """Bf6xe5 dxe5 Re8xe5 nets black a pawn — a 3-deep chain the pairwise ladder
    could not see."""
    assert see_from("4r3/8/5b2/4B3/3P4/8/8/4K2k w - - 0 1", chess.E5) == 1


def test_see_promotion_gain_is_counted():
    """Black pawn b2 takes the knight on a1 AND promotes: 3 + (9 - 1)."""
    assert see_from("4k3/8/8/8/8/8/1p6/N3K3 b - - 0 1", chess.A1) == 11


# ---------------------------------------------------------------------------
# Exchange geometry — batteries, blockers and pins.
#
# None of this has code of its own any more: pushing each capture updates
# occupancy, so a rear slider becomes an attacker exactly when the piece ahead
# of it captures, and `board.is_legal` rejects a pinned attacker at every step.
# These cases are the regressions that used to need `_battery_sliders`.
# ---------------------------------------------------------------------------

def test_adjacent_king_may_take_an_undefended_piece():
    board = chess.Board("7K/8/8/3k4/4R3/8/8/8 w - - 0 1")
    assert _is_piece_hanging(board, board, chess.E4) is True


def test_adjacent_king_may_not_take_a_defended_piece():
    """Kd5xe4 would land beside the white king on f4 — illegal, so nothing hangs."""
    board = chess.Board("8/8/8/3k4/4QK2/8/8/8 w - - 0 1")
    assert _is_piece_hanging(board, board, chess.E4) is False


def test_defended_pawn_does_not_hang():
    """exd5 Bxd5: an even trade, not a win."""
    assert hangs("8/8/4p3/3P4/2B5/8/8/4K2k w - - 0 1", chess.D5) is False


def test_unattacked_piece_never_hangs():
    assert hangs("8/8/8/3P4/2B5/8/8/4K2k w - - 0 1", chess.D5) is False


def test_battery_defends_the_knight(  # 172163779992 ply 36, the bug behind exp 044
):
    """Qd7 + Rd8 doubled on the d-file. Rd8 is not an attacker of d4 until Qd7
    captures there, and the swap reaches it in its own turn."""
    assert hangs(
        "3r1r2/pppq1pkp/1n2p1p1/4P3/2Pn1R2/8/PP1QB1PP/RN4K1 w - - 0 19", chess.D4
    ) is False


def test_attacking_battery_wins_the_bishop():
    """Rd7 takes, Rd1 recaptures, Rd8 — revealed by Rd7 leaving — takes again.
    Black nets a bishop; the pre-SEE code counted Rd8 only after a special pass."""
    assert hangs("3r3k/3r4/8/8/8/8/3B4/3R3K w - - 0 1", chess.D2) is True


def test_rear_rook_behind_a_pawn_that_cannot_capture_is_no_attacker():
    """Same geometry, but the blocker is a black PAWN on d7: it captures on c6
    and e6, never d2, so it never vacates the file and Rd8 never joins."""
    assert hangs("3r3k/3p4/8/8/8/8/3B4/3R3K w - - 0 1", chess.D2) is False


def test_rear_rook_behind_an_enemy_blocker_defends_nothing():
    """Rd1 is aligned with d5 but a BLACK knight on d3 blocks the file. An enemy
    blocker never captures on d5 to clear the ray, so after cxd5 there is no
    recapture and the pawn is won — a defended pawn would swap to 0.

    Won by exactly one pawn, so HANGING_SEE_FLOOR declines it: the ray fact and
    the hanging verdict are separate assertions here."""
    assert see_from("7k/8/2p5/3P4/8/3n4/8/3RK3 w - - 0 1", chess.D5) == 1
    assert hangs("7k/8/2p5/3P4/8/3n4/8/3RK3 w - - 0 1", chess.D5) is False


def test_rear_rook_behind_a_friendly_pawn_that_cannot_capture_defends_nothing():
    """Pd2 is friendly but captures on c3/e3, never d4 — Rd1 is never revealed
    and Ra4xd4 wins the knight outright."""
    assert hangs("4k3/8/8/8/r2N4/8/3P4/3RK3 w - - 0 1", chess.D4) is True


def test_rear_rook_behind_a_friendly_knight_defends_nothing():
    """A knight can never capture along the ray it blocks."""
    assert hangs("4k3/8/8/8/r2N4/8/3N4/3RK3 w - - 0 1", chess.D4) is True


def test_rear_bishop_behind_its_own_capturing_pawn_defends():
    """Pc3 sits on the b2–d4 diagonal AND captures on d4, so cxd4 vacates c3 and
    reveals Bb2 — a real battery through a pawn."""
    assert hangs("4k3/8/8/8/r2N4/2P5/1B6/4K3 w - - 0 1", chess.D4) is False


def test_three_piece_battery_chain_defends():
    """Q+R+R on the d-file: each capture reveals the next link."""
    assert hangs("4k3/8/8/8/r2N4/3R4/3R4/3QK3 w - - 0 1", chess.D4) is False


def test_rook_behind_a_blocking_bishop_still_hangs():
    """101568724143 ply 56 (28...Re1+): Rb1xe1 is free — Re8 is walled off by its
    own Be7, which cannot capture on e1."""
    assert hangs(
        "4r1k1/1p2bppp/2p5/3p4/Pp4R1/1P1P2P1/1N3P1P/1R2r1K1 w - - 1 29", chess.E1
    ) is True


def test_battery_through_a_pinned_blocker_is_not_an_attacker():
    """102971523263 ply 18: Qd1 bears on g4 only through Be2, and Be2 is pinned
    to e1 by Qe5 — it can never vacate, so Bg4 is not attacked at all. The
    pre-SEE code checked the rear slider's pin but never the blocker's
    (fixed by this predicate)."""
    assert hangs(
        "rn2k2r/ppp2pp1/5p1p/4q3/1b4b1/2NP4/PPPBBPPP/R2QK2R w KQkq - 6 10", chess.G4
    ) is False


def test_battery_defended_knight_is_not_a_sacrifice():
    """18...Nxd4 — attacked twice (Qd2, Rf4), defended twice (Qd7, Rd8 behind it).
    Nothing is offered, so the brilliant arm's first gate must not open."""
    before = chess.Board("3r1r2/pppq1pkp/1n2p1p1/4Pn2/2PP1R2/8/PP1QB1PP/RN4K1 b - - 1 18")
    move = before.parse_san("Nxd4")
    after = before.copy()
    after.push(move)
    assert _is_material_sacrifice(before, after, move, chess.BLACK) is False


# ---------------------------------------------------------------------------
# _is_piece_hanging — the four ladder rules SEE replaced.
#
# Three of these inverted on 2026-07-28, and the inversion is the shipped
# behaviour, not a regression: the ladder exempted positions where the enemy
# genuinely does win material. What kept those exemptions from mislabelling
# moves is one level up — `_is_material_sacrifice` requires the hanging value to
# exceed what the move itself captured, so a recapture is filtered there. That
# guard is pinned by `test_material_sacrifice_recapture_equal_value_is_not_sacrifice`.
# ---------------------------------------------------------------------------

def test_recaptured_piece_still_hangs_when_it_is_genuinely_en_prise():
    """Black's knight recaptured on e4 and Bd3 can simply take it, with no
    recapture — so the piece hangs. The ladder exempted this as an "equal or
    better trade" purely because the enemy had just captured into it."""
    board_before = chess.Board("8/8/8/8/4N3/3B4/8/4K2k b - - 0 1")
    board_after = chess.Board("8/8/8/8/4n3/3B4/8/4K2k w - - 0 1")
    assert _is_piece_hanging(board_before, board_after, chess.E4) is True


def test_one_pawn_of_profit_is_below_the_floor():
    """The floor's whole job, in one pair: Rxd4 cxd4 wins a knight for nothing
    (3) and hangs, while the same rook against a defended pawn nets 1 and does
    not. Every SEE=1 brilliant in the corpus was a false positive (experiment
    048)."""
    assert see_from("4k3/8/8/8/r2N4/8/8/4K3 w - - 0 1", chess.D4) == 3
    assert hangs("4k3/8/8/8/r2N4/8/8/4K3 w - - 0 1", chess.D4) is True
    assert HANGING_SEE_FLOOR == 2


def test_queen_attacked_by_a_pawn_hangs():
    assert hangs("8/8/3p4/4Q3/8/8/8/4K2k b - - 0 1", chess.E5) is True


def test_rook_attacked_twice_and_undefended_hangs():
    assert hangs("8/8/8/3p1p2/4R3/8/8/4K2k b - - 0 1", chess.E4) is True


def test_pawn_defender_does_not_hold_when_the_chain_still_wins():
    """Bf6xe5 dxe5 Re8xe5 nets black a pawn. The ladder had a flat "a pawn
    defender is enough to hold" exemption, which this refutes on material — and
    a pawn is also all it wins, so HANGING_SEE_FLOOR declines the offer."""
    assert see_from("4r3/8/5b2/4B3/3P4/8/8/4K2k b - - 0 1", chess.E5) == 1
    assert hangs("4r3/8/5b2/4B3/3P4/8/8/4K2k b - - 0 1", chess.E5) is False


def test_rook_attacked_by_a_lone_minor_hangs():
    """The ladder welcomed rook-for-minor as a "favourable exchange" and exempted
    it. Nothing defends e4, so Nxe4 simply wins a rook."""
    board_before = chess.Board("8/8/5n2/8/4n3/8/8/4K2k b - - 0 1")
    board_after = chess.Board("8/8/5n2/8/4R3/8/8/4K2k w - - 0 1")
    assert _is_piece_hanging(board_before, board_after, chess.E4) is True


def test_capturing_into_a_defended_pawn_is_declined():
    """Qxe4 dxe4 costs the queen for a pawn, so the exchange is declined — the
    one ladder exemption SEE reaches on its own."""
    board_before = chess.Board("8/8/8/8/4P3/3P4/8/4K2k b - - 0 1")
    board_after = chess.Board("8/4q3/8/8/4P3/3P4/8/4K2k b - - 0 1")
    assert _is_piece_hanging(board_before, board_after, chess.E4) is False


# ---------------------------------------------------------------------------
# _has_hanging_friendly — scans all friendly non-pawn non-king pieces
# ---------------------------------------------------------------------------

def test_has_hanging_friendly_returns_false_when_nothing_hangs():
    """Quiet starting position after 1.e4 — no white piece is hanging."""
    before = chess.Board()
    after = before.copy()
    after.push(chess.Move.from_uci("e2e4"))
    assert _has_hanging_friendly(before, after, mover_color=chess.WHITE) is False


def test_has_hanging_friendly_returns_true_when_knight_hangs():
    """Quiet white move that leaves white knight on c3 attacked by pawn on b4,
    with no defenders → knight is hanging → True."""
    # Board: white K on e1, white knight on c3, black pawn on b4, black king on e8.
    # Move: irrelevant for the scan (we only check post-move state); use a noop-like Ke1->e2.
    before = chess.Board("4k3/8/8/8/1p6/2N5/8/4K3 w - - 0 1")
    after = before.copy()
    after.push(chess.Move.from_uci("e1e2"))
    assert _has_hanging_friendly(before, after, mover_color=chess.WHITE) is True


def test_has_hanging_friendly_skips_pawns():
    """A white pawn on a square attacked by a black pawn with no defender
    must NOT count as 'hanging friendly' — pawns and kings are excluded
    from the brilliant-sacrifice scan."""
    # White pawn on d5 attacked by black pawn on e6, no white defender.
    before = chess.Board("4k3/8/4p3/8/3P4/8/8/4K3 w - - 0 1")
    after = before.copy()
    after.push(chess.Move.from_uci("e1e2"))  # noop king move
    assert _has_hanging_friendly(before, after, mover_color=chess.WHITE) is False


def test_has_hanging_friendly_only_scans_mover_color():
    """A BLACK hanging knight must not satisfy `mover_color=WHITE`."""
    # White king on e1; black knight on c3 attacked by white pawn on b2 (lower-value attacker).
    before = chess.Board("4k3/8/8/8/8/2n5/1P6/4K3 w - - 0 1")
    after = before.copy()
    after.push(chess.Move.from_uci("e1e2"))
    # No white piece is hanging — black knight doesn't count.
    assert _has_hanging_friendly(before, after, mover_color=chess.WHITE) is False
    # Same position but asking from black's POV: knight IS hanging.
    assert _has_hanging_friendly(before, after, mover_color=chess.BLACK) is True


# ---------------------------------------------------------------------------
# _is_material_sacrifice — hanging piece only counts as a sacrifice when its
# value exceeds what the move itself captured
# ---------------------------------------------------------------------------

def test_material_sacrifice_recapture_equal_value_is_not_sacrifice():
    """Qxh3 regression: recapturing a bishop while own bishop on h6 hangs is
    an even trade, not a sacrifice (hanging B=3, captured B=3)."""
    # After 1.e4 e5 2.Nf3 Bc5 3.Bc4 d6 4.d4 exd4 5.Ng5 Nh6 6.Qf3 O-O
    # 7.Nh3 Nc6 8.Bxh6 Bxh3 — white to play 9.Qxh3.
    before = chess.Board("r2q1rk1/ppp2ppp/2np3B/2b5/2BpP3/5Q1b/PPP2PPP/RN2K2R w KQ - 0 9")
    move = chess.Move.from_uci("f3h3")
    after = before.copy()
    after.push(move)
    # Precondition: the heuristic does see Bh6 as hanging.
    assert _has_hanging_friendly(before, after, mover_color=chess.WHITE) is True
    assert _is_material_sacrifice(before, after, move, mover_color=chess.WHITE) is False


def test_material_sacrifice_quiet_move_leaving_knight_is_sacrifice():
    """Quiet move (captures nothing) leaving own knight hanging → sacrifice."""
    before = chess.Board("4k3/8/8/8/1p6/2N5/8/4K3 w - - 0 1")
    move = chess.Move.from_uci("e1e2")
    after = before.copy()
    after.push(move)
    assert _is_material_sacrifice(before, after, move, mover_color=chess.WHITE) is True


def test_material_sacrifice_capture_lower_value_is_sacrifice():
    """Capturing a pawn (1) while own knight (3) hangs → net material offered
    → still a sacrifice."""
    # White Nc3 hangs to b4 pawn; white plays exd5 winning a pawn.
    before = chess.Board("4k3/8/8/3p4/1p2P3/2N5/8/4K3 w - - 0 1")
    move = chess.Move.from_uci("e4d5")
    after = before.copy()
    after.push(move)
    assert _has_hanging_friendly(before, after, mover_color=chess.WHITE) is True
    assert _is_material_sacrifice(before, after, move, mover_color=chess.WHITE) is True


@pytest.mark.parametrize(
    "fen,uci",
    [
        # Quiet move beside a knight that was already hanging → not fresh.
        ("4k3/8/8/8/1p6/2N5/8/4K3 w - - 0 1", "e1e2"),
        # Move abandons the knight's only defender → fresh off the destination.
        ("4r1k1/8/8/8/4N3/8/8/4R1K1 w - - 0 1", "e1a1"),
        # Capture worth less than the piece left hanging → still a sacrifice.
        ("4k3/8/8/3p4/1p2P3/2N5/8/4K3 w - - 0 1", "e4d5"),
        # Even recapture while a bishop hangs → not a sacrifice.
        ("r2q1rk1/ppp2ppp/2np3B/2b5/2BpP3/5Q1b/PPP2PPP/RN2K2R w KQ - 0 9", "f3h3"),
        # Nothing hangs at all.
        ("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "e1e2"),
    ],
)
def test_sacrifice_facts_agrees_with_the_two_single_fact_helpers(fen, uci):
    """`sacrifice_facts` exists only to spend one board scan instead of two, so
    it must return exactly what calling them in sequence returned."""
    before = chess.Board(fen)
    move = chess.Move.from_uci(uci)
    after = before.copy()
    after.push(move)

    expected_sac = _is_material_sacrifice(before, after, move, before.turn)
    expected_fresh = (
        _move_created_offer(before, after, move, before.turn) if expected_sac else False
    )
    assert sacrifice_facts(before, after, move, before.turn) == (
        expected_sac,
        expected_fresh,
    )


def test_sacrifice_facts_reports_fresh_false_when_the_move_is_no_sacrifice():
    """The callers' cheap-when-relevant gate, preserved: `fresh` is only
    meaningful on a sacrifice, so a non-sacrifice reports False rather than
    `_move_created_offer`'s own nothing-hangs True."""
    before = chess.Board("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
    move = chess.Move.from_uci("e1e2")
    after = before.copy()
    after.push(move)

    assert _move_created_offer(before, after, move, chess.WHITE) is True
    assert sacrifice_facts(before, after, move, chess.WHITE) == (False, False)


def test_fresh_sacrifice_off_destination_when_the_move_created_the_exposure():
    """The abandoned-defender branch: Re1 is the only defender of Ne4, so
    moving it offers the knight even though the rook is what moved. Shipped
    as a product call."""
    before = chess.Board("4r1k1/8/8/8/4N3/8/8/4R1K1 w - - 0 1")
    move = chess.Move.from_uci("e1a1")
    after = before.copy()
    after.push(move)

    assert _is_piece_hanging(before, before, chess.E4) is False  # created here
    assert _hanging_friendly_square(before, after, chess.WHITE) == chess.E4
    assert _is_material_sacrifice(before, after, move, chess.WHITE) is True
    assert _move_created_offer(before, after, move, chess.WHITE) is True
    assert sacrifice_facts(before, after, move, chess.WHITE) == (True, True)


def test_fresh_sacrifice_rejects_a_bystander_that_was_already_hanging():
    """The other side of the same rule: Nc3 is en prise to b4 going in, so a
    king move elsewhere offers nothing the position was not already losing."""
    before = chess.Board("4k3/8/8/8/1p6/2N5/8/4K3 w - - 0 1")
    move = chess.Move.from_uci("e1e2")
    after = before.copy()
    after.push(move)

    assert _is_piece_hanging(before, before, chess.C3) is True
    assert _is_material_sacrifice(before, after, move, chess.WHITE) is True
    assert _move_created_offer(before, after, move, chess.WHITE) is False
    assert sacrifice_facts(before, after, move, chess.WHITE) == (True, False)


def test_material_sacrifice_capture_higher_value_is_not_sacrifice():
    """Capturing a queen (9) while own knight (3) hangs → net material gain
    → not a sacrifice."""
    # White Nc3 hangs to b4 pawn; white rook takes the black queen on d8.
    before = chess.Board("3qk3/8/8/8/1p6/2N5/8/3RK3 w - - 0 1")
    move = chess.Move.from_uci("d1d8")
    after = before.copy()
    after.push(move)
    assert _is_material_sacrifice(before, after, move, mover_color=chess.WHITE) is False


def test_material_sacrifice_false_when_nothing_hangs():
    """No hanging friendly piece → never a sacrifice."""
    before = chess.Board()
    move = chess.Move.from_uci("e2e4")
    after = before.copy()
    after.push(move)
    assert _is_material_sacrifice(before, after, move, mover_color=chess.WHITE) is False


# ---------------------------------------------------------------------------
# brilliant_material — experiment 077's per-piece offer and acceptance ledger
# ---------------------------------------------------------------------------

def brilliant_facts(fen: str, uci: str) -> BrilliantMaterial:
    before = chess.Board(fen)
    move = chess.Move.from_uci(uci)
    after = before.copy()
    after.push(move)
    return brilliant_material(before, after, move, before.turn)


def test_brilliant_material_counts_a_moved_piece_offer():
    """Nb2-a4 steps onto Ra8's file: exposure rises from 0 to 3."""
    assert brilliant_facts(
        "r3k3/8/8/8/8/8/1N6/4K3 w - - 0 1", "b2a4"
    ) == BrilliantMaterial(offer_delta=3, net_material=3)


def test_brilliant_material_counts_an_off_destination_discovered_offer():
    """Bg5 abandons Re8, exposing it to Re1 without moving the offered rook."""
    assert brilliant_facts(
        "4r1k1/1p2b1pp/2p5/3p1p2/Pp3R2/1P1P2P1/1N3P1P/4R1K1 b - - 1 30",
        "e7g5",
    ) == BrilliantMaterial(offer_delta=5, net_material=5)


def test_brilliant_material_reoffer_has_no_positive_delta():
    """Re8 was already loose before Rxf5+, so its five-point exposure is old."""
    assert brilliant_facts(
        "4R3/1p3kpp/2p5/3p1pb1/Pp3R2/1P1P2P1/1N3P1P/6K1 w - - 1 32",
        "f4f5",
    ) == BrilliantMaterial(offer_delta=0, net_material=1)


def test_brilliant_material_subtracts_the_played_capture():
    """Bxe7 offers that bishop for three but has already banked a bishop."""
    assert brilliant_facts(
        "q4rk1/rppbnppp/4p3/n1b1P3/Pp1p3B/1B1P1N2/2P1QPPP/RN3RK1 w - - 11 15",
        "h4e7",
    ) == BrilliantMaterial(offer_delta=3, net_material=0)


def test_brilliant_material_does_not_collect_locally_and_elsewhere_on_one_turn():
    """After ...bxa4, white may take that pawn (1) or Nh5 (3), not both."""
    assert brilliant_facts(
        "4k3/8/8/1p5n/2R5/8/1N6/4K2R w - - 0 1", "b2a4"
    ) == BrilliantMaterial(offer_delta=2, net_material=0)


def test_brilliant_material_credits_only_elsewheres_advantage_over_local():
    """Removing loose Nh5 leaves local recapture best, so recoup is zero."""
    assert brilliant_facts(
        "4k3/8/8/1p6/2R5/8/1N6/4K3 w - - 0 1", "b2a4"
    ) == BrilliantMaterial(offer_delta=2, net_material=2)


def test_incremental_recoup_is_zero_without_a_legal_acceptance_capture():
    board = chess.Board("4k3/8/8/8/4N3/8/8/4K3 b - - 0 1")
    assert _incremental_recoup_after_acceptance(board, chess.WHITE, chess.E4) == 0


def test_brilliant_material_breaks_equal_delta_ties_by_greater_exposure():
    """Rg7 and Ra7 both have delta 0; Ra7's five-point exposure must win."""
    assert brilliant_facts(
        "3r2k1/p3RrB1/b1p1p2p/8/7P/4K3/P2n4/8 w - - 0 33",
        "e7a7",
    ) == BrilliantMaterial(offer_delta=0, net_material=4)


def test_brilliant_material_excludes_pawns_and_kings():
    assert brilliant_facts(
        "k2r4/8/8/8/3P4/8/8/4K3 w - - 0 1", "e1e2"
    ) == BrilliantMaterial(offer_delta=0, net_material=0)


def test_brilliant_material_returns_zero_when_no_piece_is_offered():
    assert brilliant_facts(
        chess.STARTING_FEN, "e2e4"
    ) == BrilliantMaterial(offer_delta=0, net_material=0)


# ---------------------------------------------------------------------------
# _pv_material_swing — mover-POV net material change along the best PV
# ---------------------------------------------------------------------------

def test_pv_material_swing_clean_piece_win():
    """PV captures an undefended knight in one ply → +3 for the mover."""
    board = chess.Board("4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1")
    pv = [chess.Move.from_uci("d1d5")]  # Rxd5, no recapture
    assert _pv_material_swing(board, pv, chess.WHITE) == 3


def test_pv_material_swing_even_trade_is_zero():
    """Rook takes rook, king recaptures → net material unchanged → 0."""
    board = chess.Board("3rk3/8/3R4/8/8/8/8/4K3 w - - 0 1")
    pv = [chess.Move.from_uci("d6d8"), chess.Move.from_uci("e8d8")]  # Rxd8+ Kxd8
    assert _pv_material_swing(board, pv, chess.WHITE) == 0


def test_pv_material_swing_empty_pv_is_zero():
    board = chess.Board("4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1")
    assert _pv_material_swing(board, [], chess.WHITE) == 0


def test_pv_material_swing_illegal_tail_uses_partial_walk():
    """A stale/illegal PV move stops the walk; the swing to that point stands."""
    board = chess.Board("4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1")
    pv = [chess.Move.from_uci("d1d5"), chess.Move.from_uci("e7e5")]  # 2nd illegal
    assert _pv_material_swing(board, pv, chess.WHITE) == 3


def test_pv_material_swing_promotion_counted():
    """Unopposed queening: pawn (1) leaves, queen (9) appears → +8 net."""
    board = chess.Board("4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
    pv = [chess.Move.from_uci("a7a8q")]
    assert _pv_material_swing(board, pv, chess.WHITE) == 8


# ---------------------------------------------------------------------------
# _hanging_friendly_square — companion to _hanging_friendly_value, exposes
# which square the flagged piece sits on (needed to track it through a PV)
# ---------------------------------------------------------------------------

def test_hanging_friendly_square_returns_the_hanging_piece_square():
    before = chess.Board("4k3/8/8/3p4/1p2P3/2N5/8/4K3 w - - 0 1")
    move = chess.Move.from_uci("e4d5")
    after = before.copy()
    after.push(move)
    assert _hanging_friendly_square(before, after, mover_color=chess.WHITE) == chess.C3


def test_hanging_friendly_square_none_when_nothing_hangs():
    before = chess.Board()
    move = chess.Move.from_uci("e2e4")
    after = before.copy()
    after.push(move)
    assert _hanging_friendly_square(before, after, mover_color=chess.WHITE) is None


# ---------------------------------------------------------------------------
# _pv_confirms_sacrifice — does the engine's own continuation actually
# capture the flagged piece (tracking relocation), vs. a static false-
# positive where it evacuates untaken (2026-07-11 calibration redesign:
# replaces a bare pv_material_swing<0 check, which can't tell these apart
# when the sac's own line nets ahead overall — see the docstring in
# review/hanging.py and the classify()-level regression tests for the two
# real reference games this was built against).
# ---------------------------------------------------------------------------

def test_pv_confirms_sacrifice_direct_capture():
    """Simplest case: the opponent's very next move captures the flagged
    piece in place."""
    board_after = chess.Board("4k3/8/4p3/3N4/8/8/8/4K3 b - - 0 1")
    pv_after_move = [chess.Move.from_uci("e6d5")]
    assert _pv_confirms_sacrifice(board_after, chess.D5, pv_after_move) is True


def test_pv_confirms_sacrifice_after_relocation():
    """Rxh2-shape: the flagged piece isn't captured immediately — its own
    side moves it again first (h2->d2), and only then does the opponent
    capture it (on its new square). Tracking must follow the relocation."""
    board_after = chess.Board("4k3/8/8/8/8/4B3/P6r/6K1 w - - 0 1")
    pv_after_move = [
        chess.Move.from_uci("a2a3"),  # White quiet, doesn't touch h2
        chess.Move.from_uci("h2d2"),  # Black relocates the flagged rook
        chess.Move.from_uci("e3d2"),  # White finally captures it on d2
    ]
    assert _pv_confirms_sacrifice(board_after, chess.H2, pv_after_move) is True


def test_pv_confirms_sacrifice_false_when_piece_evacuates_untaken():
    """Qxd6-shape: the flagged piece relocates via its own side's move and is
    never captured within the horizon — not a confirmed sacrifice."""
    board_after = chess.Board("4k3/p7/8/8/4N3/8/8/4K3 b - - 0 1")
    pv_after_move = [
        chess.Move.from_uci("a7a6"),  # Black quiet, doesn't touch e4
        chess.Move.from_uci("e4d6"),  # White relocates the flagged knight
        chess.Move.from_uci("a6a5"),  # Black quiet, doesn't touch d6
    ]
    assert _pv_confirms_sacrifice(board_after, chess.E4, pv_after_move) is False


def test_pv_confirms_sacrifice_false_when_no_hanging_square():
    board_after = chess.Board()
    assert _pv_confirms_sacrifice(board_after, None, list(board_after.legal_moves)) is False


def test_pv_confirms_sacrifice_stops_at_illegal_tail():
    """A stale/illegal PV move stops the walk — no confirmation beyond it."""
    board_after = chess.Board("4k3/8/4p3/3N4/8/8/8/4K3 b - - 0 1")
    pv_after_move = [chess.Move.from_uci("a1a2")]  # a1 is empty — illegal
    assert _pv_confirms_sacrifice(board_after, chess.D5, pv_after_move) is False
