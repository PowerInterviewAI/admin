# SPEC.md

Project specification for the Power Interview AI admin dashboard - a local-only, production-quality admin panel for analytics, user/payment/session management, and audit log review.

## Overview

`admin` is a standalone full-stack app (FastAPI + Next.js) that reads and writes the same MongoDB database `../backend` uses for the Power Interview AI product. It does not call backend's API - it talks to MongoDB directly, since backend exposes no admin-facing endpoints today. It is meant to run on a single local machine, opened in a browser; it is never deployed or exposed publicly, and has no authentication.

## Tech Stack

| Layer            | Technology                                          |
| ---------------- | ---------------------------------------------------- |
| API              | FastAPI (Python 3.12), uv-managed                    |
| Database access  | pymongo async client, direct to MongoDB (no ODM)     |
| Frontend         | Next.js 16 (App Router), React 19, TypeScript        |
| Styling          | Tailwind CSS v4, shadcn/ui (Base UI-based, `base-nova` preset) |
| Data fetching    | TanStack Query v5 (client-side only - no server components fetch data) |
| Tables           | TanStack Table v8                                    |
| Charts           | Recharts, via shadcn's `Chart` wrapper                |
| Forms            | react-hook-form + Zod                                |
| Package managers | `uv` (Python), `pnpm` (Node)                          |

## Data Model

Five MongoDB collections, owned by `../backend` and read/written here without any schema-migration coordination between the two repos:

| Collection    | Key fields                                                                                          | Notes |
| ------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| `users`       | `username`, `email`, `role` (`user`/`trial_user`/`admin`), `status` (`active`/`inactive`), `credits`  | `password_hash` is always masked to `null` in API responses |
| `payments`    | `user_id`, `plan` (`starter`/`pro`/`enterprise`), `status` (10-value enum), `price_amount`, `credits_amount`, `credits_applied` | Status/`credits_applied` are manually editable here - editing does **not** call NOWPayments or replay webhook logic |
| `sessions`    | `token`, `user_id`, `device_info` (`ip_address`, `user_agent`)                                        | Deleting one force-logs-out that device. `token` is never served by the API - it is a live bearer credential |
| `audit_logs`  | `event_type` (16-value enum), `user_id`, `email`, `status`, `metadata` (free-form dict)               | Read-only in the UI; this is the primary real-usage signal |
| `global_state`| `active_sessions`                                                                                      | **Not used anywhere in this app** - it's a simulated `random.gauss(260, 10)` value in backend, not real data |

## Features

### Analytics (`/`)

All computed server-side from real documents (`app/services/analytics_service.py`), never from `global_state`:

- KPI cards: total users (+ admin count), lifetime revenue from `finished` payments, credits outstanding across all users, ASR sessions in the last 30 days
- Signups per day and revenue per day (last 30 days), as trend charts
- Users-by-role and payments-by-status distributions
- Recent activity feed: latest 20 audit log entries

### Users (`/users`)

Search (username/email), filter by role and status, paginated table. Row click opens an edit sheet: role, status, credits, username, email are all editable; the sheet also shows that user's payment and session counts, and has a delete action (destructive, confirmed via dialog).

### Payments (`/payments`)

Filter by status and plan, paginated table showing which user each payment belongs to. Row click opens an edit sheet for a manual `status`/`credits_applied` override - explicitly labeled as a support/manual tool, not a payment-provider action.

### Sessions (`/sessions`)

Paginated table of every active session across all users, showing the account and device behind each one, with a revoke action (confirmed via dialog) that deletes the session document, forcing that device to re-authenticate.

### Audit Logs (`/audit-logs`)

Filterable (event type, status, date range) read-only table. Row click opens a dialog with the full record, including the raw `metadata` JSON.

### Cross-cutting UI behaviour

- Light and dark themes, following the system preference by default with a toggle in the header
- Every table distinguishes "no rows matched" from "the API could not be reached", the latter with a retry action
- Destructive actions (delete user, revoke session) always go through a confirmation dialog
- Every mutation reports success or failure as a toast

## Out of Scope

- No authentication or authorization - local-only tool, confirmed decision
- No user creation from the admin panel (only editing existing users)
- No payment creation - payments only originate from the real NOWPayments flow in backend
- `global_state.active_sessions` is excluded everywhere as simulated, non-real data
- No changes to `../backend` - this app is fully independent of it at the code level, coupled only by reading/writing the same database

## Project Structure

See [CLAUDE.md](CLAUDE.md) for the full directory layout, architecture rationale, and known gotchas in the shadcn/Base UI setup and the form/PATCH patterns.
