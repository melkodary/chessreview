"""Review-job store — the swap seam behind the queue + API.

All review-job state lives here, behind a small interface (the queue + API only
talk to these methods). One implementation, `SqlStore` (SQLAlchemy Core over
SQLite); what varies is the engine behind it, which `main.py` picks by
`APP_ENV`:

- prod — a durable file at `DATABASE_URL`, surviving restart/redeploy.
- dev / tests — `ephemeral_store()`, a private throwaway database. Ephemeral in
  exactly the way the hand-written dict store it replaced was.

Statuses: ``queued`` -> ``running`` -> ``done`` / ``error`` / ``canceled``.
"""
from __future__ import annotations

import tempfile
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, func, insert, select, update

from db import reviews

ACTIVE_OR_DONE = ("queued", "running", "done")


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class ReviewJob:
    id: str
    source: str
    pgn: str
    depth: int
    multipv: int
    pgn_hash: str
    white: str
    black: str
    total_plies: int
    user_id: str | None = None
    game_id: str | None = None
    engine: str | None = None
    # 'backend' | 'frontend' — which feeder produced the evals. None (a row
    # older than the split) reads as 'backend'.
    engine_source: str | None = None
    status: str = "queued"
    moves: list[dict] = field(default_factory=list)
    summary: dict | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=_now)
    finished_at: datetime | None = None


TERMINAL = ("done", "error", "canceled")


