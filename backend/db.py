"""Database engine + schema for the durable review store.

SQLAlchemy Core, one `reviews` table. **SQLite only** (single file, in-process) —
the whole queue architecture already assumes one API process, so there is no
multi-writer concern and no Postgres. The store layer (`review_jobs/store.py`)
talks to this; nothing above the store knows it exists.

In prod `main.py` builds the engine via `make_engine(DATABASE_URL)` and calls
`init_db(engine)` in the lifespan startup; dev and tests go through
`review_jobs.store.ephemeral_store()`, which does both against a temp file.
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    event,
)
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool

metadata = MetaData()

# `seq` (autoincrement PK) gives a portable monotonic insertion order for the
# newest-first inbox without relying on `created_at` tie-breaking. `id` (uuid,
# generated in the store) is the externally-used unique key / URL segment.
reviews = Table(
    "reviews",
    metadata,
    Column("seq", Integer, primary_key=True, autoincrement=True),
    Column("id", String(36), nullable=False, unique=True, index=True),
    Column("source", Text, nullable=False),
    Column("pgn", Text, nullable=False),
    Column("depth", Integer, nullable=False),
    Column("multipv", Integer, nullable=False),
    Column("pgn_hash", Text, nullable=False, index=True),
    Column("status", Text, nullable=False),
    Column("white", Text, nullable=False),
    Column("black", Text, nullable=False),
    Column("total_plies", Integer, nullable=False),
    # Origin game coordinates — let the inbox deep-link back into the existing
    # review viewer. Nullable: a review can be submitted from a raw PGN with no
    # game.
    Column("user_id", Text, nullable=True),
    Column("game_id", Text, nullable=True),
    # Observed UCI `id name`; NULL means the review predates identity stamping.
    Column("engine", Text, nullable=True),
    # Which feeder produced the evals: 'backend' | 'frontend'. NULL predates the
    # split and reads as 'backend' (the only feeder that existed).
    Column("engine_source", Text, nullable=True),
    # The full per-ply list as one JSON blob (not a child table): each
    # append_move read-modify-writes the whole array. Cheap under WAL for a
    # review's ~40-80 plies, and no read-side JOIN/aggregate in get/list.
    Column("moves", JSON, nullable=False),
    Column("summary", JSON, nullable=True),
    Column("error", Text, nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("finished_at", DateTime(timezone=True), nullable=True),
)


def _enable_sqlite_wal(dbapi_conn, _record) -> None:
    # WAL + synchronous=NORMAL: commits no longer fsync on every transaction
    # (only at WAL checkpoint). The worker persists one row update per ply, so the
    # default rollback-journal fsync-per-commit made reviews slow. No-op for
    # :memory: (which can't use WAL — PRAGMA just stays "memory").
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


def make_engine(url: str) -> Engine:
    """Build a SQLite engine with the WAL pragmas + threading workarounds.

    The worker runs in a background thread, so `check_same_thread=False` is
    required; a shared in-memory SQLite (tests) additionally needs `StaticPool`
    so it stays one DB across threads. `timeout` waits out a write lock instead
    of erroring (worker + request can contend on a file DB).
    """
    if url.startswith("sqlite"):
        connect_args = {"check_same_thread": False, "timeout": 30}
        if ":memory:" in url:
            engine = create_engine(
                url, connect_args=connect_args, poolclass=StaticPool, future=True
            )
        else:
            # Ensure the parent dir exists (e.g. a freshly-mounted volume) so
            # SQLite can create the file instead of erroring "unable to open".
            db_path = url.split("sqlite:///", 1)[-1]
            if db_path and db_path != ":memory:":
                Path(db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
            engine = create_engine(url, connect_args=connect_args, future=True)
        event.listen(engine, "connect", _enable_sqlite_wal)
        return engine
    # Non-sqlite URLs are unsupported by design (SQLite-only), but fall through
    # to a plain engine rather than silently mangling the URL.
    return create_engine(url, pool_pre_ping=True, future=True)


def init_db(engine: Engine) -> None:
    metadata.create_all(engine)
    # `create_all` does not evolve an existing table. These nullable,
    # backward-compatible columns keep durable pre-stamp reviews readable
    # without introducing a migration framework.
    from sqlalchemy import inspect

    columns = {column["name"] for column in inspect(engine).get_columns("reviews")}
    for column in ("engine", "engine_source"):
        if column not in columns:
            with engine.begin() as conn:
                conn.exec_driver_sql(f"ALTER TABLE reviews ADD COLUMN {column} TEXT")
