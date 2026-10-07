# Power Interview AI - Admin

Admin dashboard for Power Interview AI: analytics, CRUD over users, payments, sessions, and audit logs, and bulk email marketing. A single Next.js app that reads and writes the same MongoDB database `../backend` uses - it does not call backend's API.

It has its own email/password sign-in. A built-in admin comes from the environment; everybody else requests access and an admin approves them. Approved accounts are an **admin** (does everything), a **guest** (reads the dashboard's figures only), or a **reseller** (a guest's reads, plus their own reseller portal).

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

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are **required**. They name the built-in admin, which is created the first time the app starts and re-asserted as an approved admin on every restart - so there is always one way in, and a dashboard nobody can get into is fixed by restarting it. Leave them unset and the sign-in page says so rather than rejecting everything you type.

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

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env.local`, then start the app and open
`http://localhost:13000`. That account is created on the first boot; sign in with it.

Change its password from **Your account** once you are in. `ADMIN_PASSWORD` only ever *seeds* the
account - it is not re-applied on later restarts, so a password you set in the UI sticks. If you
forget it, set `ADMIN_PASSWORD_FORCE_RESET=true` for one boot to put it back to the environment
value, then unset it again.

**Everyone else has to be approved.** `/sign-up` creates a `pending` account that cannot read a
single page, and does not sign anybody in. An admin approves it from **Access** in the sidebar,
which shows a badge with the number of people waiting. Approving is a button on the row; the sheet
behind the row also sets the role, resets a password, signs an account out everywhere, revokes
access, or deletes it. An admin can also create an account outright, approved on the spot.

What each role may do is a table of permissions in `src/lib/rbac.ts`. A guest sees the dashboard's
aggregate figures and nothing underneath them. Users, interviews, payments, sessions, audit logs,
email, resellers and Access are admin-only, and a guest or reseller who types one of those URLs gets
a refusal rather than the page. Every server action re-checks the permission before doing anything,
so hidden links are the explanation rather than the enforcement.
`pnpm check:rbac` asserts which pages each role can reach.

You cannot demote, revoke, sign out, or delete your own account, and neither can anyone do it to
the built-in admin: between them that is what makes locking the last admin out impossible.
Changing your own password is the exception, and it keeps the tab you changed it in.

## Resellers

A reseller is an outside partner who sells access through their own app. Give an account the
**Reseller** role from Access and they get a **Reseller API** page: they issue, rotate and revoke
their own API key there (shown once; only its hash is stored), and see the customers and sales
their app has created. Their app sends the key to the backend's `/api/reseller` endpoints to create
customers and add credits, so the backend has to be running a version that has them, with read
access to this dashboard's `ADMIN_MONGO_DB`.

Admins manage resellers under **Resellers**: set each one's rate (USD per interview hour, which is
600 credits), revoke a key, browse every sale, and see what each reseller owes per day. Payment is
collected by hand: mark a day paid on the **Settlements** page, which also exports to CSV. Top-ups
the backend could not confirm appear under **Sales history > Needs review** for an admin to decide.

`RESELLER_API_BASE_URL` (optional, default `https://api.powerinterviewai.com/api`) is the backend's
public address. The reseller's page links to the API reference the backend serves at
`<origin>/redoc`, which is where the endpoints, fields and examples live. It is display only.

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

`pnpm seed:resellers` adds fixtures for the reseller pages: four resellers (steady, partly
unpriced, brand new, rejected), a guest account, their customers, sales, daily settlements and one
top-up awaiting review. Its accounts all use the password `Fixture!2026`, and it prints a fresh API
key for each reseller that has one. Run it against a local database only (it refuses anything else),
and re-run it any time: it replaces just its own fixtures.

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
