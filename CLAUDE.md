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
pnpm dev          # dev server on :3000, hot reload
pnpm build        # production build (also type-checks the whole app)
pnpm start        # serve the production build on :3000
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
```

**Whenever you change anything under `src/`, run `pnpm build` before considering the change done** - `next build` type-checks the whole app and this project has already hit real bugs (see below) that only surfaced there, not in the editor.

## Architecture

One Next.js app. There is no separate API service: pages read MongoDB directly on the server and mutate it through server actions.

```
src/
  app/                 one route per entity: /, /users, /payments, /sessions, /audit-logs
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
  lib/
    schemas/             zod schemas: the single source of truth for the app's types
    search-params.ts     per-route URL state schemas and query-string building
    action-result.ts     the { ok } | { ok: false, error } shape every action returns
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

`zodResolver` requires a schema whose input and output types are identical, so a form schema must not use `.default()`. That is why `src/lib/schemas/user.ts` carries two interview-config schemas with the same output type: a strict one for the form, and a `storedInterviewConfigSchema` with defaults for reading documents written before a field existed.

### Rows that reference a user resolve the user

Payments and sessions only store `user_id`. A raw ObjectId tells an admin nothing, so both list queries resolve the whole page's users in one query (`src/server/queries/user-labels.ts`) and attach a `UserLabel` to each row; the UI renders it through `src/components/user-cell.tsx`, which falls back to "Deleted user" plus the raw id when the user is gone.

The users list does the same in reverse: it resolves payment and session counts for the whole page in two grouped aggregations, which is why the edit sheet can open from row data alone and there is no per-record fetch anywhere in the app.

### Server/client boundary

`src/server/**` imports `server-only`, so leaking it into a client component is a build error rather than a runtime surprise.

Functions cannot cross the boundary. `TrendChart` takes `format="usd"` rather than a formatter function, and `DistributionChart` title-cases its keys itself, because both are rendered from server components.

### shadcn/ui is not the CLI you remember

This app was scaffolded with a current-generation `shadcn` CLI (v4.18+) that differs a lot from the classic new-york/default + Radix setup: components are built on **Base UI** (`@base-ui/react`, not Radix), the style is a named preset (`base-nova`, not `new-york`), and there's no `tailwind.config.js` (Tailwind v4, CSS-native). Two consequences that have already caused real bugs here:

1. **No `asChild`.** Base UI components take a `render` prop instead: `<AlertDialogTrigger render={<Button variant="destructive" />}>Delete</AlertDialogTrigger>`. Check the actual component source in `src/components/ui/` before assuming Radix conventions - grep for `render=` to see the pattern already in use.
2. **`Select.Value` needs a formatter.** `<SelectValue />` with no children renders blank for any value that isn't in a statically-known `items` array passed to `<Select.Root items={...}>`. Always pass a children function: `<SelectValue>{(v: string) => titleCase(v)}</SelectValue>` (see `src/lib/format.ts`'s `titleCase`, which is null-safe on purpose - the formatter gets called with `null` during transient render states, not just real values). `Select`'s `onValueChange` is also typed `string | null`.

`--overwrite`-generated files in `src/components/ui/` are vendor code - prefer composing them from `src/components/` over hand-editing the generated files.

### Tailwind sources are pinned

`globals.css` uses `@import "tailwindcss" source(none)` plus `@source "../../src"`. Automatic content detection walks up to the repo root, which holds `.claude/skills/` - documentation full of class-like strings, one of which (`bg-[url('...')]`) made the build fail trying to resolve it as a real module. Only application code is a real source of class names.

### Fonts wire through `@theme inline`, and the variable names must match

`globals.css` maps Tailwind's font theme keys to the `next/font` CSS variables inside `@theme inline` (`--font-sans: var(--font-inter), ...`). The `inline` option is load-bearing: the `next/font` variables are declared on `<html>` via the font loader's `className`, which is below the scope where a plain `@theme` would emit `--font-sans`, so utilities have to inline the *value* rather than reference the theme variable. This was previously written as `--font-sans: var(--font-sans)` - self-referential, so `font-sans` resolved to nothing and the whole app silently fell back to the browser default font while still loading and self-hosting the webfont. If you swap the font family, change the name in **both** `layout.tsx` (`variable:`) and `globals.css`, and confirm with `grep -o 'html{[^}]*}' .next/static/chunks/*.css` after `pnpm build` that the rule names the font variable you expect.

### The dashboard needs `connection()`

`/` takes no search params, so without an explicit request dependency Next would try to prerender it at build time, against a database that is not running during the build. `await connection()` at the top of the page opts it out. Every other route reads `searchParams` and is dynamic already.

### Theme

`next-themes` was already a dependency (the generated `sonner.tsx` imports `useTheme`) but nothing mounted a provider, so the dark palette in `globals.css` was unreachable. `AppShell` now wraps everything in `ThemeProvider attribute="class"`, and the root `<html>` carries `suppressHydrationWarning` because the provider mutates that element before hydration.

`ThemeToggle` renders both icons and lets the `dark:` variant pick one in CSS. Choosing in JS needs a post-hydration `mounted` flag (the server cannot know the stored theme), and the project's eslint config rejects that pattern outright via `react-hooks/set-state-in-effect`.

### Known lint warning

`pnpm lint` reports one warning: React Compiler skips `useReactTable` (`react-hooks/incompatible-library`). TanStack Table returns functions that cannot be memoized safely; the warning is inherent to using it and is not a defect to fix.

## Project Spec

See [SPEC.md](SPEC.md) for feature list, tech stack, and data model.
