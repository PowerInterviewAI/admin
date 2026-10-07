# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Documentation Lookups

Use Context7 MCP (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) before answering any question about a library, framework, SDK, API, or CLI tool used here - Next.js, the MongoDB Node driver, shadcn/ui, Base UI, TanStack Table, Recharts, react-hook-form, Zod - even ones you're confident about. This project runs Next.js 16 and a shadcn CLI generation that changed significantly from what most training data reflects (see "shadcn/ui is not the CLI you remember" below). Never answer from training data alone for these.

For Next.js specifically, the version-matched docs ship in the package: read `node_modules/next/dist/docs/` before writing route, caching, or server-action code.

## Writing Rules

- Never generate em-dashes (--). Use a hyphen (-) or rewrite the sentence instead.
- No filler phrases, no trailing summaries, no explanations of what the code does.
- Comments only when the WHY is non-obvious.

## Commands

```bash
pnpm install
pnpm dev          # dev server on :13000, hot reload
pnpm build        # production build (also type-checks the whole app)
pnpm start        # serve the production build on :13000
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
```

**Whenever you change anything under `src/`, run `pnpm build` before considering the change done** - `next build` type-checks the whole app and this project has already hit real bugs (see below) that only surfaced there, not in the editor.

A build writes into the same `.next` a running `pnpm dev` is serving from, and the dev server then hands out a half-swapped manifest - the app dies with "Element type is invalid" until dev is restarted. `next.config.ts` reads `NEXT_DIST_DIR`, so a verification build can go somewhere harmless instead:

```bash
NEXT_DIST_DIR=.next-verify pnpm build   # safe to run while `pnpm dev` is up
```

Next rewrites `tsconfig.json` to add that directory's generated types, which is why both `.next/` and `.next-verify/` entries are in `include`. That file is tool-managed - leave what the build puts there. `.next-*/**` is in `eslint.config.mjs`'s ignore list for the same reason; without it `pnpm lint` reports ten thousand findings from generated output.

## Architecture

One Next.js app. There is no separate API service: pages read MongoDB directly on the server and mutate it through server actions. Routes are split into two groups - `(auth)` renders signed out, `(dashboard)` is everything behind a session.

```
src/
  proxy.ts             optimistic auth redirect, ahead of every route (Next 16's middleware)
  app/
    (auth)/              signed-out: /sign-in, /sign-up, no sidebar
    (dashboard)/         everything behind requireAccount(): /, /users, /payments, /sessions,
                         /emails, /audit-logs, /access, /account
      layout.tsx           the real session check, plus SessionProvider and the chrome
      <route>/page.tsx     async server component: parses searchParams, runs the query
      <route>/*-view.tsx   client component: filters + table + sheet
      <route>/loading.tsx  route-shaped skeleton
    error.tsx            one boundary for every page, both groups (see "Errors" below)
  server/              server-only, never imported by a client component
    db.ts                  pooled MongoClient, collection names, ObjectId helpers
    repository.ts          paged find, grouped counts, update/delete, document validation
    errors.ts              AppError plus duplicate-key mapping
    auth/                  accounts, sessions, the built-in admin bootstrap, the
                           denyWrite/denyAdminArea/denyRead guards, sign-in throttle
    queries/               one module per entity, plus analytics, user-labels, and list-stats
    actions/               "use server" mutations
    email/                 SMTP transport and the background campaign runner
  lib/
    schemas/             zod schemas: the single source of truth for the app's types
    auth-routes.ts       the cookie name and public paths, shared with proxy.ts (no db import)
    search-params.ts     per-route URL state schemas and query-string building
    list-tabs.ts         the quick-filter tabs each list offers, as params patches
    action-result.ts     the { ok } | { ok: false, error } shape every action returns
    email/               the shared email layout, ported from backend's Jinja templates
  components/
    ui/                  generated shadcn primitives (vendor code, don't hand-edit)
    *.tsx                shared app components
```

Route-specific components are colocated with their route; only genuinely shared ones live in `src/components/`.

### Why direct MongoDB access, not backend's API

`../backend` has an `admin` role and an unused `get_admin_user` dependency, but zero list/edit/delete endpoints for anything - every backend endpoint operates on "the current user" only. Rather than build ~15 new endpoints in a second repo and keep both in sync, this app connects straight to the same MongoDB database (`MONGO_URL`/`MONGO_DB` in `.env.local`). This means `src/lib/schemas/*.ts` are a second copy of backend's document shapes - if backend changes a field, update it here too. There's no migration tool enforcing that; it's a manual sync, which is exactly why every document is validated on read.

### Authentication: two roles, and where each is enforced

The dashboard is behind an email/password sign-in with two roles. `admin` does everything; `guest` reads the dashboard, users and payments, and writes nothing. Four routes are not part of "reads": `/sessions`, `/audit-logs`, `/emails` and `/access` are admins only.

**An admin account is not a product user.** `admin_accounts` and `admin_sessions` live in their own database (`ADMIN_MONGO_DB`, default `pia_admin`), not beside backend's collections, and `accountRoleSchema` is a separate enum from `userRoleSchema`. The two never join: a `users` row with `role: "admin"` is a customer of the product and grants nothing here, and an `admin_accounts` row grants nothing in the product. Keeping them apart is what stops a backend role change from silently becoming a permission in this app - and it is why `getCollection` is the only thing that knows which database a collection name belongs to.

**The admin comes from the environment, and everyone else has to be let in.**

`ADMIN_EMAIL`/`ADMIN_PASSWORD` name a built-in admin that `bootstrapAdminAccount()` creates if absent and re-asserts as an approved admin on every boot. That re-assertion is the recovery guarantee: whatever state the row gets into, a restart makes the built-in admin an approved admin again, which is why the access panel refuses to demote, revoke, or delete it rather than allowing a change that would silently revert on the next boot.

**`ADMIN_PASSWORD` only ever seeds a new account.** Re-applying it on every boot would undo a password changed on the account page the next time the process restarted, so an existing row keeps its hash. `ADMIN_PASSWORD_FORCE_RESET=true` is the documented way back in when that password has been forgotten. Verified: a password set through `/account` survives a restart, and the environment's value does not come back.

**Signing up gets you a `pending` account and no session.** A pending account cannot read a single page, so there is nothing for a session to hold - signing someone in and then showing them a wall would be a worse lie than telling them an admin has to let them in, and it would mean carrying a second signed-in-but-not-allowed layout for a state that lasts until somebody clicks approve. An admin approves from `/access`, or creates the account outright, which is approved on the spot because an admin typing someone's password in *is* the approval.

**Status and role are separate axes on purpose.** "May this person in" and "may they write" are decided by different people at different times - an admin approving a colleague is not also choosing whether they can delete users - so `rejected` is not a fourth role and `guest` is not a kind of pending. `rejected` doubles as suspension: there is no separate word for "was approved, now is not", because the effect is identical and a second word would only invite the two drifting apart.

