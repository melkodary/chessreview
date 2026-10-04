import json
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path

import chess
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

import review
from models import (
    CreateReviewRequest,
    ExplainRequest,
    MoveReviewRequest,
    WinChancePoint,
    WinChanceRequest,
)
from config import (
    ALLOWED_ORIGINS,
    APP_ENV,
    CLASSIFIER_STATS_PATH,
    DATABASE_URL,
    ENABLE_EXPLAIN,
    REVIEW_DEFAULT_SOURCE,
    REVIEW_KEEP,
    REVIEW_PAYLOAD_MAX_BYTES,
    REVIEW_PAYLOAD_MAX_PLIES,
    REVIEW_TTL_HOURS,
)
from review.classify import explain
from review.expected import expected_points_pct, k_for
from review.stored import points_and_facts
from review.trace import to_json
from logging_config import configure_logging
from review_jobs.queue import ReviewQueue
from review_jobs.store import ReviewJob, SqlStore, StoreFull, ephemeral_store

configure_logging()
logger = logging.getLogger(__name__)


def _build_queue() -> tuple[ReviewQueue, object | None]:
    """Select the store's backing database by APP_ENV (the injection switch).

    dev  → a throwaway SQLite file in the OS temp dir (ephemeral, zero setup).
    prod → SQLite file at DATABASE_URL (durable). Returns the engine so the
           lifespan can init the schema + boot-sweep; None for dev, whose
           database `ephemeral_store()` has already initialised and which is
           always empty at boot.
    """
    if APP_ENV == "prod":
        from db import make_engine

        engine = make_engine(DATABASE_URL)
        store = SqlStore(engine, maxsize=REVIEW_KEEP, ttl_hours=REVIEW_TTL_HOURS)
        logger.info("store_selected", extra={"store": "sql", "database_url": DATABASE_URL})
        return ReviewQueue(store), engine
    logger.info("store_selected", extra={"store": "memory"})
    return ReviewQueue(ephemeral_store(maxsize=REVIEW_KEEP, ttl_hours=REVIEW_TTL_HOURS)), None


# Async review job queue; single process — one engine, serialized via the
# queue's ENGINE_LOCK. Store is durable (SqlStore) in prod, ephemeral in dev.
review_queue, _db_engine = _build_queue()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Review engines are spawned per-review as a short-lived pool (see
    # review.review_stream); nothing to warm or shut down here.
    if _db_engine is not None:
        from db import init_db

        init_db(_db_engine)  # create_all — no migrations
        review_queue.boot_sweep()  # resume interrupted work from a prior process
    yield
    # Interactive grading engines are long-lived (borrowed per /reviews/move);
    # release them on shutdown. Per-review pools clean themselves up.
    from engine import shutdown_interactive_pool
    shutdown_interactive_pool()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET", "DELETE"],
    allow_headers=["Content-Type"],
)

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Classifier benchmark ──────────────────────────────────────────────────────
@lru_cache(maxsize=8)
def _classifier_stats(path: Path) -> dict | None:
    """The precomputed benchmark, parsed once. None when the artifact is absent
    or unreadable — an optional data file, not a request-time failure."""
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        logger.warning("classifier_stats_unavailable", extra={"path": str(path)})
        return None


@app.get("/stats/classifier")
def classifier_stats():
    stats = _classifier_stats(CLASSIFIER_STATS_PATH)
    if stats is None:
        raise HTTPException(status_code=503, detail="classifier stats unavailable")
    return stats


# ── Async review jobs ─────────────────────────────────────────────────────────
def _inbox_row(job: ReviewJob) -> dict:
    """Inbox shape — no `moves` array; `reviewed` = how many plies are scored."""
    user_id = job.user_id.casefold() if job.user_id else None
    side = (
        "white" if user_id == job.white.casefold()
        else "black" if user_id == job.black.casefold()
        else None
    )
    mine = job.summary.get(side, {}) if job.summary and side else {}
    return {
        "id": job.id,
        "source": job.source,
        "status": job.status,
        "white": job.white,
        "black": job.black,
        "reviewed": len(job.moves),
        "total_plies": job.total_plies,
        "user_id": job.user_id,
        "game_id": job.game_id,
        "accuracy": mine.get("accuracy"),
        # Sparse, player-relative; None (not {}) when unmatched or a legacy summary.
        "counts": mine.get("counts"),
        "created_at": job.created_at.isoformat(),
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "depth": job.depth,
        "multipv": job.multipv,
        "engine": job.engine,
        "engine_source": job.engine_source or "backend",
    }


