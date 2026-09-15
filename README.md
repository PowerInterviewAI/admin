# Power Interview AI - Admin

Admin dashboard for Power Interview AI: analytics, CRUD over users, payments, sessions, and audit logs, and bulk email marketing. A single Next.js app that reads and writes the same MongoDB database `../backend` uses - it does not call backend's API.

It has its own email/password sign-in with two roles: **admin** does everything, **guest** reads everything and writes nothing.

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

`ADMIN_MONGO_DB` (default `pia_admin`) is where this dashboard keeps its own accounts and sessions: the same cluster as `MONGO_DB`, a different database. These are operators of the admin tool, not Power Interview users - the two sets of records never meet, and a product user whose role is `admin` gets nothing here.

Leave the `SMTP_*` values unset and `/emails` still composes and previews; only sending is disabled, with the missing variables named on the page.

## Running

One process, on `:13000` - a fixed port so it never collides with the marketing site (`../hero`, `:3000`).

```bash
pnpm dev      # hot reload
pnpm build && pnpm start   # production build
```

On Windows, `run.bat` does the production path in one step: it checks for pnpm and
`.env.local`, installs dependencies only if `node_modules` is absent, builds, then serves.
Double-clicking it works from any folder.

## First sign-in

Open `http://localhost:13000`. Every page redirects to `/sign-in` until you have an account, and
`/sign-up` creates one.

**The first account created becomes the admin.** Every account after it is a guest with read-only
access, which an admin can promote from **Access** in the sidebar. So make your own account first,
before handing the URL to anybody else.

Guests see every page an admin sees. The write controls are disabled with a note saying why, and
every server action re-checks the role before doing anything - the disabled buttons are the
explanation, not the enforcement.

From **Access** an admin can create accounts outright (role and password set on the spot), change
a role, reset a password, sign an account out of every device, or delete it. You cannot demote,
sign out, or delete your own account: that is what makes it impossible to lock the last admin out.
Changing your own password is the exception, and it keeps the tab you changed it in.

## Mock data

An empty database makes every page an empty state. `pnpm seed` fills the local one with a
product's worth of history - 217 accounts, their payments, sessions, audit trail, and a few email
campaigns - spread over the current year to date.

```bash
pnpm seed
```

It refuses to run against anything but a local `MONGO_URL`, keeps the admin account already in the
database, and replaces everything else it wrote before, so re-running it is safe. Seeded accounts
all share the password `Interview!2026`.

It writes `users` in the product database and never touches `pia_admin`, so it cannot create or
disturb the account you sign in to the dashboard with.

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
