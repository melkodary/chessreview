"""Parallel-pool review streaming (P3): each position analysed once, plies
emitted in order, pool engines quit on finish and on cancel."""
import threading

import chess
import chess.engine

import review


PGN_4_SCORED = '[Event "?"]\n\n1. a3 a6 2. h3 h6 *'   # off-book, 4 scored plies
PGN_6_SCORED = '[Event "?"]\n\n1. a3 a6 2. h3 h6 3. b3 b6 *'


def _no_book(_game):
    return review._opening.BookInfo(plies=0, eco=None, name=None)


class FakeAnalysis:
    def __init__(self, depth, multipv):
        self._depth, self._multipv = depth, multipv

    def __enter__(self): return self
    def __exit__(self, *a): return False
    def stop(self): pass

    def __iter__(self):
        for d in range(1, self._depth + 1):
            for mp in range(1, self._multipv + 1):
                yield {
                    "depth": d, "multipv": mp,
                    "pv": [chess.Move.from_uci("e2e4")],
                    "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE),
                }


class FakeEngine:
    def __init__(self):
        self.calls = 0
        self.quit_called = False
        self._lock = threading.Lock()

    def analysis(self, board, limit, multipv, game=None):
        with self._lock:
            self.calls += 1
        return FakeAnalysis(limit.depth, multipv)

    def quit(self):
        self.quit_called = True


def test_each_position_analysed_once_no_double_analysis():
    # 4 scored plies, none terminal → 1 seed + 4 after-positions = 5 analyses,
    # NOT 2×4 (the prev/after chain reuse must survive the rewrite).
    eng = FakeEngine()
    list(review.review_stream(
        PGN_4_SCORED, depth=6, multipv=2,
        engine_factory=lambda: [eng], book_walk=_no_book,
    ))
    assert eng.calls == 5, f"expected 5 analyses (1 seed + 4), got {eng.calls}"


def test_plies_emitted_in_strict_order_with_multi_engine_pool():
    pool = [FakeEngine() for _ in range(3)]
    events = list(review.review_stream(
        PGN_6_SCORED, depth=6, multipv=2,
        engine_factory=lambda: pool, book_walk=_no_book,
    ))
    plies = [e["data"]["ply"] for e in events if e["type"] == "move"]
    assert plies == [1, 2, 3, 4, 5, 6], f"plies out of order: {plies}"


def test_pool_engines_quit_on_finish():
    pool = [FakeEngine() for _ in range(3)]
    list(review.review_stream(
        PGN_4_SCORED, depth=6, multipv=2,
        engine_factory=lambda: pool, book_walk=_no_book,
    ))
    assert all(e.quit_called for e in pool), "every pooled engine must quit on finish"


def test_pool_engines_quit_on_cancel():
    pool = [FakeEngine() for _ in range(3)]
    cancel = threading.Event()

    out = []
    for evt in review.review_stream(
        PGN_6_SCORED, depth=6, multipv=2, cancel_event=cancel,
        engine_factory=lambda: pool, book_walk=_no_book,
    ):
        out.append(evt)
        if sum(1 for e in out if e["type"] == "move") == 2:
            cancel.set()

    assert all(e["type"] != "summary" for e in out)
    assert all(e.quit_called for e in pool), "cancel must still quit every engine"
