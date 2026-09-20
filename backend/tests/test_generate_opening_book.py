import hashlib
import io
import struct
import sys
from collections import Counter
from pathlib import Path

import chess
import chess.polyglot
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "tools"))

import generate_opening_book as generator  # noqa: E402


def test_generated_records_are_sorted_valid_and_weights_are_capped(tmp_path):
    pgn = (
        '[Event "x"]\n\n1. e4 e5 *\n\n'
        '[Event "y"]\n\n1. e4 c5 *\n\n'
        '[Event "z"]\n\n1. d4 d5 *\n\n'
    )
    records, games, skipped = generator.collect_records(
        [io.StringIO(pgn)], max_depth=2, min_count=1
    )
    capped = generator.records_from_counts(
        Counter({(records[0].key, records[0].raw_move): 70_000}),
        min_count=25,
    )
    assert capped[0].weight == 65_535
    destination = tmp_path / "book.bin"
    digest = generator.write_book(destination, records)

    raw = destination.read_bytes()
    unpacked = [
        struct.unpack(">QHHI", raw[offset : offset + 16])
        for offset in range(0, len(raw), 16)
    ]
    assert unpacked == sorted(unpacked)
    assert games == 3
    assert skipped == 0
    assert sorted(record[2] for record in unpacked) == [1, 1, 1, 1, 2]
    assert digest == hashlib.sha256(raw).hexdigest()

    with chess.polyglot.open_reader(destination) as reader:
        entries = list(reader.find_all(chess.Board()))
    assert {entry.move.uci() for entry in entries} == {"e2e4", "d2d4"}


def test_incomplete_traversal_never_overwrites_destination_or_metadata(tmp_path):
    destination = tmp_path / "book.bin"
    metadata = tmp_path / "BOOK.md"
    destination.write_bytes(b"existing")
    metadata.write_text("existing metadata")

    class BrokenStream(io.StringIO):
        def readline(self, *args, **kwargs):
            raise OSError("incomplete")

    with pytest.raises(OSError, match="incomplete"):
        records, _, _ = generator.collect_records(
            [BrokenStream('[Event "x"]\n\n1. e4 *\n')],
            max_depth=2,
            min_count=1,
        )
        generator.write_book(destination, records)

    assert destination.read_bytes() == b"existing"
    assert metadata.read_text() == "existing metadata"


def test_malformed_games_are_skipped_without_salvaging_partial_moves():
    pgn = (
        '[Event "bad"]\n\n1. O-O *\n\n'
        '[Event "good"]\n\n1. e4 e5 *\n\n'
    )
    records, games, skipped = generator.collect_records(
        [io.StringIO(pgn)], max_depth=2, min_count=1
    )
    assert games == 1
    assert skipped == 1
    assert len(records) == 2
