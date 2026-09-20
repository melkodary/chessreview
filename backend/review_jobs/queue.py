"""The worker queue (phase 1: in-memory, no boot sweep).

`submit()` inserts a ``queued`` job and spawns a daemon thread. Every worker
blocks on **one** ``ENGINE_LOCK`` so exactly one review runs at a time. The
engine generator (`review.review_stream`) is unchanged — only its driver (this
thread) and sink (the store) change.
"""
from __future__ import annotations

import hashlib
import logging
import threading
import time

from config import QUEUE_ACQUIRE_TIMEOUT, REVIEW_DEFAULT_SOURCE
from review import _parse_pgn_or_raise, classify_game, review_stream

from .store import ReviewJob, SqlStore

logger = logging.getLogger(__name__)


def _pgn_hash(pgn: str, depth: int, multipv: int) -> str:
    return hashlib.sha256(f"{pgn}|{depth}|{multipv}".encode()).hexdigest()


class ReviewQueue:
    def __init__(self, store: SqlStore) -> None:
        self.store = store
        # One engine, one review at a time (single process — phase 1 assumption).
        self.engine_lock = threading.Lock()
        # job_id -> cancel Event; present only while a job is live.
        self._events: dict[str, threading.Event] = {}
        self._events_lock = threading.Lock()

    # ── submit ────────────────────────────────────────────────────────────
    def submit(
        self,
        pgn: str,
        *,
        depth: int,
        multipv: int,
        force: bool = False,
        source: str = REVIEW_DEFAULT_SOURCE,
        user_id: str | None = None,
        game_id: str | None = None,
        white_elo: int | None = None,
        black_elo: int | None = None,
    ) -> ReviewJob:
        game, moves = _parse_pgn_or_raise(pgn)  # raises ValueError on bad/empty PGN
        pgn_hash = _pgn_hash(pgn, depth, multipv)

        if not force:
            existing = self.store.dedup_lookup(pgn_hash, "backend")
            if existing is not None:
                return existing

        job = self.store.create(
            source=source,
            pgn=pgn,
            depth=depth,
            multipv=multipv,
            pgn_hash=pgn_hash,
            white=game.headers.get("White", "?"),
            black=game.headers.get("Black", "?"),
            total_plies=len(moves),
            user_id=user_id,
            game_id=game_id,
            engine_source="backend",
        )
        # white_elo/black_elo are not persisted on the job (no store/schema
        # change for an optional, review-time-only input): threaded straight
        # into this submit's worker thread. A
        # boot-resumed job (orphaned running/queued row, no live submit call)
        # re-spawns with white_elo/black_elo=None and falls back to the PGN's
        # own Elo tags — same resolution `review._resolve_ratings` always does.
        self._spawn(job, white_elo=white_elo, black_elo=black_elo)
        return job

    def submit_evaluated(
        self,
        pgn: str,
        *,
        depth: int,
        multipv: int,
        plies,
        engine: str | None = None,
        force: bool = False,
        source: str = REVIEW_DEFAULT_SOURCE,
        user_id: str | None = None,
        game_id: str | None = None,
        white_elo: int | None = None,
        black_elo: int | None = None,
    ) -> ReviewJob | None:
        """The frontend-eval feeder: classify `plies` (review.classify_game) and
        store the result ``done`` — no worker, no engine. A backend review of the
        same hash satisfies the request first (the dedupe ordering). None when
        the payload does not cover the plan; the caller queues a backend job."""
        game, moves = _parse_pgn_or_raise(pgn)
        pgn_hash = _pgn_hash(pgn, depth, multipv)

        if not force:
            existing = self.store.dedup_lookup(pgn_hash, "frontend")
            if existing is not None:
                return existing

        result = classify_game(pgn, plies, white_elo=white_elo, black_elo=black_elo)
        if result is None:
            return None
        reviewed, summary = result
        return self.store.create_done(
            source=source,
            pgn=pgn,
            depth=depth,
            multipv=multipv,
            pgn_hash=pgn_hash,
            white=game.headers.get("White", "?"),
            black=game.headers.get("Black", "?"),
            total_plies=len(moves),
            user_id=user_id,
            game_id=game_id,
            moves=reviewed,
            summary=summary,
            engine=engine,
            engine_source="frontend",
        )

    def _spawn(self, job: ReviewJob, *, white_elo: int | None = None, black_elo: int | None = None) -> None:
        cancel_event = threading.Event()
        with self._events_lock:
            self._events[job.id] = cancel_event
        threading.Thread(
            target=self._worker,
            args=(job.id, job.pgn, job.depth, job.multipv, job.total_plies, cancel_event),
            kwargs={"white_elo": white_elo, "black_elo": black_elo},
            name=f"review-{job.id[:8]}",
            daemon=True,
        ).start()

    # ── boot recovery ─────────────────────────────────────────────────────────
    def boot_sweep(self) -> None:
        """Resume work the previous process left behind (prod only; a no-op on
        the dev store, whose in-memory database is always empty at boot).

        - ``running`` rows are orphaned — their worker thread died with the
          process. Requeue restart-from-0 (clear `moves`, set ``queued``) and
          re-spawn. We deliberately do not resume from the last persisted ply;
          `review/` re-derives everything from the PGN.
        - ``queued`` rows never got a worker (submitted, then the process died
          before spawn). Spawn one for each.
        - terminal rows are untouched.

        Snapshots both lists before mutating so a just-requeued running row is
        not double-spawned by the queued pass.
        """
        running = self.store.running_jobs()
        queued = self.store.queued_jobs()
        for job in running:
            self.store.requeue(job.id)
        for job in running + queued:
            logger.info("review_resumed", extra={"job_id": job.id, "prior_status": job.status})
            self._spawn(job)

    # ── cancel ────────────────────────────────────────────────────────────
    def cancel(self, job_id: str) -> ReviewJob | None:
        job = self.store.get(job_id)
        if job is None:
            return None
        with self._events_lock:
            event = self._events.get(job_id)
        if event is not None:
            event.set()
        if job.status in ("queued", "running"):
            logger.info("review_canceled", extra={"job_id": job_id, "prior_status": job.status})
            # Durable cancel — survives even if the worker is mid-ply. The worker
            # sees the event at the next ply boundary and stops touching the row.
            self.store.mark_canceled(job_id)
        else:
            # Terminal row: DELETE removes it (also force-invalidation seam).
            self.store.delete(job_id)
        return job

    # ── worker ────────────────────────────────────────────────────────────
    def _worker(
        self,
        job_id: str,
        pgn: str,
        depth: int,
        multipv: int,
        total_plies: int,
        cancel_event: threading.Event,
        *,
        white_elo: int | None = None,
        black_elo: int | None = None,
    ) -> None:
        try:
            # Wait for the single engine, staying cancel-responsive.
            while True:
                if cancel_event.is_set():
                    self.store.mark_canceled(job_id)
                    return
                if self.engine_lock.acquire(timeout=QUEUE_ACQUIRE_TIMEOUT):
                    break
            try:
                if not self.store.mark_running(job_id):
                    return
                started_at = time.monotonic()
                logger.info("review_started", extra={"job_id": job_id, "total_plies": total_plies})
                for evt in review_stream(
                    pgn, cancel_event, depth=depth, multipv=multipv,
                    white_elo=white_elo, black_elo=black_elo,
                ):
                    if evt["type"] == "engine":
                        self.store.set_engine(job_id, evt["data"]["engine"])
                    elif evt["type"] == "move":
                        self.store.append_move(job_id, evt["data"])
                    elif evt["type"] == "summary" and self.store.finish(job_id, evt["data"]):
                        logger.info(
                            "review_finished",
                            extra={"job_id": job_id, "duration_s": time.monotonic() - started_at},
                        )
                # Generator stops without a summary when canceled mid-run.
                if cancel_event.is_set():
                    self.store.mark_canceled(job_id)
            finally:
                self.engine_lock.release()
        except Exception as exc:  # engine crash, etc.
            logger.exception("review_failed", extra={"job_id": job_id})
            self.store.fail(job_id, str(exc))
        finally:
            with self._events_lock:
                self._events.pop(job_id, None)