class StoreFull(Exception):
    """Raised by `create()` when the store is still at capacity after the
    TTL sweep (no terminal job past `ttl_hours`, or `ttl_hours` unset)."""


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite has no tz; SQLAlchemy reads `DateTime(timezone=True)` back naive.

    Reattach UTC (rows are written from tz-aware `_now()`) so the store returns
    tz-aware datetimes and comparisons stay safe.
    """
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class SqlStore:
    """SQLAlchemy-backed store over one `reviews` table.

    Durable or ephemeral purely by which engine it is given — see the module
    docstring. One writer per job (its worker), so the read-modify-write in
    `append_move` cannot lose updates.
    """

    def __init__(self, engine, maxsize: int | None = None, ttl_hours: int | None = None) -> None:
        self._engine = engine
        self._maxsize = maxsize
        self._ttl_hours = ttl_hours

    @property
    def engine(self):
        return self._engine

    def _row_to_job(self, row) -> ReviewJob:
        # Column names are `ReviewJob`'s field names, so the row maps straight
        # onto it — `seq` excepted, which is the table's own insertion order.
        fields = {k: v for k, v in row._mapping.items() if k != "seq"}
        fields["moves"] = list(fields["moves"] or [])          # JSON null -> []
        fields["created_at"] = _as_utc(fields["created_at"])
        fields["finished_at"] = _as_utc(fields["finished_at"])
        return ReviewJob(**fields)

    def _count(self, conn) -> int:
        return conn.execute(select(func.count()).select_from(reviews)).scalar()

    def _sweep_expired(self, conn) -> None:
        """Drop terminal rows past `ttl_hours` (Python-side filter — SQLite has
        no reliable tz-aware datetime comparison). Runs inside the caller's txn."""
        if self._ttl_hours is None:
            return
        cutoff = _now() - timedelta(hours=self._ttl_hours)
        rows = conn.execute(
            select(reviews.c.id, reviews.c.finished_at).where(reviews.c.status.in_(TERMINAL))
        ).all()
        expired = [
            r._mapping["id"]
            for r in rows
            if r._mapping["finished_at"] is not None
            and _as_utc(r._mapping["finished_at"]) < cutoff
        ]
        for jid in expired:
            conn.execute(delete(reviews).where(reviews.c.id == jid))

    def create(
        self, *, source: str, pgn: str, depth: int, multipv: int, pgn_hash: str,
        white: str, black: str, total_plies: int,
        user_id: str | None = None, game_id: str | None = None,
        engine_source: str = "backend",
    ) -> ReviewJob:
        return self._insert(ReviewJob(
            id=str(uuid.uuid4()), source=source, pgn=pgn, depth=depth,
            multipv=multipv, pgn_hash=pgn_hash, white=white, black=black,
            total_plies=total_plies, user_id=user_id, game_id=game_id,
            engine_source=engine_source,
        ))

    def create_done(
        self, *, source: str, pgn: str, depth: int, multipv: int, pgn_hash: str,
        white: str, black: str, total_plies: int, moves: list[dict], summary: dict,
        engine: str | None, engine_source: str,
        user_id: str | None = None, game_id: str | None = None,
    ) -> ReviewJob:
        """A review that arrives already classified (the frontend-eval feeder):
        inserted ``done`` in one write, never queued or run."""
        return self._insert(ReviewJob(
            id=str(uuid.uuid4()), source=source, pgn=pgn, depth=depth,
            multipv=multipv, pgn_hash=pgn_hash, white=white, black=black,
            total_plies=total_plies, user_id=user_id, game_id=game_id,
            engine=engine, engine_source=engine_source, status="done",
            moves=moves, summary=summary, finished_at=_now(),
        ))

    def _insert(self, job: ReviewJob) -> ReviewJob:
        with self._engine.begin() as conn:
            # Sweep on every insert, not only when full: `ttl_hours` is the
            # retention promise, and a quiet store must still honour it.
            self._sweep_expired(conn)
            if self._maxsize is not None and self._count(conn) >= self._maxsize:
                raise StoreFull()
            # Field names are the column names — the remaining defaults (status,
            # engine, moves, summary, error, timestamps) come along unrestated.
            conn.execute(insert(reviews).values(**asdict(job)))
        return job

    def get(self, job_id: str) -> ReviewJob | None:
        with self._engine.connect() as conn:
            row = conn.execute(select(reviews).where(reviews.c.id == job_id)).first()
        return self._row_to_job(row) if row is not None else None

    def list(
        self,
        *,
        source: str | None = None,
        user_id: str | None = None,
        game_id: str | None = None,
    ) -> list[ReviewJob]:
        stmt = select(reviews)
        if source is not None:
            stmt = stmt.where(reviews.c.source == source)
        if user_id is not None:
            stmt = stmt.where(reviews.c.user_id == user_id)
        if game_id is not None:
            stmt = stmt.where(reviews.c.game_id == game_id)
        stmt = stmt.order_by(reviews.c.seq.desc())
        with self._engine.connect() as conn:
            rows = conn.execute(stmt).all()
        return [self._row_to_job(r) for r in rows]

    def dedup_lookup(self, pgn_hash: str, engine_source: str = "backend") -> ReviewJob | None:
        """The ``queued``/``running``/``done`` job for this hash that satisfies
        an `engine_source` request — backend-sourced rows first, then most recent.

        The ordering is asymmetric: a backend review satisfies a frontend
        request, a frontend review never satisfies a backend one (NULL is a
        backend row). Canceled/errored rows are ignored so a resubmit re-runs.
        """
        stored = func.coalesce(reviews.c.engine_source, "backend")
        stmt = (
            select(reviews)
            .where(reviews.c.pgn_hash == pgn_hash)
            .where(reviews.c.status.in_(ACTIVE_OR_DONE))
        )
        if engine_source == "backend":
            stmt = stmt.where(stored != "frontend")
        with self._engine.connect() as conn:
            row = conn.execute(
                stmt.order_by(stored == "frontend", reviews.c.seq.desc()).limit(1)
            ).first()
        return self._row_to_job(row) if row is not None else None

    def _set(self, job_id: str, expected: tuple[str, ...], **values) -> bool:
        with self._engine.begin() as conn:
            result = conn.execute(
                update(reviews)
                .where(reviews.c.id == job_id)
                .where(reviews.c.status.in_(expected))
                .values(**values)
            )
        return result.rowcount == 1

    def mark_running(self, job_id: str) -> bool:
        return self._set(job_id, expected=("queued",), status="running")

    def set_engine(self, job_id: str, engine: str) -> bool:
        return self._set(job_id, expected=("running",), engine=engine)

    def append_move(self, job_id: str, move: dict) -> bool:
        # Read-modify-write the whole moves blob: one writer per job (its worker),
        # so no lost updates.
        with self._engine.begin() as conn:
            row = conn.execute(
                select(reviews.c.id, reviews.c.moves)
                .where(reviews.c.id == job_id)
                .where(reviews.c.status == "running")
            ).first()
            if row is None:
                return False
            moves = list(row.moves or [])
            moves.append(move)
            result = conn.execute(
                update(reviews)
                .where(reviews.c.id == job_id)
                .where(reviews.c.status == "running")
                .values(moves=moves)
            )
        return result.rowcount == 1

    def finish(self, job_id: str, summary: dict) -> bool:
        return self._set(
            job_id, expected=("running",), status="done",
            summary=summary, finished_at=_now(),
        )

    def fail(self, job_id: str, message: str) -> bool:
        return self._set(
            job_id, expected=("running",), status="error",
            error=message, finished_at=_now(),
        )

    def mark_canceled(self, job_id: str) -> bool:
        return self._set(
            job_id, expected=("queued", "running"),
            status="canceled", finished_at=_now(),
        )

    def delete(self, job_id: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(delete(reviews).where(reviews.c.id == job_id))

    # ── boot-recovery helpers ─────────────────────────────────────────────────
    def running_jobs(self) -> list[ReviewJob]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                select(reviews).where(reviews.c.status == "running").order_by(reviews.c.seq)
            ).all()
        return [self._row_to_job(r) for r in rows]

    def queued_jobs(self) -> list[ReviewJob]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                select(reviews).where(reviews.c.status == "queued").order_by(reviews.c.seq)
            ).all()
        return [self._row_to_job(r) for r in rows]

    def requeue(self, job_id: str) -> bool:
        """Reset an orphaned ``running`` row to a fresh ``queued`` state,
        clearing `moves` so the re-spawned worker rebuilds from ply 0."""
        return self._set(
            job_id, expected=("running",), status="queued",
            moves=[], engine=None, finished_at=None,
        )


def ephemeral_store(maxsize: int | None = None, ttl_hours: int | None = None) -> SqlStore:
    """A store on a private, throwaway SQLite database — the dev and test store.

    A temp **file**, not `:memory:`, and that is load-bearing. An in-memory
    SQLite needs `StaticPool`, which shares ONE connection between the worker
    thread and the request threads; their transactions then interleave, and
    `append_move`'s read-modify-write stops being safe. Measured on the
    worker+readers pattern this store exists to serve: 25 of 300 appends
    silently lost (every one returning True) and readers getting None for a row
    that existed. Shared-cache `mode=memory` trades that for table-level locking
    and fails outright with "database table is locked".

    A file gives each thread its own connection, which is what the one-writer-
    per-job assumption actually requires — and makes dev exercise the prod path
    rather than a second one.
    """
    from db import init_db, make_engine

    tmp = tempfile.TemporaryDirectory(prefix="chessreview-store-")
    engine = make_engine(f"sqlite:///{Path(tmp.name) / 'reviews.db'}")
    init_db(engine)
    store = SqlStore(engine, maxsize=maxsize, ttl_hours=ttl_hours)
    # Tie the temp dir's life to the store's: its finalizer removes the file
    # once the store is collected, so nothing has to be cleaned up by hand.
    store._tmpdir = tmp
    return store
