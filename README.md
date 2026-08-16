# Power Interview AI - Admin

Local-only admin dashboard for Power Interview AI: analytics, and CRUD over users, payments, sessions, and audit logs. A single Next.js app that reads and writes the same MongoDB database `../backend` uses - it does not call backend's API.

See [SPEC.md](SPEC.md) for the feature list and data model, and [CLAUDE.md](CLAUDE.md) for architecture, conventions, and known gotchas.

## Requirements

- Node.js and [pnpm](https://pnpm.io/)
- MongoDB, reachable at the same `MONGO_URL`/`MONGO_DB` backend uses

## Setup

```bash
pnpm install
cp .env.example .env.local   # defaults already point at backend's local MongoDB
```

`MONGO_URL` and `MONGO_DB` are read on the server only. Do not prefix them with `NEXT_PUBLIC_` - that would ship the connection string to the browser.

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
| `src/lib/search-params.ts` | URL state: the filter, sort, and page schema for every list view |
| `src/components/ui/` | Generated shadcn primitives (vendor code) |
| `src/components/` | Shared app components |
| `.env.example` | Environment variable template |