Both enums `.catch()` to their *least* privileged value, so a row carrying a word this build has never heard of degrades to a pending guest rather than throwing. Rows written before the gate existed have no `status` at all, and `accountSchema` would read that as pending - which would have locked out everybody who already had a working account the moment this shipped. `backfillMissingStatus` approves exactly those rows (`$exists: false`, so it can never touch one an admin deliberately set to pending).

Authorization is checked in four places, and only two of them are controls:

1. **`src/proxy.ts` is optimistic and knows only whether a cookie is present.** It runs ahead of every request including prefetches, so a database lookup there would put one on the path of every hovered link. What it buys is that a signed-out visitor lands on the form instead of watching a dashboard render and vanish.
2. **`requireAccount()` in `(dashboard)/layout.tsx` is the real route check.** It resolves the cookie against the database, so a forged or revoked cookie gets past the proxy and dies here. It lives in the layout so no route underneath can forget it.
3. **`AdminGate` in the layout of each segment under `ADMIN_ONLY_PATHS` is the route check for the four admin-only routes.** It renders an "Admins only" panel *instead of* `children`, so the page component is never invoked and its queries never run - nothing about those rows is fetched, let alone serialised. It sits in the segment layout for the same reason `requireAccount` sits in the group layout: a route added under `/emails` tomorrow inherits it. It explains rather than redirects, because a guest bounced to the dashboard would be looking at a page they did not ask for with nothing saying why.
4. **Every server action starts with `denyWrite()`, `denyAdminArea()` or `denyRead()`**, before it validates its input or touches the database. Actions are reachable by direct POST, not only through the UI, so a hidden button is a courtesy and never a control. `denyWrite` is admins only. `denyRead` requires any signed-in account and is what the users, payments and own-account actions use - a guest may run those, because they return what that guest can already see on the page calling them. `denyAdminArea` is the third because the other two each say the wrong thing about an action that only reads a page a guest cannot open: the recipient search, the campaign pollers, and the sessions and audit-log exports would hand a guest by direct POST exactly the rows `AdminGate` withholds, while `denyWrite` would refuse them with a message about a change nobody attempted.

The dashboard is the one page where the gate had to reach inside a route rather than in front of it: `/` renders the newest twenty audit rows, addresses and all, which is exactly what gating `/audit-logs` withholds. That card is admin-only (`isAdminRequest()` in `(dashboard)/page.tsx`), and a guest never has those rows passed to the client component, so they are not serialised into the response either. The charts above it stay, because they are counts per day - "eleven logins on Tuesday" is a fact about the product, not about a person.

`ADMIN_ONLY_PATHS` in `src/lib/auth-routes.ts` is the single list, prefix-matched and free of any database import so the client can ask the same question. `useCanAccess(href)` is what drops the sidebar entries, the account menu's access item, and the "sessions"/"audit log" cross-links in the user and payment sheets - a link to a refusal is worse than no link.

`useCanWrite()`, `useCanAccess()` and `ReadOnlyNotice` gate the UI, and gate nothing: a guest who edits the role in memory gets the buttons and the nav entries back, and every one of them fails in the action or at the gate. They exist so the interface tells the truth about what will work.

**The account page's four actions are guarded by `denyRead`, not `denyWrite`**, and that is deliberate rather than an oversight: they act only on the caller. Changing your own password, renaming yourself, and signing out your own devices are not writes a guest should have to ask permission for - they are the things every signed-in account must be able to do regardless of role. `changeOwnPassword` additionally demands the current password, which `setAccountPassword` (an admin resetting someone else's) cannot: you always have your own, and requiring it is what stops a borrowed session from locking the real owner out in one step.

**The role and the status are read from the account document on every request, never carried in the cookie.** That is the whole reason a demotion, a revocation, or a deletion takes effect on the victim's next navigation rather than whenever they happen to sign out. Revoking access also deletes that account's sessions, so `getCurrentAccount`'s status check is the belt rather than the braces - but it is the half that cannot be raced. Verified end to end: a promoted account starts writing with the same cookie it already held, and a revoked or deleted account's unexpired cookie stops authenticating immediately.

**Sign-in tells an approved user nothing it would not tell a stranger, and a blocked user exactly why.** A wrong password and an unknown address give one message; `pending` and `rejected` give their own. That is not an enumeration leak, because both are only reachable by someone who has already produced the right password - and telling a waiting user "your password is wrong" would have them retyping a correct password all day. A correct password that is refused for status also clears the throttle rather than counting against it, so waiting for approval cannot lock you out of the form that is telling you to wait.

**Sessions are opaque tokens, stored hashed.** The cookie carries 32 random bytes; `admin_sessions` stores only their SHA-256. A token is a bearer credential, so anyone reading that collection - a backup, a screen-shared Mongo client - could otherwise sign in as anybody with no password. No work factor: the token is high-entropy already, so this is a lookup key, not a password.

**The cookie's `Secure` flag comes from the request scheme, not `NODE_ENV`.** `NODE_ENV` is the obvious-looking test and it is wrong here: `pnpm start` is a production build served over plain HTTP on :13000, and a browser silently discards a `Secure` cookie that arrives over HTTP - so signing in appears to succeed and then bounces straight back to the form, with nothing in any log to say why. `secureCookieFlag()` reads `x-forwarded-proto`; `SECURE_COOKIES` forces it for a proxy that does not set the header.

**No sliding renewal.** The cookie and the row share one absolute 30-day deadline. Extending a live session means writing a `Set-Cookie`, and the only thing that reads the session on an ordinary page view is a server component, where Next does not allow one.

**Expired session rows are swept on sign-in, not by a TTL index.** Mongo's TTL indexes need a BSON date and every timestamp in this stack is a unix-ms integer. Sign-in is the natural moment: rare, already writing to that collection, and nothing reads an expired row meanwhile because `getCurrentAccount` filters on the deadline.

**The self-exclusion in `actions/accounts.ts` is the lockout guard, and it is blunt on purpose.** An admin cannot demote, delete, or sign out their own account, so the account performing an action is always still an admin when it finishes, so the last admin can never be removed - no counting, no transaction, and no window where a concurrent second demotion slips between a count and a write. The cost is that stepping down needs another admin, which is also how it should read. Changing your *own* password is the one exception, and it keeps the tab you changed it in - the one session that just proved it belongs to you.

**Sign-in does not say which half was wrong.** One message for a bad password and for an unknown address, and `verifyPassword` compares against a real throwaway hash when the account does not exist so the response time does not give it away either. `src/server/auth/throttle.ts` locks an email after 8 failures in 15 minutes; it is an in-memory map, which is correct for a single `next start` process and stops being a limit the moment this runs behind more than one - past that it belongs in Mongo beside the sessions.

