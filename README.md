# Power Interview AI - Admin

Local-only admin dashboard for Power Interview AI: analytics, and CRUD over users, payments, sessions, and audit logs. Reads/writes the same MongoDB database `../backend` uses - it does not call backend's API.

See [SPEC.md](SPEC.md) for the feature list and data model, and [CLAUDE.md](CLAUDE.md) for architecture, conventions, and known gotchas.

## Requirements

- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js and [pnpm](https://pnpm.io/)
- MongoDB (local, matching backend's `MONGO_URL`/`MONGO_DB`)

## Setup

```bash
uv sync
cp .env.example .env   # defaults already point at backend's local MongoDB

pnpm install            # root: installs `concurrently`
cd web && pnpm install && cd ..
```

## Running

Two processes: the API (`:8000`) and the Next.js UI (`:3000`).

```bash
# Both at once, from admin/
pnpm dev      # hot-reload dev servers

# Or separately
uv run python -m app.main   # API
cd web && pnpm dev          # UI
```

For a production-style run, build the UI first: `cd web && pnpm build`, then `pnpm start` from `admin/` (or `pnpm --dir web start` + `uv run python -m app.main` separately).

## Lint, type-check

```bash
uv run ruff format
uv run ruff check
uv run mypy app

cd web && pnpm lint
```

## Project layout

| Path | Purpose |
|---|---|
| `app/` | FastAPI service: routers, MongoDB models, analytics aggregations |
| `web/` | Next.js admin UI |
| `pyproject.toml` / `uv.lock` | Python dependencies (uv) |
| `package.json` | Root convenience scripts only (`concurrently`) - not a Node project itself |
| `.env.example` | Environment variable template |
