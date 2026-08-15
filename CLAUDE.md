# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation Lookups

Use Context7 MCP (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) before answering any question about a library, framework, SDK, API, or CLI tool used here - FastAPI, Pydantic, pymongo, Next.js, shadcn/ui, Base UI, TanStack Query/Table, Recharts, react-hook-form, Zod - even ones you're confident about. Do this even when you think you know the answer: `web/` runs Next.js 16 and a shadcn CLI generation that changed significantly from what most training data reflects (see "shadcn/ui is not the CLI you remember" below). Never answer from training data alone for these.

## Writing Rules

- Never generate em-dashes (--). Use a hyphen (-) or rewrite the sentence instead.
- No filler phrases, no trailing summaries, no explanations of what the code does.
- Comments only when the WHY is non-obvious.

## Commands

```bash
# Backend (Python 3.12, uv)
uv sync                        # install deps, creates .venv
uv run python -m app.main      # run the API (reads PORT/HOST from .env, default :8000)
uv run ruff check .            # lint (ruff ALL, see pyproject.toml for the ignore list)
uv run ruff format .           # format
uv run mypy app                # strict type check

# Frontend (Next.js 16, pnpm) - run from web/
pnpm install
pnpm dev                       # dev server on :3000, hot reload
pnpm build                     # production build (also runs `tsc` via next build)
pnpm start                     # serve the production build on :3000
pnpm lint                      # eslint

# Both at once, from admin/ root
pnpm install                   # installs `concurrently` for the root script
pnpm start                     # runs `uv run python -m app.main` + `pnpm --dir web start` together
```

There is no single-process deployment: `web/` is a real Next.js server, not a static bundle the API can mount, so daily use is always two processes (API on `:8000`, web on `:3000`). The root `package.json` exists only to launch both together.

**Whenever you change anything under `web/`, run `pnpm build` in `web/` before considering the change done** - `next build` type-checks the whole app and this project has already hit real bugs (see below) that only surfaced there, not in the editor.

## Architecture

Two independent halves in one repo:

```
admin/
  app/            FastAPI service (Python), talks to MongoDB directly
    api/
      router.py       mounts sub-routers under /api
      endpoints/       analytics.py, users.py, payments.py, sessions.py, audit_logs.py
      dependency.py    DB + per-entity CRUD dependencies
    cfg/            pydantic-settings config (.env)
    db/mongo.py      AsyncMongoClient singleton
    models/          User, Payment, Session, AuditLog - ported field-for-field from
                     ../backend/app/models/*.py (see "Why direct Mongo access" below)
    services/analytics_service.py   aggregation pipelines behind /api/analytics/overview
  web/            Next.js 16 (App Router) admin UI, pnpm
    src/app/         one route per entity: /, /users, /payments, /sessions, /audit-logs
    src/components/ui/     shadcn primitives (generated, don't hand-edit - see below)
    src/components/custom/ data-table, charts, edit sheets
    src/hooks/       one TanStack Query hook module per entity
    src/lib/         api.ts (fetch client), types.ts (hand-written, mirrors backend schemas)
  package.json    root-only: `concurrently` to run both dev servers with `pnpm start`
```

### Why direct MongoDB access, not backend's API

`../backend` has an `admin` role and an unused `get_admin_user` dependency, but zero list/edit/delete endpoints for anything - every backend endpoint operates on "the current user" only. Rather than build ~15 new endpoints in a second repo and keep both in sync, `admin/app/` connects straight to the same MongoDB database (`MONGO_URL`/`MONGO_DB` in `.env`, defaults matching backend's live config: `mongodb://127.0.0.1:27017` / `power_interview_ai`) and re-implements a lightweight `GenericCRUDBase` (`app/models/common/generic_crud.py`) matching backend's shape. This means the document models in `app/models/*.py` are a second copy of backend's schemas - if backend changes a field, update it here too. There's no migration tool enforcing that; it's a manual sync.

**No authentication.** This is a local-only tool (confirmed decision - see git history). Don't add a login flow without checking with the user first; it was explicitly scoped out.

### Analytics: what's real vs simulated

`app/services/analytics_service.py` computes everything from real documents - `created_at`/`updated_at` are unix-ms ints (not BSON dates), so pipelines bucket by day via `{"$toDate": "$field"}` inside `$dateToString`, not `$dateTrunc`. **`global_state.active_sessions` is deliberately never surfaced anywhere in the dashboard** - it's `random.gauss(260, 10)` in `backend/app/services/ping_client_service.py`, not a real metric. If you're asked to add a "live active users" widget, don't wire it to that field; it isn't real data.

### shadcn/ui is not the CLI you remember

`web/` was scaffolded with a current-generation `shadcn` CLI (v4.18+) that differs a lot from the classic new-york/default + Radix setup: components are built on **Base UI** (`@base-ui/react`, not Radix), the style is a named preset (`base-nova`, not `new-york`), and there's no `tailwind.config.js` (Tailwind v4, CSS-native). Two consequences that have already caused real bugs here:

1. **No `asChild`.** Base UI components take a `render` prop instead: `<AlertDialogTrigger render={<Button variant="destructive" />}>Delete</AlertDialogTrigger>`, not `<AlertDialogTrigger asChild><Button>...</Button></AlertDialogTrigger>`. Check the actual component source in `src/components/ui/` before assuming Radix conventions - grep for `render=` to see the pattern already in use.
2. **`Select.Value` needs a formatter.** `<SelectValue />` with no children renders blank for any value that isn't in a statically-known `items` array passed to `<Select.Root items={...}>`. Always pass a children function: `<SelectValue>{(v: string) => titleCase(v)}</SelectValue>` (see `src/lib/format.ts`'s `titleCase`, which is null-safe on purpose - the formatter gets called with `null` during transient render states, not just real values).

