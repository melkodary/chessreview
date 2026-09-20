"""Fetch a PGN for `explain_move.py`'s live tier -- chess.com or lichess, by
game id.

chess.com has no by-id endpoint: walk the user's monthly archives newest-first
and match the trailing digits of each game's `url` (mirrors
`frontend/src/api/sources/chesscom.ts`). lichess has a real by-id GET and
needs no username (mirrors `frontend/src/api/sources/lichess.ts`).

Stdlib `urllib.request` only -- this is a CLI tool's fetch path, not the app.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

_GAME_ID_RE = re.compile(r"(\d+)/?$")


class FetchError(Exception):
    """A network / not-found failure the CLI should print, not traceback."""


def _extract_game_id(url: str) -> str:
    m = _GAME_ID_RE.search(url)
    return m.group(1) if m else url


def _get(url: str, *, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise FetchError(f"not found: {url}") from exc
        raise FetchError(f"HTTP {exc.code} fetching {url}") from exc
    except urllib.error.URLError as exc:
        raise FetchError(f"network error fetching {url}: {exc.reason}") from exc


def _fetch_lichess(game_id: str, *, api_base: str) -> str:
    body = _get(
        f"{api_base}/game/export/{game_id}",
        headers={"Accept": "application/x-chess-pgn"},
    )
    return body.decode("utf-8")


def _fetch_chesscom(game_id: str, username: str, *, api_base: str, max_archives: int) -> str:
    archives_body = _get(f"{api_base}/player/{username}/games/archives")
    archives = json.loads(archives_body).get("archives", [])
    for url in reversed(archives[-max_archives:]):
        games_body = _get(url)
        games = json.loads(games_body).get("games", [])
        for game in games:
            if _extract_game_id(game.get("url", "")) == game_id:
                return game["pgn"]
    raise FetchError(
        f"game {game_id} not found in {username}'s last {max_archives} archives"
    )


def fetch_pgn(
    game_id: str, *, source: str, username: str | None,
    chesscom_api_base: str, lichess_api_base: str, max_archives: int,
) -> str:
    """Fetch the PGN text for `game_id` from `source` ("chesscom" | "lichess").

    chess.com requires `username` (no by-id endpoint); lichess ignores it.
    Raises `FetchError` on 404 / not-found / network failure.
    """
    if source == "lichess":
        return _fetch_lichess(game_id, api_base=lichess_api_base)
    if source == "chesscom":
        if not username:
            raise FetchError("chess.com fetch requires --fetch USERNAME")
        return _fetch_chesscom(
            game_id, username, api_base=chesscom_api_base, max_archives=max_archives,
        )
    raise FetchError(f"unknown source {source!r}")