### Secrets are absent from schemas, not masked

`password_hash` and a session's `token` have no field in `userSchema`/`sessionSchema`. Zod strips unknown keys, so they are dropped the moment a document is parsed and cannot reach a client even by accident. The earlier FastAPI version masked `password_hash` to `null` with a serializer, which is strictly worse: the field still existed on the wire, and a `None` that fails re-validation downstream is a real failure mode this shape does not have. If you add a field that must never leave the server, leave it out of the schema rather than nulling it.

Being absent from the schema does not mean being unwritable. `setUserPassword` in `src/server/actions/users.ts` `$set`s `password_hash` and is the only thing in the app that does; the field stays out of `userSchema` because that schema governs what leaves the server, not what the server may write. `updateById` takes a plain `Document`, so a write-only field needs no schema entry at all.

### Overwriting a password: the hash has to be backend's

`src/server/password.ts` hashes with `bcryptjs` at cost 12, which is what backend gets from `CryptContext(schemes=["bcrypt"])` taking passlib's defaults (`$2b$` ident, 12 rounds - `app/services/auth_service.py`). Both halves matter: the ident because passlib's `needs_update()` would otherwise mark the hash stale, and the cost because an admin-set password should not be quietly weaker than one backend writes on signup. Verified end to end against the backend venv's own `CryptContext`, not just assumed from the `$2b$` prefix.

bcrypt hashes at most the first 72 bytes and ignores the rest, silently, on both sides. `userPasswordSchema` rejects anything longer, because a password that authenticates on a truncated prefix is not something any other layer here would report.

Three things happen alongside the write, and each exists for a reason that is not obvious from the feature name:

1. **Every session for that user is deleted.** A session token outlives the password it was issued against, so without this the overwrite is cosmetic on any device already signed in - including the one you are taking the account back from. Backend's own change-password keeps the *calling* session alive; there is no calling session here, so all of them go.
2. **A `password_change` audit log entry is written.** This is the only document this app inserts anywhere. Backend logs that event when a user changes their own password, and an admin overwrite that left no trace would make the audit log read as if the password never moved. `metadata.source` is `admin_dashboard` to tell the two apart; backend's entries carry `device_info` instead, which this has no request to derive.
3. **That audit write can fail without failing the action.** By the time it runs the password is already changed, so returning `{ ok: false }` would tell the admin the opposite of what happened. It logs to the server console and the action still reports success.

The UI lives in `src/app/users/set-password-dialog.tsx`, mounted from the edit sheet but deliberately **outside** `<form id="user-edit-form">`: the sheet's footer submit is bound to that form by id, so a password field inside it would ride along with every ordinary save, and a nested `<form>` is invalid HTML besides. The dialog's inner form is mounted only while the dialog is open, which is the same "don't reactively resync, remount instead" rule the edit sheets follow - here it means reopening never shows what was typed last time.

### Every document is validated on read

`parseDocument` in `src/server/repository.ts` runs the zod schema over every document and throws an `AppError` naming the collection, the `_id`, and the failing path. Backend owns these collections and can change a field without telling this app; a loud failure that names the offending document beats a page of silently blank cells. Keep new reads going through `findPage`/`findMany` so they inherit this.

BSON does not survive React's serialization boundary, so `toPlainJson` converts ObjectIds to hex strings and dates to unix ms before parsing. `audit_logs.metadata` is free-form, which is why that conversion is recursive rather than a per-field mapper.

### Analytics: what's real vs simulated

`src/server/queries/analytics.ts` computes everything from real documents - `created_at`/`updated_at` are unix-ms ints (not BSON dates), so pipelines bucket by day via `{"$toDate": "$field"}` inside `$dateToString`, not `$dateTrunc`. **`global_state.active_sessions` is deliberately never surfaced anywhere in the dashboard** - it's `random.gauss(260, 10)` in `backend/app/services/ping_client_service.py`, not a real metric. If you're asked to add a "live active users" widget, don't wire it to that field; it isn't real data. The real ones already exist: `liveNow()` counts apps online from `sessions.updated_at` and running interviews from unpaired ASR start/stop rows, reading only `global_state.booted_at`.

The overview's aggregations all run in one `Promise.all`, so the dashboard costs the slowest query rather than their sum. Keep additions inside that array.

The window is a parameter (`?days=`, an allowlist of 7/30/90/180), not a constant, which is also why `/` no longer needs `await connection()`: it reads `searchParams` and is dynamic for the same reason every other route is.

**Day series are densified before they leave the query.** A day with no events comes back absent from a `$group`, not as a zero. Left sparse, an area chart draws a straight line from the day before to the day after and the x-axis spaces its ticks by row rather than by date, so a quiet week renders as a gentle slope instead of a flat line on the floor. `densify` in `analytics.ts` fills every calendar day in the window; `windowDays` steps with `setDate` rather than adding 86,400,000ms, because across a DST change a day is 23 or 25 hours long and fixed-millisecond arithmetic eventually emits one day twice and skips another.

The cumulative-users curve is seeded with `countDocuments({ created_at: { $lt: cutoff } })`. Without that baseline it would start at zero and read as if the product launched at the left edge of the window.

**A day bucket is a calendar day in one zone, and both ends have to agree on which.** `$dateToString` defaults to UTC and `new Date("2026-08-17")` parses as UTC midnight, so the original pair shifted in opposite directions and did not cancel: in `America/New_York` an event at 10am was labelled a day early, one at 9pm was labelled correctly, and the same day's activity split across two ticks. The symptom is the dashboard's rightmost point staying flat while the stat cards and the activity table - which format raw unix-ms, and are therefore right - already show the change.

Both halves of the fix are required, and either alone just moves which rows are wrong. `dayBucket` passes `timezone: reportingTimeZone()`, and `dateFormatter` in `src/components/charts.tsx` parses `` `${value}T00:00:00` `` so the string is read as a local date. The zone comes from `Intl.DateTimeFormat().resolvedOptions().timeZone` rather than a new env var, because Node derives both that and `Date`'s local-time methods from `TZ` - which is what keeps `windowCutoff`'s local midnight in the same zone as the buckets it bounds. Set `TZ` to move them together.

`reportingTimeZone` lives in `src/server/queries/time.ts` alongside `dayRangeMs`, which is the same rule applied to a `from`/`to` filter. That one had the bug the other way round: it parsed `` `${from}T00:00:00.000Z` `` - UTC midnight, which west of Greenwich is the afternoon of the day before - so a date filter and a chart bucket disagreed about which day a row belonged to. The offset-less form is a local-time parse, which is the zone the buckets group by.

