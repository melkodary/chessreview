# Chess Review

![CI](https://github.com/melkodary/chessreview/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT%20%2B%20GPLv3-blue.svg)

Analyze your Chess.com or Lichess games with Stockfish. Step through moves with live engine lines, or queue a full game review — every move classified (Brilliant → Blunder), accuracy scores, opening ID, and a coach-style tip per move. Reviews run in the background; queue one from your games list and check back from the home dashboard.

Not affiliated with or endorsed by Chess.com or Lichess.

**Stack:** FastAPI + python-chess backend (runs game reviews — a short-lived pool of Stockfish processes per review) · React + TypeScript + Vite frontend (live analysis runs Stockfish right in your browser via WASM) · Playwright for e2e.

---

## Quick start (Docker)

No local Python/Node needed.

```bash
cd docker && docker compose up --build
```

- App → http://localhost
- API → http://localhost:8000

## Local development

Prereqs: Python 3.14+, Node 24+ with Yarn, Stockfish (`brew install stockfish` on Mac, `apt install stockfish` on Linux).

```bash
# Backend
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/pip install -r requirements-dev.txt

# Frontend
cd frontend
yarn install
```

Both run on code defaults — no env file needed. To override one (e.g. Stockfish
lives at `/opt/homebrew/bin/stockfish` on Mac), write it to a gitignored
`.env.local`. The knob catalogue is the code itself — `backend/config.py` and
`frontend/src/config.ts` — and the backend can print it as an env file:

```bash
cd backend && venv/bin/python -m config --dump-env > .env.local   # then edit
```

Run both in separate terminals (both auto-reload on changes):

```bash
cd backend && venv/bin/uvicorn main:app --reload --reload-include '*.env' --port 8000
cd frontend && yarn dev
```

- Frontend → http://localhost:5173
- Backend → http://localhost:8000

## Configuration

Every knob has a code default, documented where it is declared: `backend/config.py` (engine pool sizing, classification thresholds, queue limits) and `frontend/src/config.ts` (API bases, UI defaults). Nothing is required to run.

To override one, write it to a gitignored `.env.local` next to the service (`backend/.env.local`, `frontend/.env.local`) — it wins over the defaults, and real env vars win over it. Secrets go there and nowhere else. The one you'll likely change locally is `STOCKFISH_PATH`. `python -m config --dump-env` prints the whole backend catalogue as a ready-to-edit env file.

## Tests

```bash
cd backend && venv/bin/pytest tests/    # engine mocked, no Stockfish binary needed
cd frontend && yarn test                 # or yarn test:watch

cd e2e && yarn e2e:install && yarn e2e   # first run only installs Chromium; needs backend + frontend running
```

## License

MIT for `frontend/`, `e2e/`, `docker/`, `scripts/` (`LICENSE`); **GPLv3 for
`backend/`** (`backend/LICENSE`) because it depends on python-chess. Stockfish,
opening data and piece graphics carry their own licenses — see
`THIRD_PARTY_NOTICES.md`.
