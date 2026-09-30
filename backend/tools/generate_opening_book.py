#!/usr/bin/env python3
"""Generate an offline Polyglot book from licensed Lichess broadcast PGNs."""

from __future__ import annotations

import argparse
import hashlib
import io
import os
import struct
import subprocess
import sys
import tempfile
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, TextIO

import chess
import chess.pgn
import chess.polyglot

DEFAULT_DEPTH = 20
DEFAULT_MIN_COUNT = 25
NAMES_REVISION = "51a55d956b7ed0b9cd7853893744b1ca39cd2a05"
POLYGLOT_RECORD = struct.Struct(">QHHI")
BROADCAST_BASE = "https://database.lichess.org/broadcast"
DEFAULT_SOURCES = (
    ("lichess_db_broadcast_2026-01.pgn.zst", "9abf10d106a8bf5ecd41359825b3bf55c2f124c8a790a380cb98844c2cca5dca"),
    ("lichess_db_broadcast_2026-02.pgn.zst", "ea977569917718b33940ba5379db2adad77d58876c29084294d357f15fe6a31b"),
    ("lichess_db_broadcast_2026-03.pgn.zst", "1a5ad83fc9f440dcdadde17b11cc81a953f4895aaf8b8588470b3078209dc7fc"),
    ("lichess_db_broadcast_2026-04.pgn.zst", "97b036f3a3639ae3be59c1508b1e18c76ac1b2e8fada4587d1b5c5a93c438d5d"),
    ("lichess_db_broadcast_2026-05.pgn.zst", "d212987f7972a70268809ff6c726acff8bf0987161aacd7647b160f8564f6a53"),
    ("lichess_db_broadcast_2026-06.pgn.zst", "65905d611c0d78d90ab57cd9edd3821f4119b46c22b5489fd7e265a74c6767b3"),
)


class GenerationError(RuntimeError):
    """Input download, checksum, decompression, or PGN traversal failed."""


class QuietGameBuilder(chess.pgn.GameBuilder):
    def handle_error(self, error: Exception) -> None:
        self.game.errors.append(error)


@dataclass(frozen=True, order=True)
class BookRecord:
    key: int
    raw_move: int
    weight: int
    learn: int = 0

    def pack(self) -> bytes:
        return POLYGLOT_RECORD.pack(self.key, self.raw_move, self.weight, self.learn)


def encode_move(board: chess.Board, move: chess.Move) -> int:
    """Encode one legal move using Polyglot's castling/promotion conventions."""
    if board.is_castling(move):
        move = board._to_chess960(move)
    promotion = 0 if move.promotion is None else move.promotion - 1
    return move.to_square | (move.from_square << 6) | (promotion << 12)


def records_from_counts(
    counts: Counter[tuple[int, int]], *, min_count: int
) -> list[BookRecord]:
    return sorted(
        BookRecord(key, raw_move, min(count, 0xFFFF))
        for (key, raw_move), count in counts.items()
        if count >= min_count
    )


def collect_records(
    streams: Iterable[TextIO], *, max_depth: int, min_count: int
) -> tuple[list[BookRecord], int, int]:
    if max_depth < 1:
        raise ValueError("max_depth must be at least 1")
    if min_count < 1:
        raise ValueError("min_count must be at least 1")

    counts: Counter[tuple[int, int]] = Counter()
    games = 0
    skipped = 0
    for stream in streams:
        while game := chess.pgn.read_game(stream, Visitor=QuietGameBuilder):
            if game.errors:
                skipped += 1
                continue
            board = game.board()
            for ply, move in enumerate(game.mainline_moves(), start=1):
                if ply > max_depth:
                    break
                counts[
                    chess.polyglot.zobrist_hash(board),
                    encode_move(board, move),
                ] += 1
                board.push(move)
            games += 1
            total = games + skipped
            if total % 10_000 == 0:
                print(
                    f"processed {total:,} games ({skipped} malformed skipped)",
                    file=sys.stderr,
                    flush=True,
                )

    return records_from_counts(counts, min_count=min_count), games, skipped


def write_book(destination: Path, records: list[BookRecord]) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    data = b"".join(record.pack() for record in sorted(records))
    digest = hashlib.sha256(data).hexdigest()
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=destination.parent, prefix=f".{destination.name}.", delete=False
        ) as temp:
            temp_path = Path(temp.name)
            temp.write(data)
            temp.flush()
            os.fsync(temp.fileno())
        os.replace(temp_path, destination)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
    return digest


def _download(source: tuple[str, str], directory: Path) -> Path:
    name, expected = source
    destination = directory / name
    digest = hashlib.sha256()
    request = urllib.request.Request(
        f"{BROADCAST_BASE}/{name}",
        headers={"User-Agent": "chessreview-opening-book-generator/1"},
    )
    print(f"downloading {name}", file=sys.stderr, flush=True)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            with destination.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
                    digest.update(chunk)
    except (OSError, TimeoutError) as exc:
        raise GenerationError(f"failed downloading {name}: {exc}") from exc
    observed = digest.hexdigest()
    if observed != expected:
        raise GenerationError(
            f"checksum mismatch for {name}: expected {expected}, got {observed}"
        )
    return destination