`dayRangeMs` also rejects a date that matches `YYYY-MM-DD` and does not exist. JavaScript does not: `new Date("2026-02-31T00:00:00")` rolls over to 3 March, so a hand-edited URL would get a confident answer to a question nobody asked. Checking that the parsed date reports back the same calendar day is what turns that into "ignore this filter", which is how every other stale param degrades.

### URL state, not component state

Filters, sort, and page for every list view live in the URL and are parsed server-side by a schema in `src/lib/search-params.ts`. A view is therefore linkable, and the back button steps through it.

- Every field is `.catch()`ed, so a hand-edited or stale URL degrades to the default instead of throwing a parse error at an admin. `user_id` is validated as a 24-character hex id for that reason and not only for tidiness: `toObjectId` *throws*, so a truncated link used to render the error boundary - "Invalid id" over a table that had nothing wrong with it. A well-formed id that matches nothing still shows an empty table, which is the right answer.
- `sort_by` is an allowlist of real fields, not a raw Mongo field name. Offering a sort on a field the collection cannot usefully order by just produces a confusing result set.
- `useListParams` resets `page` to 1 on any change other than an explicit page jump: page 3 of the old filter is not page 3 of the new one.
- Writes go through `startTransition`, so the current rows stay on screen and dim (`isPending`) instead of being replaced by a skeleton. The search box writes with `replace` so typing does not fill the back stack - which is also why it can be uncontrolled, sidestepping an effect-based resync that this project's eslint config rejects (`react-hooks/set-state-in-effect`). `NumberRangeFilter` is uncontrolled for the same reason, and debounced for a second one: a number typed digit by digit would navigate once per keystroke, and `1` on the way to `150` is a filter that matches almost nothing.
- `per_page` is an allowlist (`PAGE_SIZE_OPTIONS`), not a free integer. It goes straight into a Mongo `limit`, and `?per_page=100000` against a collection this app renders whole is a denial of service on the admin's own browser.
- **Filters go into `$and`, not onto the filter object.** Two of them are each an `$or` (a search term, and the users view's `configured`), and a second assignment to `filter.$or` silently replaces the first - dropping the search while still looking like it applied. Every list query builds an `and: Document[]` and assigns once.
- `useListParams` returns `resetFilters` and `activeFilterCount` alongside `setParams`. Reset navigates to a *replacement* params object (`withoutFilters`) rather than patching `setParams` with a bag of `undefined`s, which `buildQueryString` could not tell apart from "never set". It keeps sort order and page size - an admin who chose 100 rows wants that to survive clearing a search box - but drops `page`, because page 5 of the filtered list is not page 5 of the unfiltered one.
- **Column visibility is deliberately *not* in the URL.** It describes how one admin likes to read a table, not which rows they are reading, so putting it in the query string would make every shared link carry it.
- A **tab is an ordinary filter**, which is why `bucket` and `group` are not in `LAYOUT_KEYS`: they count toward the Reset badge and Reset returns the strip to "All". See "Every list page" below.

### Every list page: a summary strip, then tabs, then the filter row

Three layers sit above each table, and which layer owns what is the point.

**The summary strip (`src/components/list-summary.tsx`) is computed from the list's own filter.** `getUsersSummary` and friends take the same `params` the list query took and run `buildXFilter` over them, so the five figures on top describe exactly the rows the table is showing. A total that ignored the filters would sit above a filtered table claiming to be about it, which is the one reading of these numbers that cannot be defended. The first stat's label flips to "Matching ..." as soon as `countActiveFilters` is non-zero, so the distinction is on screen rather than implied.

It is rendered by the route's **server component**, not inside the client view. Nothing crosses the boundary, and `latest`-style stats cannot be recomputed in the browser against a different clock.

`summarize` in `src/server/queries/list-stats.ts` is one `$match` + `$group` + `$project`. Two things about it:

- **`$group` emits no row at all when nothing matched**, so every caller passes an `empty`. Without it a filter that matches nothing renders `undefined` in five cells.
- It cannot use `aggregate<T>`: the driver constrains that type parameter to a document with an index signature, and the summary interfaces in `src/lib/schemas/analytics.ts` deliberately have none. The `$project` is what makes the shape true and the assertion lives in `summarize` rather than at every call site.

Distinct counts (`countDistinctSet`) build an `$addToSet` and take its `$size`, filtering out null and `""` - a failed login for an address with no account has no `user_id`, and "nobody" is not a person. That is affordable on `audit_logs` despite the row count because a set is bounded by *distinct* values, and this product has few users and few IPs.

**Tabs are URL filters, not component state.** `src/lib/list-tabs.ts` holds the definitions and `FilterTabs` renders them; the active tab is *derived* from the params rather than held in state, so a tab is linkable and the back button steps through it. Three consequences are load-bearing:

1. **Selecting a tab clears every key any tab in the group touches, then applies its own patch.** Without that, "Trial" followed by "Admins" would accumulate into `role=trial_user AND role=admin` - a filter matching nobody that still looks like it applied. `tabPatch` is what makes the strip behave as one single-select control. Filters set *below* the strip are untouched: tabs and filters compose.
2. **No tab is highlighted when the params match none of them**, which is reachable by picking a value the tabs do not offer (`?event_type=login`, `?group=asr&status=failure`). Base UI's `Tabs.Root` takes `value={null}` for exactly this. Highlighting a tab whose filter is not the one in force would be worse than highlighting nothing.
3. **Tab counts are measured with that tab's filter substituted for whatever tab is selected**, and with the view's other filters still applied (`countListTabs`). So "Failed 3" means three failed payments among the admin's current filters *whichever tab they are on*, rather than collapsing to zero on every tab but one. Counting the naive way would make four of the five numbers useless.

`Tabs.Root`'s `onValueChange` carries a reason, and only `'none'` is user-initiated. `FilterTabs` ignores the rest: a controlled root emits nothing else today, but an automatic fallback writing params would be a navigation nobody asked for.

**Two params exist only for tabs, and both are named sets rather than overloaded enums.** `payments.bucket` (`PAYMENT_STATUS_BUCKETS`) because three of its four values are several statuses and `unapplied` is not a status at all - it is finished-and-never-granted, a job rather than a state. `audit_logs.group` (`AUDIT_EVENT_GROUPS`) because twenty event types is too many to scan. Both are built by naming the specific sets and deriving the catch-all as the complement, and the direction matters: a new NOWPayments status lands in "in flight" rather than being reported as money that failed, and a new backend event type lands in "accounts" rather than disappearing from every tab. `src/server/queries/payments.ts` carries the same two clauses again as aggregation expressions (`FINISHED_EXPR`, `UNAPPLIED_EXPR`) so the tab, its count, and the strip's "credits owed" cannot come to mean three different things; `activityExpr` in `queries/sessions.ts` is the same arrangement for the session buckets, and is now the single definition the filter, the count, and the badge all read.

The strip and the counts run inside the page's `Promise.all` beside the list query, so a list page costs the slowest of the three rather than their sum.

### One table component

`DataTable` is TanStack Table and is the only table in the app, including the dashboard's activity feed (which passes no `pagination`, so it renders as a plain list). Two things differ from stock TanStack:

1. **Sorting is off per column by default** and a column opts in with `enableSorting: true`. That is the inverse of TanStack's default, and it exists so a new column is never accidentally sortable by a key the query does not accept.
2. `manualPagination`/`manualSorting` are always on. The table never sorts or slices in the browser; it renders the page the server produced.
3. A clickable row is not a native control, so the keyboard affordance is spelled out: `tabIndex`, `role="button"`, and an Enter/Space handler that ignores events bubbling up from a control inside the row (`event.target !== event.currentTarget`). Without that guard, revoking a session from the row's own button would also open the row.

Only columns with a plain-string `header` are offered in the Columns menu - an action column has no name to list, and hiding one would take away the row's only control. The last visible column cannot be hidden either: an empty table has no header row to turn anything back on from. Pass `enableColumnToggle={false}` where the control makes no sense (the dashboard's activity feed, which is four columns inside a card).