`--overwrite`-generated files in `src/components/ui/` are vendor code - prefer composing them from `src/components/custom/` over hand-editing the generated files.

### Forms: key by entity id, don't reactively resync

The user/payment edit sheets (`src/components/custom/user-edit-sheet.tsx`, `payment-edit-sheet.tsx`) mount a fresh inner form component keyed by the record's id (`<UserEditForm key={userId} .../>`) using `useForm({ defaultValues })`, instead of one long-lived form synced via RHF's reactive `values` option. The `values`-sync approach was tried first and silently left `Controller`-wrapped `<Select>` fields displaying blank (the underlying value was correct - visible in the open dropdown's highlighted item - but the closed trigger never rendered it) even though plain `register()`-bound inputs updated fine. Remounting via `key` sidesteps the whole question of *why* by never needing async resync in the first place. If you add another entity's edit form, follow the same keyed-remount pattern rather than reaching for `values` again.

### Rows that reference a user resolve the user, and sessions never serve their token

Payments and sessions only store `user_id`. A raw ObjectId tells an admin nothing, so both list endpoints resolve the whole page's users in one query (`app/services/user_lookup_service.py`) and attach a `UserLabel` to each row; the UI renders it through `src/components/custom/user-cell.tsx`, which falls back to "Deleted user" plus the raw id when the user is gone. Follow that pattern for any new user-referencing list rather than adding a per-row fetch.

`SessionRead` deliberately has **no** `token` field at all (it inherits `SessionBase`, not `Session`) and sets `extra="ignore"` so the Mongo document's token is dropped at validation. A session token is a live bearer credential and the dashboard only ever revokes by `_id`. Masking it with a `field_serializer` was tried first and is worse: the serializer emits `None`, which then fails re-validation when the row is wrapped into `SessionWithUser`, and widening the annotation to `str | None` breaks mypy's LSP check against the base model. Not having the field is both simpler and more honest about the API surface.

### PATCH bodies never include `id`

`UserUpdate`/`PaymentUpdate` (the full internal update models, shared with the `GenericCRUDBase` pattern) require `id` - but the client sends it via the URL path, not the body, and validating the raw client body against those models 422s on "missing id" for every single edit. Each PATCH endpoint therefore takes a separate `*PatchBody` model with no `id` field, and constructs the full `*Update` server-side: `UserUpdate(id=user_id, **body.model_dump(exclude_unset=True))`. If you add a PATCH endpoint for a new entity, follow this pattern - don't take the `*Update` model directly as the request body.

### Query and error-state conventions

`src/lib/query-provider.tsx` sets `retry: 1` deliberately: the API is on localhost, so it is either up or it is not, and TanStack Query's default 3 retries with exponential backoff only delays the error state by ~10 seconds with no realistic chance of succeeding.

Every list page passes `error` and `onRetry` into `DataTable`, which renders `QueryError` instead of the empty state. Keep that distinction - an unreachable API rendering as "No results" reads as "there are no users", which is exactly the wrong conclusion to hand someone looking at account or payment data. New data-backed views should wire the same two props.

### Theme

`next-themes` was already a dependency (the generated `sonner.tsx` imports `useTheme`) but nothing mounted a provider, so the dark palette in `globals.css` was unreachable. `AppShell` now wraps everything in `ThemeProvider attribute="class"`, and the root `<html>` carries `suppressHydrationWarning` because the provider mutates that element before hydration.

`ThemeToggle` renders both icons and lets the `dark:` variant pick one in CSS. Choosing in JS needs a post-hydration `mounted` flag (the server cannot know the stored theme), and the project's eslint config rejects that pattern outright via `react-hooks/set-state-in-effect`.

### Code style

Backend: `ruff` with `select = ["ALL"]` (see `pyproject.toml` for the ignore list - kept close to `../backend`'s), mypy strict. Frontend: no enforced Prettier config beyond eslint's defaults; format the files you touch.

## Project Spec

See [SPEC.md](SPEC.md) for feature list, tech stack, and data model.
