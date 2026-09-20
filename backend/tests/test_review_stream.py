import io
import threading

import chess
import chess.engine
import chess.pgn
import pytest

import review


PGN_5_MOVES = '[Event "?"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *'
PGN_2_MOVES = '[Event "?"]\n\n1. e4 e5 *'


def _fake_engine_factory(response_factory):
    """Build a fake review engine and return an `engine_factory` (callable
    returning it) for injection into review_stream — no monkeypatching."""
    class FakeAnalysis:
        def __init__(self, infos): self.infos = infos
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __iter__(self):
            for d in range(1, review._FALLBACK_DEPTH + 1):
                for info in self.infos:
                    yield {**info, "depth": d}
        def stop(self): pass

    class FakeEngine:
        def __init__(self): self.calls = 0
        def analysis(self, board, limit, multipv, game=None):
            self.calls += 1
            return FakeAnalysis(response_factory(board, multipv))

    fake = FakeEngine()
    return lambda: fake


def _no_book(_game):
    """A `book_walk` that reports no opening theory (forces engine scoring)."""
    return review._opening.BookInfo(plies=0, eco=None, name=None)


def _flat_response(_board, multipv):
    return [
        {"multipv": i + 1, "pv": [chess.Move.from_uci("e2e4")],
         "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE)}
        for i in range(multipv)
    ]


def _mate_response(mate_n):
    """A response_factory reporting a forced mate (White POV) at every ply."""
    def _resp(_board, multipv):
        return [
            {"multipv": i + 1, "pv": [chess.Move.from_uci("e2e4")],
             "score": chess.engine.PovScore(chess.engine.Mate(mate_n), chess.WHITE)}
            for i in range(multipv)
        ]
    return _resp


def test_stream_emits_one_move_event_per_ply():
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_2_MOVES, engine_factory=ef))
    move_events = [e for e in events if e["type"] == "move"]
    summary_events = [e for e in events if e["type"] == "summary"]
    assert len(move_events) == 2
    assert len(summary_events) == 1


def test_stream_summary_event_is_last():
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_2_MOVES, engine_factory=ef))
    assert events[-1]["type"] == "summary"


def test_stream_move_events_have_required_fields():
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_2_MOVES, engine_factory=ef))
    move = events[0]["data"]
    for field in (
        "ply", "san", "fen_before", "eval_before", "eval_after_played",
        "best_move_san", "win_before",
        "win_after_played", "win_after_second", "win_drop", "classification",
    ):
        assert field in move, f"missing field: {field}"


def test_stream_move_events_mate_fields_none_when_no_forced_mate():
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_2_MOVES, engine_factory=ef, book_walk=_no_book))
    move = next(e["data"] for e in events if e["type"] == "move")
    assert move["mate_before"] is None
    assert move["mate_after_played"] is None


def test_stream_move_events_carry_mate_fields_on_forced_mate():
    ef = _fake_engine_factory(_mate_response(3))
    events = list(review.review_stream(PGN_2_MOVES, engine_factory=ef, book_walk=_no_book))
    move = next(e["data"] for e in events if e["type"] == "move")
    assert move["mate_before"] == 3
    assert move["mate_after_played"] == 3


def test_stream_move_events_mate_sign_matches_mating_side():
    ef = _fake_engine_factory(_mate_response(-2))
    events = list(review.review_stream(PGN_2_MOVES, engine_factory=ef, book_walk=_no_book))
    move = next(e["data"] for e in events if e["type"] == "move")
    assert move["mate_before"] == -2
    assert move["mate_after_played"] == -2


def test_book_ply_mate_fields_are_none():
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_OFF_BOOK, engine_factory=ef))
    book_moves = [
        e["data"] for e in events
        if e["type"] == "move" and e["data"]["classification"] == "book"
    ]
    assert book_moves
    for m in book_moves:
        assert m["mate_before"] is None
        assert m["mate_after_played"] is None
        assert m["win_after_second"] is None


def test_stream_cancel_event_stops_before_summary():
    ef = _fake_engine_factory(_flat_response)
    cancel = threading.Event()
    cancel.set()
    events = list(review.review_stream(PGN_5_MOVES, cancel_event=cancel, engine_factory=ef))
    assert all(e["type"] != "summary" for e in events)
    assert len(events) == 0


