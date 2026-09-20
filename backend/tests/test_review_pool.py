"""Per-review engine pool primitive (P2 of the parallel-pool spec)."""
import shutil
from dataclasses import replace

import chess
import chess.engine
import pytest

import engine as engine_mod
from config import ACTIVE_ENGINE_SPEC, EngineSpec


class FakeEngine:
    def __init__(self, name="Stockfish 19"):
        self.id = {"name": name}
        self.config = None
        self.quit_called = False

    def configure(self, opts):
        self.config = opts

    def quit(self):
        self.quit_called = True


def _patch_popen(monkeypatch):
    made = []

    def fake_popen(cls, path):
        e = FakeEngine()
        made.append(e)
        return e

    monkeypatch.setattr(
        chess.engine.SimpleEngine, "popen_uci", classmethod(fake_popen)
    )
    return made


def _spec(tmp_path, **overrides):
    path = tmp_path / "stockfish"
    path.touch()
    values = {
        "id": "test",
        "path": str(path),
        "options": {"Threads": 2, "Hash": 32},
        "expects": "Stockfish 19",
    }
    values.update(overrides)
    return EngineSpec(**values)


def test_spawn_review_pool_size_and_per_engine_config(monkeypatch, tmp_path):
    made = _patch_popen(monkeypatch)
    pool = engine_mod.spawn_review_pool(
        3, spec=_spec(tmp_path), threads=1, hash_mb=64
    )
    assert len(pool) == 3
    assert len(made) == 3
    assert all(e.config == {"Threads": 1, "Hash": 64} for e in pool)


def test_resolve_pool_size_auto_is_cpu_minus_one(monkeypatch):
    monkeypatch.setattr(engine_mod.os, "cpu_count", lambda: 8)
    assert engine_mod.resolve_pool_size(0) == 7   # 0 => auto
    assert engine_mod.resolve_pool_size(3) == 3   # explicit wins
    assert engine_mod.resolve_pool_size(0) >= 1   # never below 1


def test_resolve_pool_size_floor_on_single_core(monkeypatch):
    monkeypatch.setattr(engine_mod.os, "cpu_count", lambda: 1)
    assert engine_mod.resolve_pool_size(0) == 1


def test_quit_pool_quits_every_engine(monkeypatch):
    pool = [FakeEngine(), FakeEngine()]
    engine_mod.quit_pool(pool)
    assert all(e.quit_called for e in pool)


def test_quit_pool_survives_one_failing_quit(monkeypatch):
    good = FakeEngine()

    class Boom(FakeEngine):
        def quit(self):
            raise RuntimeError("already dead")

    engine_mod.quit_pool([Boom(), good])  # must not raise
    assert good.quit_called


def test_spawn_missing_path_names_resolved_path_and_config_key(tmp_path):
    spec = EngineSpec(
        id="missing",
        path=str(tmp_path / "not-there"),
        options={},
        expects="Stockfish 19",
    )
    with pytest.raises(FileNotFoundError) as exc:
        engine_mod._spawn_engine(spec)
    message = str(exc.value)
    assert str((tmp_path / "not-there").resolve()) in message
    assert "STOCKFISH_PATH" in message
    assert "REVIEW_ENGINE='missing'" in message


def test_spawn_rejects_mismatched_observed_identity_and_quits(tmp_path):
    wrong = FakeEngine("Candidate 1")
    with pytest.raises(RuntimeError, match="Candidate 1"):
        engine_mod._spawn_engine(_spec(tmp_path), spawn=lambda _path: wrong)
    assert wrong.quit_called


def test_real_engine_reports_identity_matching_active_spec():
    path = shutil.which("stockfish")
    if path is None:
        pytest.skip("Stockfish is not installed")
    spec = replace(
        ACTIVE_ENGINE_SPEC,
        path=path,
        options={"Threads": 1, "Hash": 16},
    )
    engine = engine_mod._spawn_engine(spec)
    try:
        assert engine_mod.observed_engine_name(engine).startswith(spec.expects)
    finally:
        engine.quit()