### Exports serialize the query, not the page

`src/server/actions/exports.ts` re-runs each list query with `page: 1, per_page: EXPORT_LIMIT` and serializes the result. Serializing the rows already in the browser would have been less code and the wrong feature: an admin exporting "failed payments this month" wants all of them, and would have no way to tell they got the first twenty. The result carries `rows` and `truncated` so the toast can say when the cap cut the file short, rather than handing over a partial export silently.

**`csvCell` neutralises formulas, and that is not decoration.** Every string in these files came out of the database and most of it was typed by a user - a username, an email, a user agent. A cell starting `=`, `+`, `-`, `@`, or a leading tab/CR is executed as a formula when the file is opened in Excel or Sheets, which turns "export the user list" into running whatever a signup form was willing to accept. The apostrophe prefix is what a spreadsheet reads as "this is text".

`CSV_BOM` is built with `String.fromCharCode(0xfeff)` rather than written literally: without it Excel reads the bytes in the system codepage and every non-ASCII name arrives mojibaked, and a zero-width character sitting in source is invisible to review.

Because the exports re-run the list query from `params`, the tab filters (`bucket`, `group`) come along for free: exporting from the "Credits owed" tab exports the payments that are actually owed.

These actions are reachable by direct POST like every other action here, so each one opens with a guard (see "Authentication" above), and which guard follows the page rather than the action: the users and payments exports take `denyRead` and are runnable by a guest on purpose - an export returns the rows of the list that guest is already looking at, and refusing would make read-only mean something narrower than it says. The sessions and audit-log exports take `denyAdminArea`, because those two pages are admins only and a CSV is not a loophole in that.

### Session activity is decided on the server

`SessionRow.activity` and `last_active_at` are computed during the server render, not derived in the cell, for the same reason `EmailCampaignRow.interrupted` is: they compare against the current clock, and a client recomputing them during hydration would be free to disagree with the markup it is hydrating. One `now` is taken for the whole page, so two rows a millisecond apart cannot land in different buckets.

`src/lib/session-activity.ts` holds the thresholds and the classifier, and `queries/sessions.ts` expresses the same rule for the query engine. Both read "last seen" as `updated_at ?? created_at` - the query through `$expr` with `$ifNull`, which is why that filter cannot use an index. `updated_at` starts null and stays null until the account's next authenticated request, so reading it alone would file every brand-new session as the oldest thing in the table. If you move a threshold, move it in the shared module; the badge and the filter that selected it must not be able to disagree.

### Errors: unreachable database vs no rows

A failed read throws, and `src/app/error.tsx` renders `DataError` with a retry that re-runs the server render. Keep that distinct from a table's empty state - an unreachable database rendering as "No results" reads as "there are no users", which is exactly the wrong conclusion to hand someone looking at account or payment data.

Server actions never throw across the boundary. They return `{ ok: false, error }` (see `src/lib/action-result.ts`), because a thrown error becomes an opaque digest in production, which cannot tell an admin whether a save failed on validation, a duplicate email, or an unreachable database. Callers toast the message.

### Mutations: id is an argument, not a body field

Actions take `(id, input)` and validate `input` with the same zod schema the form uses. The old PATCH endpoints had to define a separate `*PatchBody` model with no `id`, because the client sent the id in the URL while the update model required it in the body - that whole class of bug does not exist here.

`updateById` `$set`s the dumped object, so a nested object is **replaced wholesale, never merged**. The user edit sheet therefore always submits all three `interview_config` fields, seeded from `user.interview_config ?? EMPTY_INTERVIEW_CONFIG` so a user who has never configured an interview gets one created rather than a partial write.

After a successful write an action calls `refresh()` from `next/cache`, which re-renders the current route on the server. Nothing is cached, so `revalidatePath`/`revalidateTag` would be the wrong tool.

### Forms: key by entity id, don't reactively resync

