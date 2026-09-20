import chess
import chess.pgn
import gzip
import io
import json
import logging
import struct

import opening
from config import OPENING_ECO_INDEX_PATH


def _game(pgn_moves: str) -> chess.pgn.Game:
    return chess.pgn.read_game(io.StringIO(pgn_moves))


def _tiny_book(tmp_path, uci_moves: list[str]):
    board = chess.Board()
    rows = []
    for uci in uci_moves:
        move = chess.Move.from_uci(uci)
        rows.append(
            (
                chess.polyglot.zobrist_hash(board),
                move.to_square | (move.from_square << 6),
                1,
                0,
            )
        )
        board.push(move)
    path = tmp_path / "tiny.bin"
    path.write_bytes(b"".join(struct.pack(">QHHI", *row) for row in sorted(rows)))
    return chess.polyglot.open_reader(path)


def test_ruy_lopez_berlin_known_line():
    # 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 — 6 half-plies, Berlin Defense family
    pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 *"
    info = opening.book_walk(_game(pgn))
    assert info.plies == 6
    assert info.eco is not None and info.eco.startswith("C6")
    assert info.name is not None and "Berlin" in info.name


def test_transposition_same_position():
    # 1.Nf3 d5 2.d4 and 1.d4 d5 2.Nf3 both reach the same board → same ECO/name
    pgn_a = "1. Nf3 d5 2. d4 *"
    pgn_b = "1. d4 d5 2. Nf3 *"
    info_a = opening.book_walk(_game(pgn_a))
    info_b = opening.book_walk(_game(pgn_b))
    assert info_a.eco == info_b.eco
    assert info_a.name == info_b.name


def test_theory_break_detected():
    # 1.e4 b5 — b5 is not in the Lichess opening DB; only e4 is booked (plies=1)
    pgn = "1. e4 b5 *"
    info = opening.book_walk(_game(pgn))
    assert info.plies == 1
    assert info.eco is not None
    assert info.name is not None


def test_offbeat_second_move_breaks_book():
    # 1.e4 e5 2.Na3 — Na3 is offbeat; first 2 plies (e4, e5) are in book, Na3 breaks
    pgn = "1. e4 e5 2. Na3 *"
    info = opening.book_walk(_game(pgn))
    assert info.plies == 2
    assert info.eco is not None


def test_position_key_ignores_move_counters():
    # Same position, different halfmove/fullmove counts → identical key
    board_a = chess.Board()
    board_a.push_san("e4")
    board_b = chess.Board("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 5 99")
    assert opening.position_key(board_a) == opening.position_key(board_b)


def test_full_book_game():
    # A short game entirely within opening theory (1.e4) → at least 1 ply in book
    pgn = "1. e4 *"
    info = opening.book_walk(_game(pgn))
    assert info.plies >= 1


def test_lookup_returns_none_for_unknown_position():
    # After 1.e4 e5 2.Na3 the resulting board is not in the DB
    board = chess.Board()
    board.push_san("e4")
    board.push_san("e5")
    board.push_san("Na3")
    assert opening.lookup(board) is None


def test_polyglot_book_extends_through_unnamed_continuation(tmp_path):
    moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6", "h2h3"]
    with _tiny_book(tmp_path, moves) as book:
        info = opening.book_walk(
            _game("1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. h3 *"), book=book
        )
    assert info.plies == 7
    assert info.eco is not None
    assert info.name is not None and "Berlin" in info.name


def test_polyglot_book_checks_move_from_same_position_and_stops(tmp_path):
    moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6", "h2h3"]
    with _tiny_book(tmp_path, moves) as book:
        info = opening.book_walk(
            _game("1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. a3 *"), book=book
        )
    assert info.plies == 6


def test_polyglot_book_keeps_eco_naming_independent(tmp_path):
    board = chess.Board()
    board.push_uci("e2e4")
    board.push_uci("c7c5")
    expected = opening.lookup(board)
    with _tiny_book(tmp_path, ["e2e4", "c7c5"]) as book:
        info = opening.book_walk(_game("1. e4 c5 *"), book=book)
    assert info.plies == 2
    assert expected is not None
    assert (info.eco, info.name) == expected


def test_polyglot_book_never_shortens_legacy_tsv_boundary(tmp_path):
    with _tiny_book(tmp_path, ["e2e4"]) as book:
        info = opening.book_walk(_game("1. e4 e5 2. Na3 *"), book=book)
    assert info.plies == 2


def test_committed_eco_index_matches_a_fresh_tsv_build():
    # The anti-drift guard: the artifact is the TSVs' output frozen at build
    # time, so editing a TSV without `python -m tools.generate_eco_index`
    # fails here rather than silently serving a stale map.
    assert opening._DB == opening.build_index_from_tsv()


def test_eco_index_records_the_digest_of_the_tsvs_it_was_built_from():
    payload = json.loads(gzip.decompress(OPENING_ECO_INDEX_PATH.read_bytes()))
    assert payload["version"] == opening._INDEX_VERSION
    assert payload["sources_sha256"] == opening.sources_digest()


def test_missing_or_stale_eco_index_warns_and_falls_back_to_the_tsv_build(
    tmp_path, caplog
):
    missing = tmp_path / "missing.json.gz"
    corrupt = tmp_path / "corrupt.json.gz"
    corrupt.write_bytes(b"not-gzipped-json")
    stale = tmp_path / "stale.json.gz"
    stale.write_bytes(
        gzip.compress(
            json.dumps(
                {
                    "version": opening._INDEX_VERSION,
                    "sources_sha256": "0" * 64,
                    "entries": [],
                }
            ).encode()
        )
    )

    with caplog.at_level(logging.WARNING):
        assert opening._load_index(missing) is None
        assert opening._load_index(corrupt) is None
        assert opening._load_index(stale) is None

    assert "rebuilding from TSVs" in caplog.text
    assert opening.build_index_from_tsv()  # the fallback still produces a map


def test_unavailable_or_corrupt_book_warns_and_uses_tsv_fallback(tmp_path, caplog):
    missing = tmp_path / "missing.bin"
    corrupt = tmp_path / "corrupt.bin"
    corrupt.write_bytes(b"not-a-polyglot-record")

    with caplog.at_level(logging.WARNING):
        assert opening._open_book(missing) is None
        assert opening._open_book(corrupt) is None

    assert "using ECO TSV fallback" in caplog.text
    info = opening.book_walk(_game("1. e4 e5 2. Na3 *"), book=None)
    assert info.plies == 2