def test_stream_cancel_after_some_moves_caps_events():
    ef = _fake_engine_factory(_flat_response)
    cancel = threading.Event()

    def producer():
        out = []
        for evt in review.review_stream(PGN_5_MOVES, cancel_event=cancel, engine_factory=ef):
            out.append(evt)
            if len([e for e in out if e["type"] == "move"]) == 2:
                cancel.set()
        return out

    out = producer()
    move_count = sum(1 for e in out if e["type"] == "move")
    summary_count = sum(1 for e in out if e["type"] == "summary")
    assert move_count <= 3
    assert summary_count == 0


def test_stream_invalid_pgn_raises_value_error():
    ef = _fake_engine_factory(_flat_response)
    with pytest.raises(ValueError):
        list(review.review_stream("not a pgn", engine_factory=ef))


def test_stream_engine_terminated_propagates_and_quits_pool():
    # Per-review pool: an engine that dies mid-search propagates the error out
    # of the stream, and the pool is released (quit) on the way out — there is
    # no shared singleton to reset anymore.
    class DyingAnalysis:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __iter__(self):
            raise chess.engine.EngineTerminatedError("simulated")
        def stop(self): pass

    class DyingEngine:
        def __init__(self): self.quit_called = False
        def analysis(self, b, l, multipv, game=None):
            return DyingAnalysis()
        def quit(self): self.quit_called = True

    dying = DyingEngine()
    # Force book.plies=0 so the engine is actually called and can throw.
    with pytest.raises(chess.engine.EngineTerminatedError):
        list(review.review_stream(PGN_2_MOVES, engine_factory=lambda: [dying], book_walk=_no_book))
    assert dying.quit_called


def test_summary_counts_match_emitted_classifications():
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_5_MOVES, engine_factory=ef))
    moves = [e["data"] for e in events if e["type"] == "move"]
    summary = next(e["data"] for e in events if e["type"] == "summary")

    expected_white = {}
    expected_black = {}
    for m in moves:
        bucket = expected_white if m["ply"] % 2 == 1 else expected_black
        bucket[m["classification"]] = bucket.get(m["classification"], 0) + 1

    assert summary["white"]["counts"] == expected_white
    assert summary["black"]["counts"] == expected_black


def test_summary_key_moments_sorted_by_severity_then_chronological():
    import opening as _opening_mod
    moves = [
        review.MoveReview(ply=1, san="e4", fen_before="", eval_before=0, eval_after_played=0,
                          best_move_san="e4", win_before=50,
                          win_after_played=50, win_drop=0, classification="inaccuracy"),
        review.MoveReview(ply=2, san="e5", fen_before="", eval_before=0, eval_after_played=0,
                          best_move_san="e5", win_before=50,
                          win_after_played=50, win_drop=0, classification="blunder"),
        review.MoveReview(ply=3, san="Nf3", fen_before="", eval_before=0, eval_after_played=0,
                          best_move_san="Nf3", win_before=50,
                          win_after_played=50, win_drop=0, classification="mistake"),
    ]
    no_book = _opening_mod.BookInfo(plies=0, eco=None, name=None)
    summary = review._build_summary(
        moves,
        no_book,
        {m.ply: 0.0 for m in moves},
        white_elo=1000,
        black_elo=1000,
        pgn_result="*",
    )
    assert summary["key_moments"] == [2, 3, 1]


def test_stream_classifies_best_when_played_matches_engine_top():
    def best_is_e4(_board, multipv):
        return [
            {"multipv": 1, "pv": [chess.Move.from_uci("e2e4")],
             "score": chess.engine.PovScore(chess.engine.Cp(20), chess.WHITE)},
            {"multipv": 2, "pv": [chess.Move.from_uci("d2d4")],
             "score": chess.engine.PovScore(chess.engine.Cp(15), chess.WHITE)},
        ][:multipv]

    ef = _fake_engine_factory(best_is_e4)
    # Suppress book walk so engine classification is tested (not book override).
    events = list(review.review_stream(PGN_2_MOVES, engine_factory=ef, book_walk=_no_book))
    move1 = events[0]["data"]
    assert move1["classification"] == "best"


