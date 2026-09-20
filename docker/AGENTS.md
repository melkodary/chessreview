# Docker / compose rules

Binds `docker/` — the compose files and how they are run.

- **Compose files live in `docker/`; run compose from there** (`cd docker && docker compose …`). The project name is pinned `name: chessreview` in `docker-compose.yml` — do not remove it, or named volumes re-prefix and the durable `review-data` store orphans. Build contexts are `../backend` / `../frontend`. **Rebuild command is `docker compose up --build --force-recreate`**, not `--build` alone (stale layers cause silent failures).