The user/payment edit sheets mount a fresh inner form component keyed by the record's id (`<UserEditForm key={user._id} .../>`) using `useForm({ defaultValues })`, instead of one long-lived form synced via RHF's reactive `values` option. The `values`-sync approach was tried first and silently left `Controller`-wrapped `<Select>` fields displaying blank (the underlying value was correct - visible in the open dropdown's highlighted item - but the closed trigger never rendered it) even though plain `register()`-bound inputs updated fine. Remounting via `key` sidesteps the whole question of *why* by never needing async resync in the first place.

**Subscribe with `useWatch`, not `watch()`.** `watch()` is a returned function, so React Compiler skips memoizing the whole component and eslint reports `react-hooks/incompatible-library` - the same warning TanStack Table produces, but avoidable here. `useWatch({ control, name })` returns a value instead. Scope it to the smallest component that needs it (the composer's `PreviewPane` is the example): a live preview subscribed at the top of the form would re-render the recipient picker on every keystroke and throw away its search results.

`zodResolver` requires a schema whose input and output types are identical, so a form schema must not use `.default()`. That is why `src/lib/schemas/user.ts` carries two interview-config schemas with the same output type: a strict one for the form, and a `storedInterviewConfigSchema` with defaults for reading documents written before a field existed.

### Rows that reference a user resolve the user

Payments and sessions only store `user_id`. A raw ObjectId tells an admin nothing, so both list queries resolve the whole page's users in one query (`src/server/queries/user-labels.ts`) and attach a `UserLabel` to each row; the UI renders it through `src/components/user-cell.tsx`, which falls back to "Deleted user" plus the raw id when the user is gone.

The users list does the same in reverse: it resolves payment and session counts for the whole page in two grouped aggregations, which is why the edit sheet can open from row data alone and there is no per-record fetch anywhere in the app.

### Email marketing: one renderer, two callers

`/emails` replaces `../../power-interview-email`, a Python CLI whose campaign lived in a gitignored `content.py` and whose only record of a send was `logs/app.log`.

**`src/lib/email/template.ts` is a hand port of `../backend/app/templates/base.j2.html`, not a renderer for it.** Marketing and transactional mail have to look like the same product, and there is no Jinja here; reading the `.j2.html` off disk would also couple a Next build to a sibling Python repo's directory layout. The cost is that the two copies can drift - **if the backend template changes, change this file too**. The port is verified byte-identical to the Jinja render for all four severities, escaping included (Jinja's autoescape emits `&#39;`/`&#34;`, not `&apos;`/`&quot;`, which is why `escapeHtml` uses the numeric forms).

It carries no `server-only`, deliberately: the live preview and the actual send call `renderEmailHtml` with the same arguments, so what an admin approves in the browser is byte-for-byte what leaves the SMTP server. `greetingName` reproduces Python's `str.capitalize()`, lowercased tail and all - a marketing email that addressed someone differently from every transactional email they have had would read as coming from somewhere else.

**Sending outlives the action.** `startEmailCampaign` writes the campaign document and returns; `campaign-runner.ts` keeps walking the recipient list in the same Node process afterwards, and the composer polls `getCampaignProgress`. A server action cannot hold a request open for the minutes a few hundred paced recipients take. Three consequences are load-bearing:

1. **Every recipient is written as `pending` before the first send** and flipped in place as the run proceeds, so a run that dies halfway still names exactly who was reached.
2. **`updated_at` is the heartbeat.** The runner touches it on every recipient. A campaign still marked `sending` with a stale one is a run whose process went away, and `isCampaignInterrupted` is what turns that into an **Interrupted** badge instead of a progress bar that will never move. It is computed on the server (`EmailCampaignRow.interrupted`) because it compares against the current clock, and a client re-deciding it during hydration would be free to disagree with the markup it is hydrating.
3. **Counters are `$set` from local variables, not `$inc`ed.** The loop is the document's only writer, so there is nothing to race with - and `$inc` does not type-check against `Collection<Record<string, unknown>>` anyway (the driver's `NotAcceptedFields` collapses every key of an index-signature schema to `undefined`; `$set` has no such member, which is why a `Document`-typed update object works there).

**The delivery log lives in the campaign document, and that has a ceiling.** `recipients[]` is an array inside one `email_campaigns` document, so a campaign is capped by MongoDB's 16MB per-document limit - roughly 100k recipients at ~150 bytes a row. The run also rewrites that document once per recipient, so write volume grows with the square of the audience. Both are fine at this product's scale (tens of active users) and neither is fine at tens of thousands: past that, the log belongs in its own collection keyed by campaign id. Deliberate trade, not an oversight - keeping the log in the document is what makes "who was reached" a single read, and what lets an interrupted run be reconstructed without a join.

`sendEmail` lets SMTP failures propagate, which is the opposite of what backend and the Python sender do - both swallow every exception into a log line, which is precisely why neither can say afterwards who received a campaign. The runner catches per recipient and records the reason on that recipient's row.

`email_campaigns` is the one collection in this app that backend neither owns nor reads. Test sends stay out of it: recording every draft iteration would bury the real sends in the history table.

`/emails` reads no search params, so it needs `await connection()` for the same reason the dashboard does. Without it Next prerenders it at build time - against a database that is not running, and baking in whatever `SMTP_*` values the build environment happened to have.

**The preview is fed, and it is debounced exactly once.** The composer pushes a snapshot of the subject and body into `PreviewPane` imperatively rather than letting it subscribe, so a keystroke costs no React render; `PreviewPane` debounces that snapshot into state, and `PreviewFrame` assigns the rendered document to `iframe.srcdoc`. `PreviewFrame` deliberately has **no** debounce of its own - every `html` it sees is already the end of a typing burst, and a second timer only added latency.

The flush snapshots the accumulated patch into a local before calling `setMessage`:

```ts
const flushing = pending.current;
pending.current = {};
setMessage((current) => ({ ...current, ...flushing }));
```

Reading `pending.current` from inside the updater instead is a bug that already shipped once. React calls a state updater during render, not when the update is queued, so the updater saw the ref the flush had already cleared and returned `{ ...current }` - the memoised `html` never changed and the preview froze. It survived review because React *does* evaluate an updater eagerly while the fiber has no pending work, which made the first edit of a session land and every one after it disappear. If you touch this flush, keep the read outside the updater.

`srcdoc` is assigned imperatively rather than passed as a prop so the swap is not tied to React's commit of that element. Scroll survives it by stashing the offset before the swap and restoring it on `load`, which is what `sandbox="allow-same-origin"` is for; `allow-scripts` is deliberately not granted, so the raw author-written body cannot execute anything.

### The campaign body is raw HTML, and `src/lib/email/body.ts` is what makes that survivable

`normalizeEmailBody` runs **inside `renderEmailHtml`**, not at a call site, because that is what keeps the preview and the send byte-identical. It handles exactly one shape: a complete `<!doctype html>` document, which authors paste all the time out of a template tool. A browser parser silently discards a nested `<html>`/`<head>`/`<body>`, so without this the frame looks correct while the string handed to SMTP still carries the nesting - the preview lying about what a recipient receives is the one failure this whole isomorphic-renderer design exists to prevent.

`inspectEmailBody` only describes; it never rewrites. An email body is hand-tuned HTML and quietly "fixing" it is a worse surprise than a wrong preview, so the composer renders the findings as non-blocking notes in the preview card and lets the admin decide. They are derived from the same debounced snapshot as `html`, so the scan costs one pass per typing burst.

The tag-balance check tolerates HTML's optional end tags (`p`, `li`, `td`, `tr`, …) and skips comment contents, because `<p>one<p>two` and Outlook's `<!--[if mso]>` conditionals are both normal in email HTML and neither is a mistake. It is regex-based rather than DOM-based on purpose: `renderEmailHtml` runs in the browser and in Node, and Node has no `DOMParser`.

### The body editor is a painted layer under a transparent textarea

`HtmlEditor` (`src/app/emails/html-editor.tsx`) syntax-highlights the campaign body without an editor library. The element stays a real, uncontrolled `<textarea>`, so native undo, `register("body")`'s ref, and the browser's own caret and selection keep working; a `<pre>` behind it carries the colour, and the textarea's own text is `transparent`.

Four things about it are load-bearing:

