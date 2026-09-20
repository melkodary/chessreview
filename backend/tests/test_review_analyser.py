import chess
import chess.engine

import review


def test_cp_white_returns_int_from_score():
    info = {"score": chess.engine.PovScore(chess.engine.Cp(45), chess.WHITE)}
    assert review._cp_white(info) == 45


def test_cp_white_mate_in_n_returns_positive_saturation():
    info = {"score": chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE)}
    assert review._cp_white(info) == 10_000


def test_cp_white_mated_in_n_returns_negative_saturation():
    info = {"score": chess.engine.PovScore(chess.engine.Mate(-3), chess.WHITE)}
    assert review._cp_white(info) == -10_000


def test_cp_white_missing_score_returns_zero():
    assert review._cp_white({}) == 0


def test_cp_to_pawns_rounds_to_two_places():
    assert review._cp_to_pawns(45) == 0.45
    assert review._cp_to_pawns(-200) == -2.0


def test_cp_to_pawns_clamps_at_sentinel_for_mate():
    assert review._cp_to_pawns(10_000) == 99.99
    assert review._cp_to_pawns(-10_000) == -99.99


def test_terminal_infos_checkmate_white_to_move_is_negative_mate():
    board = chess.Board("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")
    infos = review._terminal_infos(board)
    assert len(infos) == 1
    score = infos[0]["score"].white()
    assert score.is_mate()
    assert (score.mate() or 0) < 0


def test_terminal_infos_stalemate_returns_zero_cp():
    board = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
    infos = review._terminal_infos(board)
    score = infos[0]["score"].white()
    assert not score.is_mate()
    assert score.score() == 0


def test_analyse_position_collects_multipv_lines():
    class FakeAnalysis:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __iter__(self):
            for d in range(1, review._FALLBACK_DEPTH + 1):
                for mp in (1, 2):
                    yield {
                        "depth": d, "multipv": mp,
                        "score": chess.engine.PovScore(
                            chess.engine.Cp(20 - mp * 5), chess.WHITE
                        ),
                        "pv": [chess.Move.from_uci("e2e4")],
                    }
        def stop(self): pass

    class FakeEngine:
        def analysis(self, board, limit, multipv, game=None):
            return FakeAnalysis()

    board = chess.Board()
    infos = review._analyse_position(FakeEngine(), board, review._FALLBACK_DEPTH, 2)
    assert len(infos) == 2
    assert infos[0]["multipv"] == 1
    assert infos[1]["multipv"] == 2


def test_analyse_position_starts_each_position_as_a_new_uci_game():
    class FakeAnalysis:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __iter__(self):
            yield {
                "depth": 1,
                "multipv": 1,
                "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE),
                "pv": [chess.Move.from_uci("e2e4")],
            }

    class FakeEngine:
        def __init__(self):
            self.games = []

        def analysis(self, board, limit, multipv, game=None):
            self.games.append(game)
            return FakeAnalysis()

    engine = FakeEngine()
    review._analyse_position(engine, chess.Board(), depth=1, multipv=1)
    review._analyse_position(engine, chess.Board(), depth=1, multipv=1)

    assert engine.games[0] is not None
    assert engine.games[1] is not None
    assert engine.games[0] is not engine.games[1]
