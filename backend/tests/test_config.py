"""Config behaviour that must survive the os.getenv -> BaseSettings swap."""
import pytest
from pydantic import ValidationError

import config
from config import Settings

# Fields that exist only to reject a knob that was deleted (json_schema_extra
# "removed"). They are deliberately neither dumped as env-file lines nor
# re-exported as module globals, so the two whole-surface invariants below skip
# them rather than being weakened.
REMOVED_FIELDS = {
    name for name, field in Settings.model_fields.items()
    if (field.json_schema_extra or {}).get("removed")
}


def test_pytest_loads_no_env_file():
    # backend/conftest.py sets CHESSREVIEW_NO_DOTENV before config is imported,
    # so the suite runs on the class defaults alone. Without this, a knob
    # tweaked in the (gitignored) .env.local silently re-tunes the classifier
    # every calibration/classifier test asserts against.
    assert Settings.model_config["env_file"] == ()


def test_dump_env_round_trips_to_the_defaults(tmp_path):
    # `python -m config --dump-env` replaces the deleted .env.example. It must
    # be a *loadable* env file whose every key is a real field and whose every
    # value re-parses to the default it was rendered from -- otherwise the
    # catalogue an operator copies onto a box would silently re-tune the app.
    dumped = tmp_path / ".env.local"
    dumped.write_text(config.dump_env())

    keys = {
        line.split("=", 1)[0]
        for line in dumped.read_text().splitlines()
        if line and not line.startswith("#")
    }
    assert keys == {
        name.upper() for name in Settings.model_fields if name not in REMOVED_FIELDS
    }

    round_tripped = Settings(_env_file=(str(dumped),))
    assert round_tripped.model_dump() == Settings(_env_file=None).model_dump()


def test_module_globals_equal_the_field_defaults():
    # The back-compat `from config import X` globals must be the *declared*
    # defaults under pytest -- i.e. nothing leaked in from an env file. This is
    # the guard that makes "tests are immune to local env tweaks" checkable
    # rather than assumed.
    for name, field in Settings.model_fields.items():
        if name in REMOVED_FIELDS:
            continue
        assert getattr(config, name.upper()) == field.default, name


def test_precedence_real_env_over_local_over_base(tmp_path, monkeypatch):
    base = tmp_path / ".env"
    local = tmp_path / ".env.local"
    base.write_text("LOG_LEVEL=base\n")
    local.write_text("LOG_LEVEL=local\n")
    files = (str(base), str(local))  # last file wins in pydantic-settings

    # base only
    base_only = tmp_path / ".env.base-only"
    base_only.write_text("LOG_LEVEL=base\n")
    assert Settings(_env_file=(str(base_only),)).log_level == "base"

    # local wins over base
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    assert Settings(_env_file=files).log_level == "local"

    # real env beats both files
    monkeypatch.setenv("LOG_LEVEL", "real")
    assert Settings(_env_file=files).log_level == "real"


def test_review_pool_size_explicit():
    s = Settings(_env_file=None, stockfish_review_pool_size=4)
    assert s.stockfish_review_pool_size == 4


def test_unknown_review_engine_names_valid_ids():
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None, review_engine="unknown")
    message = str(exc.value)
    assert "unknown REVIEW_ENGINE='unknown'" in message
    assert "valid ids: sf19" in message


def test_allowed_origins_strips_empties():
    s = Settings(_env_file=None, allowed_origins="a, ,b")
    assert s.allowed_origins == ["a", "b"]


def test_malformed_int_raises_validation_error():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, port="abc")


@pytest.mark.parametrize(
    "knob,value",
    [("rating_k_low", 0.0035), ("rating_k_high", 0.0055), ("rating_k_split", 1300)],
)
def test_removed_rating_k_knobs_raise_instead_of_being_ignored(knob, value):
    """extra="ignore" would drop a stale RATING_K_LOW silently and revert that
    deploy to the code default. Declaring the removed names makes it a startup
    failure that names the replacement. Values are type-correct on purpose: a
    type error would mask the guard for anyone reading this test."""
    with pytest.raises(ValidationError, match="removed on 2026-07-26"):
        Settings(_env_file=None, **{knob: value})


def test_dump_env_omits_the_removed_knobs():
    """--dump-env output is meant to be usable as an env file; a knob that
    raises on startup must not appear in it as if it were a setting."""
    from config import dump_env
    text = dump_env()
    assert "RATING_K_AT_1000=" in text
    for gone in ("RATING_K_LOW=", "RATING_K_HIGH=", "RATING_K_SPLIT="):
        assert gone not in text


def test_back_compat_module_exports():
    import config
    for name in (
        "LOG_LEVEL", "ALLOWED_ORIGINS", "HOST", "PORT",
        "STOCKFISH_PATH",
        "REVIEW_ENGINE", "ENGINE_REGISTRY", "ACTIVE_ENGINE_SPEC",
        "OPENING_BOOK_PATH",
        "STOCKFISH_REVIEW_POOL_SIZE", "STOCKFISH_REVIEW_POOL_THREADS",
        "STOCKFISH_REVIEW_POOL_HASH",
        # The removed RATING_K_LOW/HIGH/SPLIT are deliberately NOT here: they
        # survive only as Settings fields that raise, not as module constants
        # (re-adding one would make this pass while resurrecting a live global
        # whose value is now None).
        "RATING_K_AT_1000", "RATING_K_AT_2000", "RATING_K_MIN", "RATING_K_MAX",
        "ACCURACY_K", "ACCURACY_CURVE_A", "ACCURACY_CURVE_B", "ACCURACY_CURVE_C",
        "REVIEW_KEEP", "REVIEW_TTL_HOURS", "REVIEW_DEFAULT_SOURCE",
        "QUEUE_ACQUIRE_TIMEOUT", "REVIEW_META_MAX_LENGTH",
        "BAND_BLUNDER", "BAND_MISTAKE", "BAND_INACCURACY", "BAND_GOOD",
    ):
        assert hasattr(config, name), f"config.{name} missing"