def test_run_review_d5_bug_pgn_not_brilliant():
    """Regression: the reported PGN where d5 was misclassified as Brilliant
    must classify as 'best' end-to-end. Covers wiring in _run_review
    (mover_color, is_sacrifice threading) — not just classify() alone.

    Stub: engine always says the move actually played is the top PV, with a
    flat 0cp score so the win-prob bands keep the move in the Best/Excellent
    range. The d5 ply has no friendly hanging piece after the push (Bc4
    defends d5), so the fix forces 'best'.
    """
    bug_pgn = '[Event "?"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 d6 4. d4 Be6 5. d5 *'
    game = chess.pgn.read_game(io.StringIO(bug_pgn))
    mainline = list(game.mainline_moves())

    # Key the stub by FEN, not call order — the parallel analyser scores
    # positions out of order. Top PV for each position = the move actually
    # played from it, making played_is_best=True on every ply. (Order-based
    # indexing used to be rescued by the drop<0.5 "best" clamp; strict best
    # exposed it.)
    played_from: dict[str, chess.Move] = {}
    walk = game.board()
    for mv in mainline:
        played_from[walk.fen()] = mv
        walk.push(mv)

    def best_is_played_move(board, multipv):
        top = played_from.get(board.fen()) or next(iter(board.legal_moves))
        return [
            {"multipv": j + 1, "pv": [top],
             "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE)}
            for j in range(multipv)
        ]

    ef = _fake_engine_factory(best_is_played_move)
    events = list(review.review_stream(bug_pgn, engine_factory=ef))

    moves = [e["data"] for e in events if e["type"] == "move"]
    d5 = next(m for m in moves if m["ply"] == 9)
    assert d5["san"] == "d5"
    assert d5["classification"] != "brilliant", (
        f"d5 must not be Brilliant (Bc4 defends d5, no friendly piece hangs); "
        f"got {d5['classification']}"
    )
    assert d5["classification"] == "best"


def test_run_review_qxh3_recapture_not_brilliant():
    """Regression: 9.Qxh3 recaptures a bishop while Bh6 hangs — an even trade,
    not a sacrifice — so it must NOT be Brilliant end-to-end.

    Stub: engine says the played move is always the top PV with a flat 0cp
    score, so `played_is_best=True` and win probs sit at 50%. Before the fix
    the hanging Bh6 alone satisfied the brilliant gate; the net-material check
    must force 'best'.
    """
    bug_pgn = (
        '[Event "?"]\n\n'
        '1. e4 e5 2. Nf3 Bc5 3. Bc4 d6 4. d4 exd4 5. Ng5 Nh6 6. Qf3 O-O '
        '7. Nh3 Nc6 8. Bxh6 Bxh3 9. Qxh3 *'
    )
    game = chess.pgn.read_game(io.StringIO(bug_pgn))

    # Map each position to the move actually played from it, so the stub is
    # independent of the order the analyser visits positions.
    played_from: dict[str, chess.Move] = {}
    node = game
    while node.variations:
        nxt = node.variations[0]
        played_from[node.board().fen()] = nxt.move
        node = nxt

    def best_is_played_move(board, multipv):
        top = played_from.get(board.fen()) or next(iter(board.legal_moves))
        return [
            {"multipv": j + 1, "pv": [top],
             "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE)}
            for j in range(multipv)
        ]

    ef = _fake_engine_factory(best_is_played_move)
    events = list(review.review_stream(bug_pgn, engine_factory=ef, book_walk=_no_book))

    moves = [e["data"] for e in events if e["type"] == "move"]
    qxh3 = next(m for m in moves if m["ply"] == 17)
    assert qxh3["san"] == "Qxh3"
    assert qxh3["classification"] != "brilliant", (
        "Qxh3 recaptures equal material (bishop for bishop) — the hanging Bh6 "
        f"is not a sacrifice; got {qxh3['classification']}"
    )
    assert qxh3["classification"] == "best"


def test_run_review_squandered_opponent_blunder_is_miss():
    """End-to-end: opponent hangs a piece for real (the eval jumps), the
    reply declines it and gives the whole thing back → that reply must be
    'miss', not 'blunder'.

    CHANGED (2026-07-13 rating-aware redesign): miss rule 2 is the
    squandered-opportunity predicate (lab experiment 008) — the opponent's
    previous move handed the mover an expected-points swing (>= MISS_SWING),
    the mover dropped it (>= MISS_DROP) from an equal-or-better position
    (>= MISS_CHANCE) without ending dead-lost (>= MISS_ALIVE). The stub:
    1.e4 d5 2.exd5 Qxd5 3.Nc3 Nc6?? — Nc6 ignores the queen Nc3 just
    attacked, so white's eval jumps 0 → +300 (Nc6 itself bands as blunder,
    and the jump IS the swing the next ply reads via before_opp). 4.Nf3
    declines the capture and the eval collapses back to 0: swing banked
    never, drop taken in full → miss. This also covers the __init__.py
    threading of before_opp (prev ply's before, converted with the CURRENT
    mover's k).
    """
    pgn = '[Event "?"]\n\n1. e4 d5 2. exd5 Qxd5 3. Nc3 Nc6 4. Nf3 *'
    b = chess.Board()
    fen0 = b.fen()
    b.push_san("e4"); fen1 = b.fen()
    b.push_san("d5"); fen2 = b.fen()
    b.push_san("exd5"); fen3 = b.fen()
    b.push_san("Qxd5"); fen4 = b.fen()
    b.push_san("Nc3"); fen5 = b.fen()   # attacks the queen on d5
    b.push_san("Nc6"); fen6 = b.fen()   # black ignores the attack — queen still hangs
    b.push_san("Nf3"); fen7 = b.fen()   # white declines Nxd5 (squander)

    # Fair (0) until black's Nc6; then +300 for White (Nc6 -> blunder by
    # band, and the jump is the opportunity swing Nf3's ply sees). Nf3 lets
    # it collapse back to 0 without ever taking the queen.
    responses = {
        fen0: ("d2d4", 0),
        fen1: ("d7d5", 0),
        fen2: ("d8d5", 0),
        fen3: ("d8d5", 0),
        fen4: ("b1c3", 0),
        fen5: ("d5a5", 0),      # best is to retreat the queen; Nc6 ignores it
        fen6: ("c3d5", 300),    # Nxd5 wins the hung queen; best != Nf3
        fen7: ("g8f6", 0),      # after Nf3 the queen is still black's — gone
    }

    def by_position(board, multipv):
        pv_uci, cp = responses[board.fen()]
        return [
            {"multipv": j + 1, "pv": [chess.Move.from_uci(pv_uci)],
             "score": chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE)}
            for j in range(multipv)
        ]

    ef = _fake_engine_factory(by_position)
    events = list(review.review_stream(pgn, engine_factory=ef, book_walk=_no_book))

    moves = [e["data"] for e in events if e["type"] == "move"]
    nc6, nf3 = moves[5], moves[6]
    assert nc6["san"] == "Nc6" and nc6["classification"] == "blunder"
    assert nf3["san"] == "Nf3"
    assert nf3["classification"] == "miss", (
        f"Nf3 squanders the opportunity from black's hung queen — expected 'miss', "
        f"got {nf3['classification']}"
    )


def test_review_stream_passes_depth_and_multipv_to_engine():
    """depth/multipv kwargs must reach engine.analysis() calls."""
    seen_limits = []
    seen_multipvs = []

    class FakeAnalysis:
        def __init__(self, depth, multipv):
            self._depth = depth
            self._multipv = multipv
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __iter__(self):
            for d in range(1, self._depth + 1):
                for mp in range(1, self._multipv + 1):
                    yield {
                        "depth": d, "multipv": mp,
                        "pv": [chess.Move.from_uci("e2e4")],
                        "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE),
                    }
        def stop(self): pass

    class FakeEngine:
        def analysis(self, board, limit, multipv, game=None):
            seen_limits.append(limit.depth)
            seen_multipvs.append(multipv)
            return FakeAnalysis(limit.depth, multipv)

    list(review.review_stream(PGN_2_MOVES, depth=22, multipv=3, engine_factory=lambda: FakeEngine()))

    assert all(d == 22 for d in seen_limits), f"expected depth=22, got {seen_limits}"
    assert all(m == 3 for m in seen_multipvs), f"expected multipv=3, got {seen_multipvs}"


# ── Opening / book tests ──────────────────────────────────────────────────────

# PGN where 1.e4 e5 2.Na3 goes off book at Na3 (2 book plies then scored)
PGN_OFF_BOOK = '[Event "?"]\n\n1. e4 e5 2. Na3 *'


def test_book_plies_classified_as_book():
    """Leading in-book plies are emitted with classification='book'."""
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_OFF_BOOK, engine_factory=ef))
    move_events = [e["data"] for e in events if e["type"] == "move"]
    book_moves = [m for m in move_events if m["classification"] == "book"]
    assert len(book_moves) == 2  # e4 and e5 are in the opening DB


