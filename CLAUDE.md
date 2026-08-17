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

## Architecture

One Next.js app. There is no separate API service: pages read MongoDB directly on the server and mutate it through server actions.

```
src/
  app/                 one route per entity: /, /users, /payments, /sessions, /emails, /audit-logs
    <route>/page.tsx       async server component: parses searchParams, runs the query
    <route>/*-view.tsx     client component: filters + table + sheet
    <route>/loading.tsx    route-shaped skeleton
    error.tsx              one boundary for every page (see "Errors" below)
  server/              server-only, never imported by a client component
    db.ts                  pooled MongoClient, collection names, ObjectId helpers
    repository.ts          paged find, grouped counts, update/delete, document validation
    errors.ts              AppError plus duplicate-key mapping
    queries/               one module per entity, plus analytics and user-labels
    actions/               "use server" mutations
    email/                 SMTP transport and the background campaign runner
  lib/
    schemas/             zod schemas: the single source of truth for the app's types
    search-params.ts     per-route URL state schemas and query-string building
    action-result.ts     the { ok } | { ok: false, error } shape every action returns
    email/               the shared email layout, ported from backend's Jinja templates
  components/
    ui/                  generated shadcn primitives (vendor code, don't hand-edit)
    *.tsx                shared app components
```

Route-specific components are colocated with their route; only genuinely shared ones live in `src/components/`.

### Why direct MongoDB access, not backend's API

`../backend` has an `admin` role and an unused `get_admin_user` dependency, but zero list/edit/delete endpoints for anything - every backend endpoint operates on "the current user" only. Rather than build ~15 new endpoints in a second repo and keep both in sync, this app connects straight to the same MongoDB database (`MONGO_URL`/`MONGO_DB` in `.env.local`). This means `src/lib/schemas/*.ts` are a second copy of backend's document shapes - if backend changes a field, update it here too. There's no migration tool enforcing that; it's a manual sync, which is exactly why every document is validated on read.

**No authentication.** This is a local-only tool (confirmed decision - see git history). Don't add a login flow without checking with the user first; it was explicitly scoped out. Note that server actions are reachable by direct POST, not only through the UI - if this app ever stops being local-only, every action in `src/server/actions/` needs an authorization check before anything else.

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

`src/server/queries/analytics.ts` computes everything from real documents - `created_at`/`updated_at` are unix-ms ints (not BSON dates), so pipelines bucket by day via `{"$toDate": "$field"}` inside `$dateToString`, not `$dateTrunc`. **`global_state.active_sessions` is deliberately never surfaced anywhere in the dashboard** - it's `random.gauss(260, 10)` in `backend/app/services/ping_client_service.py`, not a real metric. If you're asked to add a "live active users" widget, don't wire it to that field; it isn't real data.

The overview's eleven aggregations run in one `Promise.all`, so the dashboard costs the slowest query rather than their sum. Keep additions inside that array.

### URL state, not component state

Filters, sort, and page for every list view live in the URL and are parsed server-side by a schema in `src/lib/search-params.ts`. A view is therefore linkable, and the back button steps through it.

- Every field is `.catch()`ed, so a hand-edited or stale URL degrades to the default instead of throwing a parse error at an admin.
- `sort_by` is an allowlist of real fields, not a raw Mongo field name. Offering a sort on a field the collection cannot usefully order by just produces a confusing result set.
- `useListParams` resets `page` to 1 on any change other than an explicit page jump: page 3 of the old filter is not page 3 of the new one.
- Writes go through `startTransition`, so the current rows stay on screen and dim (`isPending`) instead of being replaced by a skeleton. The search box writes with `replace` so typing does not fill the back stack - which is also why it can be uncontrolled, sidestepping an effect-based resync that this project's eslint config rejects (`react-hooks/set-state-in-effect`).

### One table component

`DataTable` is TanStack Table and is the only table in the app, including the dashboard's activity feed (which passes no `pagination`, so it renders as a plain list). Two things differ from stock TanStack:

1. **Sorting is off per column by default** and a column opts in with `enableSorting: true`. That is the inverse of TanStack's default, and it exists so a new column is never accidentally sortable by a key the query does not accept.
2. `manualPagination`/`manualSorting` are always on. The table never sorts or slices in the browser; it renders the page the server produced.

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

### Server/client boundary

`src/server/**` imports `server-only`, so leaking it into a client component is a build error rather than a runtime surprise.

Functions cannot cross the boundary. `TrendChart` takes `format="usd"` rather than a formatter function, and `DistributionChart` title-cases its keys itself, because both are rendered from server components.

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

### The dashboard needs `connection()`

`/` takes no search params, so without an explicit request dependency Next would try to prerender it at build time, against a database that is not running during the build. `await connection()` at the top of the page opts it out. Every other route reads `searchParams` and is dynamic already.

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

The `SMTP_*` block is required only by `/emails`, and its absence is a first-class state rather than a crash: `readEmailConfig()` names the missing variables, the page renders read-only with that reason shown, and composing and previewing still work. Only `describeEmailSetup()` crosses to the client - it deliberately omits the password, because the API key must never reach a browser. `EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME`/`APP_NAME` default to what backend and the Python sender already send as, so leaving them unset keeps every kind of mail arriving from one identity.

### Known lint warning

`pnpm lint` reports exactly one warning: React Compiler skips `useReactTable` (`react-hooks/incompatible-library`). TanStack Table returns functions that cannot be memoized safely; the warning is inherent to using it and is not a defect to fix.

If a second one appears naming react-hook-form's `watch()`, that one *is* fixable - see "Subscribe with `useWatch`" above.

## Project Spec

See [SPEC.md](SPEC.md) for feature list, tech stack, and data model.