1. **`tokenizeHtml` returns tokens, not markup, and `paint()` writes them with `textContent`.** This layer lives in the admin document, not the sandboxed preview frame, and its input is raw author-written HTML. Returning an HTML string would put a single escaping bug between a pasted `<img onerror=...>` and script execution on a page wired straight to MongoDB. There is no `innerHTML` in this path and there must not be.
2. **`tokenize(s).map(t => t.value).join("") === s`.** Not a character added, dropped, or reordered - it is what lets the painted layer sit glyph-for-glyph under the text. Checked against 20k fuzzed inputs; if you extend the tokenizer, keep that test honest.
3. **`scrollbar-gutter: stable` on both layers.** The textarea's scrollbar narrows the width its text wraps at while the layer, which never scrolls, has no gutter - so without this the two wrap at different columns the moment the body outgrows the box, and every wrapped line drifts. Reserving the gutter in CSS is what makes the width constant, which is why the layer needs no per-keystroke measuring. An earlier version re-read `clientWidth` on every input and cost 12ms a keystroke to layout thrash; the CSS version costs about 2ms at 7KB.
4. **Painting is driven by a native `input` listener, not React state.** Highlighting through state would have put a re-render of the whole form back on the keystroke path that `PreviewPane` exists to keep clear. It also means a consumer's `onChange` cannot skip the paint. A programmatic write still has to say so: `setValue` fires no `input`, so the starter-layout button calls `editorRef.current.sync()` alongside the preview's `update()`.

Token colours are GitHub's palette in `globals.css` (`--code-*`, one set per theme) rather than anything derived from the app's theme: it has one hue, the brand orange, on neutral greys, so a theme-derived palette would have separated tag, attribute, and value by lightness alone. Nothing in the `.tok-*` rules may change a metric - no italics, no weight, no spacing - or the colours slide off the characters. Bodies over `HIGHLIGHT_LIMIT` (40k) drop to plain readable text instead of paying the paint cost.

### Auto-refresh lives in `PageHeader`

`LiveRefresh` (`src/components/live-refresh.tsx`) calls `router.refresh()` every 10 seconds (`AUTO_REFRESH_INTERVAL_MS`) and shows when the page was last read. It is mounted by `PageHeader` rather than the dashboard layout, because a layout is not re-rendered on a navigation between its pages - a timestamp taken there would describe the previous page. `at` is the server's clock during the render, so it also moves when an action's own `refresh()` lands.

Two things pause it: a hidden tab (which catches up on becoming visible again), and an open dialog or sheet. The edit sheets find their record by id in the page's rows, so a refresh that moved the row off the page would close the sheet under a half-typed form. The time is rendered only after hydration, because the server would format it in its own zone and locale.

`/emails` and `/account` pass `autoRefresh={false}`: they keep the time and the manual button and drop the interval. Both are forms outside any dialog, and a refresh that fails renders the error boundary in place of the page - taking an unsent campaign body with it.

`src/app/error.tsx` retries on the same interval, because the boundary replaces the header that was doing the refreshing; without that, one failed read would strand an unattended tab on the error panel. It uses the boundary's `retry` prop (re-fetch and re-render), not `reset`, which only re-renders.

`PageHeader` imports `server-only` so that `Date.now()` there stays a once-per-request read.

### Navigation feedback

`src/components/navigation-progress.tsx` holds a count of in-flight navigations outside React. Whatever already knows it is pending reports to it with `usePendingNavigation(pending)`, and two things read it: `NavigationProgress` (the bar at the top of the viewport, mounted in `AppProviders`) and `AppShell`, which sets `aria-busy` on `<main>`.

The `loading.tsx` skeletons do not cover this on their own. A skeleton shows instantly only when it was prefetched - `next dev` never prefetches, and a click can beat the prefetch in production - and a same-route change (filters, tabs, sort, paging, the dashboard window) runs in a transition precisely so the skeleton does *not* replace the page.

- **Reporters:** `useListParams`, `RangeSelect`, the account menu's two `router.push` items, and every `<Link>` through `useLinkStatus` - the sidebar's `NavIcon` (which also swaps the icon for a spinner) and `LinkPending` everywhere else. A new `<Link>` to a dynamic route wants a `<LinkPending />` inside it; a new `router.push` wants a transition and `usePendingNavigation`.
- **`LiveRefresh` deliberately does not report.** A bar and a dim every ten seconds would be noise, and it spins its own icon.
- **Data regions dim, controls do not.** `.stale-dim` in `globals.css` fades an element while `<main>` is busy; it is on `DataTable`'s wrapper, `ListSummary`, and the dashboard's three grids. A CSS hook rather than a prop because the summary strip and the charts are server-rendered and cannot see a client `isPending`. Dimming `<main>` itself was tried first and faded the search box while it was being typed in - opacity cannot be undone by a descendant. `DataTable`'s `isPending` now only blocks clicks. A new block of server-rendered figures wants the class.
- **Both indicators are delayed 150ms** (`animation-delay` on the bar, `transition-delay` on the dim), so a fast navigation shows neither.

### Server/client boundary

`src/server/**` imports `server-only`, so leaking it into a client component is a build error rather than a runtime surprise.

Functions cannot cross the boundary. `TrendChart` takes `format="usd"` rather than a formatter function, and `DistributionChart` title-cases its keys itself, because both are rendered from server components. The multi-series charts take a `ChartSeries[]` of `{ key, label, color }` strings for the same reason - the colour is a CSS variable name, not a resolved value, so `ChartStyle` can emit one pair of light/dark definitions per series.

`MultiTrendChart` draws lines and `StackedDayChart` stacks bars, and which one a chart gets is a claim about the data. Login attempts split by outcome stack honestly: the column height is the day's total and the split is what happened to it. Logins, signups, and ASR sessions do not - stacking them would invite reading the top edge as a total that means nothing.

### shadcn/ui is not the CLI you remember

This app was scaffolded with a current-generation `shadcn` CLI (v4.18+) that differs a lot from the classic new-york/default + Radix setup: components are built on **Base UI** (`@base-ui/react`, not Radix), the style is a named preset (`base-nova`, not `new-york`), and there's no `tailwind.config.js` (Tailwind v4, CSS-native). Four consequences that have already caused real bugs here:

1. **No `asChild`.** Base UI components take a `render` prop instead: `<AlertDialogTrigger render={<Button variant="destructive" />}>Delete</AlertDialogTrigger>`. Check the actual component source in `src/components/ui/` before assuming Radix conventions - grep for `render=` to see the pattern already in use.
2. **`Select.Value` needs a formatter.** `<SelectValue />` with no children renders blank for any value that isn't in a statically-known `items` array passed to `<Select.Root items={...}>`. Always pass a children function: `<SelectValue>{(v: string) => titleCase(v)}</SelectValue>` (see `src/lib/format.ts`'s `titleCase`, which is null-safe on purpose - the formatter gets called with `null` during transient render states, not just real values). `Select`'s `onValueChange` is also typed `string | null`.
3. **`render={<Link/>}` on a `Button` needs `nativeButton={false}`.** `useButton` asserts in a dev-only effect that a component claiming native button semantics actually rendered a `<button>`; an anchor trips it on every visit to the page. `PaginationLink` in `src/components/ui/pagination.tsx` is the reference. `SidebarMenuButton` is exempt - it calls `useRender` directly and never goes through `useButton`.
4. **`Textarea` is `field-sizing-content`.** It re-measures the whole value to size itself on every keystroke, and grows the page unbounded. Fine for short fields; for anything holding kilobytes (a CV, a campaign body) add `field-sizing-fixed` and let it scroll, or it will visibly stall typing.

