# SPEC.md

Project specification for the Power Interview AI admin dashboard - a local-only, production-quality admin panel for analytics, user/payment/session management, audit log review, and bulk email marketing.

## Overview

`admin` is a single Next.js application that reads and writes the same MongoDB database `../backend` uses for the Power Interview AI product. It does not call backend's API - it talks to MongoDB directly, since backend exposes no admin-facing endpoints today. It is meant to run on a single local machine, opened in a browser; it is never deployed or exposed publicly, and has no authentication.

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
| `audit_logs`  | `event_type` (17-value enum), `user_id`, `email`, `status`, `metadata` (free-form dict)               | Read-only in the UI. The one entry this app writes is the `password_change` it records for its own overwrites |
| `global_state`| `active_sessions`                                                                                      | **Not used anywhere in this app** - it's a simulated `random.gauss(260, 10)` value in backend, not real data |
| `email_campaigns` | `subject`, `template`, `body`, `audience`, `status`, `total`, `sent_count`, `failed_count`, `recipients[]` | **Owned by this app**, not backend. Written by the email marketing page; nothing else reads it. `recipients[]` is the per-address delivery log |

## Features

### Analytics (`/`)

All computed server-side from real documents (`src/server/queries/analytics.ts`), never from `global_state`, and issued as one parallel batch:

- KPI cards: total users (+ admin count), lifetime revenue from `finished` payments, credits outstanding across all users, ASR sessions in the last 30 days
- Signups per day and revenue per day (last 30 days), as trend charts
- Users-by-role and payments-by-status distributions
- Recent activity feed: latest 20 audit log entries

### Users (`/users`)

Search (username/email), filter by role and status, paginated table sortable by username, credits, or joined date. Row click opens an edit sheet: role, status, credits, username, email, and the user's interview configuration (full name, profile/CV, context) are all editable; the sheet also shows that user's payment and session counts, and has a delete action (destructive, confirmed via dialog).

The sheet also carries a **set-password** action, in its own dialog outside the edit form so it never rides along with an ordinary save. It overwrites `password_hash` without knowing the current password (which is what makes it an admin tool rather than a copy of backend's change-password endpoint), revokes every session that user holds, and records a `password_change` audit log entry. The hash is bcrypt in backend's exact format, so the user signs in through the normal login flow afterwards.

### Payments (`/payments`)

Filter by status and plan, paginated table sortable by amount or created date, showing which user each payment belongs to. Row click opens an edit sheet for a manual `status`/`credits_applied` override - explicitly labeled as a support/manual tool, not a payment-provider action.

### Sessions (`/sessions`)

Paginated table of every active session across all users, sortable by start or last-active time, showing the account and device behind each one, with a revoke action (confirmed via dialog) that deletes the session document, forcing that device to re-authenticate.

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

Paginated, status-filterable table of every campaign sent from here, sortable by recipient count or date. Row click opens the full record: the delivery result for every address, filterable to just the failures, alongside the HTML that was sent.

A campaign whose Node process went away mid-send is shown as **Interrupted** rather than as still sending, decided from a stale heartbeat on `updated_at`.

### Audit Logs (`/audit-logs`)

Filterable (event type, status, date range) read-only table. Row click opens a dialog with the full record, including the raw `metadata` JSON.

### Cross-cutting UI behaviour

- Filters, sort, and page live in the URL: every view is linkable, and the back button steps through it
- Light and dark themes, following the system preference by default with a toggle in the header
- Every table distinguishes "no rows matched" from "the database could not be reached", the latter with a retry that re-runs the server render
- Destructive actions (delete user, revoke session) and every campaign send go through a confirmation dialog
- Every mutation reports success or failure as a toast, driven by the action's return value rather than a thrown error

## Out of Scope

- No authentication or authorization - local-only tool, confirmed decision
- No user creation from the admin panel (only editing existing users)
- No payment creation - payments only originate from the real NOWPayments flow in backend
- `global_state.active_sessions` is excluded everywhere as simulated, non-real data
- No changes to `../backend` - this app is fully independent of it at the code level, coupled only by reading/writing the same database

## Project Structure

See [CLAUDE.md](CLAUDE.md) for the full directory layout, architecture rationale, and known gotchas in the shadcn/Base UI setup and the URL-state, table, and server-action patterns.