def test_book_plies_skip_engine_calls():
    """Engine should be called only for scored plies + 1 seed, not for book plies."""
    seen_limits: list[int] = []

    class FakeAnalysis:
        def __init__(self, depth): self._depth = depth
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __iter__(self):
            for d in range(1, self._depth + 1):
                yield {
                    "depth": d, "multipv": 1,
                    "pv": [chess.Move.from_uci("e2e4")],
                    "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE),
                }
        def stop(self): pass

    class FakeEngine:
        def analysis(self, board, limit, multipv, game=None):
            seen_limits.append(limit.depth)
            return FakeAnalysis(limit.depth)

    list(review.review_stream(PGN_OFF_BOOK, engine_factory=lambda: FakeEngine()))

    # PGN_OFF_BOOK has 3 moves: 2 booked (e4, e5) + 1 scored (Na3).
    # Engine calls: 1 seed + 1 after Na3 (terminal position via _terminal_infos or analyse) = 2 max.
    # Book plies must NOT trigger engine calls.
    assert len(seen_limits) <= 2, f"too many engine calls: {len(seen_limits)}"


def test_expanded_book_prefix_never_sends_book_positions_to_engine():
    analysed_fens: list[str] = []

    class FakeAnalysis:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __iter__(self):
            yield {
                "depth": 16,
                "multipv": 1,
                "pv": [chess.Move.from_uci("b8c6")],
                "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE),
            }
        def stop(self): pass

    class FakeEngine:
        def analysis(self, board, limit, multipv, game=None):
            analysed_fens.append(board.fen())
            return FakeAnalysis()

    def three_book_plies(_game):
        return review._opening.BookInfo(plies=3, eco="C40", name="King's Knight")

    events = list(
        review.review_stream(
            PGN_5_MOVES,
            engine_factory=lambda: FakeEngine(),
            book_walk=three_book_plies,
        )
    )

    moves = [event["data"] for event in events if event["type"] == "move"]
    assert [move["classification"] for move in moves[:3]] == ["book"] * 3
    book_fens = {move["fen_before"] for move in moves[:3]}
    assert not book_fens.intersection(analysed_fens)


