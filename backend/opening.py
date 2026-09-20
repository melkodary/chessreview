"""Opening lookup using a Polyglot move book plus vendored Lichess ECO TSVs.

Position key = first 4 FEN fields (drops halfmove clock + fullmove number)
so transpositions reaching the same board state share the same entry.

The key->(eco, name) map is loaded from the precomputed `eco.json.gz` artifact
(~6ms). Building it from the TSVs costs ~1.5s of PGN parsing and FEN
serialization, so that path is the fallback only — see `_load_index`.
"""

import gzip
import hashlib
import io
import json
import logging
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.pgn
import chess.polyglot

from config import OPENING_BOOK_PATH, OPENING_ECO_INDEX_PATH

_DATA_DIR = Path(__file__).parent / "openings"
_TSV_FILES = ("a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv")
_INDEX_VERSION = 1
_LOG = logging.getLogger(__name__)


def position_key(board: chess.Board) -> str:
    return " ".join(board.fen().split()[:4])


def sources_digest() -> str:
    """sha256 over the TSV bytes. Names are mixed in, so a rename or a reorder
    of `_TSV_FILES` invalidates the artifact just as an edit does."""
    digest = hashlib.sha256()
    for name in _TSV_FILES:
        digest.update(name.encode())
        digest.update(hashlib.sha256((_DATA_DIR / name).read_bytes()).digest())
    return digest.hexdigest()


def build_index_from_tsv() -> dict[str, tuple[str, str]]:
    """The TSVs are the source of truth; `eco.json.gz` is this function's output
    frozen at build time (tools/generate_eco_index.py calls it).

    Later (longer) lines overwrite earlier ones for the same position, so the
    deepest/most-specific name wins.
    """
    index: dict[str, tuple[str, str]] = {}
    for fname in _TSV_FILES:
        with open(_DATA_DIR / fname, encoding="utf-8") as handle:
            next(handle)  # skip header
            for line in handle:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3:
                    continue
                eco, name, pgn = parts[0], parts[1], parts[2]
                game = chess.pgn.read_game(io.StringIO(pgn))
                if game is None:
                    continue
                board = game.board()
                for move in game.mainline_moves():
                    board.push(move)
                    index[position_key(board)] = (eco, name)
    return index


def _load_index(path: Path) -> dict[str, tuple[str, str]] | None:
    """Read the precomputed index, or None if it is absent, unreadable, of an
    unknown version, or built from different TSVs.

    The digest check is what lets the artifact be trusted at import: editing a
    TSV without regenerating degrades to the slow build with a warning instead
    of silently serving a stale map.
    """
    try:
        payload = json.loads(gzip.decompress(path.read_bytes()))
        if payload["version"] != _INDEX_VERSION:
            raise ValueError(f"unsupported index version {payload['version']}")
        if payload["sources_sha256"] != sources_digest():
            raise ValueError("index is stale — rerun tools/generate_eco_index.py")
        # Intern the (eco, name) pairs: ~7.7k positions share ~3.7k openings, and
        # a fresh tuple per entry would cost more memory than the TSV build did.
        pool: dict[tuple[str, str], tuple[str, str]] = {}
        return {
            key: pool.setdefault((eco, name), (eco, name))
            for key, eco, name in payload["entries"]
        }
    except (OSError, ValueError, KeyError, TypeError) as exc:
        _LOG.warning(
            "Precomputed ECO index unavailable at %s; rebuilding from TSVs: %s",
            path,
            exc,
        )
        return None


_DB: dict[str, tuple[str, str]] = (
    _load_index(OPENING_ECO_INDEX_PATH) or build_index_from_tsv()
)


def _open_book(path: Path) -> chess.polyglot.MemoryMappedReader | None:
    reader: chess.polyglot.MemoryMappedReader | None = None
    try:
        reader = chess.polyglot.open_reader(path)
        previous = -1
        for entry in reader:
            if entry.key < previous:
                raise ValueError("records are not sorted by Polyglot key")
            previous = entry.key
        return reader
    except (OSError, ValueError, IndexError) as exc:
        if reader is not None:
            reader.close()
        _LOG.warning(
            "Polyglot opening book unavailable at %s; using ECO TSV fallback: %s",
            path,
            exc,
        )
        return None


_BOOK = _open_book(OPENING_BOOK_PATH)
_DEFAULT_BOOK = object()


@dataclass
class BookInfo:
    plies: int        # leading in-book ply count (0 = offbeat first move)
    eco: str | None   # deepest matched ECO
    name: str | None  # deepest matched opening name


def lookup(board: chess.Board) -> tuple[str, str] | None:
    """Return (eco, name) for this position, or None if not in the database."""
    return _DB.get(position_key(board))


def _contains_move(
    reader: chess.polyglot.MemoryMappedReader, board: chess.Board, move: chess.Move
) -> bool:
    return any(entry.move == move for entry in reader.find_all(board))


def book_walk(
    game: chess.pgn.Game,
    *,
    book: chess.polyglot.MemoryMappedReader | None | object = _DEFAULT_BOOK,
) -> BookInfo:
    """Walk mainline, count leading in-book plies, return deepest matched opening.

    Monotonic: once a ply misses, all subsequent plies are out of book even if
    they happen to match a known transposition.
    """
    board = game.board()
    plies = 0
    eco: str | None = None
    name: str | None = None
    reader = _BOOK if book is _DEFAULT_BOOK else book

    for move in game.mainline_moves():
        if reader is not None:
            is_book = _contains_move(reader, board, move)
        else:
            is_book = False
        board.push(move)
        entry = lookup(board)
        if entry is not None:
            eco, name = entry

        # Polyglot extends the legacy TSV boundary; it never shortens it. This
        # also defines fallback naturally when the binary is unavailable.
        is_book = is_book or entry is not None
        if not is_book:
            break
        plies += 1

    return BookInfo(plies=plies, eco=eco, name=name)