def _full_row(job: ReviewJob) -> dict:
    return {**_inbox_row(job), "moves": job.moves, "summary": job.summary,
            "error": job.error}


def _payload_within_caps(request: CreateReviewRequest, raw: Request) -> bool:
    """Is the frontend-eval payload small enough to classify here? Over either
    cap it is ignored, not rejected — the request queues a backend review."""
    if request.plies is None or len(request.plies) > REVIEW_PAYLOAD_MAX_PLIES:
        return False
    return int(raw.headers.get("content-length") or 0) <= REVIEW_PAYLOAD_MAX_BYTES


@app.post("/reviews", status_code=201)
def create_review(request: CreateReviewRequest, raw: Request):
    """Field-presence dispatch, as /reviews/move: a complete `plies` payload is
    classified with no engine and stored done (engine_source 'frontend');
    anything else queues a backend review (engine_source 'backend')."""
    source = request.source or REVIEW_DEFAULT_SOURCE
    meta = dict(
        depth=request.depth, multipv=request.multipv, force=request.force,
        source=source, user_id=request.user_id, game_id=request.game_id,
        white_elo=request.white_elo, black_elo=request.black_elo,
    )
    try:
        job = None
        if _payload_within_caps(request, raw):
            job = review_queue.submit_evaluated(
                request.pgn, plies=request.plies, engine=request.engine, **meta,
            )
        if job is None:
            job = review_queue.submit(request.pgn, **meta)
    except StoreFull:
        logger.warning("review_rejected", extra={"source": source, "user_id": request.user_id})
        raise HTTPException(status_code=429, detail="Review queue full, try again later")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    logger.info(
        "review_submitted",
        extra={
            "job_id": job.id,
            "source": job.source,
            "depth": job.depth,
            "multipv": job.multipv,
            "forced": request.force,
            "engine_source": job.engine_source,
        },
    )
    return {"id": job.id, "status": job.status, "engine": job.engine}


def _seed_eval(request: MoveReviewRequest) -> float | None:
    """`prev_before` as the pawns seed both feeders take: `_cp_white` is the
    whole-game review's own conversion (mate -> +-10000), so it round-trips exactly."""
    if request.prev_before is None:
        return request.prev_before_eval
    return review._cp_white(review._eval_to_info(request.prev_before)) / 100


def _only_legal_move(fen: str) -> bool:
    try:
        return chess.Board(fen).legal_moves.count() == 1
    except ValueError:
        return False


def _has_complete_eval_payload(request: MoveReviewRequest | ExplainRequest) -> bool:
    """Does the request carry enough frontend eval to grade with no backend
    engine? Needs >= 2 before-lines (so `after_second` exists), or 1 for a forced
    move, AND either an after-eval or a terminal after-position (which the frontend
    never searches). A bad FEN/UCI routes to the engine path, which raises the same 422."""
    if not request.before_lines:
        return False
    if len(request.before_lines) < 2 and not _only_legal_move(request.fen_before):
        return False
    if request.after_eval is not None:
        return True
    try:
        return review.move_is_terminal(request.fen_before, request.uci)
    except ValueError:
        return False


@app.post("/reviews/move")
def grade_move(request: MoveReviewRequest):
    """Grade one deviation move (played off `fen_before`) with the same
    classifier a whole-game review uses. Ephemeral — no job, no persistence.

    Field-presence dispatch: a complete frontend-eval payload grades with no
    backend engine (review.classify_move, pure CPU); otherwise the backend
    searches (review.review_move, sync def → FastAPI threadpool, so it does not
    block the event loop). 503 is possible only on the engine path."""
    try:
        if _has_complete_eval_payload(request):
            mv = review.classify_move(
                request.fen_before,
                request.uci,
                request.before_lines,
                request.after_eval,
                white_elo=request.white_elo,
                black_elo=request.black_elo,
                prev_before_eval=_seed_eval(request),
            )
        else:
            mv = review.review_move(
                request.fen_before,
                request.uci,
                depth=request.depth,
                multipv=request.multipv,
                white_elo=request.white_elo,
                black_elo=request.black_elo,
                prev_before_eval=_seed_eval(request),
            )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except TimeoutError:
        raise HTTPException(status_code=503, detail="Grading busy, try again")
    return asdict(mv)