def test_book_plies_excluded_from_accuracy():
    """Book moves must not appear in accuracy calculation (only scored moves counted)."""
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_OFF_BOOK, engine_factory=ef))
    summary = next(e["data"] for e in events if e["type"] == "summary")
    # White played e4 (book) and Na3 (scored). Black played e5 (book).
    # White accuracy is from Na3 only; black has only book moves → accuracy 100.0
    assert summary["black"]["accuracy"] == 100.0


def test_summary_carries_opening_info():
    """Summary opening field populated when game enters known theory."""
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_OFF_BOOK, engine_factory=ef))
    summary = next(e["data"] for e in events if e["type"] == "summary")
    op = summary.get("opening")
    assert op is not None
    assert op["eco"] is not None
    assert op["name"] is not None
    assert op["until_ply"] == 2


def test_summary_opening_none_when_no_book():
    """Opening is None when game goes off book immediately (plies == 0)."""
    ef = _fake_engine_factory(_flat_response)
    events = list(review.review_stream(PGN_2_MOVES, engine_factory=ef, book_walk=_no_book))
    summary = next(e["data"] for e in events if e["type"] == "summary")
    assert summary.get("opening") is None


def test_run_review_missed_forced_mate_is_miss():
    """Mover has a forced mate before the move; the played move (not the engine
    best) bails into a plain cp eval, losing the mate → 'miss' via Rule 1,
    independent of win_drop / history."""
    pgn = '[Event "?"]\n\n1. e4 e5 2. Qh5 *'
    b = chess.Board()
    fen0 = b.fen()
    b.push_san("e4"); fen1 = b.fen()
    b.push_san("e5"); fen2 = b.fen()
    b.push_san("Qh5"); fen3 = b.fen()

    # fen → (top-PV uci [never the played move], PovScore White POV)
    responses = {
        fen0: ("d2d4", chess.engine.Cp(0)),
        fen1: ("g8f6", chess.engine.Cp(0)),
        fen2: ("f1c4", chess.engine.Mate(3)),   # white has forced mate, best ≠ Qh5
        fen3: ("g8f6", chess.engine.Cp(0)),      # after Qh5 the mate is gone
    }

    def by_position(board, multipv):
        pv_uci, score = responses[board.fen()]
        return [
            {"multipv": j + 1, "pv": [chess.Move.from_uci(pv_uci)],
             "score": chess.engine.PovScore(score, chess.WHITE)}
            for j in range(multipv)
        ]

    ef = _fake_engine_factory(by_position)
    events = list(review.review_stream(pgn, engine_factory=ef, book_walk=_no_book))

    moves = [e["data"] for e in events if e["type"] == "move"]
    qh5 = moves[2]
    assert qh5["san"] == "Qh5"
    assert qh5["classification"] == "miss", (
        f"Qh5 abandons a forced mate → expected 'miss', got {qh5['classification']}"
    )