def _open_zstd(path: Path, zstd: str):
    try:
        process = subprocess.Popen(
            [zstd, "-q", "-d", "-c", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise GenerationError(f"cannot run {zstd}: {exc}") from exc
    assert process.stdout is not None
    return process, io.TextIOWrapper(process.stdout, encoding="utf-8", errors="strict")


def _collect_downloads(
    paths: list[Path], *, zstd: str, max_depth: int, min_count: int
) -> tuple[list[BookRecord], int, int]:
    processes: list[subprocess.Popen] = []
    streams: list[TextIO] = []
    try:
        for path in paths:
            process, stream = _open_zstd(path, zstd)
            processes.append(process)
            streams.append(stream)
        records, games, skipped = collect_records(
            streams, max_depth=max_depth, min_count=min_count
        )
        for path, process in zip(paths, processes):
            stderr = process.stderr.read().decode() if process.stderr else ""
            if process.wait() != 0:
                raise GenerationError(f"zstd failed for {path.name}: {stderr.strip()}")
        return records, games, skipped
    finally:
        for stream in streams:
            stream.close()
        for process in processes:
            if process.poll() is None:
                process.terminate()


def provenance_text(
    *,
    destination: Path,
    records: list[BookRecord],
    games: int,
    skipped: int,
    digest: str,
    sources: tuple[tuple[str, str], ...],
    max_depth: int,
    min_count: int,
    generated_at: datetime,
) -> str:
    source_lines = "\n".join(
        f"- [{name}]({BROADCAST_BASE}/{name}) — SHA-256 `{checksum}`"
        for name, checksum in sources
    )
    return f"""# Elite opening book

- Source: official Lichess broadcast database, by Lichess and broadcast contributors
- Source license: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Derived book license: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- License and downloads: https://database.lichess.org/#broadcasts
- Generated UTC: {generated_at.astimezone(timezone.utc).isoformat()}
- Generator: `backend/tools/generate_opening_book.py`
- Arguments: `--max-depth {max_depth} --min-count {min_count}`
- Opening-name source revision: https://github.com/lichess-org/chess-openings/commit/{NAMES_REVISION}
- Artifact: `{destination.name}`
- Input games: {games}
- Malformed input games skipped: {skipped}
- Entries: {len(records)}
SHA-256: `{digest}`

## Pinned inputs

{source_lines}

Every record is a standard Polyglot `(key, move, weight, learn)` record. Weight
is continuation frequency in the pinned broadcast corpus capped at 65,535;
runtime uses membership, not weight. ECO/name data remains sourced from the
vendored CC0 TSV files.

`{destination.name}` is derived database material, distributed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This license
applies to the book, not Chessreview's separately licensed code or CC0 ECO data.

Changes by Chessreview: retain only mainline position/move pairs from the first
{max_depth} plies of valid games, aggregate continuation frequencies, drop pairs
occurring fewer than {min_count} times, and encode the result as Polyglot records.
Player details, PGN headers, annotations, and variations are not retained.
The source and derived book are provided without warranties; see the license.
"""


def generate(
    *,
    destination: Path,
    metadata: Path,
    sources: tuple[tuple[str, str], ...],
    zstd: str,
    max_depth: int,
    min_count: int,
) -> tuple[int, int, int, str]:
    with tempfile.TemporaryDirectory(prefix="chessreview-opening-book-") as temp:
        paths = [_download(source, Path(temp)) for source in sources]
        records, games, skipped = _collect_downloads(
            paths, zstd=zstd, max_depth=max_depth, min_count=min_count
        )
    digest = write_book(destination, records)
    metadata.write_text(
        provenance_text(
            destination=destination,
            records=records,
            games=games,
            skipped=skipped,
            digest=digest,
            sources=sources,
            max_depth=max_depth,
            min_count=min_count,
            generated_at=datetime.now(timezone.utc),
        )
    )
    return len(records), games, skipped, digest


def main() -> None:
    backend = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=backend / "openings" / "elite.bin")
    parser.add_argument(
        "--metadata", type=Path, default=backend / "openings" / "ELITE_BOOK.md"
    )
    parser.add_argument("--max-depth", type=int, default=DEFAULT_DEPTH)
    parser.add_argument("--min-count", type=int, default=DEFAULT_MIN_COUNT)
    parser.add_argument("--zstd", default="zstd")
    args = parser.parse_args()

    count, games, skipped, digest = generate(
        destination=args.output,
        metadata=args.metadata,
        sources=DEFAULT_SOURCES,
        zstd=args.zstd,
        max_depth=args.max_depth,
        min_count=args.min_count,
    )
    print(
        f"wrote {count:,} entries from {games:,} games "
        f"({skipped} malformed skipped) to {args.output} "
        f"(sha256 {digest})"
    )


if __name__ == "__main__":
    main()