`--overwrite`-generated files in `src/components/ui/` are vendor code - prefer composing them from `src/components/` over hand-editing the generated files.

### Tailwind sources are pinned

`globals.css` uses `@import "tailwindcss" source(none)` plus `@source "../../src"`. Automatic content detection walks up to the repo root, which holds `.claude/skills/` - documentation full of class-like strings, one of which (`bg-[url('...')]`) made the build fail trying to resolve it as a real module. Only application code is a real source of class names.

### Fonts wire through `@theme inline`, and the variable names must match

`globals.css` maps Tailwind's font theme keys to the `next/font` CSS variables inside `@theme inline` (`--font-sans: var(--font-inter), ...`). The `inline` option is load-bearing: the `next/font` variables are declared on `<html>` via the font loader's `className`, which is below the scope where a plain `@theme` would emit `--font-sans`, so utilities have to inline the *value* rather than reference the theme variable. This was previously written as `--font-sans: var(--font-sans)` - self-referential, so `font-sans` resolved to nothing and the whole app silently fell back to the browser default font while still loading and self-hosting the webfont. If you swap the font family, change the name in **both** `layout.tsx` (`variable:`) and `globals.css`, and confirm with `grep -o 'html{[^}]*}' .next/static/chunks/*.css` after `pnpm build` that the rule names the font variable you expect.

### Prerendering against a database that is not running

Next tries to prerender any route with no request dependency, at build time, against a database that is not up. Reading `searchParams` is such a dependency, and every route here does - including `/`, since the dashboard's reporting window became a URL parameter. `/emails` is the exception: it reads no search params, so it still needs `await connection()`, without which Next would prerender it and bake in whatever `SMTP_*` values the build environment happened to have.

`/` used to need the same call and no longer does. If you ever make the dashboard's window a constant again, put `await connection()` back.

### `mongodb+srv://` and `src/server/dns.ts`

Node has two resolvers: `dns.lookup` (the OS one) and `dns.resolve*` (c-ares, configured by `dns.getServers()`). The driver expands a `+srv` URI with `resolveSrv`/`resolveTxt` and only then connects with `lookup`, so when c-ares is misconfigured the failure is `querySrv ECONNREFUSED` on the `_mongodb._tcp.*` hostname while every other network call, including the FastAPI backend and `nslookup`, works fine. It reads as an Atlas outage, a firewall, or a bad IP allowlist entry, and is none of those. Before assuming the database is unreachable, check `node -e "console.log(require('dns').getServers())"`.

c-ares falls back to a hardcoded `127.0.0.1` when it cannot read the system DNS config (a VPN adapter plus VMware virtual adapters trigger this), and nothing listens on port 53 there. `ensureResolvableDns()` points it at real resolvers, but **only when the configured servers are entirely loopback** - on a healthy machine it is a no-op, so it will not quietly route DNS off-box for anyone who does not have this problem. Override the resolvers with `DNS_SERVERS` in `.env.local`.

Two things about it are load-bearing, and both were found the hard way:

1. **`dns` and `dns.promises` are separate resolver instances.** `dns.setServers()` does not touch `dns.promises`, and the driver resolves through `dns.promises`. Fixing only the callback API leaves `dns.getServers()` reporting the new servers while `dns.promises.getServers()` still says `127.0.0.1` and every SRV lookup keeps failing - a very convincing false fix. Both must be set. A throwaway script will not reproduce this: `dns.promises` is initialized lazily from the current default servers, so a script that touches it *after* `setServers` appears to work.
2. **It hangs off client creation, not `instrumentation.ts`.** Resolver config is per-process, and in dev Next renders routes in a worker process separate from the one that runs `register()`. Instrumentation logged success while the worker actually holding the connection was never fixed.

Switching the URI to the standard non-SRV form (shard hosts plus `replicaSet=`) also works, since that path never touches c-ares, but it pins hostnames that Atlas is free to change when the cluster rescales.

### Theme

`next-themes` was already a dependency (the generated `sonner.tsx` imports `useTheme`) but nothing mounted a provider, so the dark palette in `globals.css` was unreachable. `AppShell` now wraps everything in `ThemeProvider attribute="class"`, and the root `<html>` carries `suppressHydrationWarning` because the provider mutates that element before hydration.

`ThemeToggle` renders both icons and lets the `dark:` variant pick one in CSS. Choosing in JS needs a post-hydration `mounted` flag (the server cannot know the stored theme), and the project's eslint config rejects that pattern outright via `react-hooks/set-state-in-effect`.

### Environment

`.env.local`, gitignored. `MONGO_URL`/`MONGO_DB` are required; `DNS_SERVERS` is an escape hatch for the `+srv` problem above.

`ADMIN_MONGO_DB` (default `pia_admin`) is the database holding this dashboard's own accounts and sessions - the same cluster as `MONGO_DB`, a different database. `SECURE_COOKIES` forces the session cookie's `Secure` flag on or off; leave it unset and the scheme decides.

`ADMIN_EMAIL`/`ADMIN_PASSWORD` are required: without them nobody can sign in and nobody can approve anybody. That is reported the way a missing `SMTP_*` block is - `readBootstrapConfig()` names what is missing and the sign-in page shows it, rather than presenting a form that cannot succeed. `ADMIN_NAME` sets the display name of the seeded account, and `ADMIN_PASSWORD_FORCE_RESET=true` re-applies `ADMIN_PASSWORD` on one boot.

The `SMTP_*` block is required only by `/emails`, and its absence is a first-class state rather than a crash: `readEmailConfig()` names the missing variables, the page renders read-only with that reason shown, and composing and previewing still work. Only `describeEmailSetup()` crosses to the client - it deliberately omits the password, because the API key must never reach a browser. `EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME`/`APP_NAME` default to what backend and the Python sender already send as, so leaving them unset keeps every kind of mail arriving from one identity.

### Known lint warning

`pnpm lint` reports exactly one warning: React Compiler skips `useReactTable` (`react-hooks/incompatible-library`). TanStack Table returns functions that cannot be memoized safely; the warning is inherent to using it and is not a defect to fix.

If a second one appears naming react-hook-form's `watch()`, that one *is* fixable - see "Subscribe with `useWatch`" above.

## Project Spec

See [SPEC.md](SPEC.md) for feature list, tech stack, and data model.
