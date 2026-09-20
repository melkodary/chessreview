"""Unit tests for `backend/tools/fetch_game.py` -- stubbed `urllib`, no
network. Mirrors the assertions in `frontend/src/api/sources/chesscom.test.ts`
and `lichess.test.ts` (archive-walk order, by-id happy path, not-found)."""
import json
import sys
import urllib.error
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "tools"))

import fetch_game  # noqa: E402


class _Resp:
    def __init__(self, body: bytes):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._body


def _stub_urlopen(responses):
    """responses: dict url -> bytes, or url -> Exception instance to raise."""
    def _urlopen(req, *a, **kw):
        url = req.full_url if hasattr(req, "full_url") else req
        if url not in responses:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        value = responses[url]
        if isinstance(value, Exception):
            raise value
        return _Resp(value)
    return _urlopen


PGN = '[Event "t"]\n\n1. e4 e5 *\n'


def test_lichess_by_id_happy_path(monkeypatch):
    monkeypatch.setattr(
        fetch_game.urllib.request, "urlopen",
        _stub_urlopen({"https://lichess.org/api/game/export/abc123": PGN.encode()}),
    )
    pgn = fetch_game.fetch_pgn(
        "abc123", source="lichess", username=None,
        chesscom_api_base="https://api.chess.com/pub",
        lichess_api_base="https://lichess.org/api",
        max_archives=12,
    )
    assert pgn == PGN


def test_lichess_not_found_raises_fetch_error(monkeypatch):
    monkeypatch.setattr(
        fetch_game.urllib.request, "urlopen", _stub_urlopen({}),
    )
    with pytest.raises(fetch_game.FetchError):
        fetch_game.fetch_pgn(
            "nope", source="lichess", username=None,
            chesscom_api_base="https://api.chess.com/pub",
            lichess_api_base="https://lichess.org/api",
            max_archives=12,
        )


def _archives_body(urls):
    return json.dumps({"archives": urls}).encode()


def _games_body(games):
    return json.dumps({"games": games}).encode()


def test_chesscom_archive_walk_finds_game_in_a_non_newest_archive(monkeypatch):
    base = "https://api.chess.com/pub"
    archives_url = f"{base}/player/bob/games/archives"
    old_url = f"{base}/player/bob/games/2026/01"
    new_url = f"{base}/player/bob/games/2026/02"

    responses = {
        archives_url: _archives_body([old_url, new_url]),
        new_url: _games_body([{"url": "https://www.chess.com/game/live/999", "pgn": "wrong"}]),
        old_url: _games_body([{"url": "https://www.chess.com/game/live/555", "pgn": PGN}]),
    }
    monkeypatch.setattr(fetch_game.urllib.request, "urlopen", _stub_urlopen(responses))

    pgn = fetch_game.fetch_pgn(
        "555", source="chesscom", username="bob",
        chesscom_api_base=base, lichess_api_base="https://lichess.org/api",
        max_archives=12,
    )
    assert pgn == PGN


def test_chesscom_not_found_after_scanning_the_cap(monkeypatch):
    base = "https://api.chess.com/pub"
    archives_url = f"{base}/player/bob/games/archives"
    archive_urls = [f"{base}/player/bob/games/2026/{m:02d}" for m in range(1, 4)]

    responses = {archives_url: _archives_body(archive_urls)}
    for url in archive_urls:
        responses[url] = _games_body([{"url": "https://www.chess.com/game/live/1", "pgn": "x"}])
    monkeypatch.setattr(fetch_game.urllib.request, "urlopen", _stub_urlopen(responses))

    with pytest.raises(fetch_game.FetchError):
        fetch_game.fetch_pgn(
            "not-there", source="chesscom", username="bob",
            chesscom_api_base=base, lichess_api_base="https://lichess.org/api",
            max_archives=2,
        )


def test_chesscom_requires_username():
    with pytest.raises(fetch_game.FetchError):
        fetch_game.fetch_pgn(
            "1", source="chesscom", username=None,
            chesscom_api_base="https://api.chess.com/pub",
            lichess_api_base="https://lichess.org/api",
            max_archives=12,
        )


def test_404_is_a_clean_fetch_error(monkeypatch):
    monkeypatch.setattr(fetch_game.urllib.request, "urlopen", _stub_urlopen({}))
    with pytest.raises(fetch_game.FetchError):
        fetch_game.fetch_pgn(
            "1", source="lichess", username=None,
            chesscom_api_base="https://api.chess.com/pub",
            lichess_api_base="https://lichess.org/api",
            max_archives=12,
        )