def _point_cp_white(point: WinChancePoint) -> int:
    """White-POV cp for one sample: an explicit eval, or a mate distance
    folded to +-10000 -- review/winchance.py:_cp_white's convention, minus the
    PovScore unwrap (the wire mate is already white-POV, matching cp_white)."""
    if point.mate is not None:
        return 10_000 if point.mate > 0 else -10_000
    return point.cp_white


@app.post("/win-chance")
def win_chance(request: WinChanceRequest):
    """Provisional in-browser eval curve: cp -> mover-POV win-%, no engine, no
    lock. Ply parity decides the mover exactly as review._resolve_ratings does
    (odd ply = white); `win_after_played` matches MoveReview's own field so
    EvalGraph treats both point kinds identically."""
    out = []
    for point in request.points:
        mover_is_white = point.ply % 2 == 1
        elo = request.white_elo if mover_is_white else request.black_elo
        cp_white = _point_cp_white(point)
        win = expected_points_pct(cp_white, mover_is_white, k_for(elo))
        out.append({"ply": point.ply, "win_after_played": win})
    return out


def _explain_move(request: ExplainRequest, *, engine_factory=None):
    if not ENABLE_EXPLAIN:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        if request.move is not None:
            move = request.move.model_dump()
            board = chess.Board(move["fen_before"])
            mover_is_white = board.turn == chess.WHITE
            white_elo = request.white_elo or review._DEFAULT_ELO
            black_elo = request.black_elo or review._DEFAULT_ELO
            points, facts = points_and_facts(
                move,
                request.prev_before_eval,
                white_elo=white_elo,
                black_elo=black_elo,
                prev_fen=request.prev_fen,
                prev_move=request.prev_uci,
            )
            cp = {
                "before_opp": (
                    round(request.prev_before_eval * 100)
                    if request.prev_before_eval is not None else None
                ),
                "before": round(move["eval_before"] * 100),
                "after_played": round(move["eval_after_played"] * 100),
                "after_second": None,
            }
            san = move["san"]
            source = "review row"
            stored_label = move["classification"]
        else:
            if _has_complete_eval_payload(request):
                trace = review.classify_move_traced(
                    request.fen_before,
                    request.uci,
                    request.before_lines,
                    request.after_eval,
                    white_elo=request.white_elo,
                    black_elo=request.black_elo,
                    prev_before_eval=request.prev_before_eval,
                    prev_fen=request.prev_fen,
                    prev_uci=request.prev_uci,
                )
                source = "frontend eval"
            else:
                trace = review.review_move_traced(
                    request.fen_before,
                    request.uci,
                    depth=request.depth,
                    multipv=request.multipv,
                    white_elo=request.white_elo,
                    black_elo=request.black_elo,
                    prev_before_eval=request.prev_before_eval,
                    prev_fen=request.prev_fen,
                    prev_uci=request.prev_uci,
                    engine_factory=engine_factory,
                )
                source = "engine"
            board = chess.Board(request.fen_before)
            mover_is_white = board.turn == chess.WHITE
            white_elo = request.white_elo or review._DEFAULT_ELO
            black_elo = request.black_elo or review._DEFAULT_ELO
            points, facts = trace.points, trace.facts
            cp = trace.cp
            san = trace.review.san
            stored_label = None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except TimeoutError:
        raise HTTPException(status_code=503, detail="Grading busy, try again")

    mover_elo = white_elo if mover_is_white else black_elo
    header = {
        "san": san,
        "color": "white" if mover_is_white else "black",
        "mover_is_white": mover_is_white,
        "elo": mover_elo,
        "k": k_for(mover_elo),
        "source": source,
        "stored_label": stored_label,
        "cp": cp,
    }
    return to_json(explain(points, facts), header, points=points, facts=facts)


@app.post("/reviews/explain")
def explain_move(request: ExplainRequest):
    return _explain_move(request)


@app.get("/reviews")
def list_reviews(source: str | None = None, user_id: str | None = None, game_id: str | None = None):
    jobs = review_queue.store.list(
        source=source,
        user_id=user_id.lower() if user_id is not None else None,
        game_id=game_id,
    )
    return [_inbox_row(job) for job in jobs]


@app.get("/reviews/{job_id}")
def get_review(job_id: str):
    job = review_queue.store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return _full_row(job)


@app.delete("/reviews/{job_id}", status_code=204)
def delete_review(job_id: str):
    if review_queue.cancel(job_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
