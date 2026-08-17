# Power Interview AI - Admin

Local-only admin dashboard for Power Interview AI: analytics, CRUD over users, payments, sessions, and audit logs, and bulk email marketing. A single Next.js app that reads and writes the same MongoDB database `../backend` uses - it does not call backend's API.

See [SPEC.md](SPEC.md) for the feature list and data model, and [CLAUDE.md](CLAUDE.md) for architecture, conventions, and known gotchas.

## Requirements

- Node.js and [pnpm](https://pnpm.io/)
- MongoDB, reachable at the same `MONGO_URL`/`MONGO_DB` backend uses
- An SMTP account, only for `/emails`. Everything else runs without one

## Setup

```bash
pnpm install
cp .env.example .env.local   # defaults already point at backend's local MongoDB
```

`MONGO_URL`, `MONGO_DB`, and every `SMTP_*` value are read on the server only. Do not prefix them with `NEXT_PUBLIC_` - that would ship the connection string and the API key to the browser.

Leave the `SMTP_*` values unset and `/emails` still composes and previews; only sending is disabled, with the missing variables named on the page.

## Running

One process, on `:3000`.

```bash
pnpm dev      # hot reload
pnpm build && pnpm start   # production build
```

## Lint, type-check

```bash
pnpm lint
pnpm typecheck
pnpm build     # also type-checks the whole app
```

## Project layout

| Path | Purpose |
|---|---|
| `src/app/` | Routes. Each page is a server component that reads MongoDB and hands rows to a colocated client view |
| `src/server/` | Server-only data layer: Mongo client, repository helpers, queries, server actions |
| `src/lib/schemas/` | Zod schemas - the single source of truth for the app's types |
| `src/lib/email/` | The shared email layout, ported from backend's Jinja templates. Used by both the preview and the send |
| `src/lib/search-params.ts` | URL state: the filter, sort, and page schema for every list view |
| `src/components/ui/` | Generated shadcn primitives (vendor code) |
| `src/components/` | Shared app components |
| `.env.example` | Environment variable template |
