# SPEC.md

Project specification for the Power Interview AI admin dashboard - a production-quality admin panel for analytics, user/payment/session management, audit log review, and bulk email marketing, behind an email/password sign-in with two roles.

## Overview

`admin` is a single Next.js application that reads and writes the same MongoDB database `../backend` uses for the Power Interview AI product. It does not call backend's API - it talks to MongoDB directly, since backend exposes no admin-facing endpoints today. It is meant to run on a single machine, opened in a browser. Access is gated by its own email/password sign-in, kept in a separate database from the product's own users: a built-in admin comes from the environment, everyone else signs up and waits for an admin to approve them, and an approved account is either an `admin` (writes) or a `guest` (reads).

It also sends mail. `/emails` replaces `../../power-interview-email`, a one-shot Python CLI whose campaign lived in a gitignored `content.py` and whose only record of a send was a log file.

## Tech Stack

| Layer            | Technology                                                    |
| ---------------- | ------------------------------------------------------------- |
| Framework        | Next.js 16 (App Router), React 19, TypeScript                  |
| Server logic     | Server components for reads, server actions for writes         |
| Database access  | MongoDB Node driver, direct to MongoDB (no ODM)                |
| Validation       | Zod - one schema set shared by document reads, forms, and URL state |
| Styling          | Tailwind CSS v4, shadcn/ui (Base UI-based, `base-nova` preset) |
| Tables           | TanStack Table v8                                              |
| Charts           | Recharts, via shadcn's `Chart` wrapper                         |
| Forms            | react-hook-form + Zod                                          |
| Password hashing | `bcryptjs`, configured to match backend's passlib output       |
| Email delivery   | `nodemailer` over SMTP with implicit TLS (Resend)              |
| Package manager  | `pnpm`                                                         |

There is no separate API process and no client-side data-fetching library. A page renders from the database on the server; a mutation is a server action that writes and then refreshes the route.

## Data Model

Five MongoDB collections owned by `../backend`, read/written here without any schema-migration coordination between the two repos, plus one this app owns outright. Every document is validated against a zod schema on read, so drift surfaces as a named error rather than blank cells.

| Collection    | Key fields                                                                                          | Notes |
| ------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| `users`       | `username`, `email`, `role` (`user`/`trial_user`/`admin`), `status` (`active`/`inactive`), `credits`, `interview_config` (`full_name`, `profile_data`, `context`) | `password_hash` has no field in the schema, so it is stripped on read and never reaches a client. It is write-only here: the set-password action is the one thing that touches it |
| `payments`    | `user_id`, `plan` (`starter`/`pro`/`enterprise`), `status` (10-value enum), `price_amount`, `credits_amount`, `credits_applied` | Status/`credits_applied` are manually editable here - editing does **not** call NOWPayments or replay webhook logic |
| `sessions`    | `token`, `user_id`, `device_info` (`ip_address`, `user_agent`)                                        | Deleting one force-logs-out that device. `token` has no field in the schema - it is a live bearer credential |
| `audit_logs`  | `event_type` (23-value enum, plus an `unknown` fallback this app adds for a value it does not yet recognize), `user_id`, `email`, `status`, `metadata` (free-form dict) | Read-only in the UI. The two entries this app writes are `password_change` (for its own password overwrites) and `credits_adjusted` (for its own credit edits) |
| `global_state`| `active_sessions`                                                                                      | **Not used anywhere in this app** - it's a simulated `random.gauss(260, 10)` value in backend, not real data |
| `email_campaigns` | `subject`, `template`, `body`, `audience`, `status`, `total`, `sent_count`, `failed_count`, `recipients[]` | **Owned by this app**, not backend. Written by the email marketing page; nothing else reads it. `recipients[]` is the per-address delivery log |

Two more collections are owned by this app and live in a **separate database** (`ADMIN_MONGO_DB`, default `pia_admin`), because they describe operators of the dashboard rather than customers of the product:

| Collection        | Key fields                                                        | Notes |
| ----------------- | ----------------------------------------------------------------- | ----- |
| `admin_accounts`  | `email` (unique), `name`, `role` (`admin`/`guest`), `status` (`pending`/`approved`/`rejected`), `is_bootstrap`, `last_login_at` | Who can sign in to the dashboard. Unrelated to `users` - the two never join, and a product user with `role: "admin"` grants nothing here. `status` gates signing in at all; `role` gates writing once in. `is_bootstrap` marks the account named by `ADMIN_EMAIL`. `password_hash` has no field in the schema, same rule as `users` |
| `admin_sessions`  | `account_id`, `token_hash` (unique), `expires_at`                  | One row per live sign-in. Stores the SHA-256 of the cookie's token, never the token itself |

## Features

### Analytics (`/`)

All computed server-side from real documents (`src/server/queries/analytics.ts`), never from `global_state`, and issued as one parallel batch. The reporting window is selectable (7/30/90/180 days) and lives in the URL like every other view's state, so a particular reading of the numbers is linkable.

