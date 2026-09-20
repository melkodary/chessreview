"""Root conftest — pytest imports this before any test module or package
conftest, so it is the only place that can act *before* `config` is first
imported.

Tests run on `config.py`'s own defaults and nothing else: no `.env.local`,
no committed env file (there isn't one). A knob tweaked in `.env.local` to
try something out can therefore never re-tune the classifier the suite
asserts against. Real env vars still reach Settings (CI may set
STOCKFISH_PATH) — no test spawns a real engine, so nothing depends on it.
"""
import os

os.environ.setdefault("CHESSREVIEW_NO_DOTENV", "1")