def test_run_review_quiet_history_tactic_decline_is_not_miss():
    """CHANGED (2026-07-13 rating-aware redesign): the PV-material-swing miss
    rule is retired (lab experiment 008 replaced it with the squandered-
    opportunity predicate). A tactic declined out of a QUIET history — the
    eval was +300 all along, the opponent's previous move handed nothing —
    has no opportunity swing, so it now bands (blunder here) instead of
    relabeling to miss. Same stub as
    test_run_review_squandered_opponent_blunder_is_miss but with a constant
    eval until Nf3 (no jump at Nc6 → before_opp == before → swing 0)."""
    pgn = '[Event "?"]\n\n1. e4 d5 2. exd5 Qxd5 3. Nc3 Nc6 4. Nf3 *'
    b = chess.Board()
    fen0 = b.fen()
    b.push_san("e4"); fen1 = b.fen()
    b.push_san("d5"); fen2 = b.fen()
    b.push_san("exd5"); fen3 = b.fen()
    b.push_san("Qxd5"); fen4 = b.fen()
    b.push_san("Nc3"); fen5 = b.fen()   # attacks the queen on d5
    b.push_san("Nc6"); fen6 = b.fen()   # black ignores the attack — queen still hangs
    b.push_san("Nf3"); fen7 = b.fen()   # white ignores the free queen

    # White is +300 throughout (quiet — black's Nc6 drops nothing), until Nf3
    # lets the eval collapse to 0. Best line at fen6 is Nxd5 winning the queen.
    responses = {
        fen0: ("d2d4", 300),
        fen1: ("d7d5", 300),
        fen2: ("d8d5", 300),
        fen3: ("d8d5", 300),
        fen4: ("b1c3", 300),
        fen5: ("d5a5", 300),    # quiet: best is to retreat the queen (same eval)
        fen6: ("c3d5", 300),    # Nxd5 wins a clean queen; best ≠ Nf3
        fen7: ("g8f6", 0),      # after Nf3 the tactic is gone
    }

    def by_position(board, multipv):
        pv_uci, cp = responses[board.fen()]
        return [
            {"multipv": j + 1, "pv": [chess.Move.from_uci(pv_uci)],
             "score": chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE)}
            for j in range(multipv)
        ]

    ef = _fake_engine_factory(by_position)
    events = list(review.review_stream(pgn, engine_factory=ef, book_walk=_no_book))

    moves = [e["data"] for e in events if e["type"] == "move"]
    nc6, nf3 = moves[5], moves[6]
    assert nc6["san"] == "Nc6" and nc6["classification"] not in ("blunder", "mistake", "miss"), (
        f"history must be quiet; Nc6 was {nc6['classification']}"
    )
    assert nf3["san"] == "Nf3"
    assert nf3["classification"] == "blunder", (
        f"quiet-history tactic decline must band, not miss — got {nf3['classification']}"
    )