- KPI cards: total users (+ new in window), lifetime revenue from `finished` orders (+ revenue in window) - root payments only, since a partially-paid order is completed by a follow-up leg priced at the remainder and both documents end up `finished`, so counting every one of them would bill the remainder twice, credits outstanding (the sum of every non-trial, non-admin user's balance - trial and admin *accounts* are excluded, since neither role's balance ever had a payment behind it; a hand-edited balance on an ordinary account is still counted, and the `credits_adjusted` audit trail is where that is answered instead), ASR sessions, active users (distinct accounts with any audit event in the window), paying users (+ conversion), revenue per paying user, and payment success rate
- Trends over the window: signups per day, cumulative user total, revenue per day, and a three-series activity chart (logins, signups, ASR sessions)
- Sign-in outcomes per day, stacked success against failure - the only place `status: "failure"` is visible in aggregate
- Usage by hour of day, which the daily series structurally cannot answer
- Distributions: users by role, users by status, payments by status, revenue by plan
- Recent activity feed: latest 20 audit log entries

Day buckets are dense: a day with no events is a zero rather than an absent row, so a quiet week renders as a flat line on the floor instead of a gentle slope between the days on either side.

### Users (`/users`)

Quick-filter tabs across the top - all, active, trial, admins, not set up - over a summary strip carrying the matching account count, how many are active, how many have an interview set up (and how many never have), and the credits those accounts hold. Below that: search (username/email), filter by role, status, interview setup (whether the account has a name or CV - the product's activation signal), credit range, and joined date range. Paginated table sortable by username, email, credits, joined, or last updated, showing each account's payment and session counts. Row click opens an edit sheet: role, status, credits, username, email, and the user's interview configuration (full name, profile/CV, context) are all editable; the sheet links through to that user's payments, sessions, and audit log, and has a delete action (destructive, confirmed via dialog).

The sheet also carries a **set-password** action, in its own dialog outside the edit form so it never rides along with an ordinary save. It overwrites `password_hash` without knowing the current password (which is what makes it an admin tool rather than a copy of backend's change-password endpoint), revokes every session that user holds, and records a `password_change` audit log entry. The hash is bcrypt in backend's exact format, so the user signs in through the normal login flow afterwards.

### Payments (`/payments`)

Tabs for the coarse question an admin actually asks - all, in flight, finished, failed, and **credits owed**, the last being a finished *order* whose credits were never granted - root payments only, since a follow-up leg is credited against its root and never carries `credits_applied` of its own, so counting legs would report every settled partial payment as outstanding work forever - over a summary strip carrying the matching payment count, revenue from the finished ones, and the same three counts. Below that: search by order id, NOWPayments id, purchase id, or buyer; filter by status, plan, whether credits were applied, USD amount range, and created date range. Paginated table sortable by status, amount, credits, created, or updated, showing which user each payment belongs to. Row click opens an edit sheet for a manual `status`/`credits_applied` override - explicitly labeled as a support/manual tool, not a payment-provider action.

### Sessions (`/sessions`)

Tabs for the three activity buckets, over a summary strip carrying the matching session count, how many distinct accounts hold them and how many sessions that is each, and the split across active/idle/stale. Below that: a paginated table of every session across all users, searchable by account and filterable by start date and by activity - active (seen in 24h), idle (1-7 days), or stale (7 days or more). Sortable by start or last-active time, showing the account and device behind each one, with a revoke action (confirmed via dialog) that deletes the session document, forcing that device to re-authenticate.

The activity bucket is decided during the server render rather than in the cell, so a badge cannot disagree with the filter that selected it, and hydration cannot disagree with the markup it is hydrating.

### Email marketing (`/emails`)

Composes one announcement and sends it through the same layout the product's transactional mail uses.

- **Compose**: subject, one of four severity styles (`info`/`success`/`warning`/`error`), and an HTML body. A starter layout is offered behind a button rather than pre-filled, so placeholder copy cannot be sent by accident
- **Preview**: the fully rendered email, live, at desktop and mobile widths, with the From/To/Subject envelope above it. Rendered by the same function the send uses, so what is approved is what is delivered
- **Audiences**: one user, a set of selected users, or every active user. The first two use a searchable picker; the last resolves at send time and reports its count up front
- **Test send**: one message to any typed address, sent synchronously with the result reported immediately. Not recorded as a campaign
- **Confirmation**: every send is confirmed with the recipient count and estimated duration; sending to the whole user base additionally requires typing `SEND`
- **Progress**: sending runs in the background at one message per `EMAIL_SEND_DELAY_MS` (default 1s) and the page polls a live progress bar. Navigating away does not stop it

Recipients are active users with a non-empty `email`, deduplicated by address. Failures are recorded per recipient and never abort the run.

### Email history (`/emails/history`)

Tabs for the three campaign states, over a summary strip carrying the campaign count, how many addresses were on those send lists, and how many were delivered and failed. Paginated, status-filterable table of every campaign sent from here, sortable by recipient count or date. Row click opens the full record: the delivery result for every address, filterable to just the failures, alongside the HTML that was sent.

A campaign whose Node process went away mid-send is shown as **Interrupted** rather than as still sending, decided from a stale heartbeat on `updated_at`.

### Audit Logs (`/audit-logs`)

Tabs grouping twenty-three event types into three families - accounts, payments, ASR - plus a **failures** tab that cuts across all three, since the failures are what the page gets opened for. Over a summary strip carrying the matching event count, the failures and their share, how many distinct accounts and IP addresses are involved, and when the newest matching event happened. Below that: a read-only table, searchable by account and filterable by event type, status, IP address, and date range, ordered newest or oldest first. Row click opens a dialog with the full record, including the raw `metadata` JSON.

The three groups are exhaustive by construction: payments and ASR are named explicitly and "accounts" is everything else, so an event type backend adds later shows up under a tab rather than disappearing from all of them.

### Dashboard access (`/access`)

The admin user management panel. A summary strip (waiting for approval, approved, admins, live sessions, last sign-in) over a table of every account, sorted so the ones waiting on a decision come first. Pending rows carry **Approve** and **Reject** buttons inline; the sidebar shows a badge with the pending count, since a sign-up is the one thing here that blocks a person on a human.

A row opens a sheet to approve or revoke access, change the role, set a password, sign that account out of every device, or delete it. Admins can also create an account outright, with its role and password set on the spot - approved immediately, because an admin typing someone's password in is the approval.

Readable by guests like every other page, with the controls disabled rather than hidden. An admin cannot demote, revoke, sign out, or delete **their own** account, which is what makes it impossible to lock the last admin out. The built-in admin named by `ADMIN_EMAIL` is protected the same way, because a restart would grant its access back anyway.

### Your account (`/account`)

Your own sign-in, reachable by every signed-in account whatever its role. Shows who you are signed in as - email, role, access status, when the account was created, when you last signed in - and lets you change the two things that are yours to change: your display name and your password.

Changing your password requires the current one, and ends every other session while keeping the tab you changed it in. A separate control signs out your other devices without changing the password.

### Sign in and sign up (`/sign-in`, `/sign-up`)

Email and password. Signing up creates a **pending** account and no session: nothing is readable until an admin approves it, and the form says so rather than pretending to sign you in. Signing in reports one message for a wrong password and for an unknown address, and its own message for an account that is pending or has been rejected - both only reachable by someone who already produced the right password. An email is locked after 8 failures in 15 minutes.

There is always one way in: `ADMIN_EMAIL`/`ADMIN_PASSWORD` name a built-in admin that is created on first boot and re-asserted as an approved admin on every restart. With those unset, the sign-in page says so instead of presenting a form that cannot succeed.

### Cross-cutting UI behaviour

- Filters, sort, and page live in the URL: every view is linkable, and the back button steps through it. A **Reset** control clears the filters while keeping sort order and page size, and carries a count of how many are currently narrowing the list
- Every list page opens with a **summary strip** of five figures describing the rows the filters currently select, not the collection - so the numbers on top always answer "what am I looking at" rather than "what exists". Anything meaning work is outstanding (credits owed, failures) is coloured
- Every list page carries **quick-filter tabs** above the filter row, each labelled with how many rows sit behind it. A tab is an ordinary URL filter, so it is linkable and the back button steps through it; the counts are measured against the view's *other* filters, so "Failed 3" keeps meaning three failed rows whichever tab is selected. Tabs and filters compose, and no tab is highlighted when the filter row has been set to something no tab offers
- Rows per page is selectable (20/25/50/100/200) from an allowlist, and the pager offers first/last as well as next/previous
- Columns can be hidden per table, in the browser rather than in the URL - it describes how one admin likes to read the table, not which rows they are reading, so a shared link should not carry it
- **CSV export** on every list view, of the whole filtered result set rather than the page on screen (capped at 5,000 rows, and the toast says so when it truncates). Cells that would be read as spreadsheet formulas are neutralised on the way out
- Light and dark themes, following the system preference by default with a toggle in the header
- Every table distinguishes "no rows matched" from "the database could not be reached", the latter with a retry that re-runs the server render
- Destructive actions (delete user, revoke session) and every campaign send go through a confirmation dialog
- Every mutation reports success or failure as a toast, driven by the action's return value rather than a thrown error
- A guest sees every page an admin sees, with the write controls disabled and a note saying why. Every server action re-checks the role before doing anything, so the disabled controls are an explanation rather than the enforcement

## Out of Scope

- No sign-in for the *product's* users here - `users` is data this tool edits, not a way into it. Dashboard accounts are separate records in a separate database
- No password reset by email, no SSO, no multi-factor - an admin sets a password from the access panel and passes it on out of band, and a forgotten built-in admin password is recovered with `ADMIN_PASSWORD_FORCE_RESET`
- No email notification when somebody requests access - the pending count in the sidebar is how an admin finds out
- No user creation from the admin panel (only editing existing users). Creating a *dashboard* account is supported, from `/access`
- No payment creation - payments only originate from the real NOWPayments flow in backend
- `global_state.active_sessions` is excluded everywhere as simulated, non-real data
- No changes to `../backend` - this app is fully independent of it at the code level, coupled only by reading/writing the same database

## Project Structure

See [CLAUDE.md](CLAUDE.md) for the full directory layout, architecture rationale, and known gotchas in the shadcn/Base UI setup and the URL-state, table, and server-action patterns.
